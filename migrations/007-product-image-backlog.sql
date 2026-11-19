CREATE TABLE product_image_backlog (
  normalized_name TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('missing', 'reported')),
  image_signature TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  occurrences INTEGER NOT NULL CHECK (occurrences > 0)
) STRICT;
