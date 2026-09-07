-- ============================================================
-- 165 — Pricing maturity disposition events
-- ============================================================
-- Objet :
--   Journal append-only des décisions humaines qui disposent une commande
--   définitivement irréconciliable, sans transformer cette disposition en
--   maturité économique réelle.
--
-- Invariants :
--   - 2 états uniquement : RECONCILIABLE / IRRECONCILABLE_DISPOSED ;
--   - chaque transition porte motif, justification, preuve, auteur et date ;
--   - market_id est figé depuis orders côté service, jamais fourni par le client ;
--   - le taux de dispositions et son plafond restent évalués par le moteur de
--     maturité à partir d'une politique externe, jamais d'un seuil SQL caché ;
--   - aucune UPDATE/DELETE applicative : l'état courant est le dernier événement.

CREATE TABLE IF NOT EXISTS pricing_maturity_disposition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('RECONCILIABLE', 'IRRECONCILABLE_DISPOSED')),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  rationale TEXT NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 10 AND 2000),
  evidence_ref TEXT NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  decided_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_maturity_disposition_order_time
  ON pricing_maturity_disposition_events (order_id, decided_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_maturity_disposition_market_time
  ON pricing_maturity_disposition_events (market_id, decided_at DESC, id DESC);

COMMENT ON TABLE pricing_maturity_disposition_events IS
  'Journal append-only des transitions de disposition de maturité économique.';
COMMENT ON COLUMN pricing_maturity_disposition_events.state IS
  'RECONCILIABLE ou IRRECONCILABLE_DISPOSED ; le dernier événement fait foi.';
COMMENT ON COLUMN pricing_maturity_disposition_events.evidence_ref IS
  'Référence obligatoire vers la preuve ayant motivé la transition.';
