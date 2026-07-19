CREATE TABLE item_purchase_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  purchased_at TEXT NOT NULL
) STRICT;

CREATE INDEX item_purchase_events_item_time_idx
  ON item_purchase_events(item_id, purchased_at DESC);

INSERT INTO item_purchase_events (id, item_id, purchased_at)
SELECT lower(hex(randomblob(16))), id, completed_at
FROM items
WHERE completed_at IS NOT NULL;
