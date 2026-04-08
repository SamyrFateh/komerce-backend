-- ════════════════════════════════════════════════════════════════
-- KOMERCE — Migration 020 : Enrichissement schéma optimisation colis
-- Date : 2026-04-08
-- Idempotente : IF NOT EXISTS / IF NOT EXISTS partout
-- ════════════════════════════════════════════════════════════════

-- ── A. Colonnes manquantes sur parcels ───────────────────────────
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS label              TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS relais_id          UUID REFERENCES relais(id);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_code        TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS weight_kg          NUMERIC(6,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS volume_cm3         NUMERIC(10,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS shipping_session_id UUID;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS arrived_at         TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ;

-- ── B. product_id sur parcel_items (traçabilité directe) ─────────
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);

-- ── C. Attributs produits pour le moteur d'optimisation ──────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_cm3          NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS category            TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_fragile          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bulky            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compatibility_group TEXT;

-- ── D. Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parcels_relais_id       ON parcels(relais_id);
CREATE INDEX IF NOT EXISTS idx_products_category       ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_fragile_bulky  ON products(is_fragile, is_bulky);
