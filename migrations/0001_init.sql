CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'stopped',
  welcome_message TEXT NOT NULL DEFAULT '',
  default_reply TEXT NOT NULL DEFAULT '',
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  ai_prompt TEXT NOT NULL DEFAULT '',
  ai_model TEXT NOT NULL DEFAULT '',
  ai_context_limit INTEGER NOT NULL DEFAULT 10,
  token_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'auto',
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_bot_chat ON chats (bot_id, chat_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  media_path TEXT NOT NULL DEFAULT '',
  telegram_file_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_bot_chat_created ON messages (bot_id, chat_id, created_at);

CREATE TABLE IF NOT EXISTS raw_updates (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  update_id INTEGER,
  update_type TEXT NOT NULL DEFAULT 'unknown',
  payload TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  media_path TEXT NOT NULL DEFAULT '',
  telegram_file_id TEXT NOT NULL DEFAULT '',
  buttons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'keyword',
  pattern TEXT NOT NULL DEFAULT '',
  match_mode TEXT NOT NULL DEFAULT 'contains',
  template_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menus (
  bot_id TEXT PRIMARY KEY,
  inline_json TEXT NOT NULL DEFAULT '[]',
  keyboard_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  media_path TEXT NOT NULL DEFAULT '',
  buttons TEXT NOT NULL DEFAULT '[]',
  target_type TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft',
  total_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS broadcast_targets (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  chat_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  action TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  bot_id TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_config (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
