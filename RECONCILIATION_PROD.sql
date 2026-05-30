-- ============================================================================
-- KOMERCE — RÉCONCILIATION PROD ↔ MIGRATIONS
-- ============================================================================
-- Rattrape les migrations présentes dans migrations/ mais ABSENTES de la base
-- live (vérifié sur le dump schema_railway daté du 2026-05-30).
--
-- 100 % IDEMPOTENT : peut être exécuté plusieurs fois sans dommage.
-- À jouer en une passe :  psql "$DATABASE_URL" -f RECONCILIATION_PROD.sql
--
-- NE PAS wrapper dans un BEGIN/COMMIT global : la section enum (ALTER TYPE
-- ADD VALUE) doit être committée avant toute utilisation de la valeur.
-- psql en mode autocommit (défaut) gère cela correctement statement par statement.
-- ============================================================================

SET client_encoding = 'UTF8';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. MIGRATION 015b — Enrichissement douane sur parcels
--    Cause : routes/admin-customs-shipments.js (p.customs_value_kmf, ...) et
--            routes/carriers.js plantent (colonnes inexistantes).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_value_kmf  NUMERIC(12,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_weight_kg  NUMERIC(8,3);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_hs_code    VARCHAR(20);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_cleared_at TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_notes      TEXT;

DO $$ BEGIN RAISE NOTICE '✅ 015b appliquée — parcels.customs_* présentes'; END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. MIGRATION 073 — Contributions cash sur panier partagé
--    Cause : services/shared-cart-cash-service.js (payment_method, cash_*,
--            statut 'pending_cash') plante (colonnes + valeur enum inexistantes).
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 — Valeur d'enum 'pending_cash' (doit être committée avant usage)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pending_cash'
      AND enumtypid = 'shared_cart_contribution_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_contribution_status ADD VALUE 'pending_cash';
    RAISE NOTICE '✅ enum pending_cash ajoutée';
  ELSE
    RAISE NOTICE '↩ enum pending_cash déjà présente';
  END IF;
END $$;

-- 2.2 — Colonnes cash
ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS payment_method   TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_reference    TEXT;
ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_relais_id    UUID REFERENCES relais(id)  ON DELETE SET NULL;
ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_confirmed_by UUID REFERENCES users(id)   ON DELETE SET NULL;
ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_confirmed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_cart_contrib_cash_reference
  ON shared_cart_contributions(cash_reference)
  WHERE cash_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shared_cart_contrib_cash_pending
  ON shared_cart_contributions(status, payment_method, created_at)
  WHERE payment_method = 'cash';

DO $$ BEGIN RAISE NOTICE '✅ 073 appliquée — cash contributions activées'; END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. COLONNE MANQUANTE — shared_cart_contributions.commitment_id
--    Cause : services/shared-cart-engine.js INSERT ...commitment_id ($10)
--            → crash ("column commitment_id does not exist").
--            services/shared-cart-financial-guard.js (GAP 4) la lit pour passer
--            le commitment lié à 'paid' — sans elle, les engagements restent
--            bloqués en 'locked_for_settlement'.
--    NB : aucune migration du repo ne créait cette colonne (oubli v4).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS commitment_id UUID
    REFERENCES shared_cart_commitments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shared_cart_contrib_commitment
  ON shared_cart_contributions(commitment_id)
  WHERE commitment_id IS NOT NULL;

DO $$ BEGIN RAISE NOTICE '✅ commitment_id ajoutée sur shared_cart_contributions'; END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- NOTE — payment_mode 'collective' VOLONTAIREMENT NON AJOUTÉ.
--   Le système collective_workspaces a été démonté (routes 410, front tombstoné,
--   2026-05-30). Le seul code qui insérait payment_mode='collective'
--   (collective-close-order-service.js) est orphelin/inatteignable.
--   ALTER TYPE ... ADD VALUE est IRRÉVERSIBLE en Postgres : on ne pollue pas
--   l'enum pour une feature en cours de suppression. Le bug C1 se traite en
--   FINISSANT le démontage (tombstone du service backend), pas via le schéma.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 4. VÉRIFICATION FINALE (lecture seule)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE missing TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='parcels' AND column_name='customs_value_kmf') THEN
    missing := missing || ' parcels.customs_value_kmf'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='shared_cart_contributions' AND column_name='payment_method') THEN
    missing := missing || ' shared_cart_contributions.payment_method'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='shared_cart_contributions' AND column_name='commitment_id') THEN
    missing := missing || ' shared_cart_contributions.commitment_id'; END IF;

  IF missing = '' THEN
    RAISE NOTICE '════════════════════════════════════════════';
    RAISE NOTICE '✅ RÉCONCILIATION OK — schéma aligné';
    RAISE NOTICE '════════════════════════════════════════════';
  ELSE
    RAISE EXCEPTION 'Réconciliation incomplète, manquant :%', missing;
  END IF;
END $$;
