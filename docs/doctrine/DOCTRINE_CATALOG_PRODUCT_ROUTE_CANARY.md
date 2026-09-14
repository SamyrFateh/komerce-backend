# Doctrine — Catalog Product Route Canary V1

## Objet

Le canary éprouve en lecture la projection canonique Product sur `GET /api/products/:id` sans déplacer l'autorité commerciale du catalogue historique.

## Invariants

- Triple gate obligatoire : feature flag actif, header interne `x-komerce-catalog-canary: v1`, puis `product_id` explicitement allowlisté.
- La visibilité historique via `publicCatalogVisibilitySql()` est évaluée avant tout lookup canary. Une row invisible produit un 404 sans lecture sourcing.
- Aucune requête DB additionnelle attribuable au canary lorsque l'un des trois gates est fermé.
- Le lot est strictement read-only : aucune écriture, aucune publication et aucun appel fournisseur.
- Tout échec ou état non sûr sert strictement la row legacy.
- Aucun changement public ou économique : prix, stock, devise, MOQ, freight, délai, sellable unit et Supplier Order Identity restent hors autorité du Product canonique.
- Aucun rollout global et aucune modification Railway dans ce lot.

## Frontière Catalog ↔ Sourcing

Catalog appelle uniquement `findCanonicalProductIdsForCatalogProduct(productId, query)`. Le SQL de linkage et le schéma Resolution restent owned by sourcing. La requête est ciblée sur un seul `product_id`, sans scan corpus.

Cardinalité : zéro lien retourne `[]`; un lien retourne son ID; plusieurs liens retournent tous les IDs, sans arbitrage.

## Seam V1

`applyCanonicalSourceReadSeam(legacyRow, projectedProduct)` est l'unique logique de substitution :

| Product canonique | Champ legacy |
|---|---|
| `product_name` | `name_source` |
| `description` | `description_source` |
| `source_locale` | `source_locale` |

`CONSENSUS` applique la valeur canonique. `CONFLICT_PRESERVED` et `ABSENT` conservent le champ legacy. Une absence n'annule pas les autres consensus applicables.

## Diagnostics internes

- `canonical_applied` : au moins un champ consensus appliqué, sans conflit ; `absent_fallbacks` peut être positif.
- `legacy_no_link` : aucune relation Product → Canonical Product.
- `legacy_no_projection` : lien unique mais aucune projection, ou projection sans valeur exploitable.
- `legacy_conflict` : projection sûre et hybride, avec au moins un fallback de conflit.
- `legacy_ambiguity` : plusieurs Canonical Products liés ; aucun arbitrage.
- `legacy_unsafe` : la seam n'est pas SAFE ; legacy strict.
- `legacy_canary_error` : exception interne absorbée ; legacy strict.

Chaque diagnostic conserve `canonical_fields_applied`, `conflict_fallbacks` et `absent_fallbacks`. Il n'est jamais inclus dans le JSON Boutique.
