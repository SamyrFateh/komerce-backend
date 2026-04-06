-- ============================================================
-- Migration 006 — Colonnes Dashboard & Marges
-- ============================================================
-- Ces colonnes sont référencées dans le code (admin.js, dashboard.js)
-- mais n'étaient pas dans schema.sql (ajoutées via Supabase manuellement).
-- Cette migration les officialise dans le repo.
-- ============================================================

-- ── Colonnes marges réelles (renseignées après groupage/facturation) ────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_estimated_kmf   INTEGER       DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_real_kmf        INTEGER       DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_delta_pct       NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS margin_estimated_pct NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS margin_real_pct      NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS margin_alert         BOOLEAN       DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sourcing_blocked     BOOLEAN       DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_closed_at       TIMESTAMPTZ;

-- ── Colonnes confection sur-mesure ──────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confection_type         TEXT    DEFAULT 'aucun';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confection_instructions TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confection_delay_days   INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_occasion          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparation_at          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS purchasing_at           TIMESTAMPTZ;

-- ── Colonnes produits (pricing) ─────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_eur   NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge       TEXT;

-- ── Index dashboard performance ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_created_at        ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_margin_alert      ON orders(margin_alert) WHERE margin_alert = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_sourcing_blocked  ON orders(sourcing_blocked) WHERE sourcing_blocked = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_status_active     ON orders(status) WHERE status NOT IN ('collected','cancelled');
