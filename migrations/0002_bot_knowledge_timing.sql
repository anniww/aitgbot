ALTER TABLE bots ADD COLUMN reply_delay_seconds INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_bot ON knowledge_documents (bot_id, updated_at);
