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

BEGIN;

-- ============================================================
-- 1. order_status — retrait de pending_group_payment
-- ============================================================

-- Les vues qui dépendent directement ou indirectement de orders.status ou
-- order_status_history.status empêchent l'ALTER TYPE. Elles sont mémorisées,
-- retirées dans l'ordre inverse des dépendances, puis recréées dans la même
-- transaction. Un échec restaure donc intégralement vues et ancien ENUM.
CREATE TEMP TABLE _m124_saved_order_status_views (
  view_oid        OID PRIMARY KEY,
  view_schema     TEXT NOT NULL,
  view_name       TEXT NOT NULL,
  view_definition TEXT NOT NULL,
  view_owner      TEXT NOT NULL,
  view_comment    TEXT,
  depth           INTEGER NOT NULL
) ON COMMIT DROP;

WITH RECURSIVE impacted(view_oid, view_schema, view_name, depth, path) AS (
  SELECT DISTINCT
    c.oid,
    n.nspname,
    c.relname,
    0,
    ARRAY[c.oid]
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class c ON c.oid = r.ev_class
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE d.classid = 'pg_rewrite'::regclass
    AND d.refclassid = 'pg_class'::regclass
    AND c.relkind = 'v'
    AND (
      (
        d.refobjid = 'public.orders'::regclass
        AND d.refobjsubid = (
          SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.orders'::regclass
            AND attname = 'status'
            AND NOT attisdropped
        )
      )
      OR
      (
        d.refobjid = 'public.order_status_history'::regclass
        AND d.refobjsubid = (
          SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.order_status_history'::regclass
            AND attname = 'status'
            AND NOT attisdropped
        )
      )
    )

  UNION ALL

  SELECT
    c2.oid,
    n2.nspname,
    c2.relname,
    impacted.depth + 1,
    impacted.path || c2.oid
  FROM impacted
  JOIN pg_depend d2 ON d2.refobjid = impacted.view_oid
  JOIN pg_rewrite r2 ON r2.oid = d2.objid
  JOIN pg_class c2 ON c2.oid = r2.ev_class
  JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
  WHERE d2.classid = 'pg_rewrite'::regclass
    AND d2.refclassid = 'pg_class'::regclass
    AND c2.relkind = 'v'
    AND NOT c2.oid = ANY(impacted.path)
)
INSERT INTO _m124_saved_order_status_views (
  view_oid,
  view_schema,
  view_name,
  view_definition,
  view_owner,
  view_comment,
  depth
)
SELECT
  impacted.view_oid,
  MIN(impacted.view_schema),
  MIN(impacted.view_name),
  pg_get_viewdef(impacted.view_oid, TRUE),
  pg_get_userbyid(c.relowner),
  obj_description(impacted.view_oid, 'pg_class'),
  MAX(impacted.depth)
FROM impacted
JOIN pg_class c ON c.oid = impacted.view_oid
GROUP BY impacted.view_oid, c.relowner;

-- Tous les index non portés par une contrainte sont également mémorisés.
-- Les prédicats d'index contiennent des littéraux typés order_status : ils
-- doivent être reparsés après le remplacement de l'ENUM.
CREATE TEMP TABLE _m124_saved_order_status_indexes (
  index_oid        OID PRIMARY KEY,
  index_schema     TEXT NOT NULL,
  index_name       TEXT NOT NULL,
  index_definition TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _m124_saved_order_status_indexes (
  index_oid,
  index_schema,
  index_name,
  index_definition
)
SELECT
  i.indexrelid,
  n.nspname,
  idx.relname,
  pg_get_indexdef(i.indexrelid)
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = idx.relnamespace
WHERE i.indrelid IN (
  'public.orders'::regclass,
  'public.order_status_history'::regclass
)
AND NOT EXISTS (
  SELECT 1
  FROM pg_constraint c
  WHERE c.conindid = i.indexrelid
);

DO $$
DECLARE
  stuck_count INTEGER;
  saved_view RECORD;
  saved_index RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'pending_group_payment'
  ) THEN
    RAISE NOTICE 'Migration 124 — pending_group_payment déjà absent de order_status, rien à faire.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO stuck_count
  FROM orders
  WHERE status = 'pending_group_payment';

  IF stuck_count > 0 THEN
    UPDATE orders
    SET status = 'pending'
    WHERE status = 'pending_group_payment';
    RAISE NOTICE 'Migration 124 — % commande(s) pending_group_payment basculée(s) vers pending.', stuck_count;
  END IF;

  FOR saved_view IN
    SELECT *
    FROM _m124_saved_order_status_views
    ORDER BY depth DESC, view_oid
  LOOP
    EXECUTE format('DROP VIEW %I.%I', saved_view.view_schema, saved_view.view_name);
  END LOOP;

  FOR saved_index IN
    SELECT *
    FROM _m124_saved_order_status_indexes
    ORDER BY index_oid
  LOOP
    EXECUTE format('DROP INDEX %I.%I', saved_index.index_schema, saved_index.index_name);
  END LOOP;

  CREATE TYPE order_status_new AS ENUM (
    'pending', 'confirmed', 'ordered', 'preparation', 'shipped',
    'in_transit', 'available', 'collected', 'cancelled', 'refunded'
  );

  ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
  ALTER TABLE orders
    ALTER COLUMN status TYPE order_status_new
    USING status::text::order_status_new;

  ALTER TABLE order_status_history
    ALTER COLUMN status TYPE order_status_new
    USING status::text::order_status_new;

  DROP TYPE order_status;
  ALTER TYPE order_status_new RENAME TO order_status;
  ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending'::order_status;

  FOR saved_index IN
    SELECT *
    FROM _m124_saved_order_status_indexes
    ORDER BY index_oid
  LOOP
    EXECUTE saved_index.index_definition;
  END LOOP;

  FOR saved_view IN
    SELECT *
    FROM _m124_saved_order_status_views
    ORDER BY depth ASC, view_oid
  LOOP
    EXECUTE format(
      'CREATE VIEW %I.%I AS %s',
      saved_view.view_schema,
      saved_view.view_name,
      saved_view.view_definition
    );
    EXECUTE format(
      'ALTER VIEW %I.%I OWNER TO %I',
      saved_view.view_schema,
      saved_view.view_name,
      saved_view.view_owner
    );
    IF saved_view.view_comment IS NOT NULL THEN
      EXECUTE format(
        'COMMENT ON VIEW %I.%I IS %L',
        saved_view.view_schema,
        saved_view.view_name,
        saved_view.view_comment
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 124 OK — order_status recréé sans pending_group_payment.';
END $$;

-- ============================================================
-- 2. shared_cart_status — réduction à 3 valeurs
-- ============================================================

-- Index devenus obsolètes ou dépendants du type ENUM remplacé.
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
    RAISE NOTICE 'Migration 124 — shared_cart_status déjà réduit, rien à faire.';
    RETURN;
  END IF;

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

CREATE INDEX IF NOT EXISTS idx_shared_carts_organizer
  ON shared_carts (organizer_user_id, status);

CREATE INDEX IF NOT EXISTS idx_shared_carts_status_v41
  ON shared_carts (status, created_at DESC);

-- ============================================================
-- 4. Tables de contribution/estimation — supprimées
-- ============================================================

DROP TABLE IF EXISTS shared_cart_contributions;
DROP TABLE IF EXISTS shared_cart_estimations;
DROP TABLE IF EXISTS cart_contributions;

DO $$
BEGIN
  RAISE NOTICE 'Migration 124 OK — domaine liste partagée réduit au modèle minimal.';
END $$;

COMMIT;
