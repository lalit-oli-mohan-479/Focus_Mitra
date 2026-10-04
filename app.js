/* ============================================================
   FocusBuddy — Application Logic
   A gentle, private AI study companion
   Powered by Ollama (local) or Gemini API (cloud fallback)
   ============================================================ */

// ==================== STATE ====================
const state = {
  currentTab: 'decompose',
  ollamaConnected: false,
  geminiApiKey: localStorage.getItem('focusbuddy_gemini_key') || '',
  currentModel: '',
  availableModels: [],
  steps: [],          // { id, text, done }
  timer: {
    duration: 25 * 60,
    remaining: 25 * 60,
    isRunning: false,
    interval: null,
    mode: 'focus',     // 'focus' | 'short' | 'long'
  },
  todaySessions: 0,
  stats: loadStats(),
};

// Returns 'ollama' | 'gemini' | 'fallback'
function getActiveBackend() {
  if (state.ollamaConnected) return 'ollama';
  if (state.geminiApiKey) return 'gemini';
  return 'fallback';
}

function loadStats() {
  try {
    const saved = localStorage.getItem('focusbuddy_stats');
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore */ }
  return {
    totalSessions: 0,
    totalStepsCompleted: 0,
    totalMinutes: 0,
    streak: 0,
    lastActiveDate: null,
    history: [],
  };
}

function saveStats() {
  localStorage.setItem('focusbuddy_stats', JSON.stringify(state.stats));
}


// ==================== OLLAMA API ====================
const OLLAMA_BASE = 'http://localhost:11434';

async function checkOllamaConnection() {
  const statusEl = document.getElementById('connection-status');
  const statusText = statusEl.querySelector('.connection-text');
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('Not OK');
    const data = await res.json();
    state.ollamaConnected = true;
    state.availableModels = (data.models || []).map(m => m.name);
    statusEl.classList.remove('disconnected');
    statusEl.classList.add('connected');
    statusText.textContent = 'Ollama connected';
    populateModelSelector();
    document.getElementById('setup-modal').style.display = 'none';
    return true;
  } catch (e) {
    state.ollamaConnected = false;
    statusEl.classList.remove('connected');
    statusEl.classList.add('disconnected');
    statusText.textContent = 'Ollama offline';
    document.getElementById('setup-modal').style.display = 'flex';
    return false;
  }
}

function populateModelSelector() {
  const select = document.getElementById('model-select');
  select.innerHTML = '';
  if (state.availableModels.length === 0) {
    select.innerHTML = '<option value="">No models found</option>';
    return;
  }
  state.availableModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  });
  // Prefer llama3.2, then any first model
  const preferred = state.availableModels.find(m => m.includes('llama3.2'))
    || state.availableModels.find(m => m.includes('llama'))
    || state.availableModels.find(m => m.includes('qwen'))
    || state.availableModels.find(m => m.includes('gemma'))
    || state.availableModels[0];
  select.value = preferred;
  state.currentModel = preferred;
}

async function ollamaChat(messages) {
  const model = state.currentModel || state.availableModels[0];
  if (!model) throw new Error('No model selected');

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullText += json.message.content;
        }
      } catch (e) { /* skip malformed */ }
    }
  }
  return fullText;
}


// ==================== GEMINI API ====================

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function geminiChat(messages) {
  if (!state.geminiApiKey) throw new Error('No Gemini API key');

  // Convert Ollama-style messages to Gemini format
  const systemInstruction = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 1024,
    },
  };

  // Add system instruction if present
  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction.content }],
    };
  }

  const res = await fetch(`${GEMINI_API_URL}?key=${state.geminiApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini error: ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');
  return text;
}


// ==================== UNIFIED AI CHAT ====================
// Tries: Ollama → Gemini → returns null (caller handles fallback)

async function aiChat(messages) {
  // Try Ollama first
  if (state.ollamaConnected) {
    try {
      return await ollamaChat(messages);
    } catch (e) {
      console.warn('Ollama failed, trying Gemini...', e);
    }
  }

  // Try Gemini
  if (state.geminiApiKey) {
    try {
      return await geminiChat(messages);
    } catch (e) {
      console.warn('Gemini failed, using fallback...', e);
      showToast('⚠️', 'Gemini API error: ' + e.message);
    }
  }

  // Return null — caller uses hardcoded fallback
  return null;
}


// ==================== BACKEND STATUS ====================

function updateBackendStatus() {
  const statusEl = document.getElementById('ai-backend-status');
  if (!statusEl) return;

  const backend = getActiveBackend();
  statusEl.className = 'ai-backend-status ' + backend;

  switch (backend) {
    case 'ollama':
      statusEl.textContent = '🟢 Ollama (local)';
      break;
    case 'gemini':
      statusEl.textContent = '✨ Gemini API (cloud)';
      break;
    default:
      statusEl.textContent = '⚡ Built-in responses';
  }

  // Also update header badge
  const badge = document.querySelector('.header__badge');
  if (badge) {
    badge.textContent = backend === 'ollama' ? '100% Local AI' :
                        backend === 'gemini' ? 'Gemini AI' : 'Offline Mode';
  }
}

function saveGeminiKey(key) {
  state.geminiApiKey = key.trim();
  if (key.trim()) {
    localStorage.setItem('focusbuddy_gemini_key', key.trim());
  } else {
    localStorage.removeItem('focusbuddy_gemini_key');
  }
  updateBackendStatus();
}


// ==================== TASK DECOMPOSITION ====================

const DECOMPOSE_SYSTEM_PROMPT = `You are FocusBuddy, a warm, patient, and encouraging study companion. Your ONLY job right now is to break a user's overwhelming task into tiny, concrete micro-steps.

Rules:
- Create 5-10 micro-steps maximum
- Each step should take 5-15 minutes
- Start each step with a specific action verb (Open, Write, Read, Search, List, Draft, etc.)
- Be concrete and specific, not vague
- Add a relevant emoji at the START of each step
- Number each step
- After the steps, add one short encouraging line (1 sentence max)
- Do NOT add any other preamble or explanation — ONLY the numbered steps and the encouragement line
- Format: "1. 📖 Open the textbook to chapter 3 and read the first 2 pages"`;

async function decomposeTask(taskText) {
  const messages = [
    { role: 'system', content: DECOMPOSE_SYSTEM_PROMPT },
    { role: 'user', content: taskText },
  ];

  const stepsContainer = document.getElementById('steps-container');
  const stepsList = document.getElementById('steps-list');
  const btn = document.getElementById('decompose-btn');

  btn.classList.add('loading');
  btn.disabled = true;
  stepsContainer.style.display = 'none';
  stepsList.innerHTML = '';
  document.getElementById('steps-celebration').style.display = 'none';

  try {
    // Try AI backends, fall back to hardcoded
    let responseText = await aiChat(messages);
    if (!responseText) {
      responseText = generateFallbackSteps(taskText);
    }

    // Parse numbered steps from response
    const lines = responseText.split('\n').filter(l => l.trim());
    const steps = [];
    let encouragement = '';

    for (const line of lines) {
      const stepMatch = line.trim().match(/^\d+[\.\)]\s*(.+)/);
      if (stepMatch) {
        steps.push({ id: crypto.randomUUID(), text: stepMatch[1].trim(), done: false });
      } else if (steps.length > 0 && !line.trim().match(/^\d/)) {
        encouragement = line.trim();
      }
    }

    if (steps.length === 0) {
      // If parsing failed, just show the raw response as one step
      steps.push({ id: crypto.randomUUID(), text: responseText.trim(), done: false });
    }

    state.steps = steps;
    renderSteps(steps, encouragement);
    stepsContainer.style.display = 'block';
    showToast('✨', 'Broken down into ' + steps.length + ' micro-steps!');

  } catch (err) {
    console.error('Decompose error:', err);
    showToast('⚠️', 'Could not reach AI. Check Ollama connection.');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function generateFallbackSteps(taskText) {
  // Intelligent fallback when Ollama isn't available
  const words = taskText.split(/\s+/).length;
  const steps = [
    `📋 Read through the entire task description once, slowly — just to understand what's being asked`,
    `🔍 Identify the 2-3 key deliverables or requirements in the task`,
    `📝 Open a blank document and write a rough outline with section headers`,
    `🌐 Spend 10 minutes researching the main topic — jot down 3-5 key points`,
    `✍️ Write the first section — just get words on the page, don't worry about perfection`,
    `☕ Take a 2-minute stretch break — you've earned it`,
    `✍️ Write the next section using your research notes`,
    `🔄 Read through what you've written and fix any obvious gaps`,
    `✨ Polish the formatting, check spelling, and add any final touches`,
    `🎯 Do a final review and submit — you did it!`,
  ];
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n\nYou\'ve got this — one tiny step at a time. 💪';
}

function renderSteps(steps, encouragement) {
  const stepsList = document.getElementById('steps-list');
  stepsList.innerHTML = '';

  steps.forEach((step, index) => {
    const li = document.createElement('li');
    li.className = `step-item${step.done ? ' done' : ''}`;
    li.style.animationDelay = `${index * 80}ms`;
    li.innerHTML = `
      <div class="step-checkbox">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <span class="step-number">${index + 1}</span>
      <span class="step-text">${escapeHtml(step.text)}</span>
    `;
    li.addEventListener('click', () => toggleStep(step.id));
    stepsList.appendChild(li);
  });

  updateStepsProgress();
}

function toggleStep(stepId) {
  const step = state.steps.find(s => s.id === stepId);
  if (!step) return;
  step.done = !step.done;

  if (step.done) {
    state.stats.totalStepsCompleted++;
    saveStats();
  }

  renderSteps(state.steps);
  updateStepsProgress();

  // Check if all done
  if (state.steps.length > 0 && state.steps.every(s => s.done)) {
    document.getElementById('steps-celebration').style.display = 'block';
    showToast('🎉', 'All steps completed! You crushed it!');
  }
}

function updateStepsProgress() {
  const total = state.steps.length;
  const done = state.steps.filter(s => s.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('steps-progress-fill').style.width = `${pct}%`;
  document.getElementById('steps-progress-label').textContent = `${done} / ${total} done`;
}


// ==================== FOCUS TIMER ====================

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 100; // 628.32

function setTimerMode(minutes, mode) {
  if (state.timer.isRunning) stopTimer();
  state.timer.duration = minutes * 60;
  state.timer.remaining = minutes * 60;
  state.timer.mode = mode;

  // Update mode buttons
  document.querySelectorAll('.timer-mode').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.minutes) === minutes);
  });

  // Update timer section class
  const section = document.querySelector('.timer-section');
  section.classList.remove('running', 'break');
  if (mode !== 'focus') section.classList.add('break');

  updateTimerDisplay();
  document.getElementById('timer-session-label').textContent =
    mode === 'focus' ? 'Focus Session' : mode === 'short' ? 'Short Break' : 'Long Break';
  document.getElementById('timer-toggle-text').textContent =
    mode === 'focus' ? 'Start Focus' : 'Start Break';
}

function updateTimerDisplay() {
  const mins = Math.floor(state.timer.remaining / 60);
  const secs = state.timer.remaining % 60;
  document.getElementById('timer-time').textContent =
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  // Update SVG ring
  const progress = 1 - (state.timer.remaining / state.timer.duration);
  const offset = TIMER_CIRCUMFERENCE * (1 - progress);
  document.getElementById('timer-progress-ring').style.strokeDashoffset = offset;
}

function startTimer() {
  if (state.timer.isRunning) return;
  state.timer.isRunning = true;

  const section = document.querySelector('.timer-section');
  if (state.timer.mode === 'focus') section.classList.add('running');

  document.getElementById('timer-toggle-text').textContent = 'Pause';

  state.timer.interval = setInterval(() => {
    state.timer.remaining--;
    updateTimerDisplay();

    if (state.timer.remaining <= 0) {
      timerComplete();
    }
  }, 1000);
}

function stopTimer() {
  state.timer.isRunning = false;
  clearInterval(state.timer.interval);
  state.timer.interval = null;
  document.querySelector('.timer-section').classList.remove('running');
  document.getElementById('timer-toggle-text').textContent =
    state.timer.mode === 'focus' ? 'Resume' : 'Resume Break';
}

function resetTimer() {
  stopTimer();
  state.timer.remaining = state.timer.duration;
  updateTimerDisplay();
  document.getElementById('timer-toggle-text').textContent =
    state.timer.mode === 'focus' ? 'Start Focus' : 'Start Break';
}

function skipTimer() {
  timerComplete();
}

async function timerComplete() {
  stopTimer();
  state.timer.remaining = 0;
  updateTimerDisplay();

  if (state.timer.mode === 'focus') {
    state.todaySessions++;
    state.stats.totalSessions++;
    state.stats.totalMinutes += Math.round(state.timer.duration / 60);

    // Update streak
    const today = new Date().toDateString();
    if (state.stats.lastActiveDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      state.stats.streak = state.stats.lastActiveDate === yesterday ? state.stats.streak + 1 : 1;
      state.stats.lastActiveDate = today;
    }

    // Add to history
    state.stats.history.unshift({
      type: 'session',
      duration: Math.round(state.timer.duration / 60),
      timestamp: Date.now(),
    });
    if (state.stats.history.length > 50) state.stats.history.pop();

    saveStats();
    updateProgressTab();

    document.getElementById('session-counter').innerHTML =
      `Session: <strong>${state.todaySessions}</strong> completed today`;

    showToast('🎉', `Focus session complete! ${state.todaySessions} session(s) today.`);

    // AI encouragement
    await sendAIEncouragement();

    // Auto-switch to break
    const breakMins = state.todaySessions % 4 === 0 ? 15 : 5;
    const breakMode = breakMins === 15 ? 'long' : 'short';
    setTimerMode(breakMins, breakMode);

  } else {
    showToast('☕', 'Break over! Ready for another focus session?');
    setTimerMode(25, 'focus');
  }
}


// ==================== AI COMPANION ====================

async function sendAIEncouragement() {
  const messages = [
    {
      role: 'system',
      content: `You are FocusBuddy, a warm and supportive study companion. The user just completed a ${Math.round(state.timer.duration / 60)}-minute focus session (session #${state.todaySessions} today). Give them brief, genuine encouragement in 1-2 sentences. Be specific and warm, not generic. Use 1-2 emojis max. Don't be cheesy.`
    },
    { role: 'user', content: 'I just finished a focus session!' },
  ];

  addCompanionMessage('ai', null); // typing indicator

  try {
    let response = await aiChat(messages);
    if (!response) response = getRandomEncouragement();
    removeTypingIndicator();
    addCompanionMessage('ai', response);
  } catch (e) {
    removeTypingIndicator();
    addCompanionMessage('ai', getRandomEncouragement());
  }
}

async function sendCompanionChat(userText) {
  if (!userText.trim()) return;

  addCompanionMessage('user', userText);
  addCompanionMessage('ai', null); // typing indicator

  const messages = [
    {
      role: 'system',
      content: `You are FocusBuddy, a gentle and encouraging study companion. Be warm, brief (2-3 sentences max), and helpful. If they're stuck, suggest one tiny next action. If they're anxious, validate and reassure. Use 1-2 emojis max. Never be preachy or lecturing.`
    },
    { role: 'user', content: userText },
  ];

  try {
    let response = await aiChat(messages);
    if (!response) response = getFallbackChatResponse(userText);
    removeTypingIndicator();
    addCompanionMessage('ai', response);
  } catch (e) {
    removeTypingIndicator();
    addCompanionMessage('ai', getFallbackChatResponse(userText));
  }
}

function addCompanionMessage(sender, text) {
  const container = document.getElementById('companion-messages');

  if (text === null) {
    // Typing indicator
    const div = document.createElement('div');
    div.className = 'ai-message typing-msg';
    div.innerHTML = `
      <div class="typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const div = document.createElement('div');
  div.className = sender === 'ai' ? 'ai-message' : 'user-message';
  const bubbleClass = sender === 'ai' ? 'ai-bubble' : 'user-bubble';
  div.innerHTML = `<div class="${bubbleClass}"><p>${escapeHtml(text)}</p></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const typing = document.querySelector('.typing-msg');
  if (typing) typing.remove();
}

function getRandomEncouragement() {
  const msgs = [
    "Nice work! That was a solid focus session. Your brain just grew a little stronger. 🧠",
    "Session done! You showed up, and that's what matters most. Take a breather. 💪",
    "That's real progress right there. Be proud of yourself for staying with it. ✨",
    "Another session in the books! You're building momentum — keep going. 🔥",
    "You just proved you can focus. Remember this feeling next time it feels hard. 🌟",
    "Done! Not every session needs to feel amazing. Consistency > perfection. 💫",
    "Look at you go! That focus time adds up more than you think. 🎯",
    "Session complete! Your future self is already thanking you. 🙌",
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

function getFallbackChatResponse(userText) {
  const lower = userText.toLowerCase();
  if (lower.includes('stuck') || lower.includes("can't") || lower.includes('hard')) {
    return "That's okay — being stuck is a normal part of the process, not a failure. Try this: what's the absolute smallest thing you could do in the next 2 minutes? Start there. 💛";
  }
  if (lower.includes('anxious') || lower.includes('stress') || lower.includes('overwhelm')) {
    return "I hear you. Take a deep breath — in for 4, hold for 4, out for 4. The work will still be there, but you'll face it calmer. You're doing better than you think. 🌿";
  }
  if (lower.includes('tired') || lower.includes('exhausted') || lower.includes('sleep')) {
    return "Rest is productive too. If you're genuinely exhausted, a 20-minute power nap might be worth more than an hour of foggy work. Listen to your body. 😴";
  }
  if (lower.includes('thank') || lower.includes('helped')) {
    return "Anytime! That's what I'm here for. Now go crush it — you've got this. 🚀";
  }
  return "I'm right here with you. Whatever you're working on, just take it one tiny step at a time. You don't have to see the whole staircase — just the next step. 💪";
}


// ==================== PROGRESS TAB ====================

function updateProgressTab() {
  document.getElementById('stat-sessions').textContent = state.stats.totalSessions;
  document.getElementById('stat-tasks').textContent = state.stats.totalStepsCompleted;
  document.getElementById('stat-minutes').textContent = state.stats.totalMinutes;
  document.getElementById('stat-streak').textContent = state.stats.streak;

  // Render history
  const historyList = document.getElementById('history-list');

  if (state.stats.history.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <span class="history-empty-icon">🌱</span>
        <p>No sessions yet. Start your first focus session to see your journey here.</p>
      </div>
    `;
    return;
  }

  historyList.innerHTML = '';
  state.stats.history.slice(0, 20).forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';

    const time = new Date(item.timestamp);
    const timeStr = time.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    if (item.type === 'session') {
      div.innerHTML = `
        <span class="history-item__label">
          <span class="history-item__icon">🎯</span>
          ${item.duration}-minute focus session
        </span>
        <span class="history-item__meta">${timeStr}</span>
      `;
    } else {
      div.innerHTML = `
        <span class="history-item__label">
          <span class="history-item__icon">✅</span>
          ${item.text || 'Step completed'}
        </span>
        <span class="history-item__meta">${timeStr}</span>
      `;
    }

    historyList.appendChild(div);
  });
}


// ==================== TABS ====================

function switchTab(tabName) {
  state.currentTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  });

  if (tabName === 'progress') updateProgressTab();
}


// ==================== TOASTS ====================

function showToast(icon, message, duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}


// ==================== UTILITIES ====================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// ==================== INITIALIZATION ====================

function init() {
  // Check Ollama connection
  checkOllamaConnection();

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Model selector
  document.getElementById('model-select').addEventListener('change', (e) => {
    state.currentModel = e.target.value;
  });

  // Task input
  const taskInput = document.getElementById('task-input');
  const decomposeBtn = document.getElementById('decompose-btn');
  const charCount = document.getElementById('char-count');

  taskInput.addEventListener('input', () => {
    const len = taskInput.value.length;
    charCount.textContent = `${len} character${len !== 1 ? 's' : ''}`;
    decomposeBtn.disabled = len < 10;
  });

  decomposeBtn.addEventListener('click', () => {
    if (taskInput.value.trim().length >= 10) {
      decomposeTask(taskInput.value.trim());
    }
  });

  // Enter to submit (Ctrl+Enter or Cmd+Enter)
  taskInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !decomposeBtn.disabled) {
      decomposeTask(taskInput.value.trim());
    }
  });

  // Timer mode buttons
  document.querySelectorAll('.timer-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.minutes);
      const mode = mins === 25 ? 'focus' : mins === 5 ? 'short' : 'long';
      setTimerMode(mins, mode);
    });
  });

  // Timer controls
  document.getElementById('timer-toggle-btn').addEventListener('click', () => {
    if (state.timer.isRunning) {
      stopTimer();
    } else {
      if (state.timer.remaining <= 0) resetTimer();
      startTimer();
    }
  });

  document.getElementById('timer-reset-btn').addEventListener('click', resetTimer);
  document.getElementById('timer-skip-btn').addEventListener('click', skipTimer);

  // AI Companion chat
  const chatInput = document.getElementById('companion-input-field');
  const chatSendBtn = document.getElementById('companion-send-btn');

  chatSendBtn.addEventListener('click', () => {
    sendCompanionChat(chatInput.value);
    chatInput.value = '';
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCompanionChat(chatInput.value);
      chatInput.value = '';
    }
  });

  // Setup modal
  document.getElementById('retry-connection-btn').addEventListener('click', () => {
    checkOllamaConnection();
  });

  document.getElementById('skip-setup-btn').addEventListener('click', () => {
    document.getElementById('setup-modal').style.display = 'none';
    updateBackendStatus();
    const backend = getActiveBackend();
    if (backend === 'gemini') {
      showToast('✨', 'Using Gemini API');
    } else {
      showToast('ℹ️', 'Running without AI — using built-in responses');
    }
  });

  // Modal tabs (Ollama vs Gemini)
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.modalTab;
      document.getElementById(`modal-${target}`).classList.add('active');
    });
  });

  // Save Gemini key from modal
  document.getElementById('save-gemini-key-btn').addEventListener('click', () => {
    const key = document.getElementById('modal-gemini-key').value.trim();
    if (!key) {
      showToast('⚠️', 'Please enter your Gemini API key');
      return;
    }
    saveGeminiKey(key);
    document.getElementById('setup-modal').style.display = 'none';
    // Sync to settings panel input
    document.getElementById('gemini-api-key').value = key;
    showToast('✨', 'Gemini API connected! AI features are now active.');
  });

  // Settings panel toggle
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');
  settingsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
  });
  // Close settings when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && e.target !== settingsToggle) {
      settingsPanel.style.display = 'none';
    }
  });

  // Save API key from settings panel
  document.getElementById('save-api-key-btn').addEventListener('click', () => {
    const key = document.getElementById('gemini-api-key').value.trim();
    saveGeminiKey(key);
    if (key) {
      showToast('✨', 'Gemini API key saved!');
    } else {
      showToast('ℹ️', 'Gemini API key removed');
    }
  });

  // Load saved Gemini key into inputs
  if (state.geminiApiKey) {
    document.getElementById('gemini-api-key').value = state.geminiApiKey;
    document.getElementById('modal-gemini-key').value = state.geminiApiKey;
  }

  // Reset progress
  document.getElementById('reset-progress-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
      state.stats = {
        totalSessions: 0,
        totalStepsCompleted: 0,
        totalMinutes: 0,
        streak: 0,
        lastActiveDate: null,
        history: [],
      };
      saveStats();
      updateProgressTab();
      showToast('🗑️', 'Progress reset');
    }
  });

  // Initialize timer display
  updateTimerDisplay();

  // Load progress
  updateProgressTab();

  // Update backend status indicator
  updateBackendStatus();

  // Update streak on load
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (state.stats.lastActiveDate && state.stats.lastActiveDate !== today && state.stats.lastActiveDate !== yesterday) {
    state.stats.streak = 0;
    saveStats();
  }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
