import OpenAI from 'openai';

const providers = {
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini'
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  },
  custom: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini'
  }
};

export function createAiClient(config) {
  const readConfig = typeof config === 'function' ? config : () => config;

  function current() {
    const raw = readConfig() || {};
    const provider = providers[raw.provider] ? raw.provider : 'openai';
    const defaults = providers[provider];
    return {
      provider,
      apiKey: raw.apiKey || '',
      baseURL: raw.baseURL || defaults.baseURL,
      model: raw.model || defaults.model
    };
  }

  function resolveModel(botModel, active) {
    if (!botModel) return active.model;
    if (active.provider === 'deepseek' && botModel.startsWith('gpt-')) return active.model;
    if (active.provider === 'openai' && botModel.startsWith('deepseek-')) return active.model;
    return botModel;
  }

  return {
    get enabled() {
      return Boolean(current().apiKey);
    },
    get provider() {
      return current().provider;
    },
    get baseURL() {
      return current().baseURL;
    },
    get model() {
      return current().model;
    },
    async reply({ bot, history, text }) {
      const active = current();
      const client = active.apiKey
        ? new OpenAI({
            apiKey: active.apiKey,
            baseURL: active.baseURL
          })
        : null;
      if (!client || !bot.aiEnabled) return '';
      const messages = [
        { role: 'system', content: bot.aiPrompt || 'You are a helpful customer support assistant.' },
        ...history.map((message) => ({
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content || `[${message.mediaType || 'media'}]`
        })),
        { role: 'user', content: text }
      ];
      const response = await client.chat.completions.create({
        model: resolveModel(bot.aiModel, active),
        messages,
        temperature: 0.4
      });
      return response.choices?.[0]?.message?.content?.trim() || '';
    }
  };
}
