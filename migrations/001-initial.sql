CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  openai_key_ciphertext TEXT,
  openai_key_last_four TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(email)) BETWEEN 3 AND 320),
  CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  CHECK ((openai_key_ciphertext IS NULL) = (openai_key_last_four IS NULL))
) STRICT;

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 80)
) STRICT;

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (length(trim(invited_email)) BETWEEN 3 AND 320),
  CHECK ((accepted_at IS NULL) = (accepted_by_user_id IS NULL))
) STRICT;

CREATE INDEX invitations_household_id_idx ON invitations(household_id);
CREATE INDEX invitations_email_idx ON invitations(invited_email_normalized);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  uploaded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CHECK (byte_size > 0),
  CHECK (width > 0 AND height > 0)
) STRICT;

CREATE TABLE shopping_lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  sort_position INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, normalized_name),
  CHECK (length(trim(name)) BETWEEN 1 AND 80)
) STRICT;

CREATE INDEX shopping_lists_household_sort_idx
  ON shopping_lists(household_id, sort_position, created_at);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  note TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  sort_position INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (list_id, normalized_name),
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CHECK (note IS NULL OR length(note) <= 500)
) STRICT;

CREATE INDEX items_list_state_sort_idx
  ON items(list_id, completed_at, category, sort_position, created_at);

CREATE TABLE quantity_parts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  normalized_unit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (item_id, normalized_unit),
  CHECK (length(amount) BETWEEN 1 AND 40),
  CHECK (length(unit) <= 40)
) STRICT;

CREATE TABLE pantry_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, normalized_name),
  CHECK (length(trim(name)) BETWEEN 1 AND 120)
) STRICT;

CREATE INDEX pantry_items_household_name_idx
  ON pantry_items(household_id, normalized_name);
