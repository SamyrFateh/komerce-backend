-- @migration 206_catalog_product_market_exposure_snapshot.sql
-- @domain    catalog
-- @purpose   Snapshot de compatibilité pour le cutover catalog.expose. Écrit
--            en ENABLED, pour chaque marché actif, exactement l'ensemble des
--            produits que la vérité storefront actuelle considère déjà
--            visibles — reproduction fidèle de
--            services/catalog-public-view.js::publicCatalogVisibilitySql(),
--            pas un "all products x all markets" aveugle. Le marché ne joue
--            aujourd'hui aucun rôle dans la visibilité (seulement dans le
--            prix, via market-local-price-resolution-service.js) : chaque
--            marché actif reçoit donc le même ensemble de produits déjà
--            publics, ce qui EST la vérité actuelle du storefront.
--
--            Après ce snapshot, migration 207 câble product_market_exposure
--            comme fail-closed dans le chemin de lecture : tout produit ou
--            marché créé APRÈS ce snapshot démarre DISABLED et attend une
--            décision opérateur explicite (capability catalog.expose).
--
--            Prédicat reproduit ligne à ligne depuis catalog-public-view.js :
--              p.is_active = TRUE
--              AND p.product_ref NOT LIKE 'SHOWCASE-V2-%'
--              AND NULLIF(BTRIM(p.image_url), '') IS NOT NULL
--              AND p.image_url NOT ILIKE 'data:image/%'
--            Toute dérive entre les deux doit être traitée comme un bug —
--            voir tests/unit/catalog-market-exposure-snapshot.test.js qui
--            verrouille cette équivalence caractère pour caractère.

INSERT INTO product_market_exposure (product_id, market_id, commercial_exposure, decided_by, decided_at)
SELECT p.id, m.id, 'ENABLED', NULL, NOW()
  FROM products p
  CROSS JOIN markets m
 WHERE m.is_active = TRUE
   AND p.is_active = TRUE
   AND p.product_ref NOT LIKE 'SHOWCASE-V2-%'
   AND NULLIF(BTRIM(p.image_url), '') IS NOT NULL
   AND p.image_url NOT ILIKE 'data:image/%'
ON CONFLICT (product_id, market_id) DO NOTHING;
