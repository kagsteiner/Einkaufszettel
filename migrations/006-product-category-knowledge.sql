CREATE TABLE household_product_categories (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (household_id, normalized_name),
  CHECK (length(trim(normalized_name)) BETWEEN 1 AND 120),
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CHECK (
    category IN (
      'bakery',
      'canned',
      'dairy',
      'drinks',
      'frozen',
      'household',
      'meat',
      'other',
      'pet',
      'produce',
      'spices',
      'staples'
    )
  )
) STRICT;

CREATE INDEX household_product_categories_updated_idx
  ON household_product_categories(updated_at DESC);
