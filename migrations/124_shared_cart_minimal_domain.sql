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

-- Cette vue référence orders.status avec le type ENUM. PostgreSQL interdit
-- l'ALTER TYPE tant que sa règle de réécriture dépend de la colonne. Sa
-- définition canonique est recréée immédiatement après le cutover.
DROP VIEW IF EXISTS suppliers_stats;

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

  -- Le DEFAULT est typé avec l'ancien ENUM et ne peut pas être converti
  -- implicitement pendant ALTER COLUMN TYPE. On le retire puis on le repose
  -- après renommage du nouveau type.
  ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
  ALTER TABLE orders
    ALTER COLUMN status TYPE order_status_new
    USING status::text::order_status_new;

  DROP TYPE order_status;
  ALTER TYPE order_status_new RENAME TO order_status;
  ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending'::order_status;

  RAISE NOTICE 'Migration 124 OK — order_status recréé sans pending_group_payment.';
END $$;

CREATE OR REPLACE VIEW suppliers_stats AS
SELECT
  p.id AS partner_id,
  p.name,
  p.partner_type,
  COALESCE((
    SELECT COUNT(*)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.status NOT IN ('cancelled', 'refunded')
  ), 0) AS orders_count_30d,
  COALESCE((
    SELECT SUM(o.total_kmf)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.status NOT IN ('cancelled', 'refunded')
       AND o.created_at >= NOW() - INTERVAL '30 days'
  ), 0) AS orders_revenue_30d_kmf,
  COALESCE((
    SELECT AVG(o.margin_real_pct)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.margin_real_pct IS NOT NULL
       AND o.created_at >= NOW() - INTERVAL '90 days'
  ), 0) AS avg_margin_pct_90d,
  COALESCE((
    SELECT COUNT(*)
      FROM customs_shipments cs
     WHERE cs.supplier_id = p.id
       AND cs.is_active = TRUE
  ), 0) AS shipments_count,
  COALESCE((
    SELECT AVG(cs.effective_rate_pct)
      FROM customs_shipments cs
     WHERE cs.supplier_id = p.id
       AND cs.is_active = TRUE
       AND cs.shipment_date >= CURRENT_DATE - INTERVAL '90 days'
  ), 0) AS avg_customs_rate_90d
FROM partners p
WHERE p.is_active = TRUE;

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

  ALTER TABLE shared_carts ALTER COLUMN status DROP DEFAULT;
  ALTER TABLE shared_carts
    ALTER COLUMN status TYPE shared_cart_status_new
    USING status::text::shared_cart_status_new;

  DROP TYPE shared_cart_status;
  ALTER TYPE shared_cart_status_new RENAME TO shared_cart_status;
  ALTER TABLE shared_carts ALTER COLUMN status SET DEFAULT 'open'::shared_cart_status;

  RAISE NOTICE 'Migration 124 OK — shared_cart_status réduit à open/closed/cancelled.';
END $$;

-- ============================================================
-- 3. shared_carts — domaine minimal
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shared_carts'
      AND column_name = 'beneficiary_user_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shared_carts'
      AND column_name = 'organizer_user_id'
  ) THEN
    ALTER TABLE shared_carts RENAME COLUMN beneficiary_user_id TO organizer_user_id;
  END IF;
END $$;

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
