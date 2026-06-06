import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const defaults = {
  bots: [],
  chats: [],
  messages: [],
  rawUpdates: [],
  templates: [],
  rules: [],
  menus: {},
  broadcasts: [],
  broadcastTargets: [],
  healthChecks: [],
  sendLogs: [],
  systemLogs: [],
  aiConfig: {
    provider: '',
    baseURL: '',
    apiKey: '',
    model: ''
  }
};

export function createStore(filePath) {
  let db = load(filePath);

  function persist() {
    writeFileSync(filePath, JSON.stringify(db, null, 2), 'utf8');
  }

  function safeJson(value, fallback) {
    if (Array.isArray(value) || typeof value === 'object') return value;
    try {
      return JSON.parse(value || '');
    } catch {
      return fallback;
    }
  }

  return {
    exportData() {
      return {
        version: 1,
        exportedAt: now(),
        data: structuredClone(db)
      };
    },

    importData(payload) {
      const incoming = payload?.data || payload;
      if (!incoming || typeof incoming !== 'object') throw new Error('Invalid backup file');
      db = {
        ...structuredClone(defaults),
        ...Object.fromEntries(Object.keys(defaults).map((key) => [key, incoming[key] ?? defaults[key]]))
      };
      db.bots = db.bots.map((bot) => ({ ...bot, status: 'stopped' }));
      persist();
      return this.getDashboard();
    },

    createSystemLog(input) {
      const log = {
        id: id('syslog'),
        level: input.level || 'info',
        action: input.action || 'unknown',
        message: input.message || '',
        botId: input.botId || '',
        entityId: input.entityId || '',
        metadata: input.metadata || {},
        createdAt: now()
      };
      db.systemLogs.push(log);
      if (db.systemLogs.length > 1500) db.systemLogs = db.systemLogs.slice(-1500);
      persist();
      return log;
    },

    listSystemLogs(query = {}) {
      let rows = [...db.systemLogs];
      if (query.level) rows = rows.filter((log) => log.level === query.level);
      if (query.action) rows = rows.filter((log) => log.action === query.action);
      if (query.botId) rows = rows.filter((log) => log.botId === query.botId);
      return rows.slice(-Number(query.limit || 200)).reverse();
    },

    getAiConfig() {
      return db.aiConfig || structuredClone(defaults.aiConfig);
    },

    updateAiConfig(patch = {}) {
      const current = this.getAiConfig();
      db.aiConfig = {
        ...current,
        provider: patch.provider ?? current.provider,
        baseURL: patch.baseURL ?? current.baseURL,
        apiKey: patch.apiKey === undefined ? current.apiKey : patch.apiKey,
        model: patch.model ?? current.model,
        updatedAt: now()
      };
      persist();
      return db.aiConfig;
    },

    getDashboard() {
      const today = new Date().toISOString().slice(0, 10);
      const todayMessages = db.messages.filter((m) => m.createdAt?.startsWith(today) && m.role === 'user');
      const activeChatIds = new Set(todayMessages.map((m) => `${m.botId}:${m.chatId}`));
      return {
        botCount: db.bots.length,
        runningCount: db.bots.filter((b) => b.status === 'running').length,
        unverifiedBotCount: db.bots.filter((b) => !b.tokenVerified).length,
        todayMessages: todayMessages.length,
        activeUsers: activeChatIds.size,
        recentBots: db.bots.slice(-6).reverse(),
        recentMessages: db.messages.slice(-10).reverse(),
        recentIssues: db.systemLogs
          .filter((log) => log.level === 'error' || log.level === 'warn')
          .slice(-8)
          .reverse()
      };
    },

    listBots() {
      return db.bots;
    },

    resetRuntimeStatuses() {
      db.bots = db.bots.map((bot) => ({
        ...bot,
        status: bot.status === 'running' ? 'stopped' : bot.status,
        updatedAt: bot.status === 'running' ? now() : bot.updatedAt
      }));
      persist();
    },

    getBot(botId) {
      return db.bots.find((bot) => bot.id === botId);
    },

    createBot(input) {
      const bot = {
        id: id('bot'),
        name: input.name,
        username: input.username,
        token: input.token,
        status: 'stopped',
        welcomeMessage: input.welcomeMessage,
        defaultReply: input.defaultReply,
        aiEnabled: Boolean(input.aiEnabled),
        aiPrompt: input.aiPrompt,
        aiModel: input.aiModel,
        aiContextLimit: Number(input.aiContextLimit || 10),
        tokenVerified: Boolean(input.tokenVerified),
        createdAt: now(),
        updatedAt: now()
      };
      db.bots.push(bot);
      db.menus[bot.id] = defaultMenus();
      persist();
      return bot;
    },

    updateBot(botId, patch) {
      const bot = this.getBot(botId);
      if (!bot) return null;
      const allowed = [
        'name',
        'token',
        'welcomeMessage',
        'defaultReply',
        'aiEnabled',
        'aiPrompt',
        'aiModel',
        'aiContextLimit',
        'username',
        'tokenVerified',
        'status'
      ];
      for (const key of allowed) {
        if (patch[key] !== undefined) bot[key] = ['aiEnabled', 'tokenVerified'].includes(key) ? Boolean(patch[key]) : patch[key];
      }
      bot.aiContextLimit = Number(bot.aiContextLimit || 10);
      bot.updatedAt = now();
      persist();
      return bot;
    },

    deleteBot(botId) {
      db.bots = db.bots.filter((bot) => bot.id !== botId);
      db.chats = db.chats.filter((chat) => chat.botId !== botId);
      db.messages = db.messages.filter((message) => message.botId !== botId);
      db.rawUpdates = db.rawUpdates.filter((update) => update.botId !== botId);
      db.templates = db.templates.filter((template) => template.botId !== botId);
      db.rules = db.rules.filter((rule) => rule.botId !== botId);
      delete db.menus[botId];
      persist();
    },

    upsertChat(input) {
      const chatKey = String(input.chatId);
      let chat = db.chats.find((item) => item.botId === input.botId && String(item.chatId) === chatKey);
      if (!chat) {
        chat = {
          id: id('chat'),
          botId: input.botId,
          chatId: chatKey,
          username: input.username || '',
          firstName: input.firstName || '',
          lastName: input.lastName || '',
          type: input.type || 'private',
          status: 'auto',
          lastMessageAt: now(),
          createdAt: now(),
          updatedAt: now()
        };
        db.chats.push(chat);
      } else {
        chat.username = input.username || chat.username;
        chat.firstName = input.firstName || chat.firstName;
        chat.lastName = input.lastName || chat.lastName;
        chat.type = input.type || chat.type;
        chat.lastMessageAt = now();
        chat.updatedAt = now();
      }
      persist();
      return chat;
    },

    listChats(query = {}) {
      let rows = [...db.chats];
      if (query.botId) rows = rows.filter((chat) => chat.botId === query.botId);
      if (query.status) rows = rows.filter((chat) => chat.status === query.status);
      if (query.search) {
        const needle = String(query.search).toLowerCase();
        rows = rows.filter((chat) =>
          [chat.chatId, chat.username, chat.firstName, chat.lastName].some((value) => String(value || '').toLowerCase().includes(needle))
        );
      }
      return rows.sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
    },

    getChat(botId, chatId) {
      return db.chats.find((chat) => chat.botId === botId && String(chat.chatId) === String(chatId));
    },

    updateChat(chatId, patch) {
      const chat = db.chats.find((item) => item.id === chatId);
      if (!chat) return null;
      if (patch.status) chat.status = patch.status;
      chat.updatedAt = now();
      persist();
      return chat;
    },

    createMessage(input) {
      const message = {
        id: id('msg'),
        botId: input.botId,
        chatId: String(input.chatId),
        role: input.role,
        content: input.content || '',
        mediaType: input.mediaType || 'none',
        mediaPath: input.mediaPath || '',
        telegramFileId: input.telegramFileId || '',
        source: input.source || 'manual',
        createdAt: now()
      };
      db.messages.push(message);
      persist();
      return message;
    },

    listMessages(query = {}) {
      let rows = [...db.messages];
      if (query.botId) rows = rows.filter((message) => message.botId === query.botId);
      if (query.chatId) rows = rows.filter((message) => String(message.chatId) === String(query.chatId));
      if (query.search) {
        const needle = String(query.search).toLowerCase();
        rows = rows.filter((message) => message.content.toLowerCase().includes(needle));
      }
      const limit = Math.min(Number(query.limit || 100), 500);
      return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-limit);
    },

    createRawUpdate(input) {
      const update = {
        id: id('upd'),
        botId: input.botId,
        updateId: input.updateId,
        updateType: input.updateType,
        payload: input.payload,
        handled: Boolean(input.handled),
        errorMessage: input.errorMessage || '',
        createdAt: now()
      };
      db.rawUpdates.push(update);
      if (db.rawUpdates.length > 1000) db.rawUpdates = db.rawUpdates.slice(-1000);
      persist();
      return update;
    },

    updateRawUpdate(updateId, patch) {
      const update = db.rawUpdates.find((item) => item.id === updateId);
      if (!update) return null;
      Object.assign(update, patch);
      persist();
      return update;
    },

    listRawUpdates(botId) {
      return db.rawUpdates
        .filter((update) => !botId || update.botId === botId)
        .slice(-80)
        .reverse();
    },

    listTemplates(botId) {
      return db.templates.filter((template) => !botId || template.botId === botId);
    },

    getTemplate(templateId) {
      return db.templates.find((template) => template.id === templateId);
    },

    createTemplate(input) {
      const template = {
        id: id('tpl'),
        botId: input.botId,
        name: input.name || 'Untitled template',
        text: input.text || '',
        mediaType: input.mediaType || 'none',
        mediaPath: input.mediaPath || '',
        telegramFileId: input.telegramFileId || '',
        buttons: safeJson(input.buttonsJson, []),
        createdAt: now(),
        updatedAt: now()
      };
      db.templates.push(template);
      persist();
      return template;
    },

    updateTemplate(templateId, patch) {
      const template = this.getTemplate(templateId);
      if (!template) return null;
      for (const key of ['name', 'text', 'mediaType', 'mediaPath', 'telegramFileId']) {
        if (patch[key] !== undefined && patch[key] !== '') template[key] = patch[key];
      }
      if (patch.buttonsJson !== undefined) template.buttons = safeJson(patch.buttonsJson, []);
      template.updatedAt = now();
      persist();
      return template;
    },

    deleteTemplate(templateId) {
      db.templates = db.templates.filter((template) => template.id !== templateId);
      db.rules = db.rules.map((rule) => (rule.templateId === templateId ? { ...rule, templateId: '' } : rule));
      persist();
    },

    listRules(botId) {
      return db.rules.filter((rule) => !botId || rule.botId === botId);
    },

    createRule(input) {
      const rule = {
        id: id('rule'),
        botId: input.botId,
        type: input.type || 'keyword',
        pattern: input.pattern || '',
        matchMode: input.matchMode || 'contains',
        templateId: input.templateId || '',
        enabled: input.enabled !== false,
        priority: Number(input.priority || 100),
        createdAt: now(),
        updatedAt: now()
      };
      db.rules.push(rule);
      persist();
      return rule;
    },

    updateRule(ruleId, patch) {
      const rule = db.rules.find((item) => item.id === ruleId);
      if (!rule) return null;
      Object.assign(rule, patch);
      rule.enabled = patch.enabled === undefined ? rule.enabled : Boolean(patch.enabled);
      rule.priority = Number(rule.priority || 100);
      rule.updatedAt = now();
      persist();
      return rule;
    },

    deleteRule(ruleId) {
      db.rules = db.rules.filter((rule) => rule.id !== ruleId);
      persist();
    },

    findMatchingRule(botId, text = '', type = 'message') {
      const normalized = text.trim().toLowerCase();
      return db.rules
        .filter((rule) => rule.botId === botId && rule.enabled)
        .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100))
        .find((rule) => {
          const pattern = String(rule.pattern || '').trim().toLowerCase();
          if (!pattern) return false;
          if (rule.type === 'command' && !normalized.startsWith('/')) return false;
          if (rule.type === 'callback' && type !== 'callback') return false;
          if (rule.type !== 'callback' && type === 'callback') return false;
          return rule.matchMode === 'exact' ? normalized === pattern : normalized.includes(pattern);
        });
    },

    getMenus(botId) {
      return db.menus[botId] || defaultMenus();
    },

    updateMenus(botId, menus) {
      db.menus[botId] = {
        inline: Array.isArray(menus.inline) ? menus.inline : [],
        keyboard: Array.isArray(menus.keyboard) ? menus.keyboard : []
      };
      persist();
      return db.menus[botId];
    },

    listBroadcasts() {
      return db.broadcasts.slice().reverse();
    },

    getBroadcast(broadcastId) {
      return db.broadcasts.find((broadcast) => broadcast.id === broadcastId);
    },

    getBroadcastDetail(broadcastId) {
      const broadcast = this.getBroadcast(broadcastId);
      if (!broadcast) return null;
      return {
        ...broadcast,
        targets: this.listBroadcastTargets(broadcastId)
      };
    },

    createBroadcast(input) {
      const broadcast = {
        id: id('bc'),
        botId: input.botId,
        title: input.title || 'Untitled broadcast',
        text: input.text || '',
        mediaType: input.mediaType || 'none',
        mediaPath: input.mediaPath || '',
        buttons: safeJson(input.buttonsJson, []),
        targetType: input.targetType || 'all',
        status: 'draft',
        totalCount: 0,
        successCount: 0,
        failedCount: 0,
        createdAt: now(),
        startedAt: '',
        finishedAt: ''
      };
      db.broadcasts.push(broadcast);
      persist();
      return broadcast;
    },

    updateBroadcast(broadcastId, patch) {
      const broadcast = this.getBroadcast(broadcastId);
      if (!broadcast) return null;
      Object.assign(broadcast, patch);
      persist();
      return broadcast;
    },

    deleteBroadcast(broadcastId) {
      db.broadcasts = db.broadcasts.filter((broadcast) => broadcast.id !== broadcastId);
      db.broadcastTargets = db.broadcastTargets.filter((target) => target.broadcastId !== broadcastId);
      persist();
    },

    setBroadcastTargets(broadcastId, targets) {
      db.broadcastTargets = db.broadcastTargets.filter((target) => target.broadcastId !== broadcastId);
      db.broadcastTargets.push(...targets);
      persist();
    },

    listBroadcastTargets(broadcastId) {
      return db.broadcastTargets.filter((target) => target.broadcastId === broadcastId);
    },

    createSendLog(input) {
      const log = {
        id: id('log'),
        botId: input.botId,
        chatId: String(input.chatId || ''),
        action: input.action,
        ok: Boolean(input.ok),
        errorMessage: input.errorMessage || '',
        createdAt: now()
      };
      db.sendLogs.push(log);
      if (db.sendLogs.length > 1000) db.sendLogs = db.sendLogs.slice(-1000);
      persist();
      return log;
    },

    listSendLogs(botId) {
      return db.sendLogs.filter((log) => !botId || log.botId === botId).slice(-80).reverse();
    }
  };
}

function load(filePath) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf8');
    return structuredClone(defaults);
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  return { ...structuredClone(defaults), ...parsed };
}

function defaultMenus() {
  return {
    inline: [
      [
        { text: 'Contact Support', actionType: 'callback', actionValue: 'contact_support' },
        { text: 'Open Channel', actionType: 'url', actionValue: 'https://t.me/' }
      ]
    ],
    keyboard: [
      [
        { text: 'Contact Support', actionType: 'text', actionValue: 'Contact Support' },
        { text: 'FAQ', actionType: 'text', actionValue: 'FAQ' }
      ],
      [
        { text: 'Pricing', actionType: 'text', actionValue: 'Pricing' },
        { text: 'Main Menu', actionType: 'text', actionValue: 'Main Menu' }
      ]
    ]
  };
}
