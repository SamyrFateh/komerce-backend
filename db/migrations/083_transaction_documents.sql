-- ──────────────────────────────────────────────────────────────────────────────
-- Migration 014 — Couche documentaire transactionnelle
--
-- 1. Contrainte UNIQUE(order_id) sur invoices (idempotence DB)
-- 2. Table transaction_documents (reçus remboursement, contributions, wallet…)
--
-- Doctrine : DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
-- Phase    : Phase 1 — Socle documentaire
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Contrainte idempotence facture ────────────────────────────────────────
--
-- invoices.invoice_number est déjà UNIQUE, mais rien n'empêche deux factures
-- pour le même order_id (la logique applicative getOrCreateInvoice gérait ça
-- seule avec un SELECT … LIMIT 1). On fixe ça au niveau DB.
--
-- Si l'anomalie existe déjà en prod, dédupliquer avant d'appliquer :
--   DELETE FROM invoices
--   WHERE id NOT IN (
--     SELECT MIN(id) FROM invoices GROUP BY order_id
--   );
--
ALTER TABLE invoices
  ADD CONSTRAINT invoices_order_id_unique UNIQUE (order_id);


-- ── 2. Table transaction_documents ───────────────────────────────────────────
--
-- Table générique pour tous les documents transactionnels hors facture :
--   - reçu de remboursement (refund_receipt)
--   - reçu de contribution panier partagé (contribution_receipt)
--   - reçu wallet (wallet_receipt)
--   - preuve de retrait (pickup_proof)
--   - bon fournisseur (purchase_order)  ← futur
--
-- La facture reste dans sa propre table `invoices` (existante, production).
--
-- Idempotence :
--   UNIQUE(document_type, subject_type, subject_id)
--   → un seul document par (type, objet source).
--   Exemples :
--     ('refund_receipt',        'refund',       refund.id)
--     ('contribution_receipt',  'contribution', contribution.id)
--     ('wallet_receipt',        'wallet_tx',    wallet_transaction.id)
--     ('pickup_proof',          'order',        order.id)
--
CREATE TABLE IF NOT EXISTS transaction_documents (
  id                    UUID        DEFAULT gen_random_uuid() NOT NULL,

  -- Type de document
  document_type         TEXT        NOT NULL,
  -- Valeurs attendues : refund_receipt | contribution_receipt |
  --                     wallet_receipt | pickup_proof | purchase_order
  CONSTRAINT transaction_documents_type_check CHECK (
    document_type IN (
      'refund_receipt',
      'contribution_receipt',
      'wallet_receipt',
      'pickup_proof',
      'purchase_order'
    )
  ),

  -- Objet source (l'événement confirmé qui a produit ce document)
  subject_type          TEXT        NOT NULL,  -- 'refund' | 'contribution' | 'wallet_tx' | 'order'
  subject_id            UUID        NOT NULL,

  -- Liens optionnels vers les entités métier (pour jointures rapides)
  order_id              UUID        REFERENCES orders(id)        ON DELETE SET NULL,
  refund_id             UUID        REFERENCES refunds(id)       ON DELETE SET NULL,
  -- shared_cart_id, contribution_id, wallet_transaction_id ajoutés en Phase 3/4

  -- Référence document lisible (ex. "REM-2026-000042")
  reference             TEXT        NOT NULL,

  -- Statut de génération
  status                TEXT        NOT NULL DEFAULT 'generated',
  CONSTRAINT transaction_documents_status_check CHECK (
    status IN ('generated', 'delivered', 'error')
  ),

  -- Fichier (optionnel — pour PDF futur)
  file_url              TEXT,
  file_storage_key      TEXT,

  -- Métadonnées figées au moment de l'émission (snapshot)
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by             UUID        REFERENCES users(id)         ON DELETE SET NULL,
  metadata              JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),

  -- Contrainte d'idempotence centrale
  CONSTRAINT transaction_documents_subject_unique
    UNIQUE (document_type, subject_type, subject_id)
);

-- Index pour lookups fréquents
CREATE INDEX idx_txdoc_order    ON transaction_documents (order_id)  WHERE order_id  IS NOT NULL;
CREATE INDEX idx_txdoc_refund   ON transaction_documents (refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX idx_txdoc_type     ON transaction_documents (document_type);
CREATE INDEX idx_txdoc_issued   ON transaction_documents (issued_at DESC);

-- ── 3. Contraintes UNIQUE sur refunds ────────────────────────────────────────
--
-- Les ON CONFLICT dans refund-service.js et payment-paypal.js requièrent
-- des contraintes UNIQUE explicites. Sans elles, ON CONFLICT DO NOTHING
-- lève une erreur SQL en prod.
--
-- (order_id, refund_type) : un seul remboursement full/partial par commande.
-- stripe_refund_id : idempotence sur l'ID Stripe ou PayPal (colonne partagée).
--
-- Dédupliquer avant si l'anomalie existe déjà :
--   DELETE FROM refunds
--   WHERE id NOT IN (
--     SELECT MIN(id) FROM refunds GROUP BY order_id, refund_type
--   );
--
ALTER TABLE refunds
  ADD CONSTRAINT refunds_order_refund_type_unique UNIQUE (order_id, refund_type);

ALTER TABLE refunds
  ADD CONSTRAINT refunds_stripe_refund_id_unique UNIQUE (stripe_refund_id);


-- Séquences pour les références lisibles des documents
CREATE SEQUENCE IF NOT EXISTS refund_receipt_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS wallet_receipt_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS pickup_proof_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
