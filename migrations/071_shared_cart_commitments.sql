-- ============================================================
-- Migration 071 : Shared cart v4 commitments
-- Date : mai 2026
--
-- Doctrine v4 :
--   - avant passage au règlement : engagements indicatifs uniquement ;
--   - après passage au règlement : paiements réels via contributions.
--
-- Cette table ne remplace pas shared_cart_contributions.
-- Elle sépare clairement :
--   shared_cart_commitments   = intention / engagement indicatif
--   shared_cart_contributions = paiement réel
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_cart_commitment_status') THEN
    CREATE TYPE shared_cart_commitment_status AS ENUM (
      'pledged',               -- engagement indicatif actif
      'updated',               -- statut historique possible, non requis pour ligne courante
      'withdrawn',             -- retiré avant passage au règlement
      'locked_for_settlement',  -- figé lors du passage au règlement
      'payment_pending',        -- paiement attendu pendant la fenêtre de règlement
      'paid',                   -- engagement honoré par paiement réel
      'not_honored',            -- non réglé dans le délai
      'covered_by_creator',     -- compensé par le créateur
      'cancelled'               -- annulé avec le panier
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shared_cart_commitments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_cart_id        UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,

  -- Identité volontairement simple : téléphone + nom affiché.
  -- Le nom n'est jamais supposé unique.
  participant_name      TEXT NOT NULL,
  participant_phone     TEXT,

  amount_kmf            INTEGER NOT NULL CHECK (amount_kmf > 0),
  message               TEXT,
  status                shared_cart_commitment_status NOT NULL DEFAULT 'pledged',

  locked_at             TIMESTAMPTZ,
  withdrawn_at          TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,

  -- Lien optionnel vers le paiement réel quand il existe.
  contribution_id       UUID REFERENCES shared_cart_contributions(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata              JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shared_cart_commitments_cart
  ON shared_cart_commitments(shared_cart_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shared_cart_commitments_phone
  ON shared_cart_commitments(shared_cart_id, participant_phone)
  WHERE participant_phone IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_shared_cart_commitments_updated') THEN
    CREATE TRIGGER trg_shared_cart_commitments_updated BEFORE UPDATE ON shared_cart_commitments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 071 OK : shared_cart_commitments';
END $$;
