-- Migration 071 — Tables relay dashboard : incidents et commentaires
-- ═══════════════════════════════════════════════════════════════════════
-- A-BE-18 : `ensureRelayTables()` était appelée au chargement du module
-- `routes/relay-dashboard.js` (CREATE TABLE IF NOT EXISTS au runtime).
-- Ces tables sont maintenant versionnées ici.
--
-- Tables créées :
--   order_incidents  — incidents signalés par les agents relais sur une commande
--   order_comments   — commentaires terrain sur une commande
--
-- Idempotent : IF NOT EXISTS sur les CREATE TABLE et CREATE INDEX.
-- Peut être rejoué sans risque sur un environnement qui a déjà les tables
-- (ex: Railway où ensureRelayTables() les a déjà créées au runtime).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS order_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reporter_id     UUID REFERENCES users(id),
  reporter_name   TEXT,
  type            TEXT NOT NULL CHECK (type IN (
                    'retard','blocage','paiement','stock',
                    'colis_endommage','colis_perdu','client_absent','autre'
                  )),
  description     TEXT,
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id),
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS order_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id),
  author_name TEXT,
  author_role TEXT,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index lecture rapide par commande et par statut incident
CREATE INDEX IF NOT EXISTS idx_incidents_order  ON order_incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON order_incidents(status);
CREATE INDEX IF NOT EXISTS idx_comments_order   ON order_comments(order_id);
