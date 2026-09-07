-- ============================================================
-- 169 — Product market price decision events
-- ============================================================
-- Objet :
--   Permettre à un marché de décider le prix local d'un produit global sans
--   dupliquer le catalogue ni muter products.price_kmf.
--
-- Invariants :
--   - produit global, décision de prix market-scoped ;
--   - append-only : SET et RESET sont des événements, jamais des UPDATE ;
--   - le prix local et la devise sont résolus/enregistrés côté serveur ;
--   - un SET conserve les frontières économiques KMF qui ont gouverné la décision ;
--   - une position UNDER_CDR est toujours bornée dans le temps ;
--   - RESET restaure l'héritage du prix global sans effacer l'historique.

CREATE TABLE IF NOT EXISTS product_market_price_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,

  decision_type TEXT NOT NULL
    CHECK (decision_type IN ('SET', 'RESET')),

  local_price NUMERIC(18,4) NULL,
  local_currency TEXT NULL,
  price_kmf_snapshot NUMERIC(18,2) NULL,
  variable_cost_kmf_snapshot NUMERIC(18,2) NULL,
  cdr_kmf_snapshot NUMERIC(18,2) NULL,
  strategy_position TEXT NULL
    CHECK (strategy_position IS NULL OR strategy_position IN ('COVERED', 'UNDER_CDR')),
  valid_until TIMESTAMPTZ NULL,

  rationale TEXT NOT NULL
    CHECK (char_length(btrim(rationale)) BETWEEN 10 AND 2000),
  decision_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT product_market_price_set_payload_check CHECK (
    (decision_type = 'SET'
      AND local_price IS NOT NULL AND local_price > 0
      AND local_currency IS NOT NULL AND char_length(local_currency) = 3
      AND price_kmf_snapshot IS NOT NULL AND price_kmf_snapshot > 0
      AND variable_cost_kmf_snapshot IS NOT NULL AND variable_cost_kmf_snapshot >= 0
      AND cdr_kmf_snapshot IS NOT NULL AND cdr_kmf_snapshot >= variable_cost_kmf_snapshot
      AND price_kmf_snapshot > variable_cost_kmf_snapshot
      AND strategy_position IS NOT NULL)
    OR
    (decision_type = 'RESET'
      AND local_price IS NULL
      AND local_currency IS NULL
      AND price_kmf_snapshot IS NULL
      AND variable_cost_kmf_snapshot IS NULL
      AND cdr_kmf_snapshot IS NULL
      AND strategy_position IS NULL
      AND valid_until IS NULL)
  ),
  CONSTRAINT product_market_price_under_cdr_expiry_check CHECK (
    strategy_position IS DISTINCT FROM 'UNDER_CDR' OR valid_until IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_product_market_price_decision_latest
  ON product_market_price_decision_events
  (market_id, product_id, recorded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_product_market_price_decision_market
  ON product_market_price_decision_events
  (market_id, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_product_market_price_decision_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'product_market_price_decision_events is append-only; record a new decision event instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_product_market_price_decision_mutation
  ON product_market_price_decision_events;
CREATE TRIGGER trg_prevent_product_market_price_decision_mutation
BEFORE UPDATE OR DELETE ON product_market_price_decision_events
FOR EACH ROW EXECUTE FUNCTION prevent_product_market_price_decision_mutation();

COMMENT ON TABLE product_market_price_decision_events IS
  'Décisions append-only de prix produit par marché. products.price_kmf reste le prix global et n est jamais muté par cette table.';
COMMENT ON COLUMN product_market_price_decision_events.price_kmf_snapshot IS
  'Projection KMF du prix local au moment de la décision, utilisée pour vérifier coût variable et CDR.';
COMMENT ON COLUMN product_market_price_decision_events.decision_snapshot IS
  'Snapshot compact du gate/policy ayant autorisé une position UNDER_CDR ; aucun identifiant de commande interne.';
