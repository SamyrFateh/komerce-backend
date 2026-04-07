-- ============================================================
-- Migration 018: Schema Reconciliation
-- Date: 7 avril 2026
--
-- Fixes:
--   FIX-002: CREATE TYPE/TABLE IF NOT EXISTS pour parcels, parcel_items, customs_history
--   FIX-003: DISABLE TRIGGER trg_scan_sync_status (conflit avec parcelSync Phase 3)
--   FIX-006: ADD COLUMN scans.parcel_id
--   FIX-008: ADD COLUMNS products.price_eur, products.badge
--
-- NOTE: Utilise IF NOT EXISTS partout car ces objets existent déjà en prod.
--       Cette migration sert à rendre le repo auto-suffisant pour recréer la DB.
-- ============================================================

-- ── FIX-002 : TYPE parcel_status ────────────────────────────────────────────
-- Le DO block gère le cas où le type existe déjà (IF NOT EXISTS n'existe
-- pas pour CREATE TYPE en PostgreSQL < 16).

DO $$ BEGIN
  CREATE TYPE parcel_status AS ENUM (
    'draft',
    'preparation',
    'shipped',
    'in_transit',
    'arrived',
    'available',
    'collected',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── FIX-002 : TABLE parcels ─────────────────────────────────────────────────
-- Colonnes reconstituées à partir du code (hub.js, parcels.js, parcelSync.js,
-- logistics.js, dashboard.js, carriers.js) + migration 015 (customs).

CREATE TABLE IF NOT EXISTS parcels (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference       TEXT          UNIQUE NOT NULL,
  order_id        UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipment_id     UUID          REFERENCES shipments(id),
  status          parcel_status NOT NULL DEFAULT 'draft',
  type            TEXT          NOT NULL DEFAULT 'standard'
                                CHECK (type IN ('standard', 'partial', 'backorder', 'awaiting_stock')),
  notes           TEXT,

  -- Timestamps logistiques (remplis par parcelSync.js)
  prepared_at     TIMESTAMPTZ,
  shipped_at      TIMESTAMPTZ,
  in_transit_at   TIMESTAMPTZ,
  available_at    TIMESTAMPTZ,
  collected_at    TIMESTAMPTZ,

  -- Customs (miroir de migration 015 — inclus ici pour setup from scratch)
  customs_value_kmf  NUMERIC(12,2),
  customs_weight_kg  NUMERIC(8,3),
  customs_hs_code    VARCHAR(20),
  customs_cleared_at TIMESTAMPTZ,
  customs_notes      TEXT,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── FIX-002 : TABLE parcel_items ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parcel_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id       UUID          NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  order_item_id   UUID          NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity        INTEGER       NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── FIX-002 : TABLE customs_history ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customs_history (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id             UUID          REFERENCES parcels(id) ON DELETE CASCADE,
  customs_estimated_kmf NUMERIC(12,2),
  customs_real_kmf      NUMERIC(12,2),
  customs_agent_id      UUID          REFERENCES users(id),
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── FIX-003 : Désactiver le trigger legacy ──────────────────────────────────
-- parcelSync.js Phase 3 est la SOURCE DE VÉRITÉ pour orders.status.
-- Le trigger trg_scan_sync_status entre en conflit (double écriture).
-- La fonction sync_order_status_from_scan() reste dans schema.sql pour
-- référence mais le trigger est désactivé.

ALTER TABLE scans DISABLE TRIGGER trg_scan_sync_status;

-- ── FIX-006 : scans.parcel_id ───────────────────────────────────────────────
-- parcelSync.js étape 3 lie le scan au parcel via UPDATE scans SET parcel_id = $1

ALTER TABLE scans ADD COLUMN IF NOT EXISTS parcel_id UUID REFERENCES parcels(id);
CREATE INDEX IF NOT EXISTS idx_scans_parcel_id ON scans(parcel_id);

-- ── FIX-008 : products.price_eur + products.badge ───────────────────────────
-- Utilisés par seedProducts() dans server.js

ALTER TABLE products ADD COLUMN IF NOT EXISTS price_eur NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge TEXT;

-- ── Trigger updated_at pour parcels ─────────────────────────────────────────
-- Cohérent avec les autres tables (users, products, orders, shipments, disputes)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parcels_updated') THEN
    CREATE TRIGGER trg_parcels_updated
      BEFORE UPDATE ON parcels
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- FIN migration 018
-- ============================================================
