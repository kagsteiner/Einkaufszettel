-- Existing notes are durable product guidance. Recipe-derived notes live only
-- for the current shopping cycle and are cleared or replaced on reactivation.
ALTER TABLE items ADD COLUMN purchase_note TEXT
  CHECK (purchase_note IS NULL OR length(purchase_note) <= 500);
