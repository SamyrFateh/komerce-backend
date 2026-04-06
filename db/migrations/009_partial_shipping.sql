-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 009 — Phase 4 : Expédition Partielle (Hub Dubai)
--
-- Tables : sub_orders, sub_order_items
-- Colonnes ajoutées : order_items.availability_status, estimated_available_at, backorder_reason, updated_at
-- Règles métier : PARTIAL_SHIP_* dans business_rules
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Nouvelles colonnes order_items ──────────────────────────────────────────

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS estimated_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backorder_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Table sub_orders ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sub_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL CHECK (type IN ('partial_ship', 'backorder')),
  status                  TEXT NOT NULL DEFAULT 'preparation'
                          CHECK (status IN ('preparation', 'shipped', 'in_transit', 'available', 'collected', 'cancelled')),
  tracking_ref            TEXT UNIQUE,
  estimated_date          TIMESTAMPTZ,
  shipped_at              TIMESTAMPTZ,
  cancel_reason           TEXT,
  notes                   TEXT,
  created_by              UUID REFERENCES users(id),
  backorder_reminder_sent BOOLEAN DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_orders_parent ON sub_orders(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_status ON sub_orders(status);
CREATE INDEX IF NOT EXISTS idx_sub_orders_type   ON sub_orders(type);

-- ── Table sub_order_items ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sub_order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_order_id  UUID NOT NULL REFERENCES sub_orders(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  product_id    UUID NOT NULL REFERENCES products(id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  price_kmf     NUMERIC NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_order_items_sub ON sub_order_items(sub_order_id);

-- ── Règles métier Phase 4 ──────────────────────────────────────────────────

INSERT INTO business_rules (category, key, value, type, label, description, min_value, max_value)
VALUES
  ('shipping', 'PARTIAL_SHIP_DELAY_THRESHOLD_DAYS', '{"value": 7}', 'number', 'Délai min expédition partielle (jours)', 'Nombre de jours minimum après la commande avant de pouvoir créer une expédition partielle', 1, 30),
  ('shipping', 'PARTIAL_SHIP_MIN_AVAILABLE_PCT', '{"value": 30}', 'number', 'Seuil min disponibilité (%)', 'Pourcentage minimum d''articles disponibles pour autoriser l''expédition partielle', 10, 90),
  ('shipping', 'PARTIAL_SHIP_AUTO_NOTIFY', '{"value": true}', 'boolean', 'SMS auto expédition partielle', 'Envoyer automatiquement un SMS au client lors de la création d''une expédition partielle', NULL, NULL)
ON CONFLICT (key) DO NOTHING;

-- Note : BACKORDER_MAX_DAYS existe déjà (migration 007/008)

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN Migration 009
-- ═══════════════════════════════════════════════════════════════════════════════
