import { Bot, InputFile } from 'grammy';
import { existsSync } from 'node:fs';

export function createBotManager({ store, ai }) {
  const runtimes = new Map();

  function getBot(botId) {
    const bot = store.getBot(botId);
    if (!bot) throw new Error('Bot not found');
    return bot;
  }

  function createClient(token) {
    return new Bot(token);
  }

  async function sendTemplate(client, bot, chatId, template, source = 'rule') {
    if (!template) return null;
    const replyMarkup = buildInlineKeyboard(template.buttons);
    const result = await sendContent(client, chatId, {
      text: template.text,
      mediaType: template.mediaType,
      mediaPath: template.mediaPath,
      telegramFileId: template.telegramFileId,
      replyMarkup
    });
    store.createMessage({
      botId: bot.id,
      chatId,
      role: 'bot',
      content: template.text,
      mediaType: template.mediaType,
      mediaPath: template.mediaPath,
      telegramFileId: pickFileId(result),
      source
    });
    store.createSendLog({ botId: bot.id, chatId, action: source, ok: true });
    return result;
  }

  async function handleMessage(botConfig, client, message) {
    const chat = message.chat;
    const text = message.text || message.caption || mediaLabel(message);
    const media = extractMedia(message);
    store.upsertChat({
      botId: botConfig.id,
      chatId: chat.id,
      username: chat.username,
      firstName: chat.first_name,
      lastName: chat.last_name,
      type: chat.type
    });
    store.createMessage({
      botId: botConfig.id,
      chatId: chat.id,
      role: 'user',
      content: text,
      mediaType: media.mediaType,
      telegramFileId: media.telegramFileId,
      source: 'telegram'
    });

    const chatState = store.getChat(botConfig.id, chat.id);
    if (chatState?.status === 'blocked' || chatState?.status === 'manual') return;

    const isStart = message.text?.trim().startsWith('/start');
    if (isStart) {
      const menus = store.getMenus(botConfig.id);
      const template = store.listTemplates(botConfig.id).find((item) => item.name.toLowerCase() === 'welcome');
      if (template) {
        await sendTemplate(client, botConfig, chat.id, template, 'rule');
        if (hasKeyboard(menus)) {
          await client.api.sendMessage(chat.id, 'Menu ready.', {
            reply_markup: buildReplyKeyboard(menus.keyboard)
          });
        }
      } else {
        await client.api.sendMessage(chat.id, botConfig.welcomeMessage || 'Welcome.', {
          reply_markup: buildStartReplyMarkup(menus)
        });
        store.createMessage({
          botId: botConfig.id,
          chatId: chat.id,
          role: 'bot',
          content: botConfig.welcomeMessage || 'Welcome.',
          source: 'rule'
        });
        if (hasInline(menus) && hasKeyboard(menus)) {
          await client.api.sendMessage(chat.id, 'Menu ready.', {
            reply_markup: buildReplyKeyboard(menus.keyboard)
          });
          store.createMessage({
            botId: botConfig.id,
            chatId: chat.id,
            role: 'bot',
            content: 'Menu ready.',
            source: 'rule'
          });
        }
      }
      return;
    }

    const rule = store.findMatchingRule(botConfig.id, message.text || '', 'message');
    if (rule?.templateId) {
      const template = store.getTemplate(rule.templateId);
      if (template) {
        await sendTemplate(client, botConfig, chat.id, template, 'rule');
        return;
      }
    }

    if (botConfig.aiEnabled) {
      try {
        const history = store
          .listMessages({ botId: botConfig.id, chatId: chat.id, limit: botConfig.aiContextLimit || 10 })
          .filter((item) => item.role === 'user' || item.role === 'bot')
          .slice(-Number(botConfig.aiContextLimit || 10));
        const aiText = await ai.reply({ bot: botConfig, history, text });
        if (aiText) {
          await client.api.sendMessage(chat.id, aiText);
          store.createMessage({ botId: botConfig.id, chatId: chat.id, role: 'bot', content: aiText, source: 'ai' });
          store.createSendLog({ botId: botConfig.id, chatId: chat.id, action: 'ai', ok: true });
          return;
        }
      } catch (error) {
        store.createSendLog({ botId: botConfig.id, chatId: chat.id, action: 'ai', ok: false, errorMessage: error.message });
      }
    }

    if (botConfig.defaultReply) {
      await client.api.sendMessage(chat.id, botConfig.defaultReply);
      store.createMessage({ botId: botConfig.id, chatId: chat.id, role: 'bot', content: botConfig.defaultReply, source: 'default' });
    }
  }

  async function handleCallback(botConfig, client, query) {
    const chatId = query.message?.chat?.id;
    const data = query.data || '';
    if (!chatId) return;
    await client.api.answerCallbackQuery(query.id).catch(() => {});
    const rawText = `[callback] ${data}`;
    store.upsertChat({
      botId: botConfig.id,
      chatId,
      username: query.from?.username,
      firstName: query.from?.first_name,
      lastName: query.from?.last_name,
      type: query.message?.chat?.type || 'private'
    });
    store.createMessage({ botId: botConfig.id, chatId, role: 'user', content: rawText, source: 'telegram' });
    if (data === 'contact_support') {
      const chat = store.getChat(botConfig.id, chatId);
      if (chat) store.updateChat(chat.id, { status: 'manual' });
      const text = 'Support takeover enabled. A human operator will reply soon.';
      await client.api.sendMessage(chatId, text);
      store.createMessage({ botId: botConfig.id, chatId, role: 'bot', content: text, source: 'rule' });
      return;
    }
    const rule = store.findMatchingRule(botConfig.id, data, 'callback');
    if (rule?.templateId) await sendTemplate(client, botConfig, chatId, store.getTemplate(rule.templateId), 'rule');
  }

  return {
    async testToken(token) {
      if (!token) throw new Error('Token is required');
      const client = createClient(token);
      return await withTimeout(client.api.getMe(), 12000, 'Telegram token test timed out. Check network/proxy access to api.telegram.org.');
    },

    start(botId) {
      const botConfig = getBot(botId);
      const existing = runtimes.get(botId);
      if (existing?.status === 'running') return existing;

      const client = createClient(botConfig.token);
      const runtime = {
        botId,
        status: 'running',
        startedAt: new Date().toISOString(),
        lastUpdateAt: '',
        lastError: '',
        client
      };
      runtimes.set(botId, runtime);
      store.updateBot(botId, { status: 'running' });

      client.on('message', async (ctx) => {
        const message = ctx.message;
        const raw = store.createRawUpdate({
          botId,
          updateId: ctx.update.update_id,
          updateType: 'message',
          payload: ctx.update,
          handled: false
        });
        try {
          runtimes.get(botId).lastUpdateAt = new Date().toISOString();
          await handleMessage(store.getBot(botId), client, message);
          store.updateRawUpdate(raw.id, { handled: true });
        } catch (error) {
          runtimes.get(botId).lastError = error.message;
          store.updateRawUpdate(raw.id, { handled: false, errorMessage: error.message });
        }
      });

      client.on('callback_query:data', async (ctx) => {
        const raw = store.createRawUpdate({
          botId,
          updateId: ctx.update.update_id,
          updateType: 'callback_query',
          payload: ctx.update,
          handled: false
        });
        try {
          runtimes.get(botId).lastUpdateAt = new Date().toISOString();
          await handleCallback(store.getBot(botId), client, ctx.callbackQuery);
          store.updateRawUpdate(raw.id, { handled: true });
        } catch (error) {
          runtimes.get(botId).lastError = error.message;
          store.updateRawUpdate(raw.id, { handled: false, errorMessage: error.message });
        }
      });

      client.catch((error) => {
        const current = runtimes.get(botId);
        if (current) current.lastError = error.message;
        store.createSendLog({ botId, action: 'polling_error', ok: false, errorMessage: error.message });
      });

      client.start({
        onStart: () => {},
        drop_pending_updates: false
      }).catch((error) => {
        const current = runtimes.get(botId);
        if (current) {
          current.status = 'failed';
          current.lastError = error.message;
        }
        store.updateBot(botId, { status: 'stopped' });
      });

      return this.getRuntime(botId);
    },

    stop(botId) {
      const runtime = runtimes.get(botId);
      if (runtime?.client) {
        try {
          runtime.client.stop();
        } catch {
          // Stopping an already stopped bot is harmless.
        }
      }
      runtimes.set(botId, {
        botId,
        status: 'stopped',
        startedAt: runtime?.startedAt || '',
        lastUpdateAt: runtime?.lastUpdateAt || '',
        lastError: runtime?.lastError || ''
      });
      const bot = store.getBot(botId);
      if (bot) store.updateBot(botId, { status: 'stopped' });
    },

    getRuntime(botId) {
      const runtime = runtimes.get(botId);
      if (!runtime) return { botId, status: 'stopped', startedAt: '', lastUpdateAt: '', lastError: '' };
      return {
        botId,
        status: runtime.status,
        startedAt: runtime.startedAt,
        lastUpdateAt: runtime.lastUpdateAt,
        lastError: runtime.lastError
      };
    },

    async diagnose(botId) {
      const bot = getBot(botId);
      const started = Date.now();
      const client = createClient(bot.token);
      const me = await client.api.getMe();
      const webhook = await client.api.getWebhookInfo();
      const runtime = this.getRuntime(botId);
      return {
        tokenOk: Boolean(me?.id),
        bot: me,
        apiReachable: true,
        apiLatencyMs: Date.now() - started,
        webhookUrl: webhook?.url || '',
        webhook,
        polling: runtime,
        lastRawUpdates: store.listRawUpdates(botId).slice(0, 10),
        lastSendLogs: store.listSendLogs(botId).slice(0, 10)
      };
    },

    async deleteWebhook(botId, dropPendingUpdates = false) {
      const bot = getBot(botId);
      const client = createClient(bot.token);
      const ok = await client.api.deleteWebhook({ drop_pending_updates: dropPendingUpdates });
      return { ok };
    },

    async sendManualMessage(input) {
      const bot = getBot(input.botId);
      const runtime = runtimes.get(input.botId);
      const client = runtime?.client || createClient(bot.token);
      const replyMarkup = buildInlineKeyboard(parseButtons(input.buttonsJson));
      const result = await sendContent(client, input.chatId, {
        text: input.text,
        mediaType: input.mediaType,
        mediaPath: input.mediaPath,
        replyMarkup
      });
      const message = store.createMessage({
        botId: input.botId,
        chatId: input.chatId,
        role: 'admin',
        content: input.text,
        mediaType: input.mediaType,
        mediaPath: input.mediaPath,
        telegramFileId: pickFileId(result),
        source: 'manual'
      });
      store.createSendLog({ botId: input.botId, chatId: input.chatId, action: 'manual', ok: true });
      return { ok: true, message };
    },

    async sendBroadcast(broadcastId) {
      const broadcast = store.getBroadcast(broadcastId);
      if (!broadcast) throw new Error('Broadcast not found');
      const bot = getBot(broadcast.botId);
      const runtime = runtimes.get(bot.id);
      const client = runtime?.client || createClient(bot.token);
      const chats = filterBroadcastChats(store.listChats({ botId: bot.id }), broadcast.targetType);
      const targets = chats.map((chat) => ({
        id: `target_${broadcast.id}_${chat.id}`,
        broadcastId,
        chatId: chat.chatId,
        status: 'pending',
        errorMessage: '',
        sentAt: ''
      }));
      store.setBroadcastTargets(broadcastId, targets);
      store.updateBroadcast(broadcastId, {
        status: 'sending',
        totalCount: targets.length,
        successCount: 0,
        failedCount: 0,
        startedAt: new Date().toISOString()
      });

      let successCount = 0;
      let failedCount = 0;
      for (const target of targets) {
        try {
          await sendContent(client, target.chatId, {
            text: broadcast.text,
            mediaType: broadcast.mediaType,
            mediaPath: broadcast.mediaPath,
            replyMarkup: buildInlineKeyboard(broadcast.buttons)
          });
          target.status = 'sent';
          target.sentAt = new Date().toISOString();
          successCount += 1;
          store.createSendLog({ botId: bot.id, chatId: target.chatId, action: 'broadcast', ok: true });
        } catch (error) {
          target.status = 'failed';
          target.errorMessage = error.message;
          failedCount += 1;
          store.createSendLog({ botId: bot.id, chatId: target.chatId, action: 'broadcast', ok: false, errorMessage: error.message });
        }
        store.setBroadcastTargets(broadcastId, targets);
        await sleep(60);
      }
      return store.updateBroadcast(broadcastId, {
        status: 'completed',
        successCount,
        failedCount,
        finishedAt: new Date().toISOString()
      });
    }
  };
}

async function sendContent(client, chatId, content) {
  const options = {};
  if (content.replyMarkup) options.reply_markup = content.replyMarkup;
  const text = content.text || '';
  const media = content.telegramFileId || content.mediaPath;
  if (content.mediaType === 'photo' && media) {
    return await client.api.sendPhoto(chatId, mediaInput(media), { ...options, caption: text || undefined });
  }
  if (content.mediaType === 'video' && media) {
    return await client.api.sendVideo(chatId, mediaInput(media), { ...options, caption: text || undefined });
  }
  if (content.mediaType === 'document' && media) {
    return await client.api.sendDocument(chatId, mediaInput(media), { ...options, caption: text || undefined });
  }
  return await client.api.sendMessage(chatId, text || ' ', options);
}

function mediaInput(value) {
  if (!value) return value;
  if (existsSync(value)) return new InputFile(value);
  return value;
}

function buildInlineKeyboard(buttons = []) {
  const rows = parseButtons(buttons);
  const inline_keyboard = rows
    .map((row) =>
      row
        .filter((button) => button.text)
        .map((button) => {
          if (button.actionType === 'url') return { text: button.text, url: button.actionValue };
          return { text: button.text, callback_data: button.actionValue || button.text };
        })
    )
    .filter((row) => row.length);
  return inline_keyboard.length ? { inline_keyboard } : undefined;
}

function buildStartReplyMarkup(menus) {
  const inline = buildInlineKeyboard(menus.inline);
  if (inline?.inline_keyboard?.length) return inline;
  if (hasKeyboard(menus)) return buildReplyKeyboard(menus.keyboard);
  return undefined;
}

function buildReplyKeyboard(keyboard = []) {
  return {
    keyboard: keyboard.map((row) => row.map((button) => ({ text: button.actionValue || button.text }))),
    resize_keyboard: true
  };
}

function hasInline(menus) {
  return Array.isArray(menus.inline) && menus.inline.some((row) => Array.isArray(row) && row.some((button) => button.text));
}

function hasKeyboard(menus) {
  return Array.isArray(menus.keyboard) && menus.keyboard.some((row) => Array.isArray(row) && row.some((button) => button.text));
}

function parseButtons(buttons) {
  if (Array.isArray(buttons)) return buttons;
  try {
    const parsed = JSON.parse(buttons || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mediaLabel(message) {
  if (message.photo) return '[photo]';
  if (message.video) return '[video]';
  if (message.document) return '[document]';
  if (message.voice) return '[voice]';
  if (message.audio) return '[audio]';
  if (message.sticker) return '[sticker]';
  return '[unsupported message]';
}

function extractMedia(message) {
  if (message.photo?.length) return { mediaType: 'photo', telegramFileId: message.photo.at(-1).file_id };
  if (message.video) return { mediaType: 'video', telegramFileId: message.video.file_id };
  if (message.document) return { mediaType: 'document', telegramFileId: message.document.file_id };
  if (message.voice) return { mediaType: 'voice', telegramFileId: message.voice.file_id };
  if (message.audio) return { mediaType: 'audio', telegramFileId: message.audio.file_id };
  if (message.sticker) return { mediaType: 'sticker', telegramFileId: message.sticker.file_id };
  return { mediaType: 'none', telegramFileId: '' };
}

function pickFileId(result) {
  if (result?.photo?.length) return result.photo.at(-1).file_id;
  if (result?.video) return result.video.file_id;
  if (result?.document) return result.document.file_id;
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterBroadcastChats(chats, targetType = 'all') {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return chats
    .filter((chat) => chat.status !== 'blocked')
    .filter((chat) => {
      if (targetType === 'manual_only') return chat.status === 'manual';
      if (targetType === 'auto_only') return chat.status === 'auto';
      if (targetType === 'active_7d') return now - new Date(chat.lastMessageAt || 0).getTime() <= 7 * dayMs;
      if (targetType === 'active_30d') return now - new Date(chat.lastMessageAt || 0).getTime() <= 30 * dayMs;
      return true;
    });
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
