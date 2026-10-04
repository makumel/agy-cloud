const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const memory = require('./memory');
const tools = require('./tools');
const gemini = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_PASSWORD = process.env.PASSWORD || 'asenso123';
const SERVER_GEMINI_KEY = process.env.GEMINI_API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Simple Auth Middleware
function authMiddleware(req, res, next) {
  const token = req.cookies['agy_auth'] || req.headers['authorization'];
  if (token === AUTH_PASSWORD || !AUTH_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// Honeypot Protection Validator
function checkHoneypot(req, res) {
  const hp = req.body.website || req.body._hp_check || req.body.hp_field;
  if (hp && hp.trim().length > 0) {
    // Bot detected: Silent drop
    return false;
  }
  return true;
}

// --- Auth Routes ---
app.post('/api/auth/login', (req, res) => {
  if (!checkHoneypot(req, res)) {
    return res.status(400).json({ error: 'Invalid submission' });
  }

  const { password } = req.body;
  if (password === AUTH_PASSWORD) {
    res.cookie('agy_auth', password, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax'
    });
    return res.json({ success: true, message: 'Authenticated successfully' });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.cookies['agy_auth'] || req.headers['authorization'];
  if (token === AUTH_PASSWORD || !AUTH_PASSWORD) {
    return res.json({ authenticated: true });
  }
  return res.json({ authenticated: false });
});

// --- Session Routes ---
app.get('/api/sessions', authMiddleware, (req, res) => {
  const list = memory.listSessions();
  res.json({ sessions: list });
});

app.post('/api/sessions', authMiddleware, (req, res) => {
  const id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const newSession = {
    id,
    title: req.body.title || 'New Workspace Task',
    messages: [],
    artifacts: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  memory.saveSession(id, newSession);
  res.json({ session: newSession });
});

app.get('/api/sessions/:id', authMiddleware, (req, res) => {
  const sess = memory.getSession(req.params.id);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  res.json({ session: sess });
});

app.delete('/api/sessions/:id', authMiddleware, (req, res) => {
  const ok = memory.deleteSession(req.params.id);
  res.json({ success: ok });
});

// --- Chat & Agent Execution Stream (SSE) ---
app.post('/api/chat', authMiddleware, async (req, res) => {
  if (!checkHoneypot(req, res)) {
    return res.status(400).json({ error: 'Invalid submission' });
  }

  const { sessionId, message, model, apiKey } = req.body;
  const effectiveKey = (apiKey && apiKey.trim()) || SERVER_GEMINI_KEY;

  if (!effectiveKey) {
    return res.status(400).json({
      error: 'No Gemini API Key provided. Please enter your free Google AI Studio API Key in Settings or set GEMINI_API_KEY environment variable.'
    });
  }

  let session = memory.getSession(sessionId);
  if (!session) {
    session = {
      id: sessionId || ('sess_' + Date.now()),
      title: (message && message.slice(0, 30)) || 'Task',
      messages: [],
      artifacts: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  // Append user message
  if (message) {
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now()
    });
  }

  // Setup Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendSSE = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendSSE('status', { message: 'Agent thinking...' });

    const assistantResult = await gemini.runAgentTurn({
      apiKey: effectiveKey,
      model: model || 'gemini-2.5-flash',
      messages: session.messages,
      onChunk: (chunk) => {
        sendSSE('chunk', chunk);
      },
      onArtifactCreated: (art) => {
        session.artifacts = session.artifacts || [];
        session.artifacts.unshift(art);
        sendSSE('artifact', art);
      }
    });

    // Save assistant response to session
    session.messages.push({
      role: 'model',
      content: assistantResult.content,
      toolCalls: assistantResult.toolCalls,
      toolResults: assistantResult.toolResults,
      artifacts: assistantResult.artifacts,
      timestamp: Date.now()
    });

    if (session.title === 'New Workspace Task' && message) {
      session.title = message.slice(0, 35);
    }

    memory.saveSession(session.id, session);
    sendSSE('done', { sessionId: session.id });
    res.end();
  } catch (err) {
    console.error('Agent execution error:', err);
    sendSSE('error', { message: err.message || 'Agent encountered an error.' });
    res.end();
  }
});

// --- Persistent Memory Bank API ---
app.get('/api/memory', authMiddleware, (req, res) => {
  const content = memory.getMemory();
  res.json({ memory: content });
});

app.post('/api/memory', authMiddleware, (req, res) => {
  const { content } = req.body;
  const ok = memory.setMemory(content || '');
  res.json({ success: ok });
});

// --- Workspace File Explorer API ---
app.get('/api/files', authMiddleware, async (req, res) => {
  const sub = req.query.path || '';
  const result = await tools.executeTool('list_files', { directory: sub });
  res.json(result);
});

app.get('/api/files/content', authMiddleware, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const result = await tools.executeTool('read_file', { path: filePath });
  res.json(result);
});

app.post('/api/files/content', authMiddleware, async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const result = await tools.executeTool('write_file', { path: filePath, content });
  res.json(result);
});

// --- Integrated Web Terminal API ---
app.post('/api/terminal', authMiddleware, async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Command required' });
  const result = await tools.executeTool('execute_command', { command });
  res.json(result);
});

// --- System Telemetry ---
app.get('/api/system/status', authMiddleware, (req, res) => {
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const uptime = os.uptime();
  const cpus = os.cpus().length;

  res.json({
    totalMemMB: Math.round(totalMem / (1024 * 1024)),
    freeMemMB: Math.round(freeMem / (1024 * 1024)),
    usedMemMB: Math.round((totalMem - freeMem) / (1024 * 1024)),
    uptimeHours: (uptime / 3600).toFixed(1),
    cpus,
    workspace: tools.WORKSPACE_ROOT,
    hasServerApiKey: Boolean(SERVER_GEMINI_KEY)
  });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Antigravity 2.0 Web Agent listening on http://0.0.0.0:${PORT}`);
  console.log(`📁 Workspace root: ${tools.WORKSPACE_ROOT}`);
});
