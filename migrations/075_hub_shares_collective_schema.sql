-- ─────────────────────────────────────────────────────────────────────────────
-- 075_hub_shares_collective_schema.sql
-- Extrait les DDL inline de :
--   routes/hub-dashboard.js   → order_incidents, order_comments
--   routes/shares.js          → cart_shares colonnes v2
--   services/collective-stock-reservation-service.js → collective_stock_reservations
-- ─────────────────────────────────────────────────────────────────────────────

-- ── order_incidents ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_incidents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reporter_id     UUID        REFERENCES users(id),
  reporter_name   TEXT,
  type            TEXT        NOT NULL DEFAULT 'autre'
                              CHECK (type IN ('retard','blocage','paiement','stock',
                                              'colis_endommage','colis_perdu',
                                              'client_absent','autre')),
  description     TEXT,
  priority        TEXT        DEFAULT 'normal'
                              CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT        DEFAULT 'open',
  resolution_note TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID        REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_oi_order  ON order_incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_oi_status ON order_incidents(status);

-- Colonnes ajoutées en migration défensive (idempotent)
ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS priority        TEXT DEFAULT 'normal';
ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS reporter_id     UUID;
ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS reporter_name   TEXT;
ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- ── order_comments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id   UUID        REFERENCES users(id),
  author_name TEXT,
  author_role TEXT,
  text        TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_order ON order_comments(order_id);

ALTER TABLE order_comments ADD COLUMN IF NOT EXISTS author_name TEXT;
ALTER TABLE order_comments ADD COLUMN IF NOT EXISTS author_role TEXT;
ALTER TABLE order_comments ADD COLUMN IF NOT EXISTS text        TEXT DEFAULT '';

-- ── cart_shares v2 colonnes ──────────────────────────────────────────────────
ALTER TABLE cart_shares
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS contributed_kmf INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS type            TEXT DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS event_label     TEXT,
  ADD COLUMN IF NOT EXISTS sharer_name     TEXT;

-- ── collective_stock_reservations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collective_stock_reservations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES collective_workspaces(id) ON DELETE CASCADE,
  product_id     UUID        NOT NULL REFERENCES products(id),
  quantity       INTEGER     NOT NULL CHECK (quantity > 0),
  status         TEXT        NOT NULL DEFAULT 'reserved',
  reserved_until TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at    TIMESTAMPTZ NULL,
  released_at    TIMESTAMPTZ NULL,
  expired_at     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_collective_stock_res_active
  ON collective_stock_reservations(product_id, status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_collective_stock_res_workspace
  ON collective_stock_reservations(workspace_id, status);
