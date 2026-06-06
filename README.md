# TG Bot Admin

A local-first Telegram bot management system for multiple bots.

Current MVP features:

- Multiple bot management with token testing
- Polling start and stop per bot
- Incoming message storage
- Manual customer support replies
- Text, photo, video, and document sending
- Auto-reply rules
- Reusable message templates
- Inline buttons and reply keyboard menus
- Per-bot AI settings
- Chat status: auto, manual takeover, blocked
- Broadcast drafts and sending
- Diagnostics for token, webhook, polling, raw updates, and send logs
- System logs for admin actions and failures

## Local Setup

1. Install dependencies:

```bash
npm.cmd install
```

2. Create `.env` from `.env.example`:

```bash
copy .env.example .env
```

3. Edit `.env`:

```env
PORT=3000
ADMIN_PASSWORD=change-this-password
AI_PROVIDER=deepseek
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
HTTPS_PROXY=
```

AI is optional. Leave `AI_API_KEY` empty to use rules, templates, manual replies, and broadcasts without AI.

DeepSeek is the default provider. In the admin UI, you only need to paste the API key on the `AI Settings` page.

If you prefer `.env`, configure:

```env
AI_PROVIDER=deepseek
AI_API_KEY=your-deepseek-api-key
```

`AI_BASE_URL` and `AI_MODEL` are optional. DeepSeek defaults to `https://api.deepseek.com` and `deepseek-v4-flash`.

The AI client uses an OpenAI-compatible chat completions API, so OpenAI, DeepSeek, and compatible gateways can share the same integration.

If your local machine cannot access Telegram Bot API directly, set `HTTPS_PROXY`, for example:

```env
HTTPS_PROXY=http://127.0.0.1:7890
```

4. Start the app:

```bash
npm.cmd run dev
```

5. Open:

```text
http://localhost:3000
```

Default password is `admin123` if `ADMIN_PASSWORD` is not set.

## Local Checks

Before publishing or deployment work, run:

```bash
npm.cmd run check
```

This checks server and frontend JavaScript syntax, then runs a critical dependency audit.

## Suggested First Test

1. Open the admin panel.
2. Add a Telegram bot token from BotFather.
3. Click `Start`.
4. Send `/start` to the bot in Telegram.
5. Check `Messages`.
6. Create a template named `Welcome`.
7. Create a `/start` command rule or use the bot welcome settings.
8. Try a manual reply with text, then with an uploaded photo.
9. Run `Diagnostics`.

## Important Telegram Notes

- For local development this app uses `getUpdates` polling.
- If the bot has a webhook configured, polling may not receive updates.
- Use `Diagnostics` and `Delete Webhook` in the admin panel when messages are not arriving.
- Do not run the same bot token with polling in multiple servers at the same time.
- Telegram bots cannot proactively message users who have never started or interacted with the bot.

## Local Backup

Use the `Data` page in the admin panel to export or import a local JSON backup.

The backup includes sensitive bot tokens. Store it carefully and do not commit it to GitHub.

Import replaces the current local `data/db.json` content and resets bot runtime statuses to `stopped`.

## Future Cloudflare Deployment Direction

The local MVP uses Node.js polling and a JSON data store for fast local iteration.

For GitHub + Cloudflare later, the intended migration path is:

- Frontend: Cloudflare Pages
- Backend: Cloudflare Workers
- Database: Cloudflare D1
- File storage: Cloudflare R2
- Telegram receiving: Webhook instead of local polling
- Background jobs: Queues or scheduled Workers for broadcasts

The current data model is table-shaped to make that migration straightforward.

See `DEPLOYMENT.md` for the GitHub and Cloudflare migration checklist.
