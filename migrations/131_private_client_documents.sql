-- @migration 131_private_client_documents.sql
-- @domain    documents
-- @purpose   Documents PDF privés, immuables et rattachés à leur propriétaire

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pdf_content BYTEA,
  ADD COLUMN IF NOT EXISTS pdf_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS pdf_filename TEXT,
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_version TEXT NOT NULL DEFAULT '2026-08-v1';

UPDATE invoices i
   SET owner_user_id = o.user_id
  FROM orders o
 WHERE o.id = i.order_id
   AND i.owner_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_owner_created
  ON invoices(owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE transaction_documents
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pdf_content BYTEA,
  ADD COLUMN IF NOT EXISTS pdf_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS pdf_filename TEXT,
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_version TEXT NOT NULL DEFAULT '2026-08-v1';

UPDATE transaction_documents td
   SET owner_user_id = o.user_id
  FROM orders o
 WHERE o.id = td.order_id
   AND td.owner_user_id IS NULL;

UPDATE transaction_documents td
   SET owner_user_id = w.user_id
  FROM wallet_transactions wt
  JOIN wallets w ON w.id = wt.wallet_id
 WHERE td.subject_type = 'wallet_tx'
   AND td.subject_id = wt.id
   AND td.owner_user_id IS NULL;

ALTER TABLE transaction_documents
  DROP CONSTRAINT IF EXISTS transaction_documents_status_check;

UPDATE transaction_documents
   SET status = CASE WHEN pdf_content IS NULL THEN 'pending' ELSE 'available' END
 WHERE status IN ('generated', 'delivered');

ALTER TABLE transaction_documents
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD CONSTRAINT transaction_documents_status_check
    CHECK (status IN ('pending', 'available', 'error'));

CREATE INDEX IF NOT EXISTS idx_txdoc_owner_issued
  ON transaction_documents(owner_user_id, issued_at DESC)
  WHERE owner_user_id IS NOT NULL;

-- Les anciens jetons restent physiquement présents le temps d'un déploiement
-- sans rupture, mais ils ne sont plus servis par aucune route publique.
COMMENT ON COLUMN invoices.public_token IS
  'DEPRECATED 2026-08: aucune route publique; téléchargement authentifié uniquement';
