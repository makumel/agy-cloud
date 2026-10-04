const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = process.env.WORKSPACE_DIR || path.join(__dirname, '../../workspace');
const AGY_DATA_DIR = path.join(WORKSPACE_ROOT, '.agy');
const MEMORY_FILE = path.join(AGY_DATA_DIR, 'MEMORY.md');
const SESSIONS_DIR = path.join(AGY_DATA_DIR, 'sessions');

// Ensure directories exist
function initStorage() {
  try {
    if (!fs.existsSync(WORKSPACE_ROOT)) {
      fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }
    if (!fs.existsSync(AGY_DATA_DIR)) {
      fs.mkdirSync(AGY_DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    if (!fs.existsSync(MEMORY_FILE)) {
      const defaultMemory = `# 🧠 Antigravity 2.0 Persistent Memory Bank

## 1. System Environment & Infrastructure
- **Server**: Google Cloud Platform (GCP) \`agy-cloud-vm\` in \`us-central1-a\`
- **Specs**: \`e2-micro\` (Free Tier, 1GB RAM + 5GB Swap Disk)
- **Public IP**: \`34.30.116.50\`
- **Web IDE (Code-Server)**: Port 8080 (Password: \`asenso123\`)
- **Antigravity 2.0 Web Agent**: Port 3000
- **Workspace Path**: \`/workspace\`

## 2. Active Projects & Current State
- Environment initialized with continuous cross-device memory.
- Ready to build, run terminal commands, write code, and display interactive artifacts.

## 3. User Preferences & Directives
- **Zero Cost Rule**: Keep all infrastructure and API usage strictly $0 free tier.
- **Continuous Workflow**: Always maintain task history and context when switching devices (mobile to desktop).
- **Artifacts First**: Render interactive UI components and formatted code blocks into artifacts for fast review.
`;
      fs.writeFileSync(MEMORY_FILE, defaultMemory, 'utf8');
    }
  } catch (err) {
    console.error('Failed to initialize memory storage:', err);
  }
}

initStorage();

function getMemory() {
  try {
    initStorage();
    if (fs.existsSync(MEMORY_FILE)) {
      return fs.readFileSync(MEMORY_FILE, 'utf8');
    }
  } catch (err) {
    console.error('Error reading memory file:', err);
  }
  return '';
}

function setMemory(content) {
  try {
    initStorage();
    fs.writeFileSync(MEMORY_FILE, content, 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing memory file:', err);
    return false;
  }
}

function appendToMemory(heading, content) {
  try {
    initStorage();
    let current = getMemory();
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const entry = `\n\n### [${timestamp}] ${heading}\n${content}\n`;
    current += entry;
    fs.writeFileSync(MEMORY_FILE, current, 'utf8');
    return true;
  } catch (err) {
    console.error('Error appending memory:', err);
    return false;
  }
}

function listSessions() {
  try {
    initStorage();
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
        const data = JSON.parse(raw);
        sessions.push({
          id: data.id,
          title: data.title || 'Untitled Session',
          updatedAt: data.updatedAt || 0,
          messageCount: (data.messages || []).length,
          artifactCount: (data.artifacts || []).length
        });
      } catch (e) {
        // ignore corrupted file
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error('Error listing sessions:', err);
    return [];
  }
}

function getSession(sessionId) {
  try {
    initStorage();
    const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error getting session:', err);
  }
  return null;
}

function saveSession(sessionId, sessionData) {
  try {
    initStorage();
    const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
    sessionData.updatedAt = Date.now();
    fs.writeFileSync(file, JSON.stringify(sessionData, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving session:', err);
    return false;
  }
}

function deleteSession(sessionId) {
  try {
    const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch (err) {
    console.error('Error deleting session:', err);
  }
  return false;
}

module.exports = {
  WORKSPACE_ROOT,
  getMemory,
  setMemory,
  appendToMemory,
  listSessions,
  getSession,
  saveSession,
  deleteSession
};
