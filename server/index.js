import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createStore } from './store.js';
import { createBotManager } from './telegram.js';
import { createAiClient } from './ai.js';

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY || process.env.HTTP_PROXY));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const uploadDir = path.join(rootDir, 'uploads');
mkdirSync(dataDir, { recursive: true });
mkdirSync(uploadDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 3000);
const store = createStore(path.join(dataDir, 'db.json'));
store.resetRuntimeStatuses();
const envAiConfig = {
  provider: process.env.AI_PROVIDER || (process.env.AI_BASE_URL?.includes('openai') ? 'openai' : 'deepseek'),
  baseURL: process.env.AI_BASE_URL || '',
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || ''
};
function getAiConfig() {
  const saved = store.getAiConfig();
  return {
    provider: saved.provider || envAiConfig.provider,
    baseURL: saved.baseURL || envAiConfig.baseURL,
    apiKey: saved.apiKey || envAiConfig.apiKey,
    model: saved.model || envAiConfig.model
  };
}
const ai = createAiClient(getAiConfig);
const botManager = createBotManager({ store, ai, uploadDir });
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  },
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const safeBase = path
        .basename(file.originalname || 'upload', ext)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 40);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}${ext}`);
    }
  })
});
const backupUpload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  storage: multer.memoryStorage()
});

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(rootDir, 'public')));

function requireAdmin(req, res, next) {
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const header = req.headers['x-admin-password'];
  if (!password || header === password) return next();
  res.status(401).json({ error: 'ADMIN_PASSWORD_REQUIRED' });
}

app.get('/api/bootstrap', (req, res) => {
  res.json({ needsPassword: Boolean(process.env.ADMIN_PASSWORD || 'admin123') });
});

app.use('/api', requireAdmin);

app.get('/api/dashboard', (req, res) => {
  const dashboard = store.getDashboard();
  res.json({
    ...dashboard,
    recentBots: dashboard.recentBots.map((bot) => ({ ...bot, token: maskToken(bot.token) }))
  });
});

app.get('/api/media', (req, res) => {
  const files = readdirSync(uploadDir)
    .map((name) => {
      const filePath = path.join(uploadDir, name);
      const stats = statSync(filePath);
      return {
        name,
        path: filePath,
        url: `/uploads/${encodeURIComponent(name)}`,
        size: stats.size,
        mimeType: guessMimeType(name),
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(files);
});

app.get('/api/export', (req, res) => {
  const fileName = `tg-bot-admin-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.json(store.exportData());
});

app.post('/api/import', backupUpload.single('backup'), (req, res) => {
  try {
    const raw = req.file ? req.file.buffer.toString('utf8') : JSON.stringify(req.body);
    const dashboard = store.importData(JSON.parse(raw));
    store.createSystemLog({ level: 'warn', action: 'data_import', message: 'Local data was imported and replaced' });
    res.json({ ok: true, dashboard });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'data_import_failed', message: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/system-logs', (req, res) => {
  res.json(store.listSystemLogs(req.query));
});

app.get('/api/ai-config', (req, res) => {
  const config = getAiConfig();
  res.json({
    provider: config.provider,
    baseURL: config.baseURL || ai.baseURL,
    apiKeyMasked: maskSecret(config.apiKey),
    hasApiKey: Boolean(config.apiKey),
    model: config.model || ai.model,
    source: store.getAiConfig().apiKey ? 'local' : 'env'
  });
});

app.put('/api/ai-config', (req, res) => {
  const current = getAiConfig();
  const apiKey = typeof req.body.apiKey === 'string' && req.body.apiKey.trim()
    ? req.body.apiKey.trim()
    : req.body.clearApiKey
      ? ''
      : undefined;
  const updated = store.updateAiConfig({
    provider: req.body.provider || current.provider,
    baseURL: req.body.baseURL || '',
    apiKey,
    model: req.body.model || ''
  });
  store.createSystemLog({ level: 'warn', action: 'ai_config_updated', message: 'AI API configuration updated locally' });
  res.json({
    provider: updated.provider || envAiConfig.provider,
    baseURL: updated.baseURL || ai.baseURL,
    apiKeyMasked: maskSecret(updated.apiKey || envAiConfig.apiKey),
    hasApiKey: Boolean(updated.apiKey || envAiConfig.apiKey),
    model: updated.model || ai.model,
    source: updated.apiKey ? 'local' : 'env'
  });
});

app.get('/api/system-status', (req, res) => {
  const dataFile = path.join(dataDir, 'db.json');
  const uploadFiles = readdirSync(uploadDir).map((name) => {
    const filePath = path.join(uploadDir, name);
    return statSync(filePath);
  });
  const uploadBytes = uploadFiles.reduce((sum, stats) => sum + stats.size, 0);
  const dataStats = existsSync(dataFile) ? statSync(dataFile) : null;

  res.json({
    mode: 'local',
    nodeVersion: process.version,
    port,
    adminPassword: {
      configured: Boolean(process.env.ADMIN_PASSWORD),
      usingDefault: !process.env.ADMIN_PASSWORD
    },
    ai: {
      enabled: ai.enabled,
      provider: ai.provider,
      baseURLConfigured: Boolean(process.env.AI_BASE_URL),
      baseURL: ai.baseURL,
      model: ai.model
    },
    network: {
      proxyConfigured: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
    },
    storage: {
      dataFile,
      dataFileExists: Boolean(dataStats),
      dataFileBytes: dataStats?.size || 0,
      uploadDir,
      uploadFileCount: uploadFiles.length,
      uploadBytes
    },
    deployment: {
      current: 'Local JSON + local uploads',
      planned: 'Cloudflare Workers + D1 + R2'
    }
  });
});

app.get('/api/deployment-readiness', (req, res) => {
  const bots = store.listBots();
  const logs = store.listSystemLogs({ limit: 50 });
  const dataFile = path.join(dataDir, 'db.json');
  const uploadFiles = readdirSync(uploadDir);
  const aiRequired = bots.some((bot) => bot.aiEnabled);
  const unverifiedBots = bots.filter((bot) => !bot.tokenVerified);
  const runningBots = bots.filter((bot) => bot.status === 'running');
  const recentErrors = logs.filter((log) => log.level === 'error');

  const checks = [
    {
      key: 'admin-password',
      label: 'Admin password',
      status: process.env.ADMIN_PASSWORD ? 'pass' : 'warning',
      detail: process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD is configured.' : 'Set ADMIN_PASSWORD before exposing the app online.'
    },
    {
      key: 'bot-tokens',
      label: 'Bot tokens',
      status: unverifiedBots.length ? 'warning' : 'pass',
      detail: unverifiedBots.length ? `${unverifiedBots.length} bot token(s) still need verification.` : 'All saved bot tokens are verified.'
    },
    {
      key: 'runtime-mode',
      label: 'Runtime mode',
      status: runningBots.length ? 'warning' : 'pass',
      detail: runningBots.length ? 'Stop local polling before switching the same bot to webhook mode.' : 'No bot is currently running in local polling mode.'
    },
    {
      key: 'ai-config',
      label: 'AI configuration',
      status: aiRequired && !ai.enabled ? 'warning' : 'pass',
      detail: aiRequired && !ai.enabled ? 'At least one bot has AI enabled, but AI_API_KEY is missing.' : 'AI settings are compatible with current bot settings.'
    },
    {
      key: 'data-backup',
      label: 'Data backup',
      status: existsSync(dataFile) ? 'pass' : 'warning',
      detail: existsSync(dataFile) ? 'Local JSON data exists. Download a backup before deploying.' : 'Local data file was not found.'
    },
    {
      key: 'media-storage',
      label: 'Media storage',
      status: uploadFiles.length ? 'warning' : 'pass',
      detail: uploadFiles.length ? `${uploadFiles.length} uploaded file(s) must be migrated to R2 for Cloudflare.` : 'No uploaded media files need migration yet.'
    },
    {
      key: 'recent-errors',
      label: 'Recent errors',
      status: recentErrors.length ? 'warning' : 'pass',
      detail: recentErrors.length ? `${recentErrors.length} recent error log(s) found. Review Logs before deployment.` : 'No recent error logs in the latest 50 entries.'
    }
  ];

  const warningCount = checks.filter((check) => check.status === 'warning').length;
  res.json({
    ready: warningCount === 0,
    warningCount,
    generatedAt: new Date().toISOString(),
    nextTarget: 'GitHub repository, then Cloudflare Workers + D1 + R2',
    checks
  });
});

app.get('/api/bots', (req, res) => {
  res.json(store.listBots().map((bot) => ({ ...bot, token: maskToken(bot.token), runtime: botManager.getRuntime(bot.id) })));
});

app.post('/api/bots/test-token', async (req, res) => {
  try {
    const info = await botManager.testToken(req.body.token);
    res.json(info);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bots', async (req, res) => {
  try {
    const skipTokenTest = req.body.skipTokenTest === true || req.body.skipTokenTest === 'true';
    const info = skipTokenTest ? {} : await botManager.testToken(req.body.token);
    const bot = store.createBot({
      token: req.body.token,
      name: req.body.name || info.first_name || info.username || 'Unnamed Bot',
      username: info.username || '',
      welcomeMessage: req.body.welcomeMessage || 'Welcome. Please choose an option below.',
      defaultReply: req.body.defaultReply || 'Message received. Support will reply soon.',
      aiEnabled: false,
      aiPrompt: 'You are a professional customer support assistant. Keep replies concise and polite.',
      aiModel: ai.model,
      aiContextLimit: 10,
      tokenVerified: !skipTokenTest
    });
    store.createSystemLog({
      level: skipTokenTest ? 'warn' : 'info',
      action: 'bot_created',
      message: skipTokenTest ? 'Bot created without token verification' : 'Bot created and token verified',
      botId: bot.id,
      entityId: bot.id
    });
    res.json({ ...bot, token: maskToken(bot.token), runtime: botManager.getRuntime(bot.id) });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'bot_create_failed', message: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/bots/:id', (req, res) => {
  const bot = store.updateBot(req.params.id, req.body);
  if (!bot) return res.status(404).json({ error: 'BOT_NOT_FOUND' });
  store.createSystemLog({ level: 'info', action: 'bot_updated', message: 'Bot settings updated', botId: bot.id, entityId: bot.id });
  res.json({ ...bot, token: maskToken(bot.token), runtime: botManager.getRuntime(bot.id) });
});

app.delete('/api/bots/:id', (req, res) => {
  botManager.stop(req.params.id);
  store.deleteBot(req.params.id);
  store.createSystemLog({ level: 'warn', action: 'bot_deleted', message: 'Bot and related local data deleted', botId: req.params.id, entityId: req.params.id });
  res.json({ ok: true });
});

app.post('/api/bots/:id/start', (req, res) => {
  try {
    botManager.start(req.params.id);
    store.createSystemLog({ level: 'info', action: 'bot_started', message: 'Bot polling started', botId: req.params.id, entityId: req.params.id });
    res.json(botManager.getRuntime(req.params.id));
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'bot_start_failed', message: error.message, botId: req.params.id, entityId: req.params.id });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bots/:id/verify-token', async (req, res) => {
  try {
    const bot = store.getBot(req.params.id);
    if (!bot) return res.status(404).json({ error: 'BOT_NOT_FOUND' });
    const info = await botManager.testToken(bot.token);
    const updated = store.updateBot(req.params.id, {
      name: bot.name || info.first_name || info.username || 'Unnamed Bot',
      username: info.username || '',
      tokenVerified: true
    });
    store.createSystemLog({ level: 'info', action: 'bot_verified', message: 'Bot token verified', botId: updated.id, entityId: updated.id });
    res.json({ ...updated, token: maskToken(updated.token), runtime: botManager.getRuntime(updated.id) });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'bot_verify_failed', message: error.message, botId: req.params.id, entityId: req.params.id });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bots/:id/stop', (req, res) => {
  botManager.stop(req.params.id);
  store.createSystemLog({ level: 'info', action: 'bot_stopped', message: 'Bot polling stopped', botId: req.params.id, entityId: req.params.id });
  res.json(botManager.getRuntime(req.params.id));
});

app.post('/api/bots/:id/test-ai', async (req, res) => {
  try {
    const bot = store.getBot(req.params.id);
    if (!bot) return res.status(404).json({ error: 'BOT_NOT_FOUND' });
    if (!ai.enabled) return res.status(400).json({ error: 'AI_API_KEY is not configured' });
    const text = req.body.text || 'Hello. Please reply with one short sentence.';
    const reply = await ai.reply({
      bot: { ...bot, aiEnabled: true },
      history: [],
      text
    });
    res.json({ reply });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'ai_test_failed', message: error.message, botId: req.params.id, entityId: req.params.id });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/bots/:id/diagnostics', async (req, res) => {
  try {
    res.json(await botManager.diagnose(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bots/:id/delete-webhook', async (req, res) => {
  try {
    res.json(await botManager.deleteWebhook(req.params.id, Boolean(req.body.dropPendingUpdates)));
    store.createSystemLog({ level: 'warn', action: 'webhook_deleted', message: 'Telegram webhook deleted', botId: req.params.id, entityId: req.params.id });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'webhook_delete_failed', message: error.message, botId: req.params.id, entityId: req.params.id });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/chats', (req, res) => {
  res.json(store.listChats(req.query));
});

app.post('/api/chats/test', (req, res) => {
  try {
    if (!req.body.botId || !store.getBot(req.body.botId)) return res.status(400).json({ error: 'Select a valid bot first' });
    const chat = store.upsertChat({
      botId: req.body.botId,
      chatId: req.body.chatId || `test_${Date.now()}`,
      username: req.body.username || 'test_user',
      firstName: req.body.firstName || 'Test',
      lastName: req.body.lastName || 'User',
      type: 'private'
    });
    const message = store.createMessage({
      botId: req.body.botId,
      chatId: chat.chatId,
      role: 'user',
      content: req.body.message || 'This is a local test message.',
      source: 'test'
    });
    store.createSystemLog({ level: 'info', action: 'test_chat_created', message: 'Local test chat created', botId: req.body.botId, entityId: chat.chatId });
    res.json({ chat, message });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'test_chat_failed', message: error.message, botId: req.body.botId });
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/chats/:id', (req, res) => {
  const chat = store.updateChat(req.params.id, req.body);
  if (!chat) return res.status(404).json({ error: 'CHAT_NOT_FOUND' });
  res.json(chat);
});

app.get('/api/messages', (req, res) => {
  res.json(store.listMessages(req.query));
});

app.post('/api/messages/note', (req, res) => {
  try {
    if (!req.body.botId || !req.body.chatId) return res.status(400).json({ error: 'botId and chatId are required' });
    const message = store.createMessage({
      botId: req.body.botId,
      chatId: req.body.chatId,
      role: 'admin',
      content: req.body.text || '',
      source: 'note'
    });
    store.createSystemLog({ level: 'info', action: 'internal_note_saved', message: 'Internal conversation note saved', botId: req.body.botId, entityId: req.body.chatId });
    res.json({ ok: true, message });
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'internal_note_failed', message: error.message, botId: req.body.botId, entityId: req.body.chatId });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/messages/send', upload.single('media'), async (req, res) => {
  try {
    const result = await botManager.sendManualMessage({
      botId: req.body.botId,
      chatId: req.body.chatId,
      text: req.body.text || '',
      mediaType: req.body.mediaType || 'none',
      mediaPath: req.file?.path || '',
      buttonsJson: req.body.buttonsJson || '[]'
    });
    store.createSystemLog({ level: 'info', action: 'manual_message_sent', message: 'Manual message sent', botId: req.body.botId, entityId: req.body.chatId });
    res.json(result);
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'manual_message_failed', message: error.message, botId: req.body.botId, entityId: req.body.chatId });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/templates', (req, res) => {
  res.json(store.listTemplates(req.query.botId));
});

app.post('/api/templates', upload.single('media'), (req, res) => {
  const template = store.createTemplate({
    botId: req.body.botId,
    name: req.body.name,
    text: req.body.text || '',
    mediaType: req.body.mediaType || 'none',
    mediaPath: req.file?.path || req.body.mediaPath || '',
    buttonsJson: req.body.buttonsJson || '[]'
  });
  store.createSystemLog({ level: 'info', action: 'template_created', message: 'Message template created', botId: template.botId, entityId: template.id });
  res.json(template);
});

app.put('/api/templates/:id', upload.single('media'), (req, res) => {
  const template = store.updateTemplate(req.params.id, {
    ...req.body,
    mediaPath: req.file?.path || req.body.mediaPath
  });
  if (!template) return res.status(404).json({ error: 'TEMPLATE_NOT_FOUND' });
  store.createSystemLog({ level: 'info', action: 'template_updated', message: 'Message template updated', botId: template.botId, entityId: template.id });
  res.json(template);
});

app.delete('/api/templates/:id', (req, res) => {
  store.deleteTemplate(req.params.id);
  store.createSystemLog({ level: 'warn', action: 'template_deleted', message: 'Message template deleted', entityId: req.params.id });
  res.json({ ok: true });
});

app.get('/api/rules', (req, res) => {
  res.json(store.listRules(req.query.botId));
});

app.post('/api/rules/test', (req, res) => {
  try {
    const rule = store.findMatchingRule(req.body.botId, req.body.text || '', req.body.type || 'message');
    const template = rule?.templateId ? store.getTemplate(rule.templateId) : null;
    res.json({
      matched: Boolean(rule),
      rule: rule || null,
      template: template || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/rules', (req, res) => {
  const rule = store.createRule(req.body);
  store.createSystemLog({ level: 'info', action: 'rule_created', message: 'Reply rule created', botId: rule.botId, entityId: rule.id });
  res.json(rule);
});

app.put('/api/rules/:id', (req, res) => {
  const rule = store.updateRule(req.params.id, req.body);
  if (!rule) return res.status(404).json({ error: 'RULE_NOT_FOUND' });
  store.createSystemLog({ level: 'info', action: 'rule_updated', message: 'Reply rule updated', botId: rule.botId, entityId: rule.id });
  res.json(rule);
});

app.delete('/api/rules/:id', (req, res) => {
  store.deleteRule(req.params.id);
  store.createSystemLog({ level: 'warn', action: 'rule_deleted', message: 'Reply rule deleted', entityId: req.params.id });
  res.json({ ok: true });
});

app.get('/api/menus', (req, res) => {
  res.json(store.getMenus(req.query.botId));
});

app.put('/api/menus/:botId', (req, res) => {
  const menus = store.updateMenus(req.params.botId, req.body);
  store.createSystemLog({ level: 'info', action: 'menus_updated', message: 'Bot menus updated', botId: req.params.botId, entityId: req.params.botId });
  res.json(menus);
});

app.get('/api/broadcasts', (req, res) => {
  res.json(store.listBroadcasts());
});

app.get('/api/broadcasts/:id', (req, res) => {
  const broadcast = store.getBroadcastDetail(req.params.id);
  if (!broadcast) return res.status(404).json({ error: 'BROADCAST_NOT_FOUND' });
  res.json(broadcast);
});

app.post('/api/broadcasts', upload.single('media'), (req, res) => {
  const broadcast = store.createBroadcast({
      ...req.body,
      mediaPath: req.file?.path || req.body.mediaPath || ''
    });
  store.createSystemLog({ level: 'info', action: 'broadcast_created', message: 'Broadcast draft created', botId: broadcast.botId, entityId: broadcast.id });
  res.json(broadcast);
});

app.post('/api/broadcasts/:id/send', async (req, res) => {
  try {
    const broadcast = await botManager.sendBroadcast(req.params.id);
    store.createSystemLog({
      level: broadcast.failedCount ? 'warn' : 'info',
      action: 'broadcast_sent',
      message: `Broadcast sent: ${broadcast.successCount || 0} success, ${broadcast.failedCount || 0} failed`,
      botId: broadcast.botId,
      entityId: broadcast.id
    });
    res.json(broadcast);
  } catch (error) {
    store.createSystemLog({ level: 'error', action: 'broadcast_failed', message: error.message, entityId: req.params.id });
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/broadcasts/:id', (req, res) => {
  store.deleteBroadcast(req.params.id);
  store.createSystemLog({ level: 'warn', action: 'broadcast_deleted', message: 'Broadcast deleted', entityId: req.params.id });
  res.json({ ok: true });
});

app.get('/api/raw-updates', (req, res) => {
  res.json(store.listRawUpdates(req.query.botId));
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    store.createSystemLog({ level: 'error', action: 'upload_failed', message: error.message });
    return res.status(400).json({ error: error.message });
  }
  next(error);
});

app.use((error, req, res, next) => {
  store.createSystemLog({ level: 'error', action: 'server_error', message: error.message });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`TG Bot Admin running at http://localhost:${port}`);
  console.log(`Default admin password: ${process.env.ADMIN_PASSWORD || 'admin123'}`);
});

function maskToken(token = '') {
  if (!token) return '';
  if (token.length < 12) return '***';
  return `${token.slice(0, 8)}...${token.slice(-5)}`;
}

function maskSecret(secret = '') {
  if (!secret) return '';
  if (secret.length < 10) return '***';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function guessMimeType(name = '') {
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}
