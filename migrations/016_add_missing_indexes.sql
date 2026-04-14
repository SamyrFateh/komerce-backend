-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 016 — Add Missing Indexes (V1.10)
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- Identified in Deep Analysis:
--   - orders.payment_mode      → filtered in cron H+36, admin, dashboard
--   - orders.payment_status    → filtered in cron, dashboard, payments
--   - orders.status            → filtered EVERYWHERE (every dashboard, every query)
--   - parcels.type             → filtered in backorder reminders, dashboard
--   - parcels.status           → filtered in every parcel query
--   - parcels.order_id         → JOIN key, filtered constantly
--   - sms_log.order_id         → JOIN in order detail views
--   - order_status_history.order_id → JOIN in order detail/tracking
--   - parcel_items.parcel_id   → JOIN in parcel detail views
--   - purchase_orders.order_id → JOIN in purchasing completeness
--   - purchase_orders.supplier_id → JOIN in supplier views
--
-- Safe: CREATE INDEX IF NOT EXISTS → idempotent, no downtime on small tables
-- For large tables: CREATE INDEX CONCURRENTLY (requires outside transaction)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Orders indexes ──────────────────────────────────────────────────────────

-- Critical: filtered by every cron job and dashboard query
CREATE INDEX IF NOT EXISTS idx_orders_status 
  ON orders (status);

CREATE INDEX IF NOT EXISTS idx_orders_payment_mode 
  ON orders (payment_mode);

CREATE INDEX IF NOT EXISTS idx_orders_payment_status 
  ON orders (payment_status);

-- Composite: dashboard date range + status queries
CREATE INDEX IF NOT EXISTS idx_orders_created_status 
  ON orders (created_at DESC, status);

-- Cash pending: cron H+36 targets these specifically
CREATE INDEX IF NOT EXISTS idx_orders_cash_pending 
  ON orders (created_at) 
  WHERE payment_mode = 'cash_relais' AND payment_status = 'pending';

-- Active orders: dashboard "en cours" queries
CREATE INDEX IF NOT EXISTS idx_orders_active 
  ON orders (created_at DESC) 
  WHERE status NOT IN ('collected', 'cancelled');

-- ── Parcels indexes ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_parcels_status 
  ON parcels (status);

CREATE INDEX IF NOT EXISTS idx_parcels_type 
  ON parcels (type);

CREATE INDEX IF NOT EXISTS idx_parcels_order_id 
  ON parcels (order_id);

-- Active parcels by order (frequent lookup in R1 sync)
CREATE INDEX IF NOT EXISTS idx_parcels_order_active 
  ON parcels (order_id, status) 
  WHERE status != 'cancelled';

-- ── Supporting tables indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sms_log_order_id 
  ON sms_log (order_id);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id 
  ON order_status_history (order_id);

CREATE INDEX IF NOT EXISTS idx_parcel_items_parcel_id 
  ON parcel_items (parcel_id);

CREATE INDEX IF NOT EXISTS idx_parcel_events_parcel_id 
  ON parcel_events (parcel_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_id 
  ON purchase_orders (order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id 
  ON purchase_orders (supplier_id);

-- ── Order items — frequent JOINs ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_order_items_order_id 
  ON order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_product_id 
  ON order_items (product_id);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- POST-MIGRATION VERIFY:
--   SELECT indexname, tablename FROM pg_indexes 
--   WHERE indexname LIKE 'idx_%' ORDER BY tablename, indexname;
-- ═══════════════════════════════════════════════════════════════════════════════
