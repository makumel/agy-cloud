// Antigravity 2.0 Client Application Logic

let currentSessionId = null;
let currentArtifacts = [];
let selectedArtifactIndex = -1;
let artifactViewMode = 'preview'; // 'preview' or 'code'
let isAgentStreaming = false;

// DOM Elements
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginPasswordInput = document.getElementById('login-password');
const settingsModal = document.getElementById('settings-modal');
const settingsApiKeyInput = document.getElementById('settings-api-key');
const settingsModelSelect = document.getElementById('settings-model');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');

const messagesContainer = document.getElementById('messages-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const newTaskBtn = document.getElementById('new-task-btn');
const sessionTitleEl = document.getElementById('session-title');
const activeModelBadge = document.getElementById('active-model-badge');
const agentStatusBar = document.getElementById('agent-status-bar');
const agentStatusText = document.getElementById('agent-status-text');

const hubTabBtns = document.querySelectorAll('.hub-tab-btn');
const hubTabPanes = document.querySelectorAll('.hub-tab-pane');
const mobileNavBtns = document.querySelectorAll('.mobile-nav-btn');
const chatPane = document.getElementById('chat-pane');
const hubPane = document.getElementById('hub-pane');

const artifactsBadge = document.getElementById('artifacts-badge');
const mobileArtifactsBadge = document.getElementById('mobile-artifacts-badge');
const artifactsList = document.getElementById('artifacts-list');
const artifactEmpty = document.getElementById('artifact-empty');
const artifactIframe = document.getElementById('artifact-iframe');
const artifactCodeView = document.getElementById('artifact-code-view');
const artifactCodeBlock = document.getElementById('artifact-code-block');
const artifactViewModeToggle = document.getElementById('artifact-view-mode-toggle');

const fileTree = document.getElementById('file-tree');
const fileEditor = document.getElementById('file-editor');
const currentFilePath = document.getElementById('current-file-path');
const fileSaveBtn = document.getElementById('file-save-btn');

const memoryEditor = document.getElementById('memory-editor');
const saveMemoryBtn = document.getElementById('save-memory-btn');
const openMemoryTopBtn = document.getElementById('open-memory-top-btn');

const terminalForm = document.getElementById('terminal-form');
const terminalInput = document.getElementById('terminal-input');
const terminalOutput = document.getElementById('terminal-output');
const hubRefreshBtn = document.getElementById('hub-refresh-btn');

// Initialize Icons
lucide.createIcons();

// --- Configuration & LocalStorage ---
function getStoredApiKey() {
  return localStorage.getItem('agy_gemini_key') || '';
}

function getStoredModel() {
  const model = localStorage.getItem('agy_gemini_model');
  if (!model || model === 'gemini-2.5-flash' || model === 'gemini-1.5-pro' || model === 'gemini-2.0-flash') {
    localStorage.setItem('agy_gemini_model', 'gemini-3.5-flash');
    return 'gemini-3.5-flash';
  }
  return model;
}

function saveConfig(apiKey, model) {
  if (apiKey !== undefined) localStorage.setItem('agy_gemini_key', apiKey.trim());
  if (model) localStorage.setItem('agy_gemini_model', model);
}

// --- App Initialization ---
async function initApp() {
  settingsApiKeyInput.value = getStoredApiKey();
  settingsModelSelect.value = getStoredModel();
  activeModelBadge.textContent = getStoredModel();

  // Check Auth
  try {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (!data.authenticated) {
      loginModal.classList.remove('hidden');
    } else {
      loadSessionsAndBoot();
    }
  } catch (err) {
    loginModal.classList.remove('hidden');
  }

  fetchSystemTelemetry();
}

// --- Auth Handling ---
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const hp = loginForm.querySelector('[name="website"]').value;
  const password = loginPasswordInput.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, website: hp })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loginModal.classList.add('hidden');
      loadSessionsAndBoot();
    } else {
      alert(data.error || 'Login failed');
    }
  } catch (err) {
    alert('Server connection error');
  }
});

// --- System Telemetry ---
async function fetchSystemTelemetry() {
  try {
    const res = await fetch('/api/system/status');
    if (!res.ok) return;
    const data = await res.json();
    const statsEl = document.getElementById('system-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="flex justify-between"><span>RAM:</span> <span class="text-white font-mono">${data.usedMemMB} MB / ${data.totalMemMB} MB (Swap active)</span></div>
        <div class="flex justify-between"><span>CPU Cores:</span> <span class="text-white font-mono">${data.cpus} vCPUs</span></div>
        <div class="flex justify-between"><span>Server Uptime:</span> <span class="text-white font-mono">${data.uptimeHours} hrs</span></div>
        <div class="flex justify-between"><span>Server API Key:</span> <span class="text-white font-mono">${data.hasServerApiKey ? 'Configured ✅' : 'Client Mode'}</span></div>
      `;
    }
  } catch (_) {}
}

// --- Session & Memory Loading ---
async function loadSessionsAndBoot() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    const sessions = data.sessions || [];

    if (sessions.length > 0) {
      loadSession(sessions[0].id);
    } else {
      createNewSession();
    }

    loadMemoryBank();
    loadWorkspaceFiles();
  } catch (err) {
    console.error('Boot error:', err);
  }
}

async function createNewSession() {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Workspace Task' })
    });
    const data = await res.json();
    if (data.session) {
      loadSession(data.session.id);
    }
  } catch (err) {
    console.error('Failed to create session:', err);
  }
}

async function loadSession(sessionId) {
  currentSessionId = sessionId;
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    const data = await res.json();
    const session = data.session;
    if (!session) return;

    sessionTitleEl.textContent = session.title || 'Workspace Task';
    messagesContainer.innerHTML = '';
    currentArtifacts = session.artifacts || [];

    updateArtifactsUI();

    // Render Messages
    for (const msg of session.messages || []) {
      renderMessage(msg);
    }

    scrollToBottom();
  } catch (err) {
    console.error('Failed to load session:', err);
  }
}

newTaskBtn.addEventListener('click', () => {
  createNewSession();
});

// --- Settings Dialog ---
openSettingsBtn.addEventListener('click', () => {
  fetchSystemTelemetry();
  settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', () => {
  saveConfig(settingsApiKeyInput.value, settingsModelSelect.value);
  activeModelBadge.textContent = settingsModelSelect.value;
  settingsModal.classList.add('hidden');
});

// --- Message Rendering ---
function renderMessage(msg) {
  const isUser = msg.role === 'user';
  const msgDiv = document.createElement('div');
  msgDiv.className = `flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`;

  const headerDiv = document.createElement('div');
  headerDiv.className = 'flex items-center gap-1.5 text-[10px] text-slate-400 px-1';
  headerDiv.innerHTML = isUser
    ? `<span>You</span> <i data-lucide="user" class="w-3 h-3"></i>`
    : `<i data-lucide="orbit" class="w-3 h-3 text-indigo-400"></i> <span class="text-indigo-300 font-medium">Antigravity 2.0</span>`;

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = isUser
    ? 'bg-indigo-600/90 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[90%] sm:max-w-[85%] text-sm shadow-md'
    : 'bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-sm p-4 max-w-[95%] sm:max-w-[90%] text-sm prose-dark shadow-md';

  // If assistant message has tool calls
  let toolsHtml = '';
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (let i = 0; i < msg.toolCalls.length; i++) {
      const call = msg.toolCalls[i];
      const res = msg.toolResults ? msg.toolResults[i]?.result : null;
      const resStr = typeof res === 'object' ? JSON.stringify(res, null, 2) : (res || 'Executed');

      toolsHtml += `
        <div class="tool-call-card">
          <div class="tool-call-header bg-slate-900/90 text-slate-300 hover:text-white" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span class="font-mono font-semibold text-emerald-300">${call.name}</span>
            </div>
            <span class="text-[10px] text-slate-400">details ▼</span>
          </div>
          <div class="tool-call-body hidden">
            <div class="text-slate-400 mb-1">// Arguments:</div>
            <div>${JSON.stringify(call.args, null, 2)}</div>
            <div class="text-slate-400 mt-2 mb-1">// Output:</div>
            <div class="text-emerald-300">${resStr}</div>
          </div>
        </div>
      `;
    }
  }

  if (isUser) {
    bubbleDiv.textContent = msg.content;
  } else {
    const rawContent = msg.content || '';
    bubbleDiv.innerHTML = marked.parse(rawContent) + toolsHtml;
    // Highlight Code
    bubbleDiv.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }

  msgDiv.appendChild(headerDiv);
  msgDiv.appendChild(bubbleDiv);
  messagesContainer.appendChild(msgDiv);
  lucide.createIcons();
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- Chat Form & Streaming Submission ---
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// Quick Prompt Buttons
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('quick-prompt-btn')) {
    chatInput.value = e.target.textContent.trim();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  const hp = document.getElementById('global_hp').value;
  if (!text || isAgentStreaming) return;

  const apiKey = getStoredApiKey();
  const model = getStoredModel();

  chatInput.value = '';
  isAgentStreaming = true;
  sendBtn.disabled = true;

  // Append user message to UI
  renderMessage({ role: 'user', content: text });
  scrollToBottom();

  // Create temporary assistant message bubble
  const streamMsgDiv = document.createElement('div');
  streamMsgDiv.className = 'flex flex-col items-start space-y-1.5';
  streamMsgDiv.innerHTML = `
    <div class="flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
      <i data-lucide="orbit" class="w-3 h-3 text-indigo-400 animate-spin-slow"></i>
      <span class="text-indigo-300 font-medium">Antigravity 2.0 (Thinking...)</span>
    </div>
    <div class="stream-bubble bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-sm p-4 max-w-[95%] sm:max-w-[90%] text-sm prose-dark shadow-md">
      <span class="inline-block w-2 h-4 bg-indigo-400 animate-pulse"></span>
    </div>
  `;
  messagesContainer.appendChild(streamMsgDiv);
  lucide.createIcons();
  scrollToBottom();

  const bubbleEl = streamMsgDiv.querySelector('.stream-bubble');
  let accumulatedText = "";

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        message: text,
        model,
        apiKey,
        _hp_check: hp
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to communicate with agent');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        const match = line.match(/^event:\s*(.*?)\ndata:\s*(.*)$/s);
        if (match) {
          const eventType = match[1];
          let eventData = {};
          try { eventData = JSON.parse(match[2]); } catch (_) {}

          if (eventType === 'status') {
            agentStatusBar.classList.remove('hidden');
            agentStatusText.textContent = eventData.message || 'Agent executing...';
          } else if (eventType === 'chunk') {
            const chunk = eventData;
            if (chunk.type === 'token') {
              accumulatedText += chunk.content;
              bubbleEl.innerHTML = marked.parse(accumulatedText);
              bubbleEl.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
              scrollToBottom();
            } else if (chunk.type === 'tool_call') {
              agentStatusBar.classList.remove('hidden');
              agentStatusText.textContent = `Running tool: ${chunk.name}...`;
            }
          } else if (eventType === 'artifact') {
            currentArtifacts.unshift(eventData);
            updateArtifactsUI();
            selectArtifact(0);
            // Switch to Artifacts tab
            switchToHubTab('artifacts');
          } else if (eventType === 'done') {
            agentStatusBar.classList.add('hidden');
          } else if (eventType === 'error') {
            accumulatedText += `\n\n> ⚠️ **Error**: ${eventData.message}`;
            bubbleEl.innerHTML = marked.parse(accumulatedText);
          }
        }
      }
    }

    // Refresh memory and file tree after turn
    loadMemoryBank();
    loadWorkspaceFiles();

  } catch (err) {
    bubbleEl.innerHTML = marked.parse(`> ❌ **Agent Error**: ${err.message}`);
    if (err.message.includes('API Key')) {
      settingsModal.classList.remove('hidden');
    }
  } finally {
    isAgentStreaming = false;
    sendBtn.disabled = false;
    agentStatusBar.classList.add('hidden');
    scrollToBottom();
  }
});

// --- Artifacts System ---
function updateArtifactsUI() {
  artifactsBadge.textContent = currentArtifacts.length;
  if (currentArtifacts.length > 0) {
    mobileArtifactsBadge.classList.remove('hidden');
    artifactsList.innerHTML = '';
    currentArtifacts.forEach((art, idx) => {
      const btn = document.createElement('button');
      btn.className = `px-2.5 py-1 rounded-lg text-xs font-medium truncate max-w-[140px] border transition ${
        selectedArtifactIndex === idx
          ? 'bg-indigo-600 text-white border-indigo-500'
          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
      }`;
      btn.textContent = art.title || `Artifact #${idx + 1}`;
      btn.addEventListener('click', () => selectArtifact(idx));
      artifactsList.appendChild(btn);
    });

    if (selectedArtifactIndex === -1 && currentArtifacts.length > 0) {
      selectArtifact(0);
    }
  } else {
    mobileArtifactsBadge.classList.add('hidden');
    artifactsList.innerHTML = '<span class="text-slate-500 italic text-[11px]">No artifacts yet</span>';
    artifactEmpty.classList.remove('hidden');
    artifactIframe.classList.add('hidden');
    artifactCodeView.classList.add('hidden');
    artifactViewModeToggle.classList.add('hidden');
  }
}

function selectArtifact(index) {
  if (!currentArtifacts[index]) return;
  selectedArtifactIndex = index;
  const art = currentArtifacts[index];

  artifactEmpty.classList.add('hidden');
  artifactViewModeToggle.classList.remove('hidden');

  if (art.type === 'html' || art.type === 'react' || art.type === 'svg') {
    if (artifactViewMode === 'preview') {
      renderArtifactPreview(art);
    } else {
      renderArtifactCode(art);
    }
  } else {
    renderArtifactCode(art);
  }

  updateArtifactsUI();
}

function renderArtifactPreview(art) {
  artifactIframe.classList.remove('hidden');
  artifactCodeView.classList.add('hidden');

  let content = art.content;
  // If HTML snippet without full doc, wrap it with Tailwind
  if (!content.includes('<!DOCTYPE html>') && !content.includes('<html')) {
    content = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://unpkg.com/lucide@latest"></script>
      </head>
      <body class="bg-slate-900 text-white p-4 font-sans antialiased min-h-screen">
        ${content}
        <script>lucide.createIcons();</script>
      </body>
      </html>
    `;
  }

  artifactIframe.srcdoc = content;
}

function renderArtifactCode(art) {
  artifactIframe.classList.add('hidden');
  artifactCodeView.classList.remove('hidden');
  artifactCodeBlock.textContent = art.content;
  hljs.highlightElement(artifactCodeBlock);
}

artifactViewModeToggle.addEventListener('click', () => {
  artifactViewMode = artifactViewMode === 'preview' ? 'code' : 'preview';
  artifactViewModeToggle.textContent = artifactViewMode === 'preview' ? 'Show Code' : 'Show Preview';
  if (selectedArtifactIndex >= 0) {
    selectArtifact(selectedArtifactIndex);
  }
});

// --- Hub Tab Navigation ---
function switchToHubTab(tabName) {
  hubTabBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  hubTabPanes.forEach(p => {
    p.classList.toggle('hidden', p.id !== `tab-${tabName}`);
  });

  // Mobile layout switch
  if (window.innerWidth < 768) {
    if (tabName === 'chat') {
      chatPane.classList.remove('hidden');
      hubPane.classList.add('hidden');
    } else {
      chatPane.classList.add('hidden');
      hubPane.classList.remove('hidden');
    }
    mobileNavBtns.forEach(mb => {
      mb.classList.toggle('text-indigo-400', mb.dataset.target === tabName);
      mb.classList.toggle('text-slate-400', mb.dataset.target !== tabName);
    });
  }
}

hubTabBtns.forEach(btn => {
  btn.addEventListener('click', () => switchToHubTab(btn.dataset.tab));
});

mobileNavBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    switchToHubTab(target);
  });
});

openMemoryTopBtn.addEventListener('click', () => {
  switchToHubTab('memory');
});

// --- Files Explorer ---
async function loadWorkspaceFiles() {
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    fileTree.innerHTML = '';
    if (!data.items || data.items.length === 0) {
      fileTree.innerHTML = '<div class="text-slate-500 italic p-2">Workspace is empty</div>';
      return;
    }
    data.items.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'flex items-center gap-1.5 p-1.5 rounded hover:bg-slate-800 cursor-pointer text-slate-300';
      const icon = item.type === 'directory' ? '📁' : '📄';
      itemEl.innerHTML = `<span>${icon}</span> <span class="truncate">${item.name}</span>`;
      itemEl.addEventListener('click', () => {
        if (item.type !== 'directory') {
          loadFileContent(item.name);
        }
      });
      fileTree.appendChild(itemEl);
    });
  } catch (_) {}
}

async function loadFileContent(filePath) {
  try {
    currentFilePath.textContent = `/workspace/${filePath}`;
    fileSaveBtn.classList.remove('hidden');
    const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    fileEditor.value = data.content || '';
    fileSaveBtn.onclick = () => saveFileContent(filePath);
  } catch (err) {
    alert('Failed to read file');
  }
}

async function saveFileContent(filePath) {
  try {
    const res = await fetch('/api/files/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: fileEditor.value })
    });
    if (res.ok) {
      alert('File saved to workspace container!');
    }
  } catch (err) {
    alert('Failed to save file');
  }
}

// --- Persistent Memory Bank ---
async function loadMemoryBank() {
  try {
    const res = await fetch('/api/memory');
    const data = await res.json();
    if (data.memory) {
      memoryEditor.value = data.memory;
    }
  } catch (_) {}
}

saveMemoryBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: memoryEditor.value })
    });
    if (res.ok) {
      alert('🧠 Persistent Memory updated successfully! The agent will use this across all sessions.');
    }
  } catch (err) {
    alert('Failed to save memory');
  }
});

// --- Web Terminal ---
terminalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cmd = terminalInput.value.trim();
  if (!cmd) return;
  terminalInput.value = '';

  const cmdLine = document.createElement('div');
  cmdLine.className = 'text-emerald-400 font-bold';
  cmdLine.textContent = `$ ${cmd}`;
  terminalOutput.appendChild(cmdLine);

  try {
    const res = await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();
    const outDiv = document.createElement('div');
    outDiv.className = 'text-slate-300 whitespace-pre-wrap';
    outDiv.textContent = data.output || '(No output)';
    terminalOutput.appendChild(outDiv);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  } catch (err) {
    const errDiv = document.createElement('div');
    errDiv.className = 'text-red-400';
    errDiv.textContent = `Execution failed: ${err.message}`;
    terminalOutput.appendChild(errDiv);
  }
});

hubRefreshBtn.addEventListener('click', () => {
  loadWorkspaceFiles();
  loadMemoryBank();
  fetchSystemTelemetry();
});

// --- Project Import & Git Modal Handling ---
const importModal = document.getElementById('import-modal');
const openImportBtn = document.getElementById('open-import-btn');
const closeImportBtn = document.getElementById('close-import-btn');
const importGitUrl = document.getElementById('import-git-url');
const importGitFolder = document.getElementById('import-git-folder');
const btnDoClone = document.getElementById('btn-do-clone');
const btnDoPull = document.getElementById('btn-do-pull');
const importPullFolder = document.getElementById('import-pull-folder');
const importFileInput = document.getElementById('import-file-input');
const btnDoUpload = document.getElementById('btn-do-upload');
const importStatusMsg = document.getElementById('import-status-msg');

if (openImportBtn) {
  openImportBtn.addEventListener('click', () => {
    importModal.classList.remove('hidden');
    importStatusMsg.classList.add('hidden');
    lucide.createIcons();
  });
}

if (closeImportBtn) {
  closeImportBtn.addEventListener('click', () => {
    importModal.classList.add('hidden');
  });
}

if (btnDoClone) {
  btnDoClone.addEventListener('click', async () => {
    const gitUrl = importGitUrl.value.trim();
    const folderName = importGitFolder.value.trim();
    if (!gitUrl) {
      alert('Please enter a Git URL');
      return;
    }
    btnDoClone.disabled = true;
    btnDoClone.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Cloning repository...</span>';
    lucide.createIcons();
    try {
      const res = await fetch('/api/projects/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitUrl, folderName })
      });
      const data = await res.json();
      importStatusMsg.classList.remove('hidden');
      if (data.success) {
        importStatusMsg.className = 'text-xs p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300';
        importStatusMsg.innerHTML = `✅ Successfully cloned into <b>/workspace/${data.folder}</b>`;
        loadWorkspaceFiles();
      } else {
        importStatusMsg.className = 'text-xs p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300';
        importStatusMsg.innerHTML = `❌ Clone error: ${data.details || 'Unknown error'}`;
      }
    } catch (err) {
      importStatusMsg.classList.remove('hidden');
      importStatusMsg.className = 'text-xs p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300';
      importStatusMsg.textContent = 'Network or server error during clone';
    } finally {
      btnDoClone.disabled = false;
      btnDoClone.innerHTML = '<i data-lucide="download-cloud" class="w-4 h-4"></i><span>Clone Repository to Workspace</span>';
      lucide.createIcons();
    }
  });
}

if (btnDoPull) {
  btnDoPull.addEventListener('click', async () => {
    const folderName = importPullFolder.value.trim();
    btnDoPull.disabled = true;
    btnDoPull.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Pulling changes...</span>';
    lucide.createIcons();
    try {
      const res = await fetch('/api/projects/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName })
      });
      const data = await res.json();
      importStatusMsg.classList.remove('hidden');
      if (data.success) {
        importStatusMsg.className = 'text-xs p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300';
        importStatusMsg.innerHTML = `✅ Git Pull completed:<br><pre class="mt-1 font-mono text-[10px] whitespace-pre-wrap">${data.details}</pre>`;
        loadWorkspaceFiles();
      } else {
        importStatusMsg.className = 'text-xs p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300';
        importStatusMsg.innerHTML = `❌ Pull error: ${data.details || 'Unknown error'}`;
      }
    } catch (err) {
      importStatusMsg.classList.remove('hidden');
      importStatusMsg.className = 'text-xs p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300';
      importStatusMsg.textContent = 'Network or server error during pull';
    } finally {
      btnDoPull.disabled = false;
      btnDoPull.innerHTML = '<i data-lucide="git-pull-request" class="w-4 h-4"></i><span>Run Git Pull</span>';
      lucide.createIcons();
    }
  });
}

if (btnDoUpload) {
  btnDoUpload.addEventListener('click', async () => {
    const files = importFileInput.files;
    if (!files || files.length === 0) {
      alert('Please select files to upload');
      return;
    }
    btnDoUpload.disabled = true;
    btnDoUpload.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Uploading files...</span>';
    lucide.createIcons();
    try {
      const fileList = [];
      for (const file of files) {
        const text = await file.text();
        fileList.push({ path: file.name, content: text });
      }
      const res = await fetch('/api/projects/import-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileList })
      });
      const data = await res.json();
      importStatusMsg.classList.remove('hidden');
      if (data.success) {
        importStatusMsg.className = 'text-xs p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300';
        importStatusMsg.innerHTML = `✅ Successfully imported <b>${data.count} file(s)</b> into /workspace`;
        loadWorkspaceFiles();
      } else {
        importStatusMsg.className = 'text-xs p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300';
        importStatusMsg.textContent = 'Upload failed';
      }
    } catch (err) {
      importStatusMsg.classList.remove('hidden');
      importStatusMsg.className = 'text-xs p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300';
      importStatusMsg.textContent = 'File upload error: ' + err.message;
    } finally {
      btnDoUpload.disabled = false;
      btnDoUpload.innerHTML = '<i data-lucide="upload" class="w-4 h-4"></i><span>Upload Files to Workspace</span>';
      lucide.createIcons();
    }
  });
}

// Start App
window.addEventListener('DOMContentLoaded', initApp);
