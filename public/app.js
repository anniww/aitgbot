const state = {
  page: 'dashboard',
  password: localStorage.getItem('tg_admin_password') || '',
  bots: [],
  chats: [],
  messages: [],
  templates: [],
  rules: [],
  menus: { inline: [], keyboard: [] },
  broadcasts: [],
  broadcastDetail: null,
  media: [],
  logs: [],
  knowledgeDocs: [],
  systemStatus: null,
  aiConfig: null,
  deploymentReadiness: null,
  analytics: null,
  analyticsRange: localStorage.getItem('tg_analytics_range') || 'last30',
  analyticsStartDate: localStorage.getItem('tg_analytics_start_date') || '',
  analyticsEndDate: localStorage.getItem('tg_analytics_end_date') || '',
  analyticsBotId: localStorage.getItem('tg_analytics_bot_id') || '',
  dashboard: null,
  selectedBotId: '',
  selectedChatId: '',
  chatSearch: '',
  chatStatusFilter: '',
  messageSearch: '',
  modal: null,
  toast: '',
  notification: null,
  seenMessageIds: new Set(),
  realtimeTimer: null,
  realtimeBusy: false,
  livePaused: localStorage.getItem('tg_live_paused') === 'true',
  lastInteractionAt: Date.now(),
  soundEnabled: localStorage.getItem('tg_sound_enabled') !== 'false',
  soundVolume: Number(localStorage.getItem('tg_sound_volume') || 60),
  soundUnlocked: false,
  aiTestReply: '',
  ruleTestResult: null
};

const pages = [
  ['dashboard', 'Dashboard', 'DB'],
  ['analytics', 'Analytics', 'AN'],
  ['bots', 'Bots', 'BT'],
  ['messages', 'Messages', 'IN'],
  ['rules', 'Replies', 'RP'],
  ['menus', 'Menus', 'MN'],
  ['ai', 'AI Settings', 'AI'],
  ['users', 'Users', 'US'],
  ['broadcasts', 'Broadcasts', 'BC'],
  ['media', 'Media', 'MD'],
  ['logs', 'Logs', 'LG'],
  ['data', 'Data', 'DA'],
  ['diagnostics', 'Diagnostics', 'DX']
];

const aiProviderPresets = {
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini'
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  }
};

const app = document.querySelector('#app');

window.addEventListener('error', (event) => {
  notify(`UI error: ${event.message}`);
});

window.addEventListener('unhandledrejection', (event) => {
  notify(`Request error: ${event.reason?.message || event.reason || 'Unknown error'}`);
});

['click', 'input', 'keydown', 'scroll', 'pointermove'].forEach((type) => {
  window.addEventListener(type, () => {
    state.lastInteractionAt = Date.now();
  }, { passive: true });
});

document.addEventListener('click', async (event) => {
  unlockNotificationSound();
  const modalButton = event.target.closest('[data-modal]');
  if (modalButton && state.modal !== modalButton.dataset.modal) {
    state.modal = modalButton.dataset.modal;
    render();
    return;
  }

  const pageButton = event.target.closest('[data-page]');
  if (pageButton && state.page !== pageButton.dataset.page) {
    state.page = pageButton.dataset.page;
    state.ruleTestResult = null;
    await refreshScoped().catch(() => {});
    render();
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  if (actionButton.dataset.action === 'close-modal' && state.modal) {
    closeModal();
    return;
  }

  if (['form-add-inline-row', 'form-add-inline-button', 'form-remove-inline-button'].includes(actionButton.dataset.action)) {
    handleInlineButtonAction(actionButton);
  }
});

document.addEventListener('click', async (event) => {
  const jump = event.target.closest('[data-page-jump]');
  if (!jump) return;
  state.page = jump.dataset.pageJump;
  if (state.page === 'broadcasts') state.modal = 'broadcast';
  await refreshScoped().catch(() => {});
  render();
});

boot();

async function boot() {
  render();
  if (state.password) {
    await refreshAll();
    startRealtime();
  }
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    'x-admin-password': state.password,
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    state.password = '';
    localStorage.removeItem('tg_admin_password');
    render();
    throw new Error('Admin password is required');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function refreshAll() {
  try {
    const [dashboard, bots, chats, broadcasts, media, logs, systemStatus, aiConfig, deploymentReadiness] = await Promise.all([
      api('/api/dashboard'),
      api('/api/bots'),
      api('/api/chats'),
      api('/api/broadcasts'),
      api('/api/media'),
      api('/api/system-logs'),
      api('/api/system-status'),
      api('/api/ai-config'),
      api('/api/deployment-readiness')
    ]);
    state.dashboard = dashboard;
    state.bots = bots;
    state.chats = chats;
    state.broadcasts = broadcasts;
    state.media = media;
    state.logs = logs;
    state.systemStatus = systemStatus;
    state.aiConfig = aiConfig;
    state.deploymentReadiness = deploymentReadiness;
    if (!state.selectedBotId && bots[0]) state.selectedBotId = bots[0].id;
    await refreshScoped();
    await refreshAnalytics().catch(() => {});
    rememberMessages(state.messages);
    render();
  } catch (error) {
    notify(error.message);
  }
}

async function refreshScoped() {
  if (!state.selectedBotId) return;
  const [templates, rules, menus, knowledgeDocs] = await Promise.all([
    api(`/api/templates?botId=${state.selectedBotId}`),
    api(`/api/rules?botId=${state.selectedBotId}`),
    api(`/api/menus?botId=${state.selectedBotId}`),
    api(`/api/knowledge?botId=${state.selectedBotId}`)
  ]);
  state.templates = templates;
  state.rules = rules;
  state.menus = menus;
  state.knowledgeDocs = knowledgeDocs;
  await refreshMessages();
}

async function refreshMessages() {
  const params = new URLSearchParams();
  if (state.selectedBotId) params.set('botId', state.selectedBotId);
  if (state.selectedChatId) params.set('chatId', state.selectedChatId);
  if (state.messageSearch) params.set('search', state.messageSearch);
  state.messages = await api(`/api/messages?${params.toString()}`);
}

async function refreshAnalytics() {
  const params = new URLSearchParams();
  if (state.analyticsBotId) params.set('botId', state.analyticsBotId);
  appendAnalyticsParams(params);
  state.analytics = await api(`/api/analytics?${params.toString()}`);
}

function appendAnalyticsParams(params) {
  const range = state.analyticsRange || 'last30';
  params.set('range', range);
  if (range === 'custom') {
    if (state.analyticsStartDate) params.set('startDate', state.analyticsStartDate);
    if (state.analyticsEndDate) params.set('endDate', state.analyticsEndDate);
  } else if (range.startsWith('last')) {
    params.set('days', range.replace('last', ''));
  }
}

function startRealtime() {
  stopRealtime();
  state.realtimeTimer = window.setInterval(checkRealtimeUpdates, 3000);
}

function stopRealtime() {
  if (state.realtimeTimer) window.clearInterval(state.realtimeTimer);
  state.realtimeTimer = null;
}

async function checkRealtimeUpdates() {
  if (!state.password || state.realtimeBusy || state.livePaused) return;
  state.realtimeBusy = true;
  try {
    const editing = isUserEditing();
    const [dashboard, chats, logs] = await Promise.all([
      api('/api/dashboard'),
      api('/api/chats'),
      api('/api/system-logs')
    ]);
    state.dashboard = dashboard;
    state.chats = chats;
    state.logs = logs;
    if (state.selectedBotId) {
      const previousIds = new Set(state.seenMessageIds);
      await refreshMessages();
      const newUserMessages = state.messages.filter((message) => message.role === 'user' && !previousIds.has(message.id));
      rememberMessages(state.messages);
      if (newUserMessages.length) {
        const latest = newUserMessages[newUserMessages.length - 1];
        showIncomingNotice(latest, newUserMessages.length);
      }
    }
    if (!editing && isUserIdle()) render();
  } catch {
    // Keep realtime quiet during transient network or auth refresh issues.
  } finally {
    state.realtimeBusy = false;
  }
}

function isUserEditing() {
  const active = document.activeElement;
  if (!active) return false;
  if (state.modal) return true;
  if (active.closest?.('#replyForm, #botForm, #templateForm, #ruleForm, #broadcastForm, #testChatForm, #importForm')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
}

function isUserIdle() {
  return Date.now() - state.lastInteractionAt > 10000;
}

function rememberMessages(messages = []) {
  messages.forEach((message) => state.seenMessageIds.add(message.id));
  if (state.seenMessageIds.size > 1000) {
    state.seenMessageIds = new Set(Array.from(state.seenMessageIds).slice(-500));
  }
}

function showIncomingNotice(message, count) {
  const chat = state.chats.find((item) => String(item.chatId) === String(message.chatId));
  const sender = chat?.username ? `@${chat.username}` : chat?.firstName || message.chatId;
  const text = message.content || `[${message.mediaType || 'message'}]`;
  state.notification = {
    title: count > 1 ? `${count} new messages` : 'New message',
    body: `${sender}: ${text}`.slice(0, 140)
  };
  notify(state.notification.body, 5000);
  playNotificationSound();
}

function playNotificationSound() {
  if (!state.soundEnabled) return;
  if (!state.soundUnlocked) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    const volume = Math.max(0.001, Math.min(0.25, state.soundVolume / 400));
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
  } catch {
    // Audio can be blocked by the browser until the user interacts.
  }
}

function render() {
  if (!state.password) {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="top-title">${currentPageLabel()}</div>
          <div class="top-subtitle">Telegram Operations Console</div>
        </div>
        <div class="top-actions">
          <span class="live-indicator"><span class="live-dot"></span>Live</span>
          <button data-action="toggle-live">${state.livePaused ? 'Resume Live' : 'Pause Live'}</button>
          <button data-action="toggle-sound">${state.soundEnabled ? 'Sound On' : 'Sound Off'}</button>
          <label class="volume-control" title="Message sound volume">
            <span>Vol</span>
            <input id="soundVolume" type="range" min="0" max="100" value="${state.soundVolume}" />
          </label>
          <button data-action="refresh">Refresh</button>
          <button data-action="logout">Logout</button>
        </div>
      </header>
      <aside class="sidebar">
        <div class="brand">TG Bot Admin</div>
        <div class="sidebar-caption">Private bot workspace</div>
        <nav class="nav-list">
          ${pages.map(([key, label, icon]) => `
            <button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}">
              <span class="nav-icon">${icon}</span>
              <span>${label}</span>
            </button>
          `).join('')}
        </nav>
      </aside>
      <main class="content">${pageView()}</main>
    </div>
    ${state.notification ? notificationView() : ''}
    ${state.modal ? modalView(state.modal) : ''}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  `;
  bindCommon();
  bindPage();
}

function notificationView() {
  return `
    <button class="incoming-notice" data-action="open-latest-message">
      <strong>${escapeHtml(state.notification.title)}</strong>
      <span>${escapeHtml(state.notification.body)}</span>
    </button>
  `;
}

function currentPageLabel() {
  return pages.find(([key]) => key === state.page)?.[1] || 'Dashboard';
}

function loginView() {
  return `
    <div class="login-shell">
      <div class="login-art">
        <div class="art-phone">
          <div class="art-chat user"></div>
          <div class="art-chat bot"></div>
          <div class="art-chat user short"></div>
          <div class="art-composer"></div>
        </div>
        <div class="art-orbit one"></div>
        <div class="art-orbit two"></div>
      </div>
      <div class="login-card panel">
        <div class="login-brand">TG Bot Admin</div>
        <h1 class="page-title">Telegram Support Console</h1>
        <p class="page-subtitle">Manage bots, AI replies, broadcasts, customer chats, and business knowledge in one private workspace.</p>
        <div class="form-row">
          <label>Admin Password</label>
          <input id="passwordInput" type="password" placeholder="Default: admin123" />
        </div>
        <div class="actions" style="margin-top:16px;">
          <button class="primary" id="loginButton">Login</button>
        </div>
      </div>
    </div>
  `;
}

function pageView() {
  if (state.page === 'dashboard') return dashboardView();
  if (state.page === 'analytics') return analyticsView();
  if (state.page === 'bots') return botsView();
  if (state.page === 'messages') return messagesView();
  if (state.page === 'rules') return repliesView();
  if (state.page === 'menus') return menusView();
  if (state.page === 'ai') return aiView();
  if (state.page === 'users') return usersView();
  if (state.page === 'broadcasts') return broadcastsView();
  if (state.page === 'media') return mediaView();
  if (state.page === 'logs') return logsView();
  if (state.page === 'data') return dataView();
  if (state.page === 'diagnostics') return diagnosticsView();
  return '';
}

function pageHead(title, subtitle = '', action = '') {
  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">${title}</h1>
        ${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ''}
      </div>
      <div class="actions">${action}</div>
    </div>
  `;
}

function dashboardView() {
  const d = state.dashboard || {};
  return `
    ${pageHead('Dashboard', 'Overview for all bots, conversations, broadcasts, and diagnostics.')}
    <div class="grid cols-4">
      ${statCard('Bots', d.botCount || 0)}
      ${statCard('Running', d.runningCount || 0)}
      ${statCard('Today Messages', d.todayMessages || 0)}
      ${statCard('Unverified Bots', d.unverifiedBotCount || 0)}
    </div>
    <div class="quick-actions panel">
      <button data-page-jump="bots">Manage Bots</button>
      <button data-page-jump="messages">Open Inbox</button>
      <button data-page-jump="broadcasts">New Broadcast</button>
      <button data-page-jump="diagnostics">Diagnostics</button>
      <button data-page-jump="logs">Logs</button>
      <button data-page-jump="data">Backup Data</button>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="panel">
        <h2>Recent Bots</h2>
        ${botCards(d.recentBots || [], 'compact')}
      </div>
      <div class="panel">
        <h2>Recent Messages</h2>
        ${(d.recentMessages || []).map(messageLine).join('') || '<div class="empty">No messages yet.</div>'}
      </div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <h2>Recent Issues</h2>
      ${(d.recentIssues || []).map(issueLine).join('') || '<div class="empty">No recent warnings or errors.</div>'}
    </div>
  `;
}

function analyticsView() {
  const data = state.analytics || { totals: {}, rows: [] };
  return `
    ${pageHead('Analytics', 'Daily user-message counts and deduplicated user counts by all bots or one bot.', '<button class="primary" data-action="export-analytics">Export CSV</button>')}
    <div class="panel analytics-toolbar">
      <div class="form-row">
        <label>Bot Scope</label>
        <select id="analyticsBotId">
          <option value="" ${state.analyticsBotId === '' ? 'selected' : ''}>All Bots</option>
          ${state.bots.map((bot) => `<option value="${bot.id}" ${state.analyticsBotId === bot.id ? 'selected' : ''}>${escapeHtml(bot.name)} ${bot.username ? `(@${escapeHtml(bot.username)})` : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Date Range</label>
        <select id="analyticsRange">
          ${[
            ['today', 'Today'],
            ['yesterday', 'Yesterday'],
            ['last7', 'Last 7 days'],
            ['last14', 'Last 14 days'],
            ['last30', 'Last 30 days'],
            ['last90', 'Last 90 days'],
            ['last180', 'Last 180 days'],
            ['last365', 'Last 365 days'],
            ['custom', 'Custom dates']
          ].map(([value, label]) => `<option value="${value}" ${state.analyticsRange === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Start Date</label>
        <input id="analyticsStartDate" type="date" value="${escapeAttr(state.analyticsStartDate)}" ${state.analyticsRange === 'custom' ? '' : 'disabled'} />
      </div>
      <div class="form-row">
        <label>End Date</label>
        <input id="analyticsEndDate" type="date" value="${escapeAttr(state.analyticsEndDate)}" ${state.analyticsRange === 'custom' ? '' : 'disabled'} />
      </div>
      <div class="form-row filter-actions">
        <label>&nbsp;</label>
        <div class="actions"><button data-action="refresh-analytics">Apply</button></div>
      </div>
    </div>
    <div class="grid cols-4">
      ${statCard('去重前用户', data.totals.rawUserCount || data.totals.messageCount || 0)}
      ${statCard('去重后用户', data.totals.uniqueUserCount || 0)}
      ${statCard('重复用户', data.totals.duplicateUserCount || 0)}
      ${statCard('包含机器人', data.totals.botCount || (state.analyticsBotId ? 1 : 0))}
    </div>
    <div class="panel analytics-summary">
      Showing ${escapeHtml(data.startDate || '-')} to ${escapeHtml(data.endDate || '-')}
    </div>
    <div class="panel" style="margin-top:16px;">
      <h2>Daily Breakdown</h2>
      <table class="table">
        <thead><tr><th>Date</th><th>Bot</th><th>User Messages</th><th>Deduped Users</th></tr></thead>
        <tbody>${(data.rows || []).map((row) => `
          <tr>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(row.botName || row.botId)}</td>
            <td>${row.messageCount || 0}</td>
            <td>${row.uniqueUserCount || 0}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="empty">No analytics data yet.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="panel">
        <h2>重复用户列表</h2>
        <table class="table">
          <thead><tr><th>用户</th><th>机器人</th><th>消息数</th><th>首次</th><th>最近</th></tr></thead>
          <tbody>${(data.duplicateUsers || []).map((row) => `
            <tr>
              <td>${escapeHtml(row.displayName || row.chatId)}</td>
              <td>${escapeHtml(row.botName || row.botId)}</td>
              <td>${row.messageCount || 0}</td>
              <td>${formatTime(row.firstMessageAt)}</td>
              <td>${formatTime(row.lastMessageAt)}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="empty">当前日期范围没有重复用户。</td></tr>'}</tbody>
        </table>
      </div>
      <div class="panel">
        <h2>重复用户对话列表</h2>
        <table class="table">
          <thead><tr><th>时间</th><th>用户</th><th>机器人</th><th>消息</th></tr></thead>
          <tbody>${(data.duplicateMessages || []).map((row) => `
            <tr>
              <td>${formatTime(row.createdAt)}</td>
              <td>${escapeHtml(row.displayName || row.chatId)}</td>
              <td>${escapeHtml(row.botName || row.botId)}</td>
              <td>${escapeHtml(short(row.content || `[${row.mediaType || 'message'}]`, 90))}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="empty">当前日期范围没有重复用户对话。</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function botsView() {
  return `
    ${pageHead('Bots', 'Add bots, start polling, stop polling, and edit per-bot settings.', '<button class="primary" data-modal="bot">Add Bot</button>')}
    ${botCards(state.bots)}
  `;
}

function messagesView() {
  const chat = selectedChat();
  return `
    ${pageHead('Messages', 'Customer support inbox with manual takeover and media replies.', '<button data-modal="test-chat">Add Test Chat</button>')}
    <div class="inbox-shell">
      <aside class="inbox-sidebar panel">
        <div class="inbox-sidebar-head">
          <h2>Inbox</h2>
          ${botSelector()}
        </div>
        <div class="inbox-search">
          <input id="chatSearch" value="${escapeAttr(state.chatSearch)}" placeholder="Search conversations..." />
          <select id="chatStatusFilter">
            <option value="" ${state.chatStatusFilter === '' ? 'selected' : ''}>All</option>
            <option value="auto" ${state.chatStatusFilter === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="manual" ${state.chatStatusFilter === 'manual' ? 'selected' : ''}>Manual</option>
            <option value="blocked" ${state.chatStatusFilter === 'blocked' ? 'selected' : ''}>Blocked</option>
          </select>
          <input id="messageSearch" value="${escapeAttr(state.messageSearch)}" placeholder="Search messages..." />
          <div class="actions"><button data-action="apply-message-filters">Apply</button><button data-action="clear-message-filters">Clear</button></div>
        </div>
        <div class="chat-list">
          ${visibleChats().map(chatCard).join('') || '<div class="empty">No conversations match the current filters.</div>'}
        </div>
      </aside>
      <section class="conversation-panel panel">
        ${chat ? conversationHeader(chat) : '<div class="conversation-empty-head"><h2>Conversation</h2><p class="muted">Select a conversation to view messages.</p></div>'}
        <div class="messages">
          ${chat ? state.messages.map(messageBubble).join('') || '<div class="empty">No messages in this conversation.</div>' : '<div class="empty">Select a conversation.</div>'}
        </div>
        ${chat ? replyComposer(chat) : ''}
      </section>
      <aside class="customer-panel panel">
        ${chat ? customerPanel(chat) : '<div class="empty">Customer details will appear here.</div>'}
      </aside>
      </div>
    </div>
  `;
}

function repliesView() {
  return `
    ${pageHead('Replies', 'Rules trigger reusable templates. Templates support text, photo, video, document, and inline buttons.', '<button class="primary" data-modal="template">New Template</button><button data-modal="rule">New Rule</button>')}
    ${botSelector()}
    <div class="grid cols-2">
      <div class="panel">
        <h2>Templates</h2>
        ${templatesTable()}
      </div>
      <div class="panel">
        <h2>Rules</h2>
        ${rulesTable()}
      </div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <h2>Rule Tester</h2>
      <div class="form-grid">
        <div class="form-row"><label>Input Type</label><select id="ruleTestType"><option value="message">Message</option><option value="callback">Callback</option></select></div>
        <div class="form-row full"><label>User Message / Callback Data</label><textarea id="ruleTestText" placeholder="Type /start, Pricing, contact_support, etc."></textarea></div>
      </div>
      <div class="actions" style="margin-top:12px;"><button class="primary" data-action="test-rule">Test Rule</button></div>
      ${ruleTestResultView()}
    </div>
  `;
}

function menusView() {
  return `
    ${pageHead('Menus', 'Inline buttons appear below bot messages. Reply keyboard buttons send text into the normal rule flow.', '<button class="primary" data-action="save-menus">Save Menus</button>')}
    ${botSelector()}
    <div class="grid cols-2">
      <div class="panel">
        <h2>Welcome Inline Buttons</h2>
        <div id="inlineButtons">${buttonRowsEditor('inline', state.menus.inline || [])}</div>
        <button data-action="add-button-row" data-kind="inline">Add Row</button>
      </div>
      <div class="panel">
        <h2>Reply Keyboard</h2>
        <div id="keyboardButtons">${buttonRowsEditor('keyboard', state.menus.keyboard || [])}</div>
        <button data-action="add-button-row" data-kind="keyboard">Add Row</button>
      </div>
    </div>
  `;
}

function aiView() {
  const bot = selectedBot();
  return `
    ${pageHead('AI Settings', 'Configure the AI API connection, then enable AI per bot.')}
    ${botSelector()}
    ${aiApiConfigView()}
    ${bot ? `
      <div class="panel">
        ${aiProviderPanel()}
        <div class="form-grid">
          <div class="form-row"><label>AI Enabled</label><select id="aiEnabled"><option value="true" ${bot.aiEnabled ? 'selected' : ''}>Enabled</option><option value="false" ${!bot.aiEnabled ? 'selected' : ''}>Disabled</option></select></div>
          <div class="form-row"><label>Provider Preset</label><select id="aiProviderPreset"><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="custom">Custom</option></select></div>
          <div class="form-row"><label>Model</label><input id="aiModel" value="${escapeAttr(bot.aiModel || '')}" list="aiModelOptions" /><datalist id="aiModelOptions"><option value="gpt-4.1-mini"></option><option value="deepseek-v4-flash"></option><option value="deepseek-v4-pro"></option></datalist></div>
          <div class="form-row"><label>Context Limit</label><input id="aiContextLimit" type="number" value="${escapeAttr(bot.aiContextLimit || 10)}" /></div>
          <div class="form-row"><label>Reply Delay Seconds</label><input id="replyDelaySeconds" type="number" min="0" max="120" value="${escapeAttr(bot.replyDelaySeconds || 0)}" /></div>
          <div class="form-row full"><label>System Prompt</label><textarea id="aiPrompt">${escapeHtml(bot.aiPrompt || '')}</textarea></div>
        </div>
        <div class="actions" style="margin-top:14px;"><button class="primary" data-action="save-ai">Save AI Settings</button></div>
      </div>
      ${knowledgeView()}
      <div class="panel" style="margin-top:16px;">
        <h2>AI Test</h2>
        <div class="form-row">
          <label>Test Message</label>
          <textarea id="aiTestText" placeholder="Ask the bot something...">Hello, please introduce yourself in one sentence.</textarea>
        </div>
        <div class="actions" style="margin-top:12px;">
          <button class="primary" data-action="test-ai">Test AI</button>
        </div>
        ${state.aiTestReply ? `<div class="message bot" style="max-width:100%;margin-top:14px;margin-left:0;"><div class="message-meta">AI reply</div><div>${escapeHtml(state.aiTestReply)}</div></div>` : ''}
      </div>
    ` : '<div class="empty">Add a bot first.</div>'}
  `;
}

function aiApiConfigView() {
  const config = state.aiConfig || {};
  const provider = config.provider || 'deepseek';
  return `
    <div class="panel ai-config-panel">
      <div class="split-head">
        <div>
          <h2>API Key</h2>
          <p class="muted">Paste your API key only. Provider, Base URL, and Model are optional advanced settings.</p>
        </div>
        <div class="readiness-score ${config.hasApiKey ? 'pass' : 'warning'}">${config.hasApiKey ? 'Key Saved' : 'No Key'}</div>
      </div>
      <div class="form-grid">
        <div class="form-row full">
          <label>API Key</label>
          <input id="globalAiApiKey" type="password" placeholder="${config.apiKeyMasked ? `Saved: ${escapeAttr(config.apiKeyMasked)} - paste a new key to replace` : 'Paste API key'}" autocomplete="off" />
        </div>
      </div>
      <details class="advanced-config">
        <summary>Advanced API options</summary>
        <p class="muted">Provider and model automatically update the Base URL. Edit Base URL only for a custom compatible gateway.</p>
        <div class="form-grid">
          <div class="form-row">
          <label>Provider</label>
          <select id="globalAiProvider">
            <option value="openai" ${provider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="deepseek" ${provider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
            <option value="custom" ${provider === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
        </div>
        <div class="form-row">
          <label>Base URL</label>
          <input id="globalAiBaseUrl" value="${escapeAttr(config.baseURL || '')}" placeholder="https://api.deepseek.com" />
        </div>
        <div class="form-row">
          <label>Default Model</label>
          <input id="globalAiModel" value="${escapeAttr(config.model || '')}" list="globalAiModelOptions" placeholder="deepseek-v4-flash" />
          <datalist id="globalAiModelOptions"><option value="gpt-4.1-mini"></option><option value="deepseek-v4-flash"></option><option value="deepseek-v4-pro"></option></datalist>
        </div>
        </div>
      </details>
      <div class="actions" style="margin-top:14px;">
        <button class="primary" data-action="save-ai-config">Save API Key</button>
        <button data-action="fill-deepseek-config">Reset DeepSeek Defaults</button>
      </div>
    </div>
  `;
}

function knowledgeView() {
  return `
    <div class="panel" style="margin-top:16px;">
      <div class="split-head">
        <div>
          <h2>Business Knowledge</h2>
          <p class="muted">Upload text knowledge for this bot. AI replies will use these documents when relevant.</p>
        </div>
        <div class="readiness-score ${state.knowledgeDocs.length ? 'pass' : 'warning'}">${state.knowledgeDocs.length} Docs</div>
      </div>
      <form id="knowledgeForm" class="form-grid">
        <input type="hidden" name="botId" value="${escapeAttr(state.selectedBotId)}" />
        <div class="form-row"><label>Knowledge File</label><input name="file" type="file" accept=".txt,.md,.csv,.json,.html,.xml,text/*" /></div>
        <div class="form-row"><label>Name</label><input name="name" placeholder="Pricing, FAQ, product policy..." /></div>
        <div class="form-row full"><label>Paste Knowledge</label><textarea name="text" placeholder="Paste business rules, prices, FAQ, shipping policy..."></textarea></div>
        <div class="actions full"><button class="primary">Upload Knowledge</button></div>
      </form>
      <div class="knowledge-list">
        ${state.knowledgeDocs.map(knowledgeRow).join('') || '<div class="empty">No knowledge files yet.</div>'}
      </div>
    </div>
  `;
}

function knowledgeRow(doc) {
  return `
    <div class="knowledge-row">
      <div>
        <strong>${escapeHtml(doc.name)}</strong>
        <div class="muted">${escapeHtml(doc.mimeType || 'text/plain')} - ${formatBytes(doc.size || 0)} - ${formatTime(doc.updatedAt)}</div>
        <p>${escapeHtml(doc.excerpt || '')}</p>
      </div>
      <button class="danger" data-action="delete-knowledge" data-id="${doc.id}">Delete</button>
    </div>
  `;
}

function aiProviderPanel() {
  const ai = state.systemStatus?.ai || {};
  return `
    <div class="ai-provider-panel">
      <div>
        <span>Server Provider</span>
        <strong>${escapeHtml(ai.provider || 'openai')}</strong>
      </div>
      <div>
        <span>Base URL</span>
        <strong>${escapeHtml(ai.baseURL || '-')}</strong>
      </div>
      <div>
        <span>API Key</span>
        <strong>${ai.enabled ? 'Configured' : 'Missing'}</strong>
      </div>
      <div>
        <span>Default Model</span>
        <strong>${escapeHtml(ai.model || '-')}</strong>
      </div>
    </div>
  `;
}

function usersView() {
  return `
    ${pageHead('Users', 'Manage chat state: auto reply, manual takeover, or blocked.')}
    ${botSelector()}
    <div class="panel">
      <table class="table">
        <thead><tr><th>Chat</th><th>Username</th><th>Type</th><th>Status</th><th>Last Message</th><th>Actions</th></tr></thead>
        <tbody>${state.chats.filter((chat) => !state.selectedBotId || chat.botId === state.selectedBotId).map(userRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function broadcastsView() {
  return `
    ${pageHead('Broadcasts', 'Send text, photo, video, document, and inline buttons to known chats with rate limiting.', '<button class="primary" data-modal="broadcast">New Broadcast</button>')}
    <div class="panel">
      <table class="table">
        <thead><tr><th>Title</th><th>Bot</th><th>Status</th><th>Target</th><th>Success</th><th>Failed</th><th>Actions</th></tr></thead>
        <tbody>${state.broadcasts.map(broadcastRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function mediaView() {
  return `
    ${pageHead('Media', 'Uploaded local media files used by manual replies, templates, and broadcasts.', '<button data-action="refresh">Refresh</button>')}
    <div class="media-grid">
      ${state.media.map(mediaCard).join('') || '<div class="empty">No uploaded media yet.</div>'}
    </div>
  `;
}

function logsView() {
  return `
    ${pageHead('Logs', 'System operation logs for admin actions, failures, imports, broadcasts, and bot runtime changes.', '<button data-action="refresh">Refresh</button>')}
    <div class="panel">
      <table class="table">
        <thead><tr><th>Time</th><th>Level</th><th>Action</th><th>Bot</th><th>Message</th><th>Metadata</th></tr></thead>
        <tbody>${state.logs.map(logRow).join('') || '<tr><td colspan="6" class="empty">No logs yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function logRow(log) {
  return `
    <tr>
      <td>${formatTime(log.createdAt)}</td>
      <td>${levelBadge(log.level)}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.botId ? botName(log.botId) : '-')}</td>
      <td>${escapeHtml(log.message)}</td>
      <td><code>${escapeHtml(JSON.stringify(log.metadata || {}))}</code></td>
    </tr>
  `;
}

function mediaCard(file) {
  return `
    <div class="panel media-card">
      ${mediaPreview({ mediaPath: file.path, mediaType: mediaTypeFromMime(file.mimeType), mediaUrl: file.url })}
      <div class="media-name" title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</div>
      <div class="muted">${escapeHtml(file.mimeType)} - ${formatBytes(file.size)}</div>
      <div class="actions" style="margin-top:10px;">
        <a class="button-link" href="${file.url}" target="_blank" rel="noreferrer">Open</a>
      </div>
    </div>
  `;
}

function dataView() {
  return `
    ${pageHead('Data', 'Export or import local data before deployment or migration.')}
    ${deploymentReadinessView()}
    <div class="grid cols-2">
      <div class="panel">
        <h2>Export Backup</h2>
        <p class="muted">Download a full local backup. It includes bot tokens, templates, rules, chats, messages, menus, broadcasts, and logs.</p>
        <div class="actions">
          <button class="primary" data-action="export-data">Download Backup</button>
        </div>
      </div>
      <div class="panel">
        <h2>Import Backup</h2>
        <p class="muted">Import replaces the current local data. Running bot statuses will be reset to stopped.</p>
        <form id="importForm">
          <div class="form-row">
            <label>Backup JSON</label>
            <input type="file" name="backup" accept="application/json,.json" required />
          </div>
          <div class="actions" style="margin-top:12px;">
            <button class="danger">Import and Replace</button>
          </div>
        </form>
      </div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <h2>Migration Notes</h2>
      <p class="muted">For Cloudflare deployment later, this backup is the bridge from local JSON storage to D1/R2 migration scripts.</p>
      <div class="code">Local now: data/db.json + uploads/
Cloudflare target: D1 for data, R2 for media files, Workers webhook for Telegram updates.</div>
    </div>
  `;
}

function deploymentReadinessView() {
  const readiness = state.deploymentReadiness || { checks: [] };
  return `
    <div class="panel readiness-panel">
      <div class="split-head">
        <div>
          <h2>Deployment Readiness</h2>
          <p class="muted">${escapeHtml(readiness.nextTarget || 'GitHub repository, then Cloudflare Workers + D1 + R2')}</p>
        </div>
        <div class="readiness-score ${readiness.ready ? 'pass' : 'warning'}">
          ${readiness.ready ? 'Ready' : `${readiness.warningCount || 0} Warning${readiness.warningCount === 1 ? '' : 's'}`}
        </div>
      </div>
      <div class="readiness-list">
        ${(readiness.checks || []).map(readinessItem).join('') || '<div class="empty">No deployment checks yet.</div>'}
      </div>
    </div>
  `;
}

function readinessItem(check) {
  return `
    <div class="readiness-item ${check.status}">
      <div class="readiness-mark">${check.status === 'pass' ? 'OK' : '!'}</div>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        <div class="muted">${escapeHtml(check.detail)}</div>
      </div>
    </div>
  `;
}

function diagnosticsView() {
  return `
    ${pageHead('Diagnostics', 'Check token, API access, webhook state, polling runtime, raw updates, and send logs.', '<button class="primary" data-action="run-diagnostics">Run Diagnostics</button><button data-action="delete-webhook">Delete Webhook</button>')}
    ${systemStatusView()}
    ${botSelector()}
    <div id="diagnosticsPanel" class="panel"><div class="empty">Run diagnostics for the selected bot.</div></div>
  `;
}

function systemStatusView() {
  const status = state.systemStatus || {};
  const storage = status.storage || {};
  const admin = status.adminPassword || {};
  const ai = status.ai || {};
  const network = status.network || {};
  return `
    <div class="panel" style="margin-bottom:16px;">
      <h2>System Status</h2>
      <div class="grid cols-3">
        ${statCard('Runtime', status.nodeVersion || '-')}
        ${statCard('Mode', status.mode || 'local')}
        ${statCard('Port', status.port || '-')}
      </div>
      <div class="status-grid" style="margin-top:14px;">
        ${statusItem('Admin Password', admin.configured ? 'Configured' : 'Using default admin123', admin.configured)}
        ${statusItem('AI API Key', ai.enabled ? 'Configured' : 'Not configured', ai.enabled)}
        ${statusItem('Proxy', network.proxyConfigured ? 'Configured' : 'Not configured', true)}
        ${statusItem('Data File', storage.dataFileExists ? `${formatBytes(storage.dataFileBytes)} stored` : 'Missing', storage.dataFileExists)}
        ${statusItem('Uploads', `${storage.uploadFileCount || 0} files, ${formatBytes(storage.uploadBytes || 0)}`, true)}
        ${statusItem('Cloudflare Target', status.deployment?.planned || 'Workers + D1 + R2', true)}
      </div>
      <div class="code" style="margin-top:14px;">Data: ${escapeHtml(storage.dataFile || '-')}
Uploads: ${escapeHtml(storage.uploadDir || '-')}
Current: ${escapeHtml(status.deployment?.current || '-')}</div>
    </div>
  `;
}

function statCard(label, value) {
  return `<div class="panel stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

function statusItem(label, value, ok) {
  return `
    <div class="status-item ${ok ? 'ok' : 'warn'}">
      <div class="status-dot"></div>
      <div>
        <strong>${escapeHtml(label)}</strong>
        <div class="muted">${escapeHtml(value)}</div>
      </div>
    </div>
  `;
}

function botSelector() {
  return `
    <div class="toolbar">
      <select id="botSelect">
        <option value="">All Bots</option>
        ${state.bots.map((bot) => `<option value="${bot.id}" ${state.selectedBotId === bot.id ? 'selected' : ''}>${escapeHtml(bot.name)} ${bot.username ? `(@${escapeHtml(bot.username)})` : ''}</option>`).join('')}
      </select>
    </div>
  `;
}

function botTable(bots) {
  return `
    <table class="table">
      <thead><tr><th>Name</th><th>Username</th><th>Status</th><th>Token</th><th>Verified</th><th>Actions</th></tr></thead>
      <tbody>
        ${bots.map((bot) => `
          <tr>
            <td>${escapeHtml(bot.name)}</td>
            <td>${bot.username ? `@${escapeHtml(bot.username)}` : '-'}</td>
            <td>${statusBadge(bot.runtime?.status || bot.status)}</td>
            <td>${escapeHtml(bot.token || '')}</td>
            <td>${bot.tokenVerified ? statusBadge('verified') : statusBadge('unverified')}</td>
            <td class="actions">
              <button data-action="start-bot" data-id="${bot.id}">Start</button>
              <button data-action="stop-bot" data-id="${bot.id}">Stop</button>
              <button data-action="verify-bot" data-id="${bot.id}">Verify</button>
              <button data-action="edit-bot" data-id="${bot.id}">Edit</button>
              <button class="danger" data-action="delete-bot" data-id="${bot.id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6" class="empty">No bots yet.</td></tr>'}
      </tbody>
    </table>
  `;
}

function botCards(bots, mode = 'full') {
  if (!bots.length) return '<div class="empty">No bots yet.</div>';
  return `
    <div class="bot-card-grid ${mode === 'compact' ? 'compact' : ''}">
      ${bots.map((bot) => botCard(bot, mode)).join('')}
    </div>
  `;
}

function botCard(bot, mode = 'full') {
  const status = bot.runtime?.status || bot.status || 'stopped';
  const verified = Boolean(bot.tokenVerified);
  return `
    <article class="bot-card">
      <div class="bot-card-head">
        <div class="bot-avatar">${escapeHtml(botInitials(bot))}</div>
        <div class="bot-title-block">
          <h3>${escapeHtml(bot.name || 'Unnamed Bot')}</h3>
          <div class="muted">${bot.username ? `@${escapeHtml(bot.username)}` : 'Username not verified'}</div>
        </div>
        ${statusBadge(status)}
      </div>
      <div class="bot-card-meta">
        <div>
          <span>Token</span>
          <strong>${escapeHtml(bot.token || '-')}</strong>
        </div>
        <div>
          <span>Verification</span>
          <strong>${verified ? 'Verified' : 'Unverified'}</strong>
        </div>
        ${mode === 'full' ? `
          <div>
            <span>AI</span>
            <strong>${bot.aiEnabled ? 'Enabled' : 'Off'}</strong>
          </div>
        ` : ''}
      </div>
      <div class="bot-card-actions">
        <button data-action="start-bot" data-id="${bot.id}">Start</button>
        <button data-action="stop-bot" data-id="${bot.id}">Stop</button>
        <button data-action="verify-bot" data-id="${bot.id}">Verify</button>
        <button data-action="edit-bot" data-id="${bot.id}">Edit</button>
        ${mode === 'full' ? `<button class="danger" data-action="delete-bot" data-id="${bot.id}">Delete</button>` : ''}
      </div>
    </article>
  `;
}

function botInitials(bot) {
  const source = bot.username || bot.name || 'Bot';
  return source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'BT';
}

function chatCard(chat) {
  const active = String(chat.chatId) === String(state.selectedChatId);
  return `
    <div class="chat-card ${active ? 'active' : ''}" data-action="select-chat" data-chat-id="${chat.chatId}">
      ${customerAvatar(chat)}
      <div class="chat-card-main">
        <strong>${chatTitle(chat)}</strong>
        <div class="muted">${chat.status} - ${formatTime(chat.lastMessageAt)}</div>
      </div>
    </div>
  `;
}

function messageBubble(message) {
  return `
    <div class="message ${message.role}">
      <div class="message-meta">${message.role} - ${message.source} - ${formatTime(message.createdAt)}</div>
      <div>${escapeHtml(message.content || `[${message.mediaType}]`)}</div>
      ${mediaPreview(message)}
    </div>
  `;
}

function conversationHeader(chat) {
  return `
    <div class="conversation-head">
      ${customerAvatar(chat)}
      <div>
        <h2>${escapeHtml(chatTitle(chat))}</h2>
        <div class="muted">${escapeHtml(botName(chat.botId))} - ${escapeHtml(chat.type || 'private')} - ${formatTime(chat.lastMessageAt)}</div>
      </div>
      <div class="conversation-actions">
        ${statusBadge(chat.status)}
        <button data-action="set-chat-status" data-id="${chat.id}" data-status="manual">Manual</button>
        <button data-action="set-chat-status" data-id="${chat.id}" data-status="auto">Auto</button>
      </div>
    </div>
  `;
}

function customerPanel(chat) {
  const conversationMessages = state.messages.filter((message) => String(message.chatId) === String(chat.chatId));
  const userMessages = conversationMessages.filter((message) => message.role === 'user');
  return `
    <div class="customer-card">
      ${customerAvatar(chat, 'large')}
      <h2>${escapeHtml(chatTitle(chat))}</h2>
      <p class="muted">${chat.username ? `@${escapeHtml(chat.username)}` : 'No username'}</p>
    </div>
    <div class="customer-facts">
      <div><span>Chat ID</span><strong>${escapeHtml(chat.chatId)}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(chat.status)}</strong></div>
      <div><span>Messages</span><strong>${conversationMessages.length}</strong></div>
      <div><span>User Messages</span><strong>${userMessages.length}</strong></div>
      <div><span>Last Seen</span><strong>${formatTime(chat.lastMessageAt)}</strong></div>
    </div>
    <div class="quick-replies">
      <h3>Quick Actions</h3>
      <button data-action="set-chat-status" data-id="${chat.id}" data-status="manual">Manual Takeover</button>
      <button data-action="set-chat-status" data-id="${chat.id}" data-status="auto">Auto Reply</button>
      <button class="danger" data-action="set-chat-status" data-id="${chat.id}" data-status="blocked">Block User</button>
    </div>
  `;
}

function customerInitials(chat) {
  const source = chat.firstName || chat.username || String(chat.chatId || '?');
  return source.slice(0, 2).toUpperCase();
}

function customerAvatar(chat, size = '') {
  const cls = `customer-avatar ${size}`.trim();
  if (chat.avatarUrl) {
    return `<img class="${cls}" src="${escapeAttr(chat.avatarUrl)}" alt="${escapeAttr(chatTitle(chat))}" loading="lazy" />`;
  }
  return `<div class="${cls}">${escapeHtml(customerInitials(chat))}</div>`;
}

function replyComposer(chat) {
  return `
    <form id="replyForm" style="margin-top:14px;">
      <div class="form-grid">
        <div class="form-row full"><label>Reply Text</label><textarea name="text" placeholder="Type a manual reply..."></textarea></div>
        <div class="form-row">
          <label>Translate To</label>
          <input name="targetLanguage" list="languageOptions" value="auto" placeholder="auto, English, Japanese..." />
          <datalist id="languageOptions">
            <option value="auto"></option>
            <option value="English"></option>
            <option value="Chinese"></option>
            <option value="Japanese"></option>
            <option value="Korean"></option>
            <option value="Spanish"></option>
            <option value="French"></option>
            <option value="German"></option>
            <option value="Russian"></option>
            <option value="Arabic"></option>
            <option value="Hindi"></option>
            <option value="Portuguese"></option>
          </datalist>
        </div>
        <div class="form-row"><label>Send Mode</label><select name="translateMode"><option value="none">Original</option><option value="translate">Translate before sending</option></select></div>
        <div class="form-row"><label>Media Type</label><select name="mediaType"><option value="none">Text only</option><option value="photo">Photo</option><option value="video">Video</option><option value="document">Document</option></select></div>
        <div class="form-row"><label>Upload Media</label><input name="media" type="file" /></div>
        <div class="form-row full"><label>Inline Buttons</label>${inlineButtonsBuilder('buttonsJson', [])}</div>
        <div id="translationPreview" class="translation-preview full" hidden></div>
      </div>
      <div class="actions" style="margin-top:12px;">
        <button class="primary">Send</button>
        <button type="button" data-action="preview-translation">Translate Preview</button>
        <button type="button" data-action="save-internal-note">Save Internal Note</button>
        <button type="button" data-action="set-chat-status" data-id="${chat.id}" data-status="manual">Manual Takeover</button>
        <button type="button" data-action="set-chat-status" data-id="${chat.id}" data-status="auto">Auto Reply</button>
        <button type="button" class="danger" data-action="set-chat-status" data-id="${chat.id}" data-status="blocked">Block</button>
      </div>
    </form>
  `;
}

function templatesTable() {
  return `
    <table class="table">
      <thead><tr><th>Name</th><th>Text</th><th>Media</th><th>Buttons</th><th>Actions</th></tr></thead>
      <tbody>${state.templates.map((tpl) => `
        <tr>
          <td>${escapeHtml(tpl.name)}</td>
          <td>${escapeHtml(short(tpl.text))}</td>
          <td>${tpl.mediaType}</td>
          <td>${(tpl.buttons || []).flat().length}</td>
          <td class="actions"><button data-action="edit-template" data-id="${tpl.id}">Edit</button><button class="danger" data-action="delete-template" data-id="${tpl.id}">Delete</button></td>
        </tr>
      `).join('') || '<tr><td colspan="5" class="empty">No templates yet.</td></tr>'}</tbody>
    </table>
  `;
}

function rulesTable() {
  return `
    <table class="table">
      <thead><tr><th>Enabled</th><th>Type</th><th>Pattern</th><th>Match</th><th>Template</th><th>Actions</th></tr></thead>
      <tbody>${state.rules.map((rule) => `
        <tr>
          <td>${rule.enabled ? 'Yes' : 'No'}</td>
          <td>${rule.type}</td>
          <td>${escapeHtml(rule.pattern)}</td>
          <td>${rule.matchMode}</td>
          <td>${escapeHtml(templateName(rule.templateId))}</td>
          <td class="actions"><button data-action="edit-rule" data-id="${rule.id}">Edit</button><button class="danger" data-action="delete-rule" data-id="${rule.id}">Delete</button></td>
        </tr>
      `).join('') || '<tr><td colspan="6" class="empty">No rules yet.</td></tr>'}</tbody>
    </table>
  `;
}

function ruleTestResultView() {
  const result = state.ruleTestResult;
  if (!result) return '';
  if (!result.matched) {
    return `<div class="panel" style="margin-top:12px;"><strong>No rule matched.</strong><p class="muted">The bot would continue to AI reply if enabled, otherwise it would use the default reply.</p></div>`;
  }
  const buttons = (result.template?.buttons || []).flat();
  return `
    <div class="panel" style="margin-top:12px;">
      <h3>Matched Rule</h3>
      <p><strong>Type:</strong> ${escapeHtml(result.rule.type)} / <strong>Pattern:</strong> ${escapeHtml(result.rule.pattern)} / <strong>Match:</strong> ${escapeHtml(result.rule.matchMode)}</p>
      <h3>Reply Template</h3>
      ${result.template ? `
        <div class="message bot" style="max-width:100%;margin-left:0;">
          <div class="message-meta">${escapeHtml(result.template.name)} - ${escapeHtml(result.template.mediaType)}</div>
          <div>${escapeHtml(result.template.text || '(empty text)')}</div>
          ${mediaPreview(result.template)}
          ${buttons.length ? `<div class="actions" style="margin-top:10px;">${buttons.map((button) => `<span class="badge">${escapeHtml(button.text)}</span>`).join('')}</div>` : ''}
        </div>
      ` : '<p class="muted">Matched rule has no template assigned.</p>'}
    </div>
  `;
}

function buttonRowsEditor(kind, rows) {
  return `
    ${(rows || []).map((row, rowIndex) => `
      <div class="panel" style="padding:10px;margin-bottom:10px;">
        <div class="actions" style="margin-bottom:8px;"><strong>Row ${rowIndex + 1}</strong><button data-action="add-button" data-kind="${kind}" data-row="${rowIndex}">Add Button</button></div>
        ${row.map((button, colIndex) => `
          <div class="button-editor" data-kind="${kind}" data-row="${rowIndex}" data-col="${colIndex}">
            <input data-field="text" value="${escapeAttr(button.text || '')}" placeholder="Text" />
            <select data-field="actionType">
              ${['url', 'callback', 'command', 'text'].map((type) => `<option value="${type}" ${button.actionType === type ? 'selected' : ''}>${type}</option>`).join('')}
            </select>
            <input data-field="actionValue" value="${escapeAttr(button.actionValue || '')}" placeholder="Action value" />
            <button data-action="remove-button" data-kind="${kind}" data-row="${rowIndex}" data-col="${colIndex}">Remove</button>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
}

function inlineButtonsBuilder(fieldName, rows = []) {
  const normalizedRows = Array.isArray(rows) && rows.length ? rows : [];
  return `
    <div class="inline-builder" data-inline-builder data-field-name="${fieldName}">
      <input type="hidden" name="${fieldName}" value="${escapeAttr(JSON.stringify(normalizedRows))}" />
      <div class="inline-button-rows">${renderInlineButtonRows(normalizedRows)}</div>
      <div class="actions" style="margin-top:8px;">
        <button type="button" data-action="form-add-inline-row">Add Row</button>
      </div>
    </div>
  `;
}

function renderInlineButtonRows(rows = []) {
  return (rows.length ? rows : [[]])
    .map(
      (row, rowIndex) => `
        <div class="inline-button-row" data-row="${rowIndex}">
          <div class="actions inline-row-head">
            <strong>Row ${rowIndex + 1}</strong>
            <button type="button" data-action="form-add-inline-button" data-row="${rowIndex}">Add Button</button>
          </div>
          ${(row || []).map((button, colIndex) => inlineButtonEditor(button, rowIndex, colIndex)).join('')}
        </div>
      `
    )
    .join('');
}

function inlineButtonEditor(button = {}, rowIndex = 0, colIndex = 0) {
  return `
    <div class="button-editor inline-button-editor" data-row="${rowIndex}" data-col="${colIndex}">
      <input data-field="text" value="${escapeAttr(button.text || '')}" placeholder="Button text" />
      <select data-field="actionType">
        ${['url', 'callback', 'command', 'text'].map((type) => `<option value="${type}" ${button.actionType === type ? 'selected' : ''}>${type}</option>`).join('')}
      </select>
      <input data-field="actionValue" value="${escapeAttr(button.actionValue || '')}" placeholder="URL, callback, command, or text" />
      <button type="button" data-action="form-remove-inline-button" data-row="${rowIndex}" data-col="${colIndex}">Remove</button>
    </div>
  `;
}

function userRow(chat) {
  return `
    <tr>
      <td>${escapeHtml(chat.chatId)}</td>
      <td>${escapeHtml(chat.username || chatTitle(chat))}</td>
      <td>${chat.type}</td>
      <td>${statusBadge(chat.status)}</td>
      <td>${formatTime(chat.lastMessageAt)}</td>
      <td class="actions">
        <button data-action="set-chat-status" data-id="${chat.id}" data-status="auto">Auto</button>
        <button data-action="set-chat-status" data-id="${chat.id}" data-status="manual">Manual</button>
        <button class="danger" data-action="set-chat-status" data-id="${chat.id}" data-status="blocked">Block</button>
      </td>
    </tr>
  `;
}

function broadcastRow(broadcast) {
  return `
    <tr>
      <td>${escapeHtml(broadcast.title)}</td>
      <td>${escapeHtml(botName(broadcast.botId))}</td>
      <td>${statusBadge(broadcast.status)}</td>
      <td>${broadcast.targetType}</td>
      <td>${broadcast.successCount || 0}/${broadcast.totalCount || 0}</td>
      <td>${broadcast.failedCount || 0}</td>
      <td class="actions">
        <button data-action="view-broadcast" data-id="${broadcast.id}">View</button>
        <button data-action="send-broadcast" data-id="${broadcast.id}">Send</button>
        <button class="danger" data-action="delete-broadcast" data-id="${broadcast.id}">Delete</button>
      </td>
    </tr>
  `;
}

function modalView(type) {
  if (type === 'bot') return formModal('Add Bot', botForm());
  if (type.startsWith('edit-bot:')) return formModal('Edit Bot', botForm(state.bots.find((bot) => bot.id === type.split(':')[1])));
  if (type === 'template') return formModal('New Template', templateForm());
  if (type.startsWith('edit-template:')) return formModal('Edit Template', templateForm(state.templates.find((tpl) => tpl.id === type.split(':')[1])));
  if (type === 'rule') return formModal('New Rule', ruleForm());
  if (type.startsWith('edit-rule:')) return formModal('Edit Rule', ruleForm(state.rules.find((rule) => rule.id === type.split(':')[1])));
  if (type === 'broadcast') return formModal('New Broadcast', broadcastForm());
  if (type.startsWith('broadcast-detail:')) return formModal('Broadcast Detail', broadcastDetailView(state.broadcastDetail));
  if (type === 'test-chat') return formModal('Add Test Chat', testChatForm());
  return '';
}

function formModal(title, body) {
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head"><h2 class="modal-title">${title}</h2><button data-action="close-modal">Close</button></div>
        ${body}
      </div>
    </div>
  `;
}

function botForm(bot = null) {
  return `
    <form id="botForm" data-id="${bot?.id || ''}">
      <div class="form-grid">
        <div class="form-row"><label>Name</label><input name="name" value="${escapeAttr(bot?.name || '')}" /></div>
        <div class="form-row"><label>Token</label><input name="token" value="" placeholder="${bot ? 'Leave empty to keep current token' : '123456:ABC...'}" ${bot ? '' : 'required'} /></div>
        <div class="form-row full"><label>Welcome Message</label><textarea name="welcomeMessage">${escapeHtml(bot?.welcomeMessage || 'Welcome. Please choose an option below.')}</textarea></div>
        <div class="form-row full"><label>Default Reply</label><textarea name="defaultReply">${escapeHtml(bot?.defaultReply || 'Message received. Support will reply soon.')}</textarea></div>
        ${bot ? '' : `
          <label class="check-row form-row full">
            <input type="checkbox" name="skipTokenTest" value="true" />
            <span>Skip token test on save</span>
            <small>Use this only when your local network cannot reach Telegram yet. Start and diagnostics still require a valid token.</small>
          </label>
        `}
      </div>
      <div class="actions" style="margin-top:14px;">
        <button class="primary">Save Bot</button>
        <button type="button" data-action="test-token">Test Token</button>
      </div>
    </form>
  `;
}

function templateForm(tpl = null) {
  return `
    <form id="templateForm" data-id="${tpl?.id || ''}">
      <div class="form-grid">
        <div class="form-row"><label>Bot</label>${botSelectInput('botId', tpl?.botId || state.selectedBotId)}</div>
        <div class="form-row"><label>Name</label><input name="name" value="${escapeAttr(tpl?.name || '')}" required /></div>
        <div class="form-row"><label>Media Type</label><select name="mediaType">${['none', 'photo', 'video', 'document'].map((type) => `<option value="${type}" ${tpl?.mediaType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
        <div class="form-row"><label>Upload Media</label><input name="media" type="file" /></div>
        <div class="form-row full"><label>Text / Caption</label><textarea name="text">${escapeHtml(tpl?.text || '')}</textarea></div>
        <div class="form-row full"><label>Inline Buttons</label>${inlineButtonsBuilder('buttonsJson', tpl?.buttons || [])}</div>
      </div>
      <div class="actions" style="margin-top:14px;"><button class="primary">Save Template</button></div>
    </form>
  `;
}

function ruleForm(rule = null) {
  return `
    <form id="ruleForm" data-id="${rule?.id || ''}">
      <div class="form-grid">
        <div class="form-row"><label>Bot</label>${botSelectInput('botId', rule?.botId || state.selectedBotId)}</div>
        <div class="form-row"><label>Type</label><select name="type">${['command', 'keyword', 'callback'].map((type) => `<option value="${type}" ${rule?.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
        <div class="form-row"><label>Pattern</label><input name="pattern" value="${escapeAttr(rule?.pattern || '')}" required /></div>
        <div class="form-row"><label>Match Mode</label><select name="matchMode">${['contains', 'exact'].map((mode) => `<option value="${mode}" ${rule?.matchMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></div>
        <div class="form-row"><label>Template</label>${templateSelectInput('templateId', rule?.templateId || '')}</div>
        <div class="form-row"><label>Enabled</label><select name="enabled"><option value="true" ${rule?.enabled !== false ? 'selected' : ''}>Yes</option><option value="false" ${rule?.enabled === false ? 'selected' : ''}>No</option></select></div>
      </div>
      <div class="actions" style="margin-top:14px;"><button class="primary">Save Rule</button></div>
    </form>
  `;
}

function broadcastForm() {
  return `
    <form id="broadcastForm">
      <div class="form-grid">
        <div class="form-row"><label>Bot</label>${botSelectInput('botId', state.selectedBotId)}</div>
        <div class="form-row"><label>Title</label><input name="title" required /></div>
        <div class="form-row"><label>Target</label><select name="targetType"><option value="all">All non-blocked chats</option><option value="auto_only">Auto reply chats only</option><option value="manual_only">Manual takeover only</option><option value="active_7d">Active in last 7 days</option><option value="active_30d">Active in last 30 days</option></select></div>
        <div class="form-row"><label>Media Type</label><select name="mediaType"><option value="none">Text only</option><option value="photo">Photo</option><option value="video">Video</option><option value="document">Document</option></select></div>
        <div class="form-row full"><label>Upload Media</label><input name="media" type="file" /></div>
        <div class="form-row full"><label>Text / Caption</label><textarea name="text"></textarea></div>
        <div class="form-row full"><label>Inline Buttons</label>${inlineButtonsBuilder('buttonsJson', [])}</div>
      </div>
      <div class="broadcast-estimate">
        Estimated recipients:
        all ${estimateBroadcastRecipients(state.selectedBotId, 'all')} /
        auto ${estimateBroadcastRecipients(state.selectedBotId, 'auto_only')} /
        manual ${estimateBroadcastRecipients(state.selectedBotId, 'manual_only')} /
        7d ${estimateBroadcastRecipients(state.selectedBotId, 'active_7d')} /
        30d ${estimateBroadcastRecipients(state.selectedBotId, 'active_30d')}
      </div>
      <div class="actions" style="margin-top:14px;"><button class="primary">Save Broadcast</button></div>
    </form>
  `;
}

function testChatForm() {
  return `
    <form id="testChatForm">
      <div class="form-grid">
        <div class="form-row"><label>Bot</label>${botSelectInput('botId', state.selectedBotId)}</div>
        <div class="form-row"><label>Chat ID</label><input name="chatId" placeholder="test_001" /></div>
        <div class="form-row"><label>Username</label><input name="username" value="test_user" /></div>
        <div class="form-row"><label>First Name</label><input name="firstName" value="Test" /></div>
        <div class="form-row full"><label>Initial Message</label><textarea name="message">Hello, this is a local test message.</textarea></div>
      </div>
      <div class="actions" style="margin-top:14px;">
        <button class="primary">Create Test Chat</button>
      </div>
      <p class="muted">Local test chats are for UI testing only. Manual replies to test chat IDs will fail unless the ID is a real Telegram chat.</p>
    </form>
  `;
}

function broadcastDetailView(detail) {
  if (!detail) return '<div class="empty">Loading broadcast detail...</div>';
  const buttons = (detail.buttons || []).flat();
  return `
    <div class="grid cols-2">
      <div class="panel">
        <h3>Preview</h3>
        <div class="message bot" style="max-width:100%;margin-left:0;">
          <div class="message-meta">${escapeHtml(detail.mediaType || 'none')} - ${escapeHtml(botName(detail.botId))}</div>
          <div>${escapeHtml(detail.text || '(empty message)')}</div>
          ${mediaPreview(detail)}
          ${buttons.length ? `<div class="actions" style="margin-top:10px;">${buttons.map((button) => `<span class="badge">${escapeHtml(button.text)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="panel">
        <h3>Summary</h3>
        <p><strong>Status:</strong> ${statusBadge(detail.status)}</p>
        <p><strong>Target:</strong> ${escapeHtml(broadcastTargetLabel(detail.targetType))}</p>
        <p><strong>Total:</strong> ${detail.totalCount || 0}</p>
        <p><strong>Success:</strong> ${detail.successCount || 0}</p>
        <p><strong>Failed:</strong> ${detail.failedCount || 0}</p>
      </div>
    </div>
    <div class="panel" style="margin-top:14px;">
      <h3>Targets</h3>
      <table class="table">
        <thead><tr><th>Chat ID</th><th>Status</th><th>Sent At</th><th>Error</th></tr></thead>
        <tbody>${(detail.targets || []).map((target) => `
          <tr>
            <td>${escapeHtml(target.chatId)}</td>
            <td>${statusBadge(target.status)}</td>
            <td>${formatTime(target.sentAt)}</td>
            <td>${escapeHtml(target.errorMessage || '')}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="empty">No target records yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function bindLogin() {
  document.querySelector('#loginButton')?.addEventListener('click', async () => {
    state.password = document.querySelector('#passwordInput').value;
    localStorage.setItem('tg_admin_password', state.password);
    await refreshAll();
    startRealtime();
  });
}

function bindCommon() {
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.page = button.dataset.page;
      await refreshScoped().catch(() => {});
      render();
    });
  });
  document.querySelector('[data-action="refresh"]')?.addEventListener('click', refreshAll);
  document.querySelector('[data-action="toggle-live"]')?.addEventListener('click', () => {
    state.livePaused = !state.livePaused;
    localStorage.setItem('tg_live_paused', String(state.livePaused));
    notify(state.livePaused ? 'Live refresh paused' : 'Live refresh resumed');
    render();
  });
  document.querySelector('[data-action="toggle-sound"]')?.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('tg_sound_enabled', String(state.soundEnabled));
    notify(state.soundEnabled ? 'Message sound enabled' : 'Message sound disabled');
    if (state.soundEnabled) {
      state.soundUnlocked = true;
      playNotificationSound();
    }
    render();
  });
  document.querySelector('#soundVolume')?.addEventListener('input', (event) => {
    state.soundVolume = Number(event.target.value || 60);
    localStorage.setItem('tg_sound_volume', String(state.soundVolume));
  });
  document.querySelector('#soundVolume')?.addEventListener('change', () => {
    state.soundUnlocked = true;
    if (state.soundEnabled) playNotificationSound();
  });
  document.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
    stopRealtime();
    localStorage.removeItem('tg_admin_password');
    state.password = '';
    state.notification = null;
    render();
  });
  document.querySelector('[data-action="open-latest-message"]')?.addEventListener('click', async () => {
    state.page = 'messages';
    state.notification = null;
    await refreshScoped().catch(() => {});
    render();
  });
  document.querySelectorAll('[data-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      state.modal = button.dataset.modal;
      render();
    });
  });
  document.querySelectorAll('[data-action="close-modal"]').forEach((button) => button.addEventListener('click', closeModal));
  document.querySelector('#botSelect')?.addEventListener('change', async (event) => {
    state.selectedBotId = event.target.value;
    state.selectedChatId = '';
    state.ruleTestResult = null;
    await refreshScoped();
    render();
  });
}

function unlockNotificationSound() {
  state.soundUnlocked = true;
}

function bindPage() {
  bindBotActions();
  bindChatActions();
  bindForms();
  bindMenuActions();
  bindDataActions();
  bindDiagnostics();
  bindAnalyticsActions();
}

function bindAnalyticsActions() {
  document.querySelector('[data-action="refresh-analytics"]')?.addEventListener('click', applyAnalyticsFilters);
  document.querySelector('#analyticsBotId')?.addEventListener('change', applyAnalyticsFilters);
  document.querySelector('#analyticsRange')?.addEventListener('change', applyAnalyticsFilters);
  document.querySelector('#analyticsStartDate')?.addEventListener('change', applyAnalyticsFilters);
  document.querySelector('#analyticsEndDate')?.addEventListener('change', applyAnalyticsFilters);
  document.querySelector('[data-action="export-analytics"]')?.addEventListener('click', exportAnalytics);
}

async function applyAnalyticsFilters() {
  state.analyticsBotId = document.querySelector('#analyticsBotId')?.value || '';
  state.analyticsRange = document.querySelector('#analyticsRange')?.value || 'last30';
  state.analyticsStartDate = document.querySelector('#analyticsStartDate')?.value || '';
  state.analyticsEndDate = document.querySelector('#analyticsEndDate')?.value || '';
  localStorage.setItem('tg_analytics_bot_id', state.analyticsBotId);
  localStorage.setItem('tg_analytics_range', state.analyticsRange);
  localStorage.setItem('tg_analytics_start_date', state.analyticsStartDate);
  localStorage.setItem('tg_analytics_end_date', state.analyticsEndDate);
  await refreshAnalytics();
  render();
}

async function exportAnalytics() {
  const params = new URLSearchParams();
  if (state.analyticsBotId) params.set('botId', state.analyticsBotId);
  appendAnalyticsParams(params);
  const response = await fetch(`/api/analytics/export?${params.toString()}`, {
    headers: { 'x-admin-password': state.password }
  });
  if (!response.ok) return notify('Analytics export failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tg-bot-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  notify('Analytics exported');
}

function bindBotActions() {
  document.querySelectorAll('[data-action="start-bot"]').forEach((button) => button.addEventListener('click', () => postAndRefresh(`/api/bots/${button.dataset.id}/start`)));
  document.querySelectorAll('[data-action="stop-bot"]').forEach((button) => button.addEventListener('click', () => postAndRefresh(`/api/bots/${button.dataset.id}/stop`)));
  document.querySelectorAll('[data-action="verify-bot"]').forEach((button) => button.addEventListener('click', async () => {
    try {
      notify('Verifying bot token...');
      await api(`/api/bots/${button.dataset.id}/verify-token`, { method: 'POST', body: JSON.stringify({}) });
      notify('Bot token verified');
      await refreshAll();
    } catch (error) {
      notify(error.message);
    }
  }));
  document.querySelectorAll('[data-action="edit-bot"]').forEach((button) => button.addEventListener('click', () => {
    state.modal = `edit-bot:${button.dataset.id}`;
    render();
  }));
  document.querySelectorAll('[data-action="delete-bot"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this bot and related local data?')) return;
    await api(`/api/bots/${button.dataset.id}`, { method: 'DELETE' });
    notify('Bot deleted');
    await refreshAll();
  }));
}

function bindChatActions() {
  document.querySelectorAll('[data-action="select-chat"]').forEach((card) => card.addEventListener('click', async () => {
    state.selectedChatId = card.dataset.chatId;
    await refreshMessages();
    render();
  }));
  document.querySelectorAll('[data-action="set-chat-status"]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/chats/${button.dataset.id}`, { method: 'PUT', body: JSON.stringify({ status: button.dataset.status }) });
    notify('Chat status updated');
    await refreshAll();
  }));
  document.querySelector('[data-action="apply-message-filters"]')?.addEventListener('click', applyMessageFilters);
  document.querySelector('[data-action="clear-message-filters"]')?.addEventListener('click', clearMessageFilters);
  document.querySelector('#chatSearch')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyMessageFilters();
  });
  document.querySelector('#messageSearch')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyMessageFilters();
  });
}

async function applyMessageFilters() {
  state.chatSearch = document.querySelector('#chatSearch')?.value.trim() || '';
  state.chatStatusFilter = document.querySelector('#chatStatusFilter')?.value || '';
  state.messageSearch = document.querySelector('#messageSearch')?.value.trim() || '';
  if (state.selectedChatId && !visibleChats().some((chat) => String(chat.chatId) === String(state.selectedChatId))) {
    state.selectedChatId = '';
  }
  await refreshMessages();
  render();
}

async function clearMessageFilters() {
  state.chatSearch = '';
  state.chatStatusFilter = '';
  state.messageSearch = '';
  await refreshMessages();
  render();
}

function bindForms() {
  document.querySelector('#botForm')?.addEventListener('submit', submitBot);
  document.querySelector('#templateForm')?.addEventListener('submit', submitTemplate);
  document.querySelector('#ruleForm')?.addEventListener('submit', submitRule);
  document.querySelector('#broadcastForm')?.addEventListener('submit', submitBroadcast);
  document.querySelector('#replyForm')?.addEventListener('submit', submitReply);
  document.querySelector('#testChatForm')?.addEventListener('submit', submitTestChat);
  document.querySelector('#knowledgeForm')?.addEventListener('submit', submitKnowledge);
  document.querySelector('[data-action="save-internal-note"]')?.addEventListener('click', submitInternalNote);
  document.querySelector('[data-action="preview-translation"]')?.addEventListener('click', previewTranslation);
  document.querySelector('[data-action="test-rule"]')?.addEventListener('click', testRule);
  document.querySelector('[data-action="save-ai"]')?.addEventListener('click', saveAi);
  document.querySelector('[data-action="save-ai-config"]')?.addEventListener('click', saveAiConfig);
  document.querySelector('[data-action="fill-deepseek-config"]')?.addEventListener('click', fillDeepSeekConfig);
  document.querySelector('[data-action="test-ai"]')?.addEventListener('click', testAi);
  document.querySelector('#aiProviderPreset')?.addEventListener('change', applyAiProviderPreset);
  document.querySelector('#globalAiProvider')?.addEventListener('change', applyGlobalAiProviderPreset);
  document.querySelector('#globalAiModel')?.addEventListener('change', applyGlobalAiModelPreset);
  document.querySelector('#globalAiModel')?.addEventListener('input', applyGlobalAiModelPreset);
  document.querySelector('[data-action="test-token"]')?.addEventListener('click', testToken);
  document.querySelectorAll('[data-action="edit-template"]').forEach((button) => button.addEventListener('click', () => {
    state.modal = `edit-template:${button.dataset.id}`;
    render();
  }));
  document.querySelectorAll('[data-action="delete-template"]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/templates/${button.dataset.id}`, { method: 'DELETE' });
    notify('Template deleted');
    await refreshAll();
  }));
  document.querySelectorAll('[data-action="edit-rule"]').forEach((button) => button.addEventListener('click', () => {
    state.modal = `edit-rule:${button.dataset.id}`;
    render();
  }));
  document.querySelectorAll('[data-action="delete-rule"]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/rules/${button.dataset.id}`, { method: 'DELETE' });
    notify('Rule deleted');
    await refreshAll();
  }));
  document.querySelectorAll('[data-action="delete-knowledge"]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/knowledge/${button.dataset.id}`, { method: 'DELETE' });
    notify('Knowledge deleted');
    await refreshScoped();
    render();
  }));
  document.querySelectorAll('[data-action="send-broadcast"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Send this broadcast now?')) return;
    await api(`/api/broadcasts/${button.dataset.id}/send`, { method: 'POST', body: JSON.stringify({}) });
    notify('Broadcast completed');
    await refreshAll();
  }));
  document.querySelectorAll('[data-action="view-broadcast"]').forEach((button) => button.addEventListener('click', async () => {
    state.broadcastDetail = await api(`/api/broadcasts/${button.dataset.id}`);
    state.modal = `broadcast-detail:${button.dataset.id}`;
    render();
  }));
  document.querySelectorAll('[data-action="delete-broadcast"]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this broadcast and its target records?')) return;
    await api(`/api/broadcasts/${button.dataset.id}`, { method: 'DELETE' });
    notify('Broadcast deleted');
    await refreshAll();
  }));
}

function renderInlineBuilder(builder, rows) {
  builder.querySelector('.inline-button-rows').innerHTML = renderInlineButtonRows(rows);
  updateInlineButtonInput(builder);
}

function handleInlineButtonAction(button) {
  const builder = button.closest('[data-inline-builder]');
  if (!builder) return;
  const rows = collectInlineButtons(builder);
  if (button.dataset.action === 'form-add-inline-row') {
    rows.push([]);
  }
  if (button.dataset.action === 'form-add-inline-button') {
    const rowIndex = Number(button.dataset.row);
    rows[rowIndex] ||= [];
    rows[rowIndex].push({ text: 'New Button', actionType: 'callback', actionValue: 'new_button' });
  }
  if (button.dataset.action === 'form-remove-inline-button') {
    rows[Number(button.dataset.row)]?.splice(Number(button.dataset.col), 1);
  }
  renderInlineBuilder(builder, rows);
}

function collectInlineButtons(builder) {
  if (!builder) return [];
  return [...builder.querySelectorAll('.inline-button-row')]
    .map((row) =>
      [...row.querySelectorAll('.inline-button-editor')]
        .map((editor) => ({
          text: editor.querySelector('[data-field="text"]').value.trim(),
          actionType: editor.querySelector('[data-field="actionType"]').value,
          actionValue: editor.querySelector('[data-field="actionValue"]').value.trim()
        }))
        .filter((button) => button.text)
    )
    .filter((row) => row.length);
}

function updateInlineButtonInput(builder) {
  const input = builder.querySelector('input[type="hidden"]');
  input.value = JSON.stringify(collectInlineButtons(builder));
}

function updateInlineButtonInputs(form) {
  form.querySelectorAll('[data-inline-builder]').forEach(updateInlineButtonInput);
}

function bindMenuActions() {
  document.querySelectorAll('[data-action="add-button-row"]').forEach((button) => button.addEventListener('click', () => {
    state.menus[button.dataset.kind] ||= [];
    state.menus[button.dataset.kind].push([]);
    render();
  }));
  document.querySelectorAll('[data-action="add-button"]').forEach((button) => button.addEventListener('click', () => {
    readMenusFromDom();
    state.menus[button.dataset.kind][Number(button.dataset.row)].push({ text: 'New Button', actionType: 'callback', actionValue: 'new_button' });
    render();
  }));
  document.querySelectorAll('[data-action="remove-button"]').forEach((button) => button.addEventListener('click', () => {
    readMenusFromDom();
    state.menus[button.dataset.kind][Number(button.dataset.row)].splice(Number(button.dataset.col), 1);
    render();
  }));
  document.querySelector('[data-action="save-menus"]')?.addEventListener('click', async () => {
    readMenusFromDom();
    await api(`/api/menus/${state.selectedBotId}`, { method: 'PUT', body: JSON.stringify(state.menus) });
    notify('Menus saved');
    await refreshAll();
  });
}

function bindDataActions() {
  document.querySelector('[data-action="export-data"]')?.addEventListener('click', exportData);
  document.querySelector('#importForm')?.addEventListener('submit', importData);
}

async function exportData() {
  try {
    notify('Preparing backup...');
    const response = await fetch('/api/export', {
      headers: { 'x-admin-password': state.password }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tg-bot-admin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify('Backup downloaded');
  } catch (error) {
    notify(error.message);
  }
}

async function importData(event) {
  event.preventDefault();
  if (!confirm('Import will replace all current local data. Continue?')) return;
  try {
    notify('Importing backup...');
    const data = new FormData(event.currentTarget);
    await api('/api/import', { method: 'POST', body: data });
    state.selectedBotId = '';
    state.selectedChatId = '';
    state.broadcastDetail = null;
    notify('Backup imported');
    await refreshAll();
  } catch (error) {
    notify(error.message);
  }
}

function bindDiagnostics() {
  document.querySelector('[data-action="run-diagnostics"]')?.addEventListener('click', async () => {
    if (!state.selectedBotId) return notify('Select a bot first');
    const data = await api(`/api/bots/${state.selectedBotId}/diagnostics`);
    const panel = document.querySelector('#diagnosticsPanel');
    panel.innerHTML = `
      <h2>Diagnostics Result</h2>
      <div class="grid cols-3">
        ${statCard('Token', data.tokenOk ? 'OK' : 'Failed')}
        ${statCard('API Latency', `${data.apiLatencyMs}ms`)}
        ${statCard('Webhook', data.webhookUrl ? 'Enabled' : 'Not Set')}
      </div>
      <h3 style="margin-top:16px;">Polling</h3>
      <pre class="code">${escapeHtml(JSON.stringify(data.polling, null, 2))}</pre>
      <h3>Raw Updates</h3>
      <pre class="code">${escapeHtml(JSON.stringify(data.lastRawUpdates, null, 2))}</pre>
      <h3>Send Logs</h3>
      <pre class="code">${escapeHtml(JSON.stringify(data.lastSendLogs, null, 2))}</pre>
    `;
  });
  document.querySelector('[data-action="delete-webhook"]')?.addEventListener('click', async () => {
    if (!state.selectedBotId) return notify('Select a bot first');
    await api(`/api/bots/${state.selectedBotId}/delete-webhook`, { method: 'POST', body: JSON.stringify({ dropPendingUpdates: false }) });
    notify('Webhook deleted');
  });
}

async function submitBot(event) {
  event.preventDefault();
  try {
    notify('Saving bot...');
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!data.token) delete data.token;
    data.skipTokenTest = data.skipTokenTest === 'true';
    const botId = form.dataset.id;
    await api(botId ? `/api/bots/${botId}` : '/api/bots', {
      method: botId ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });
    closeModal();
    notify('Bot saved');
    await refreshAll();
  } catch (error) {
    notify(error.message);
  }
}

async function testToken() {
  try {
    notify('Testing token...');
    const form = document.querySelector('#botForm');
    const token = new FormData(form).get('token');
    if (!token) return notify('Enter a token first');
    const info = await api('/api/bots/test-token', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    notify(`Token OK: @${info.username || info.first_name || info.id}`);
  } catch (error) {
    notify(error.message);
  }
}

async function submitTemplate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  updateInlineButtonInputs(form);
  const data = new FormData(form);
  const id = form.dataset.id;
  await api(id ? `/api/templates/${id}` : '/api/templates', { method: id ? 'PUT' : 'POST', body: data });
  closeModal();
  notify('Template saved');
  await refreshAll();
}

async function submitRule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.enabled = data.enabled === 'true';
  const id = form.dataset.id;
  await api(id ? `/api/rules/${id}` : '/api/rules', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
  closeModal();
  notify('Rule saved');
  await refreshAll();
}

async function testRule() {
  try {
    if (!state.selectedBotId) return notify('Select a bot first');
    notify('Testing rule...');
    const result = await api('/api/rules/test', {
      method: 'POST',
      body: JSON.stringify({
        botId: state.selectedBotId,
        type: document.querySelector('#ruleTestType').value,
        text: document.querySelector('#ruleTestText').value
      })
    });
    state.ruleTestResult = result;
    notify(result.matched ? 'Rule matched' : 'No rule matched');
    render();
  } catch (error) {
    notify(error.message);
  }
}

async function submitBroadcast(event) {
  event.preventDefault();
  const form = event.currentTarget;
  updateInlineButtonInputs(form);
  const data = new FormData(form);
  await api('/api/broadcasts', { method: 'POST', body: data });
  closeModal();
  notify('Broadcast saved');
  await refreshAll();
}

async function submitReply(event) {
  event.preventDefault();
  const form = event.currentTarget;
  updateInlineButtonInputs(form);
  const data = new FormData(form);
  data.append('botId', state.selectedBotId);
  data.append('chatId', state.selectedChatId);
  data.append('translate', data.get('translateMode') === 'translate' ? 'true' : 'false');
  await api('/api/messages/send', { method: 'POST', body: data });
  form.reset();
  notify('Reply sent');
  await refreshMessages();
  render();
}

async function previewTranslation() {
  try {
    const form = document.querySelector('#replyForm');
    const data = Object.fromEntries(new FormData(form));
    if (!data.text || !String(data.text).trim()) return notify('Enter reply text first');
    const result = await api('/api/translate', {
      method: 'POST',
      body: JSON.stringify({
        botId: state.selectedBotId,
        chatId: state.selectedChatId,
        text: data.text,
        targetLanguage: data.targetLanguage || 'auto'
      })
    });
    const preview = document.querySelector('#translationPreview');
    if (preview) {
      preview.hidden = false;
      preview.innerHTML = `<strong>Translation</strong><p>${escapeHtml(result.text || '')}</p>`;
    }
    form.querySelector('[name="text"]').value = result.text || data.text;
    form.querySelector('[name="translateMode"]').value = 'none';
    notify(`Translated to ${result.targetLanguage || 'target language'}`);
  } catch (error) {
    notify(error.message);
  }
}

async function submitInternalNote() {
  try {
    const form = document.querySelector('#replyForm');
    const text = new FormData(form).get('text');
    if (!text || !String(text).trim()) return notify('Enter note text first');
    await api('/api/messages/note', {
      method: 'POST',
      body: JSON.stringify({
        botId: state.selectedBotId,
        chatId: state.selectedChatId,
        text
      })
    });
    form.reset();
    notify('Internal note saved');
    await refreshMessages();
    render();
  } catch (error) {
    notify(error.message);
  }
}

async function submitTestChat(event) {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await api('/api/chats/test', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    closeModal();
    notify('Test chat created');
    await refreshAll();
  } catch (error) {
    notify(error.message);
  }
}

async function submitKnowledge(event) {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!data.get('file')?.name && !String(data.get('text') || '').trim()) return notify('Upload a text file or paste knowledge first');
    await api('/api/knowledge', { method: 'POST', body: data });
    form.reset();
    notify('Knowledge uploaded');
    await refreshScoped();
    render();
  } catch (error) {
    notify(error.message);
  }
}

async function saveAi() {
  const patch = {
    aiEnabled: document.querySelector('#aiEnabled').value === 'true',
    aiModel: document.querySelector('#aiModel').value,
    aiContextLimit: Number(document.querySelector('#aiContextLimit').value || 10),
    replyDelaySeconds: Number(document.querySelector('#replyDelaySeconds').value || 0),
    aiPrompt: document.querySelector('#aiPrompt').value
  };
  await api(`/api/bots/${state.selectedBotId}`, { method: 'PUT', body: JSON.stringify(patch) });
  state.aiTestReply = '';
  notify('AI settings saved');
  await refreshAll();
}

function applyAiProviderPreset() {
  const preset = document.querySelector('#aiProviderPreset')?.value || 'custom';
  const modelInput = document.querySelector('#aiModel');
  if (!modelInput) return;
  if (aiProviderPresets[preset]) modelInput.value = aiProviderPresets[preset].model;
}

function fillDeepSeekConfig() {
  document.querySelector('#globalAiProvider').value = 'deepseek';
  applyGlobalAiProviderPreset();
  if (document.querySelector('#aiProviderPreset')) document.querySelector('#aiProviderPreset').value = 'deepseek';
  applyAiProviderPreset();
}

function applyGlobalAiProviderPreset() {
  const provider = document.querySelector('#globalAiProvider')?.value || 'deepseek';
  const preset = aiProviderPresets[provider];
  if (!preset) return;
  document.querySelector('#globalAiBaseUrl').value = preset.baseURL;
  document.querySelector('#globalAiModel').value = preset.model;
}

function applyGlobalAiModelPreset() {
  const model = document.querySelector('#globalAiModel')?.value.trim() || '';
  const providerInput = document.querySelector('#globalAiProvider');
  const baseUrlInput = document.querySelector('#globalAiBaseUrl');
  if (!providerInput || !baseUrlInput) return;
  const provider = providerForModel(model);
  if (!provider) return;
  providerInput.value = provider;
  baseUrlInput.value = aiProviderPresets[provider].baseURL;
}

function providerForModel(model = '') {
  if (model.startsWith('deepseek-')) return 'deepseek';
  if (model.startsWith('gpt-')) return 'openai';
  return '';
}

async function saveAiConfig() {
  try {
    const provider = document.querySelector('#globalAiProvider').value || 'deepseek';
    const preset = aiProviderPresets[provider] || {};
    const payload = {
      provider,
      baseURL: document.querySelector('#globalAiBaseUrl').value.trim() || preset.baseURL || '',
      model: document.querySelector('#globalAiModel').value.trim() || preset.model || '',
      apiKey: document.querySelector('#globalAiApiKey').value.trim()
    };
    state.aiConfig = await api('/api/ai-config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    notify('AI API connection saved');
    await refreshAll();
  } catch (error) {
    notify(error.message);
  }
}

async function testAi() {
  try {
    notify('Testing AI...');
    const response = await api(`/api/bots/${state.selectedBotId}/test-ai`, {
      method: 'POST',
      body: JSON.stringify({
        text: document.querySelector('#aiTestText').value
      })
    });
    state.aiTestReply = response.reply || '(empty reply)';
    notify('AI test completed');
    render();
  } catch (error) {
    notify(error.message);
  }
}

async function postAndRefresh(path) {
  await api(path, { method: 'POST', body: JSON.stringify({}) });
  notify('Updated');
  await refreshAll();
}

function readMenusFromDom() {
  for (const kind of ['inline', 'keyboard']) {
    const rows = [];
    document.querySelectorAll(`.button-editor[data-kind="${kind}"]`).forEach((editor) => {
      const row = Number(editor.dataset.row);
      rows[row] ||= [];
      rows[row].push({
        text: editor.querySelector('[data-field="text"]').value,
        actionType: editor.querySelector('[data-field="actionType"]').value,
        actionValue: editor.querySelector('[data-field="actionValue"]').value
      });
    });
    state.menus[kind] = rows;
  }
}

function closeModal() {
  state.modal = null;
  render();
}

function notify(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 2600);
}

function selectedBot() {
  return state.bots.find((bot) => bot.id === state.selectedBotId);
}

function selectedChat() {
  return state.chats.find((chat) => String(chat.chatId) === String(state.selectedChatId) && chat.botId === state.selectedBotId);
}

function visibleChats() {
  const needle = state.chatSearch.toLowerCase();
  return state.chats
    .filter((chat) => !state.selectedBotId || chat.botId === state.selectedBotId)
    .filter((chat) => !state.chatStatusFilter || chat.status === state.chatStatusFilter)
    .filter((chat) => {
      if (!needle) return true;
      return [chat.chatId, chat.username, chat.firstName, chat.lastName, chat.type]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
}

function botName(botId) {
  return state.bots.find((bot) => bot.id === botId)?.name || '-';
}

function estimateBroadcastRecipients(botId, targetType = 'all') {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return state.chats
    .filter((chat) => chat.botId === botId)
    .filter((chat) => chat.status !== 'blocked')
    .filter((chat) => {
      if (targetType === 'manual_only') return chat.status === 'manual';
      if (targetType === 'auto_only') return chat.status === 'auto';
      if (targetType === 'active_7d') return now - new Date(chat.lastMessageAt || 0).getTime() <= 7 * dayMs;
      if (targetType === 'active_30d') return now - new Date(chat.lastMessageAt || 0).getTime() <= 30 * dayMs;
      return true;
    }).length;
}

function broadcastTargetLabel(targetType = 'all') {
  return {
    all: 'All non-blocked chats',
    auto_only: 'Auto reply chats only',
    manual_only: 'Manual takeover only',
    active_7d: 'Active in last 7 days',
    active_30d: 'Active in last 30 days'
  }[targetType] || targetType;
}

function templateName(templateId) {
  return state.templates.find((tpl) => tpl.id === templateId)?.name || '-';
}

function botSelectInput(name, value) {
  return `<select name="${name}">${state.bots.map((bot) => `<option value="${bot.id}" ${value === bot.id ? 'selected' : ''}>${escapeHtml(bot.name)}</option>`).join('')}</select>`;
}

function templateSelectInput(name, value) {
  return `<select name="${name}"><option value="">None</option>${state.templates.map((tpl) => `<option value="${tpl.id}" ${value === tpl.id ? 'selected' : ''}>${escapeHtml(tpl.name)}</option>`).join('')}</select>`;
}

function statusBadge(status) {
  const color = ['running', 'auto', 'completed', 'verified', 'sent'].includes(status)
    ? 'green'
    : ['blocked', 'failed', 'unverified'].includes(status)
      ? 'red'
      : 'amber';
  return `<span class="badge ${color}">${escapeHtml(status || '-')}</span>`;
}

function levelBadge(level = 'info') {
  const color = level === 'error' ? 'red' : level === 'warn' ? 'amber' : 'green';
  return `<span class="badge ${color}">${escapeHtml(level)}</span>`;
}

function chatTitle(chat) {
  return escapeHtml(chat.username ? `@${chat.username}` : [chat.firstName, chat.lastName].filter(Boolean).join(' ') || chat.chatId);
}

function messageLine(message) {
  return `
    <div class="activity-card">
      <div class="activity-head">
        ${statusBadge(message.role)}
        <span class="muted">${formatTime(message.createdAt)}</span>
      </div>
      <div>${escapeHtml(short(message.content || `[${message.mediaType}]`, 90))}</div>
    </div>
  `;
}

function issueLine(log) {
  return `
    <div class="activity-card issue">
      <div class="activity-head">
        ${levelBadge(log.level)}
        <strong>${escapeHtml(log.action)}</strong>
        <span class="muted">${formatTime(log.createdAt)} ${log.botId ? `- ${escapeHtml(botName(log.botId))}` : ''}</span>
      </div>
      <div>${escapeHtml(log.message)}</div>
    </div>
  `;
}

function mediaPreview(item = {}) {
  const mediaType = item.mediaType || 'none';
  const url = item.mediaUrl || uploadUrl(item.mediaPath);
  if (!url || mediaType === 'none') return '';
  if (mediaType === 'photo' || mediaType === 'image') {
    return `<a href="${url}" target="_blank" rel="noreferrer"><img class="media-preview" src="${url}" alt="media preview" loading="lazy" /></a>`;
  }
  if (mediaType === 'video') {
    return `<video class="media-preview" src="${url}" controls preload="metadata"></video>`;
  }
  return `<a class="media-file" href="${url}" target="_blank" rel="noreferrer">${escapeHtml(mediaType)} file</a>`;
}

function uploadUrl(mediaPath = '') {
  if (!mediaPath) return '';
  const normalized = String(mediaPath).replaceAll('\\', '/');
  const marker = '/uploads/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return '';
  return `/uploads/${encodeURIComponent(normalized.slice(index + marker.length))}`;
}

function mediaTypeFromMime(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function short(value, length = 48) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

