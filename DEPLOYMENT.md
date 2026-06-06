# Deployment Plan

This project is currently a local MVP. It is designed to be tested locally first, then migrated to GitHub and Cloudflare in a controlled second phase.

## Before Publishing to GitHub

Run the local checks:

```bash
npm.cmd run check
```

Make sure these files and folders are not committed:

- `.env`
- `data/`
- `uploads/`
- `node_modules/`

The `.gitignore` file already excludes them.

Before the first public or private GitHub push:

1. Set a strong `ADMIN_PASSWORD` in `.env`.
2. Verify every bot token in the admin panel.
3. Stop local polling for bots that will later use Cloudflare webhooks.
4. Download a backup from the `Data` page.
5. Review the `Logs` page and clear any real runtime issues.
6. Rotate any bot token that was pasted into screenshots, shared logs, or chat history.

## Local Runtime

The local version uses:

- Express server
- Telegram polling through `getUpdates`
- Local JSON database at `data/db.json`
- Local uploads at `uploads/`

This is correct for development and private testing, but it is not the final Cloudflare runtime.

## Cloudflare Target Runtime

The intended Cloudflare version should use:

- Cloudflare Workers for backend APIs
- Telegram webhook instead of polling
- Cloudflare D1 for structured data
- Cloudflare R2 for media files
- Cloudflare Queues or scheduled Workers for broadcasts
- Cloudflare Pages or Worker static assets for the admin UI

Secrets should be configured through Cloudflare secrets, not committed in source code.

Required Cloudflare secrets:

```text
ADMIN_PASSWORD
AI_API_KEY
TELEGRAM_WEBHOOK_SECRET
```

Optional Cloudflare variables:

```text
AI_BASE_URL
AI_MODEL
```

## Migration Order

1. Publish the local MVP code to GitHub.
2. Create a Cloudflare project and connect the GitHub repository.
3. Create D1 tables that match the local data model.
4. Create an R2 bucket for media files.
5. Build the Worker API using D1 and R2 bindings.
6. Replace local polling with Telegram webhook handling.
7. Add webhook setup and webhook delete commands.
8. Import local backup data into D1.
9. Upload local media files from `uploads/` into R2.
10. Run end-to-end tests with one bot before adding more bots.

## Telegram Webhook Notes

Only one update delivery mode should be active for the same bot token:

- Local development: polling
- Cloudflare deployment: webhook

Before switching to Cloudflare webhook mode, stop local polling and delete any old webhook if needed.

For production webhook security:

- Use a random webhook secret.
- Validate the secret header on every Telegram update request.
- Do not expose bot tokens in frontend code or logs.

## Data Notes

The local backup includes sensitive bot tokens. Treat every exported backup as a secret file.

Cloudflare migration should map local collections to D1 tables:

- `bots`
- `chats`
- `messages`
- `templates`
- `rules`
- `menus`
- `broadcasts`
- `broadcast_targets`
- `raw_updates`
- `send_logs`
- `system_logs`

Media files should move from local `uploads/` into R2, and stored media paths should become R2 object keys or signed/public URLs depending on the final access design.
