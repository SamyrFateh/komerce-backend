-- Market-owned fixed-charge reference, separate from the immutable period facts.
-- Reference creation is NOT an economic accrual; facts still require evidence.
ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS market_owner_id UUID NULL REFERENCES markets(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_charges_market_owner_active
  ON charges (market_owner_id, is_active) WHERE market_owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_charges_market_name_unique
  ON charges (market_owner_id, lower(name))
  WHERE market_owner_id IS NOT NULL AND is_active = TRUE;
COMMENT ON COLUMN charges.market_owner_id IS
  'Null = shared reference. Non-null = only this market can select or record facts for the reference; never use as GROUP pool.';
