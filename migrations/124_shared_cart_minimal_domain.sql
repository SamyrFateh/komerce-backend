-- ============================================================
-- Migration 124 : Domaine minimal Liste Partagée (Boutique First, Lot 2/3)
-- Date : août 2026
--
-- CONTEXTE :
--   Suppression du mécanisme de contribution/cagnotte et de la machine
--   à états à 20 valeurs. Le paiement passe désormais entièrement par le
--   checkout canonique (migration 123). La liste partagée n'a plus que
--   trois états : open, closed, cancelled. Elle n'a plus aucune colonne
--   financière propre — le montant réclamé se calcule par jointure sur
--   order_items, jamais stocké (invariant produit n°3).
--
--   Supprimé dans la même migration : le mécanisme "paiement groupé
--   depuis une commande existante" (pending_group_payment), découvert
--   pendant ce lot comme un troisième mécanisme parallèle au même
--   problème que shared_cart_contributions et collective_workspaces.
--   Une commande en attente de financement groupé est exactement ce que
--   l'invariant produit n°1 interdit : « aucun paiement en attente ».
--
--   Portée volontairement staging : aucune contrainte de compatibilité
--   descendante. Les lignes existantes dans des statuts obsolètes sont
--   mappées vers le modèle à 3 états par la table de correspondance
--   ci-dessous, pas conservées telles quelles.
--
-- IDEMPOTENT via IF EXISTS / DO $$ garde-fou.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

-- ============================================================
-- 1. order_status — retrait de pending_group_payment
--    PostgreSQL ne permet pas de retirer une valeur d'un type ENUM
--    directement : on recrée le type sans cette valeur, on bascule la
--    colonne dessus, on supprime l'ancien type.
-- ============================================================

DO $$
DECLARE
  stuck_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'pending_group_payment'
  ) THEN
    RAISE NOTICE 'Migration 124 — pending_group_payment déjà absent de order_status, rien à faire.';
    RETURN;
  END IF;

  -- Compensation avant migration de type : toute commande encore dans cet
  -- état bascule vers 'pending' — transition déjà valide dans l'ancienne
  -- machine (pending_group_payment → pending, "retour si groupe abandonné"),
  -- donc sémantiquement neutre, pas une invention de ce lot.
  SELECT COUNT(*) INTO stuck_count FROM orders WHERE status = 'pending_group_payment';
  IF stuck_count > 0 THEN
    UPDATE orders SET status = 'pending' WHERE status = 'pending_group_payment';
    RAISE NOTICE 'Migration 124 — % commande(s) pending_group_payment basculée(s) vers pending.', stuck_count;
  END IF;

  CREATE TYPE order_status_new AS ENUM (
    'pending', 'confirmed', 'ordered', 'preparation', 'shipped',
    'in_transit', 'available', 'collected', 'cancelled', 'refunded'
  );

  ALTER TABLE orders
    ALTER COLUMN status TYPE order_status_new
    USING status::text::order_status_new;

  DROP TYPE order_status;
  ALTER TYPE order_status_new RENAME TO order_status;

  RAISE NOTICE 'Migration 124 OK — order_status recréé sans pending_group_payment.';
END $$;

-- ============================================================
-- 2. shared_cart_status — réduction à 3 valeurs
-- ============================================================

-- Pré-requis : deux index partiels existants filtrent sur des valeurs
-- d'enum ('awaiting_choice', 'funded', 'sourcing_check',
-- 'adjustment_required') absentes du type réduit à 3 valeurs. Sans ce
-- DROP, le rebuild d'index déclenché par l'ALTER COLUMN TYPE ci-dessous
-- échoue (littéral introuvable dans le nouveau type). Aucun des deux
-- n'a de raison d'être conservé dans le domaine minimal : le second est
-- déjà couvert par idx_shared_carts_status_v41 (status, created_at).
DROP INDEX IF EXISTS idx_shared_carts_awaiting_deadline;
DROP INDEX IF EXISTS idx_shared_carts_funded;

DO $$
DECLARE
  target_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'shared_cart_status';

  IF target_count <= 3 THEN
    RAISE NOTICE 'Migration 124 — shared_cart_status déjà réduit, rien à faire.';
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

  ALTER TABLE shared_carts
    ALTER COLUMN status TYPE shared_cart_status_new
    USING status::text::shared_cart_status_new;

  ALTER TABLE shared_carts ALTER COLUMN status SET DEFAULT 'open';

  DROP TYPE shared_cart_status;
  ALTER TYPE shared_cart_status_new RENAME TO shared_cart_status;

  RAISE NOTICE 'Migration 124 OK — shared_cart_status réduit à open/closed/cancelled.';
END $$;

-- ============================================================
-- 3. shared_carts — domaine minimal
-- ============================================================

ALTER TABLE shared_carts RENAME COLUMN beneficiary_user_id TO organizer_user_id;

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
-- 4. Tables de contribution/estimation — supprimées
--    Aucune FK entrante depuis l'extérieur de ces tables (vérifié).
-- ============================================================

DROP TABLE IF EXISTS shared_cart_contributions;
DROP TABLE IF EXISTS shared_cart_estimations;
DROP TABLE IF EXISTS cart_contributions;

DO $$
BEGIN
  RAISE NOTICE 'Migration 124 OK — domaine liste partagée réduit au modèle minimal.';
END $$;
