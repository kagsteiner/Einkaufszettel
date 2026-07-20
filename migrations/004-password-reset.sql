CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE INDEX password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);
