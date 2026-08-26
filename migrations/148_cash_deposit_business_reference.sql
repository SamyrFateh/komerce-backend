-- @migration 148_cash_deposit_business_reference.sql
-- @domain    payment
-- @purpose   LOT 4D — donner aux dépôts cash une référence métier stable
--            afin que le navigateur Canonical n'utilise jamais l'UUID interne.

CREATE SEQUENCE IF NOT EXISTS cash_deposit_ref_seq START WITH 1;

ALTER TABLE cash_deposits
  ADD COLUMN IF NOT EXISTS deposit_ref TEXT;

UPDATE cash_deposits
SET deposit_ref = 'KDP-' || LPAD(nextval('cash_deposit_ref_seq')::text, 6, '0')
WHERE deposit_ref IS NULL;

ALTER TABLE cash_deposits
  ALTER COLUMN deposit_ref SET DEFAULT ('KDP-' || LPAD(nextval('cash_deposit_ref_seq')::text, 6, '0')),
  ALTER COLUMN deposit_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_deposits_deposit_ref
  ON cash_deposits (deposit_ref);

COMMENT ON COLUMN cash_deposits.deposit_ref IS
  'Référence métier stable du dépôt cash exposable au navigateur (KDP-xxxxxx). L UUID interne reste serveur-only.';
