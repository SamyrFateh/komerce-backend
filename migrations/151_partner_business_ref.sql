-- LOT 4E — business reference for dashboard-owned partner registry.
-- Feature owner: dashboard.

CREATE SEQUENCE IF NOT EXISTS partner_ref_seq START 1;

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS partner_ref TEXT;

UPDATE partners
   SET partner_ref = 'KPT-' || LPAD(nextval('partner_ref_seq')::text, 6, '0')
 WHERE partner_ref IS NULL;

ALTER TABLE partners
  ALTER COLUMN partner_ref SET DEFAULT ('KPT-' || LPAD(nextval('partner_ref_seq')::text, 6, '0')),
  ALTER COLUMN partner_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_partner_ref
  ON partners(partner_ref);
