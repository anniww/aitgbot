CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_email ON password_reset_codes (email, created_at);
