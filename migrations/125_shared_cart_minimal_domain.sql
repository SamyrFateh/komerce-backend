-- ============================================================
-- Migration 125 : Domaine minimal Liste Partagée
-- (Boutique First, Lot 2/3, partie 2/2)
-- Date : août 2026
--
-- CONTEXTE :
--   Suite de la migration 124. shared_cart_status passe de 20 valeurs à
--   3 (open/closed/cancelled) — voir 124 pour l'explication de la
--   séparation en deux fichiers (deux transactions distinctes,
--   nécessaire empiriquement pour que les deux conversions d'énumération
--   réussissent toutes les deux). La liste partagée n'a plus aucune
--   colonne financière propre — le montant réclamé se calcule par
--   jointure sur order_items, jamais stocké (invariant produit n°3).
--
--   Portée volontairement staging : aucune contrainte de compatibilité
--   descendante. Les lignes existantes dans des statuts obsolètes sont
--   mappées vers le modèle à 3 états ci-dessous, pas conservées telles
--   quelles.
--
-- IDEMPOTENT via IF EXISTS / garde interne.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

-- ============================================================
-- 1. shared_cart_status — réduction à 3 valeurs
-- ============================================================

-- Pré-requis : deux index partiels existants filtrent sur des valeurs
-- d'enum ('awaiting_choice', 'funded', 'sourcing_check',
-- 'adjustment_required') absentes du type réduit à 3 valeurs. Sans ce
-- DROP, le rebuild d'index déclenché par l'ALTER COLUMN TYPE ci-dessous
-- échoue (littéral introuvable dans le nouveau type). Aucun des deux
-- n'a de raison d'être conservé dans le domaine minimal : le second est
-- déjà couvert par idx_shared_carts_status_v41 (status, created_at).
-- 7 index référencent shared_carts.status (vérifié exhaustivement via
-- pg_indexes). Pendant l'ALTER COLUMN TYPE, PostgreSQL tente de
-- reconstruire chacun avec l'opérateur = entre l'ancien type et le
-- nouveau — cet opérateur n'existe pas entre deux types ENUM distincts
-- ("operator does not exist: shared_cart_status_new = shared_cart_status").
-- Même bug que pour orders.status (migration 124, 3 index partiels).
-- Retirés avant la conversion, recréés avec les noms pertinents après.
DROP INDEX IF EXISTS idx_shared_carts_awaiting_deadline;
DROP INDEX IF EXISTS idx_shared_carts_beneficiary;
DROP INDEX IF EXISTS idx_shared_carts_closed_window;
DROP INDEX IF EXISTS idx_shared_carts_funded;
DROP INDEX IF EXISTS idx_shared_carts_open_target_date;
DROP INDEX IF EXISTS idx_shared_carts_status;
DROP INDEX IF EXISTS idx_shared_carts_status_v41;

DO $$
DECLARE
  target_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'shared_cart_status';

  IF target_count <= 3 THEN
    RAISE NOTICE 'Migration 125 — shared_cart_status déjà réduit, rien à faire.';
    RETURN;
  END IF;

  -- Compensation : toute liste dans un statut obsolète est reclassée
  -- selon l'intention la plus proche du modèle à 3 états, jamais laissée
  -- dans un état que le nouveau type ne peut plus représenter.
  UPDATE shared_carts SET status = 'open'
   WHERE status::text IN ('draft', 'active', 'partially_funded', 'fully_funded',
                           'funded', 'sourcing_check', 'adjustment_required',
                           'commitment_open');

  UPDATE shared_carts SET status = 'closed'
   WHERE status::text IN ('converted_to_order', 'ordered', 'closed_for_settlement',
                           'settlement_in_progress', 'ready_to_finalize', 'awaiting_choice');

  UPDATE shared_carts SET status = 'cancelled'
   WHERE status::text IN ('expired', 'archived', 'refunded');

  CREATE TYPE shared_cart_status_new AS ENUM ('open', 'closed', 'cancelled');

  -- Même bug que pour orders.status (migration 124) : la clause DEFAULT
  -- ('draft', valeur qui n'existe plus dans le nouveau type à 3 valeurs)
  -- doit être retirée avant l'ALTER COLUMN TYPE, pas seulement remplacée
  -- après.
  ALTER TABLE shared_carts ALTER COLUMN status DROP DEFAULT;

  ALTER TABLE shared_carts
    ALTER COLUMN status TYPE shared_cart_status_new
    USING status::text::shared_cart_status_new;

  ALTER TABLE shared_carts ALTER COLUMN status SET DEFAULT 'open';

  DROP TYPE shared_cart_status;
  ALTER TYPE shared_cart_status_new RENAME TO shared_cart_status;

  -- Recréation des index pertinents dans le domaine minimal. Les 5 autres
  -- (awaiting_deadline, closed_window, funded, open_target_date, status+expires_at)
  -- portaient sur des colonnes ou des valeurs d'enum supprimées dans ce
  -- même fichier — ils ne sont pas recréés.
  CREATE INDEX idx_shared_carts_status_v41 ON shared_carts USING btree (status, created_at DESC);

  RAISE NOTICE 'Migration 125 OK — shared_cart_status réduit à open/closed/cancelled.';
END $$;

-- ============================================================
-- 2. shared_carts — domaine minimal
-- ============================================================

ALTER TABLE shared_carts RENAME COLUMN beneficiary_user_id TO organizer_user_id;

-- Recréation de l'index sur (organizer_user_id, status), supprimé plus
-- haut pour permettre la conversion de type. Même clé, nouveau nom de
-- colonne après le RENAME ci-dessus.
CREATE INDEX idx_shared_carts_organizer ON shared_carts USING btree (organizer_user_id, status);

ALTER TABLE shared_carts
  DROP COLUMN IF EXISTS beneficiary_phone_snapshot,
  DROP COLUMN IF EXISTS beneficiary_name_snapshot,
  DROP COLUMN IF EXISTS currency_snapshot,
  DROP COLUMN IF EXISTS total_kmf_snapshot,
  DROP COLUMN IF EXISTS contributed_kmf,
  DROP COLUMN IF EXISTS remaining_kmf,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS finalized_at,
  DROP COLUMN IF EXISTS finalized_order_id,
  DROP COLUMN IF EXISTS split_mode,
  DROP COLUMN IF EXISTS suggested_share_kmf,
  DROP COLUMN IF EXISTS expected_participants,
  DROP COLUMN IF EXISTS sourcing_checked_at,
  DROP COLUMN IF EXISTS sourcing_note,
  DROP COLUMN IF EXISTS target_date,
  DROP COLUMN IF EXISTS payment_window_ends_at,
  DROP COLUMN IF EXISTS awaiting_choice_started_at,
  DROP COLUMN IF EXISTS awaiting_choice_deadline,
  DROP COLUMN IF EXISTS view_count;

-- ============================================================
-- 3. Tables de contribution/estimation — supprimées
--    Aucune FK entrante depuis l'extérieur de ces tables (vérifié).
-- ============================================================

DROP TABLE IF EXISTS shared_cart_contributions;
DROP TABLE IF EXISTS shared_cart_estimations;
DROP TABLE IF EXISTS cart_contributions;

DO $$
BEGIN
  RAISE NOTICE 'Migration 125 OK — domaine liste partagée réduit au modèle minimal.';
END $$;
