# Doctrine — Catalog Product Read Authority

## Trajectoire

`Shadow → Comparison → Read Seam → Route Canary → Canonical Preferred → retrait legacy futur`.

Cette trajectoire est progressive et réversible. **Canonical Preferred n'est pas Canonical Mandatory** : le catalogue historique reste le fallback de sécurité tant que sa retraite n'a pas fait l'objet d'un lot et d'une preuve distincts.

## Autorité de lecture

`services/catalog-product-source-read-service.js` centralise le choix du mode :

- `LEGACY_ONLY` : historique strict, aucune lecture canonique supplémentaire ;
- `CANARY` : triple gate V1 — mode, feature flag, header interne et product allowlist ;
- `CANONICAL_PREFERRED` : tentative canonique ciblée pour toute row déjà déclarée visible, avec fallback legacy systématique.

Mode absent, vide ou invalide : `LEGACY_ONLY`.

## Ordre invariant de la route

`legacy DB read → visibility gate → 404 → Product Source Read Service → market pricing → variants → toPublicProduct()`.

Le service ne doit jamais être appelé avant le verdict de visibilité. La route liste n'est pas concernée.

## Frontières

Catalog consomme seulement les APIs internes owned by sourcing :

- `findCanonicalProductIdsForCatalogProduct(productId, query)` ;
- `collectCanonicalProductProjectionById(canonicalProductId, query)` ;
- `applyCanonicalSourceReadSeam(legacyRow, projectedProduct)`.

Aucun SQL Resolution ne peut être dupliqué dans Catalog.

## Périmètre Product V1

Seuls `product_name → name_source`, `description → description_source` et `source_locale → source_locale` peuvent être substitués.

Prix, stock, devise, médias, variants, SKU, Offer, Unit, SOI, exposition et publication restent hors autorité canonique.

## Sécurité du contrat public

Une row hybride n'est retenue que si la seam est `SAFE` et prouve :

`toPublicProduct(legacy) === toPublicProduct(hybrid)`.

Toute différence, ambiguïté, absence de lien/projection ou exception retourne la row legacy. Aucune erreur canonique ne devient une erreur Boutique et aucun diagnostic n'entre dans le JSON public.

## Diagnostics internes

`canonical_applied`, `legacy_mode`, `legacy_no_link`, `legacy_no_projection`, `legacy_conflict`, `legacy_ambiguity`, `legacy_unsafe`, `legacy_read_error`.

Les diagnostics peuvent conserver `canonical_product_id`, `canonical_fields_applied`, `conflict_fallbacks` et `absent_fallbacks`.

## Coût DB

- `LEGACY_ONLY` : zéro requête additionnelle ;
- `CANARY` gates fermés : zéro requête additionnelle ;
- `CANONICAL_PREFERRED` : une requête de linkage ciblée ; si lien unique, deux requêtes ciblées de projection (observations puis evidence), soit trois requêtes additionnelles au maximum.
