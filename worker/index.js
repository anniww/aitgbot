const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {})
    }
  });

const text = (body, init = {}) =>
  new Response(body, {
    ...init,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {})
    }
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        runtime: 'cloudflare-workers',
        storage: {
          d1: Boolean(env.DB),
          r2: Boolean(env.MEDIA_BUCKET)
        },
        ai: {
          provider: env.AI_PROVIDER || 'deepseek',
          baseURL: env.AI_BASE_URL || 'https://api.deepseek.com',
          model: env.AI_MODEL || 'deepseek-v4-flash',
          hasApiKey: Boolean(env.AI_API_KEY)
        }
      });
    }

    if (url.pathname === '/api/bootstrap') {
      return json({ needsPassword: true, runtime: 'cloudflare' });
    }

    if (url.pathname === '/api/telegram/webhook') {
      return handleTelegramWebhook(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/')) {
      return json(
        {
          error: 'CLOUDFLARE_API_NOT_MIGRATED',
          message: 'This Worker is deployed. The full admin API still needs D1/R2 migration from the local Express server.'
        },
        { status: 501 }
      );
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return text('TG Bot Admin Worker is running.');
  }
};

async function handleTelegramWebhook(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });

  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET || '';
  if (expectedSecret) {
    const actualSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (actualSecret !== expectedSecret) return json({ error: 'INVALID_WEBHOOK_SECRET' }, { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  ctx.waitUntil(recordRawUpdate(env, update));
  return json({ ok: true });
}

async function recordRawUpdate(env, update) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO raw_updates (id, bot_id, update_id, update_type, payload, handled, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      '',
      update.update_id || null,
      update.message ? 'message' : update.callback_query ? 'callback_query' : 'unknown',
      JSON.stringify(update),
      0,
      '',
      new Date().toISOString()
    )
    .run();
}
