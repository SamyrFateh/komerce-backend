-- @migration 202_catalog_product_market_exposure.sql
-- @domain    catalog
-- @purpose   Primitive produit x marché — un partenaire pays décide quels
--            produits du catalogue global sont commercialisés sur son
--            Market ID. Le catalogue reste unique (products, propriété
--            catalog) ; cette table n'est qu'une projection d'exposition,
--            même patron que commercial_exposure sur physical_offers et
--            services (DOCTRINE_TRANSPORT_RAILS.md : "connu ≠ commercialisé").
--            Absence de ligne = DISABLED (fail-closed, rien n'est exposé
--            par défaut sur un nouveau marché).

CREATE TABLE IF NOT EXISTS product_market_exposure (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id          UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  commercial_exposure TEXT NOT NULL DEFAULT 'DISABLED'
                       CHECK (commercial_exposure IN ('DISABLED', 'ENABLED')),
  decided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_product_market_exposure_market
  ON product_market_exposure (market_id)
  WHERE commercial_exposure = 'ENABLED';

COMMENT ON TABLE product_market_exposure IS
  'Exposition commerciale d''un produit du catalogue global sur un Market ID donné. Le catalogue (products) reste unique et propriété de catalog. Absence de ligne = DISABLED. Écrite exclusivement via services/catalog-market-exposure-service.js (catalog, lifecycle owner) ; market-delegation (capability catalog.expose) délègue, jamais de SQL direct — writer_not_owner_boundary.';

-- catalog.expose reste MISSING volontairement, malgré l'écriture fonctionnelle
-- (services/market-delegation-catalog-service.js, routes/market-delegation-
-- catalog.js, testés). La table démarre à zéro ligne pour tous les marchés :
-- câbler le fail-closed (absence = DISABLED) dans le chemin de lecture
-- storefront masquerait instantanément tout le catalogue existant sur tous
-- les marchés déjà actifs, faute de backfill fiable (aucune donnée
-- historique ne dit "quel produit vend déjà où"). Le lien de lecture
-- (catalog-public-view.js / catalog-product-detail.js) est délibérément
-- non câblé dans ce lot — décision produit requise sur la stratégie de
-- backfill avant d'activer le fail-closed en production. Voir feature card
-- market-delegation, section perimeter/rationale.
