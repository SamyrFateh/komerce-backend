-- ============================================================
-- Migration 128 : re-fermeture canonique de order_status
-- Date : septembre 2026
--
-- CONTEXTE :
--   La migration 124 a retiré `pending_group_payment` du domaine Boutique
--   First. Le réparateur legacy `scripts/fix-schema.js` continuait cependant
--   à ré-ajouter cette valeur avant le runner de migrations et au boot.
--   124 étant déjà marquée appliquée, la valeur pouvait donc revenir en
--   production sans être retirée à nouveau.
--
--   Cette migration remet toute base concernée dans le domaine canonique.
--   Elle reprend volontairement la conversion de type éprouvée en 124.
--   Le réparateur legacy est corrigé dans le même lot pour que la valeur ne
--   puisse plus être ressuscitée après cette migration.
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';
SET search_path = public;

DROP VIEW IF EXISTS v_group_orders;

DO $$
DECLARE
  stuck_count INTEGER;
  def_suppliers_stats text;
  def_v_ceremony_orders text;
  def_v_hub_transit text;
  def_v_order_fulfillment text;
  def_v_order_margins text;
  def_v_parcel_reconciliation text;
  def_v_sourcing_pipeline text;
  def_idx_orders_active text;
  def_idx_orders_status_ordered text;
  def_uq_orders_pickup_active text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'pending_group_payment'
  ) THEN
    RAISE NOTICE 'Migration 128 — pending_group_payment déjà absent de order_status, rien à faire.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO stuck_count FROM orders WHERE status = 'pending_group_payment';
  IF stuck_count > 0 THEN
    UPDATE orders SET status = 'pending' WHERE status = 'pending_group_payment';
    RAISE NOTICE 'Migration 128 — % commande(s) pending_group_payment basculée(s) vers pending.', stuck_count;
  END IF;

  def_suppliers_stats         := pg_get_viewdef('suppliers_stats'::regclass, true);
  def_v_ceremony_orders       := pg_get_viewdef('v_ceremony_orders'::regclass, true);
  def_v_hub_transit           := pg_get_viewdef('v_hub_transit'::regclass, true);
  def_v_order_fulfillment     := pg_get_viewdef('v_order_fulfillment'::regclass, true);
  def_v_order_margins         := pg_get_viewdef('v_order_margins'::regclass, true);
  def_v_parcel_reconciliation := pg_get_viewdef('v_parcel_reconciliation'::regclass, true);
  def_v_sourcing_pipeline     := pg_get_viewdef('v_sourcing_pipeline'::regclass, true);

  DROP VIEW suppliers_stats;
  DROP VIEW v_ceremony_orders;
  DROP VIEW v_hub_transit;
  DROP VIEW v_order_fulfillment;
  DROP VIEW v_order_margins;
  DROP VIEW v_parcel_reconciliation;
  DROP VIEW v_sourcing_pipeline;

  def_idx_orders_active         := (SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_orders_active');
  def_idx_orders_status_ordered := (SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_orders_status_ordered');
  def_uq_orders_pickup_active   := (SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_orders_pickup_active');

  DROP INDEX idx_orders_active;
  DROP INDEX idx_orders_status_ordered;
  IF def_uq_orders_pickup_active IS NOT NULL THEN
    DROP INDEX uq_orders_pickup_active;
  END IF;

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

  ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'confirmed'::order_status;

  EXECUTE 'CREATE VIEW suppliers_stats AS ' || def_suppliers_stats;
  EXECUTE 'CREATE VIEW v_ceremony_orders AS ' || def_v_ceremony_orders;
  EXECUTE 'CREATE VIEW v_hub_transit AS ' || def_v_hub_transit;
  EXECUTE 'CREATE VIEW v_order_fulfillment AS ' || def_v_order_fulfillment;
  EXECUTE 'CREATE VIEW v_order_margins AS ' || def_v_order_margins;
  EXECUTE 'CREATE VIEW v_parcel_reconciliation AS ' || def_v_parcel_reconciliation;
  EXECUTE 'CREATE VIEW v_sourcing_pipeline AS ' || def_v_sourcing_pipeline;

  EXECUTE def_idx_orders_active;
  EXECUTE def_idx_orders_status_ordered;
  IF def_uq_orders_pickup_active IS NOT NULL THEN
    EXECUTE def_uq_orders_pickup_active;
  END IF;

  RAISE NOTICE 'Migration 128 OK — order_status re-fermé sans pending_group_payment.';
END $$;
