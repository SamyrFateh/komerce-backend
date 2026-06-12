-- ============================================================
-- Migration 080 : Panier Partagé V4 → V4.1 — Machine d'état
-- Date : juin 2026
--
-- DOCTRINE V4.1 (gelée) :
--   Remplace le paradigme "engagements + règlement" par une
--   machine d'état à 5 statuts visibles + 2 techniques :
--
--   OPEN           → construction libre, estimations facultatives
--   CLOSED         → fenêtre paiement fixe 48h, liste figée
--   AWAITING_CHOICE→ fin fenêtre, <100% financé, créateur décide (72h)
--   ORDERED        → commande créée
--   CANCELLED      → annulé
--   expired (tech) → 72h sans décision en AWAITING_CHOICE
--   archived (tech)→ nettoyage final
--
-- CONTENU :
--   1. Nouveaux statuts enum shared_cart_status
--   2. Nouvelles colonnes sur shared_carts
--   3. Migration données existantes (V4 → V4.1 status mapping)
--   4. Table shared_cart_estimations (remplace commitments)
--   5. DROP colonne commitment_id sur contributions (drift non versionné)
--   6. Dépréciation shared_cart_commitments (DROP conditionnel)
--   7. Index mis à jour
--
-- IDEMPOTENT via IF NOT EXISTS / IF EXISTS / DO $$ EXCEPTION.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

-- ============================================================
-- 1. Nouveaux statuts enum shared_cart_status
-- ============================================================
-- Note : PostgreSQL interdit de supprimer des valeurs d'enum.
-- Les valeurs V4 legacy (draft, active, commitment_open, etc.)
-- restent déclarées dans le type mais ne seront plus assignées
-- après cette migration. Le code V4.1 n'en produit aucune.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'open'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'open';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'closed'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'closed';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'awaiting_choice'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'awaiting_choice';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ordered'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'ordered';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'archived'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'archived';
  END IF;
END $$;

-- ============================================================
-- 2. Nouvelles colonnes sur shared_carts
-- ============================================================

-- Date cible optionnelle fixée par le créateur à la création.
-- Le cron ferme automatiquement le panier quand target_date est atteinte.
ALTER TABLE shared_carts
  ADD COLUMN IF NOT EXISTS target_date DATE;

-- Timestamp exact de fermeture (status → CLOSED).
ALTER TABLE shared_carts
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Fin de la fenêtre de paiement = closed_at + 48h fixe.
-- Calculé et stocké à la fermeture pour requêtes cron efficaces.
ALTER TABLE shared_carts
  ADD COLUMN IF NOT EXISTS payment_window_ends_at TIMESTAMPTZ;

-- Timestamp d'entrée en AWAITING_CHOICE.
ALTER TABLE shared_carts
  ADD COLUMN IF NOT EXISTS awaiting_choice_started_at TIMESTAMPTZ;

-- Deadline créateur = awaiting_choice_started_at + 72h.
-- Calculé et stocké pour requêtes cron.
ALTER TABLE shared_carts
  ADD COLUMN IF NOT EXISTS awaiting_choice_deadline TIMESTAMPTZ;

-- ============================================================
-- 3. Migration données existantes : V4 → V4.1 status mapping
--
-- Mapping :
--   draft                 → open
--   active                → open
--   commitment_open       → open
--   partially_funded      → closed  (contributions reçues, fenêtre ouverte)
--   closed_for_settlement → closed
--   settlement_in_progress→ closed
--   ready_to_finalize     → closed
--   fully_funded          → closed  (100% atteint, fenêtre ou grâce)
--   converted_to_order    → ordered
--   refunded              → cancelled (pas d'équivalent V4.1)
--   cancelled             → cancelled (inchangé)
--   expired               → expired   (inchangé)
--
-- Pour les paniers migrés vers CLOSED sans closed_at historique,
-- on reconstruit approximativement :
--   closed_at            = updated_at (meilleure approximation)
--   payment_window_ends_at = closed_at + 48h
--
-- IMPORTANT : cette UPDATE est idempotente — elle ne touche que les
-- lignes dont le status est encore une valeur V4 legacy.
-- ============================================================

DO $$
DECLARE
  migrated_open    INTEGER;
  migrated_closed  INTEGER;
  migrated_ordered INTEGER;
  migrated_cancel  INTEGER;
BEGIN
  -- Vers OPEN
  UPDATE shared_carts
     SET status = 'open',
         updated_at = NOW()
   WHERE status IN ('draft', 'active', 'commitment_open');
  GET DIAGNOSTICS migrated_open = ROW_COUNT;

  -- Vers CLOSED (avec reconstruction approximative des timestamps)
  UPDATE shared_carts
     SET status                = 'closed',
         closed_at             = COALESCE(closed_at, updated_at, created_at),
         payment_window_ends_at = COALESCE(
                                    payment_window_ends_at,
                                    COALESCE(updated_at, created_at) + INTERVAL '48 hours'
                                  ),
         updated_at            = NOW()
   WHERE status IN (
     'partially_funded',
     'fully_funded',
     'closed_for_settlement',
     'settlement_in_progress',
     'ready_to_finalize'
   );
  GET DIAGNOSTICS migrated_closed = ROW_COUNT;

  -- Vers ORDERED
  UPDATE shared_carts
     SET status = 'ordered',
         updated_at = NOW()
   WHERE status = 'converted_to_order';
  GET DIAGNOSTICS migrated_ordered = ROW_COUNT;

  -- refunded → cancelled (pas de statut refunded en V4.1)
  UPDATE shared_carts
     SET status = 'cancelled',
         updated_at = NOW()
   WHERE status = 'refunded';
  GET DIAGNOSTICS migrated_cancel = ROW_COUNT;

  RAISE NOTICE 'Migration 080 — statuts migrés : open=%, closed=%, ordered=%, cancelled(ex-refunded)=%',
    migrated_open, migrated_closed, migrated_ordered, migrated_cancel;
END $$;

-- ============================================================
-- 4. Table shared_cart_estimations
--    Remplace shared_cart_commitments.
--    Pas de statuts ni de cycle de vie : une estimation existe
--    ou n'existe pas. Create/update/delete par phone (upsert).
--    Autorisée uniquement si status = 'open'.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared_cart_estimations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_cart_id        UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,

  -- Identité déclarative (pas d'authentification requise)
  participant_name      TEXT NOT NULL,
  participant_phone     TEXT,

  -- Montant estimé en KMF (positif, indicatif — jamais verrouillé)
  amount_kmf            INTEGER NOT NULL CHECK (amount_kmf > 0),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index principal pour les lectures par panier
CREATE INDEX IF NOT EXISTS idx_shared_cart_estimations_cart
  ON shared_cart_estimations(shared_cart_id, created_at DESC);

-- Index pour upsert-by-phone (create or update par téléphone)
CREATE INDEX IF NOT EXISTS idx_shared_cart_estimations_phone
  ON shared_cart_estimations(shared_cart_id, participant_phone)
  WHERE participant_phone IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_shared_cart_estimations_updated'
  ) THEN
    CREATE TRIGGER trg_shared_cart_estimations_updated
      BEFORE UPDATE ON shared_cart_estimations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 5. Retirer commitment_id de shared_cart_contributions
--    (colonne ajoutée manuellement en prod — drift non versionné)
--    IF EXISTS absorbe silencieusement les envs sans cette colonne.
-- ============================================================

ALTER TABLE shared_cart_contributions
  DROP COLUMN IF EXISTS commitment_id;

-- ============================================================
-- 6. Dépréciation shared_cart_commitments
--
-- CONDITION : la table ne peut être droppée qu'après confirmation
-- qu'aucun engagement actif (pledged/locked_for_settlement/payment_pending)
-- n'existe en production.
--
-- Ce bloc lève une exception si des lignes actives existent.
-- Si vous êtes certain que la table est vide ou ne contient que
-- des lignes terminales, remplacez le IF/RAISE par le DROP direct.
--
-- Vérification manuelle recommandée avant déploiement :
--   SELECT status, COUNT(*) FROM shared_cart_commitments
--   WHERE status NOT IN ('cancelled','not_honored','covered_by_creator','paid','withdrawn')
--   GROUP BY 1;
-- ============================================================

DO $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'shared_cart_commitments'
  ) THEN
    RAISE NOTICE 'Migration 080 — shared_cart_commitments introuvable, rien à droper.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO active_count
  FROM shared_cart_commitments
  WHERE status NOT IN ('cancelled', 'not_honored', 'covered_by_creator', 'paid', 'withdrawn');

  IF active_count > 0 THEN
    RAISE EXCEPTION
      'Migration 080 bloquée : % engagement(s) actif(s) dans shared_cart_commitments. '
      'Résoudre manuellement ou confirmer que ces lignes sont orphelines avant de relancer.',
      active_count;
  END IF;

  -- Supprimer le trigger avant le DROP pour éviter les erreurs de dépendance
  DROP TRIGGER IF EXISTS trg_shared_cart_commitments_updated ON shared_cart_commitments;

  DROP TABLE IF EXISTS shared_cart_commitments;

  -- Supprimer le type enum devenu orphelin
  DROP TYPE IF EXISTS shared_cart_commitment_status;

  RAISE NOTICE 'Migration 080 — shared_cart_commitments droppée avec succès.';
END $$;

-- ============================================================
-- 7. Index mis à jour sur shared_carts
--    L'index existant sur (status, expires_at) est remplacé par
--    des index ciblés sur les transitions cron V4.1.
-- ============================================================

-- Index cron : OPEN avec target_date pour fermeture automatique
CREATE INDEX IF NOT EXISTS idx_shared_carts_open_target_date
  ON shared_carts(target_date)
  WHERE status = 'open'
    AND target_date IS NOT NULL;

-- Index cron : CLOSED expirés (payment_window_ends_at < NOW())
CREATE INDEX IF NOT EXISTS idx_shared_carts_closed_window
  ON shared_carts(payment_window_ends_at)
  WHERE status = 'closed';

-- Index cron : AWAITING_CHOICE expirés (awaiting_choice_deadline < NOW())
CREATE INDEX IF NOT EXISTS idx_shared_carts_awaiting_deadline
  ON shared_carts(awaiting_choice_deadline)
  WHERE status = 'awaiting_choice';

-- Index cockpit créateur / API owner (status courant)
CREATE INDEX IF NOT EXISTS idx_shared_carts_status_v41
  ON shared_carts(status, created_at DESC);

-- ============================================================
-- Fin migration 080
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 080 OK : V4.1 state machine — enum enrichi, colonnes ajoutées, données migrées, estimations créées, commitments droppés.';
END $$;
