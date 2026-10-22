-- @migration 315_orders_fx_snapshot.sql
-- @domain    orders
-- @purpose   Une seule vérité monétaire de transaction (PR-B, unification monétaire EUR-pivot) :
--            orders.fx_snapshot fige, à la commande, le montant d'origine (base KMF du moteur), le montant confirmé en
--            devise du marché du relais (côté serveur), le montant EUR autorisé et les jambes de taux (parités, observation,
--            peg). Mobile Money, Stripe/PayPal et les remboursements le LISENT ; aucun ne reconvertit au taux du jour.
--            Distinct de display_* (contexte de navigation du client) et de transport_pricing_snapshot (preuve du tarif transport).
--            Immuable une fois posé (fx_snapshot et transport_pricing_snapshot). Nullable : aucune commande historique réelle.
--            Rollback : DROP TRIGGER orders_snapshots_immutable ; DROP FUNCTION ; ALTER TABLE orders DROP COLUMN fx_snapshot.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fx_snapshot JSONB;
COMMENT ON COLUMN orders.fx_snapshot IS
  'Snapshot monétaire immuable de la commande : origine KMF, montant confirmé devise marché, EUR autorisé, jambes FX. Lu, jamais recalculé.';

CREATE OR REPLACE FUNCTION orders_snapshots_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.fx_snapshot IS NOT NULL AND NEW.fx_snapshot IS DISTINCT FROM OLD.fx_snapshot THEN
    RAISE EXCEPTION 'orders.fx_snapshot est immuable une fois posé';
  END IF;
  IF OLD.transport_pricing_snapshot IS NOT NULL AND NEW.transport_pricing_snapshot IS DISTINCT FROM OLD.transport_pricing_snapshot THEN
    RAISE EXCEPTION 'orders.transport_pricing_snapshot est immuable une fois posé';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_snapshots_immutable ON orders;
CREATE TRIGGER orders_snapshots_immutable BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_snapshots_immutable();
