-- @migration 229_f1_market_integrity_guards.sql
-- @domain    market
-- @purpose   F1 — Market Integrity / Immutable Order Market. Rend impossible
--            au niveau DB qu'une commande change silencieusement de Market
--            après sa création (doctrine M1c : orders.market_id est un
--            SNAPSHOT historique, jamais une valeur resynchronisée), et
--            qu'un changement de relais ou un déplacement de relais
--            contredise ce snapshot.
--
--            CANDIDATE — ne pas déployer avant :
--              LIVE DATA AUDIT = ZERO ANOMALIE INEXPLIQUÉE
--            (voir scripts/audit-f1-market-integrity.sql). Voir
--            RECOMMENDED PR SPLIT (F1-A / F1-B) dans la remontée d'audit.
--
--            Facts found (2026-09, vérifiés sur main réel) :
--              - orders.relais_id : NOT NULL, FK orders_relais_id_fkey sans
--                ON DELETE (db/schema.sql:2028, :8433).
--              - relais.market_id : NOT NULL depuis 137_relais_market_id.sql.
--              - orders.market_id : NOT NULL depuis 138_orders_market_id.sql,
--                snapshot résolu depuis relais.market_id (backfill +, côté
--                application, order-checkout-service.js resout
--                `relais.market_id` au moment de la commande).
--              - AUCUN writer runtime de orders.market_id trouvé dans le
--                repo (confirmé par le grep de cette revue ET par
--                scripts/lib/hub-authority.js §F4-B, qui protège déjà cette
--                colonne contre le domaine logistics au niveau applicatif).
--              - AUCUN writer runtime de orders.relais_id trouvé (même
--                constat documenté explicitement dans hub-authority.js :
--                "relais_id : autorité Orders — aucune écriture existante
--                nulle part dans le repo").
--              - AUCUN writer runtime de relais.market_id post-création
--                trouvé : relais-mutation-service.js#updateRelais et
--                #setRelaisActive excluent explicitement market_id de leur
--                SET ; market_id n'est posé qu'une fois, à l'INSERT, dans
--                #createRelais.
--            Autrement dit : ces trois invariants sont aujourd'hui déjà
--            vrais EN PRATIQUE (aucun code ne les viole). Ce lot les rend
--            vrais PAR CONSTRUCTION (DB), pour qu'aucune régression future
--            — bug, script one-off, accès direct psql — ne puisse les casser
--            silencieusement.

-- ═══════════════════════════════════════════════════════════════════════
-- F1.1 — orders.market_id immutable après INSERT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Toute correction exceptionnelle de données historiques doit passer par
-- une migration/admin-repair explicitement versionnée (SET LOCAL sur une
-- session admin dédiée, ou colonne temporairement rendue mutable dans une
-- migration dédiée puis re-verrouillée) — jamais par la voie runtime
-- normale. Ce trigger ne prévoit aucun bypass applicatif.

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
-- F1.2 — changement de orders.relais_id uniquement à l'intérieur du même
--         Market (le Market de la commande, pas du nouveau relais)
-- ═══════════════════════════════════════════════════════════════════════
--
-- La contrainte DB garantit uniquement la cohérence Market. Elle ne décide
-- pas si un changement de relais est métier autorisé dans toutes les
-- circonstances (ex. relais fermé, réassignation hors fenêtre) — ça reste
-- la responsabilité de la couche applicative / orders.
--
-- Résolution du nouveau relais AVANT comparaison : SELECT ... FOR SHARE
-- pour fermer la fenêtre TOCTOU décrite dans l'analyse de concurrence
-- (une TX qui déplacerait relais.market_id en parallèle doit être bloquée
-- ou voir son propre changement rejeté par F1.3, pas produire un état
-- incohérent côté orders).

CREATE OR REPLACE FUNCTION prevent_orders_relais_market_mismatch()
RETURNS trigger AS $$
DECLARE
  new_relais_market_id uuid;
BEGIN
  IF NEW.relais_id IS DISTINCT FROM OLD.relais_id THEN
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
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_orders_relais_market_mismatch();

-- Note d'ordonnancement : Postgres déclenche les triggers BEFORE UPDATE
-- par ordre alphabétique de nom. "trg_orders_market_id_immutable" précède
-- "trg_orders_relais_market_consistency" précède "trg_orders_updated"
-- (existant, set_updated_at). Sans incidence ici : les deux nouveaux
-- triggers RAISE EXCEPTION indépendamment l'un de l'autre et n'écrivent
-- aucune colonne partagée avec trg_orders_updated.

-- ═══════════════════════════════════════════════════════════════════════
-- F1.3 — pas de drift silencieux de relais.market_id pour un relais déjà
--         référencé par une commande historique
-- ═══════════════════════════════════════════════════════════════════════
--
-- Le déplacement réel d'un relais d'un Market vers un autre doit devenir
-- soit une nouvelle identité de relais (créer un nouveau relais dans le
-- Market cible, désactiver l'ancien via setRelaisActive), soit une
-- migration exceptionnelle explicite. Jamais une mutation runtime directe.
--
-- EXISTS ... LIMIT 1 est volontairement une simple vérification
-- d'existence (pas de verrou de plage) : voir l'analyse de concurrence
-- ci-dessous sur pourquoi ceci suffit combiné à F1.2.

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
  'F1.1 — orders.market_id est un snapshot commercial historique (doctrine '
  'M1c), jamais resynchronisé. Voir migrations/229_f1_market_integrity_guards.sql.';
COMMENT ON FUNCTION prevent_orders_relais_market_mismatch() IS
  'F1.2 — une réassignation de orders.relais_id ne peut viser qu''un relais '
  'du même Market que la commande. Voir migrations/229_f1_market_integrity_guards.sql.';
COMMENT ON FUNCTION prevent_referenced_relais_market_drift() IS
  'F1.3 — un relais déjà référencé par au moins une commande ne peut plus '
  'changer de Market (identité figée). Voir migrations/229_f1_market_integrity_guards.sql.';
