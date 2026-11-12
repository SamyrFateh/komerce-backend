-- @migration 410_hub_purchase_commitment_pdf.sql
-- Existing authorizations remain valid. Only new commitments carry a frozen document.
ALTER TABLE public.purchase_order_authorizations
  ADD COLUMN IF NOT EXISTS commitment_pdf bytea
  CONSTRAINT chk_po_commitment_pdf_type
    CHECK (commitment_pdf IS NULL OR authorization_type = 'purchase_commitment');
