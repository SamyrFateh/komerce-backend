-- @migration 074_invoice_public_token.sql
-- @domain    documents
-- @purpose   Ajout token public sur invoices
-- @added-header 2026-07-01 (audit gouvernance)

-- 074_invoice_public_token.sql
-- Public, unguessable token used for WhatsApp invoice links.
-- The invoice itself remains generated only after payment_status='paid'.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token
  ON invoices(public_token)
  WHERE public_token IS NOT NULL;
