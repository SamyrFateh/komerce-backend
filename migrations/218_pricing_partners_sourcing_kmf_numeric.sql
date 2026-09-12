-- @migration 218_pricing_partners_sourcing_kmf_numeric.sql
-- @domain    commerce, pricing, partners, sourcing
-- @purpose   Chantier currency debt (audit 09-2026), LOT 5 (clôture) — 8
--            colonnes monétaires integer sur 6 tables :
--
--              partners.commission_kmf
--              pricing_strategies.applied_price_kmf
--              pricing_strategy_history.old_price_kmf, new_price_kmf
--              competitor_prices.price_kmf
--              sourcing_candidates.purchase_price_kmf
--              shared_cart_items.unit_price_kmf_snapshot, line_total_kmf_snapshot
--
--            Précision numeric(14,2), cohérente avec LOTs 1a/1b/2/3/4 de ce
--            même chantier.
--
--            Vérifié par lecture du dépôt (routes/services) et grep
--            exhaustif sur "CREATE VIEW"/"TRIGGER" à travers
--            docs/db/railway-live-schema.sql : seul trigger présent sur une
--            de ces tables est trg_partners_updated / trg_sc_updated
--            (set_updated_at, sans rapport avec les colonnes KMF) et
--            trg_pricing_strategy_history (le cas échéant) ne recalcule
--            rien — aucune vue, aucune boucle de soustraction/addition
--            répétée trouvée sur ces colonnes :
--              - partners.commission_kmf : lu en config CRUD admin, écrit
--                une seule fois par mise à jour ;
--              - pricing_strategies.applied_price_kmf,
--                pricing_strategy_history.old/new_price_kmf : snapshots
--                figés à l'écriture, jamais accumulés (à ne pas confondre
--                avec price_history, table distincte, déjà en numeric
--                depuis un lot antérieur) ;
--              - competitor_prices.price_kmf : stocké/lu brut,
--                agrégations (médiane/min/max) recalculées à la volée,
--                jamais ré-additionnées ;
--              - sourcing_candidates.purchase_price_kmf : écrit une fois au
--                scan/import, copié une fois vers products.cost_kmf ;
--              - shared_cart_items.unit_price_kmf_snapshot,
--                line_total_kmf_snapshot : snapshot figé à la création du
--                panier partagé.
--
--            Correctif applicatif nécessaire (hors SQL, dans ce même lot,
--            voir commit suivant) : services/shared-cart-creation.js —
--            createSharedCartFromBasket arrondissait le prix via un helper
--            r(n) = Math.round(...) avant insertion, ce qui aurait écrasé
--            silencieusement les centimes malgré cette migration sur ce
--            chemin de création. Aligné sur createSharedCartFromCartItems
--            (même fichier), qui n'arrondit pas le prix.
--
--            Nettoyage inclus dans ce lot (hors périmètre "type numeric",
--            décision produit) : cart_shares.contributed_kmf. Calcul mort
--            (toujours inséré à 0 dans routes/shares.js, jamais mis à
--            jour), mais colonne encore lue/affichée dans SharedCartsView.js,
--            admin-legacy/ct-views-shared-carts.js, exposée dans le contrat
--            API (scripts/contract-generate.js, contract-check.js) et
--            référencée dans des tests. Colonne supprimée, avec retrait de
--            tous ces usages dans le même lot (voir commits suivants).
--            CHECK constraints existantes sur shared_cart_items (>= 0)
--            conservées telles quelles, compatibles NUMERIC.
--
--            Hors scope, volontairement non touché : price_history
--            (old_price_kmf/new_price_kmf déjà NUMERIC depuis un lot
--            antérieur — table distincte de pricing_strategy_history).

ALTER TABLE partners
  ALTER COLUMN commission_kmf TYPE NUMERIC(14,2);

ALTER TABLE pricing_strategies
  ALTER COLUMN applied_price_kmf TYPE NUMERIC(14,2);

ALTER TABLE pricing_strategy_history
  ALTER COLUMN old_price_kmf TYPE NUMERIC(14,2),
  ALTER COLUMN new_price_kmf TYPE NUMERIC(14,2);

ALTER TABLE competitor_prices
  ALTER COLUMN price_kmf TYPE NUMERIC(14,2);

ALTER TABLE sourcing_candidates
  ALTER COLUMN purchase_price_kmf TYPE NUMERIC(14,2);

ALTER TABLE shared_cart_items
  ALTER COLUMN unit_price_kmf_snapshot TYPE NUMERIC(14,2),
  ALTER COLUMN line_total_kmf_snapshot TYPE NUMERIC(14,2);

-- Nettoyage cart_shares.contributed_kmf (calcul mort, cf. note ci-dessus) :
-- suppression de la colonne plutôt que migration de type.
ALTER TABLE cart_shares
  DROP COLUMN contributed_kmf;
