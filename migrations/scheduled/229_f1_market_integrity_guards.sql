-- @migration 229_f1_market_integrity_guards.sql
-- @domain    market
-- @purpose   F1 — Market Integrity / Immutable Order Market. Rend impossible
--            au niveau DB qu'une commande change silencieusement de Market
--            après sa création, qu'une commande soit créée avec un relais
--            d'un autre Market, ou qu'un changement de relais / déplacement
--            de relais contredise le snapshot historique orders.market_id.
--
--            CANDIDATE F1-A — NE PAS ACTIVER AVANT :
--              LIVE DATA AUDIT = ZERO ANOMALIE INEXPLIQUÉE
--            Voir scripts/audit-f1-market-integrity.sql.
--
--            Ce fichier vit volontairement dans migrations/scheduled/ :
--            scripts/run-migrations.js ne scanne pas ce sous-dossier.
--            F1-B consistera à le déplacer vers migrations/229_...sql après
--            validation du live data preflight.

-- ═══════════════════════════════════════════════════════════════════════
-- F1.1 — orders.market_id immutable après INSERT
-- ═══════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════
-- F1.2 — cohérence order.market_id ↔ relais.market_id à l'INSERT et lors
--         d'une réassignation de relais
-- ═══════════════════════════════════════════════════════════════════════
--
-- La vérification s'applique aussi à INSERT : l'absence de writer runtime
-- aujourd'hui ne doit pas permettre à un script/admin SQL futur de créer un
-- mismatch dès l'origine.
--
-- SELECT ... FOR SHARE ferme la fenêtre TOCTOU contre un changement concurrent
-- de relais.market_id.

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

-- ═══════════════════════════════════════════════════════════════════════
-- F1.3 — pas de drift silencieux de relais.market_id pour un relais déjà
--         référencé par une commande historique
-- ═══════════════════════════════════════════════════════════════════════

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
