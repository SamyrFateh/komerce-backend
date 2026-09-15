-- @migration 232_f1_market_integrity_guards_activation.sql
-- @domain    market
-- @purpose   F1-B — activation append-only des guards Market Integrity après
--            live data preflight propre. La candidate historique 229 reste
--            immuable dans migrations/scheduled/ conformément au gate.
--
-- Live audit 2026-09-15 (PR #1530, READ ONLY + ROLLBACK) :
--   total_orders = 0
--   orders_without_relais_id = 0
--   orders_with_orphan_relais_reference = 0
--   orders_without_market_id = 0
--   orders_market_relais_mismatch = 0
--   anomaly drill-down = 0 rows

-- F1.1 — orders.market_id immutable après INSERT
CREATE OR REPLACE FUNCTION prevent_orders_market_id_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'orders_market_id_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_market_id_immutable
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_orders_market_id_mutation();

-- F1.2 — cohérence order.market_id ↔ relais.market_id à l'INSERT et lors
-- d'une réassignation de relais. FOR SHARE ferme la fenêtre TOCTOU.
CREATE OR REPLACE FUNCTION prevent_orders_relais_market_mismatch()
RETURNS trigger AS $$
DECLARE
  new_relais_market_id uuid;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.relais_id IS DISTINCT FROM OLD.relais_id THEN
    SELECT market_id INTO new_relais_market_id
    FROM relais
    WHERE id = NEW.relais_id
    FOR SHARE;

    IF new_relais_market_id IS NULL THEN
      RAISE EXCEPTION 'orders_relais_id_unresolvable';
    END IF;

    IF new_relais_market_id IS DISTINCT FROM NEW.market_id THEN
      RAISE EXCEPTION 'orders_relais_reassignment_cross_market';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_relais_market_consistency
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_orders_relais_market_mismatch();

-- F1.3 — pas de drift silencieux de relais.market_id pour un relais déjà
-- référencé par une commande historique.
CREATE OR REPLACE FUNCTION prevent_referenced_relais_market_drift()
RETURNS trigger AS $$
BEGIN
  IF NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    IF EXISTS (
      SELECT 1 FROM orders WHERE relais_id = OLD.id LIMIT 1
    ) THEN
      RAISE EXCEPTION 'relais_market_id_immutable_once_referenced';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_relais_market_id_drift_guard
  BEFORE UPDATE ON relais
  FOR EACH ROW
  EXECUTE FUNCTION prevent_referenced_relais_market_drift();

COMMENT ON FUNCTION prevent_orders_market_id_mutation() IS
  'F1.1 — orders.market_id est un snapshot commercial historique, jamais resynchronisé.';
COMMENT ON FUNCTION prevent_orders_relais_market_mismatch() IS
  'F1.2 — INSERT/réassignation order.relais_id uniquement vers un relais du même Market que la commande.';
COMMENT ON FUNCTION prevent_referenced_relais_market_drift() IS
  'F1.3 — un relais déjà référencé par une commande ne peut plus changer de Market.';
