-- @migration 278_market_lifecycle.sql
-- @domain    market
-- @purpose   Market Control Plane M5. Canonical market lifecycle and storefront
--            texts. This migration does not grant authority.
--
-- Existing active markets become ACTIVE. Existing inactive rows become
-- PROVISIONING because historical data cannot safely distinguish a never-opened
-- market from a closed one. Future transitions are owned by the market lifecycle
-- writer introduced with central provisioning.

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT,
  ADD COLUMN IF NOT EXISTS storefront_texts JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE markets
   SET lifecycle_status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'PROVISIONING' END
 WHERE lifecycle_status IS NULL;

ALTER TABLE markets
  ALTER COLUMN lifecycle_status SET DEFAULT 'PROVISIONING',
  ALTER COLUMN lifecycle_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'markets_lifecycle_status_check'
  ) THEN
    ALTER TABLE markets
      ADD CONSTRAINT markets_lifecycle_status_check
      CHECK (lifecycle_status IN ('PROVISIONING','ACTIVE','SUSPENDED','CLOSED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'markets_lifecycle_is_active_check'
  ) THEN
    ALTER TABLE markets
      ADD CONSTRAINT markets_lifecycle_is_active_check
      CHECK (is_active = (lifecycle_status IN ('ACTIVE','SUSPENDED')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'markets_storefront_texts_object_check'
  ) THEN
    ALTER TABLE markets
      ADD CONSTRAINT markets_storefront_texts_object_check
      CHECK (jsonb_typeof(storefront_texts) = 'object');
  END IF;
END
$$;

COMMENT ON COLUMN markets.lifecycle_status IS
  'Canonical lifecycle: PROVISIONING, ACTIVE, SUSPENDED, CLOSED. is_active is a compatibility projection constrained by this value.';
COMMENT ON COLUMN markets.storefront_texts IS
  'Market-owned storefront copy/settings as JSON object. No authorization is derived from this payload.';
