# LOT 4C — Catalogue Workspace Canonical

## Mission

Le Catalogue Workspace est la surface d’action centrale pour le catalogue commun Komerce :

- produits ;
- taxonomie boutique ;
- file de validation humaine.

La doctrine reste :

> Dashboard observe. Workspace agit. Entity 360 explique.

`Product 360` reste la surface de compréhension détaillée d’un produit. Le Workspace ne le duplique pas.

## Surface stable

- HTML : `GET /admin/workspaces/catalog`
- alias build : `/admin-next/workspaces/catalog`
- API : `/api/admin/workspaces/catalog`

Legacy reste disponible pendant la preuve :

- `/admin/products`
- `/admin/categories`
- `/admin/catalog-approval`

Aucun cutover destructif dans LOT 4C.

## Catalogue global, pas market-scoped

Le catalogue produit et la taxonomie sont communs aux marchés. LOT 4C n’invente donc aucun `market_id` sur `products` ou `boutique_categories`.

Le Workspace refuse explicitement `market_id`, `marketId`, `market_code` et `marketCode` envoyés par le navigateur.

Une autorité globale n’est cependant **jamais** déduite du rôle `admin`.

Migration `147_catalog_global_access_grants.sql` crée une autorité catalogue persistée et révocable. Le bootstrap initial copie les grants dashboard globaux actifs vers des grants catalogue explicites ; après migration, seule `catalog_global_access_grants` fait foi.

Un admin partenaire pays peut donc administrer ses opérations sans obtenir le droit de modifier le catalogue commun.

## Autorités métier réutilisées

### Produits

Canonical délègue à `services/product-admin-service.js` :

- création ;
- mise à jour ;
- désactivation.

Le navigateur manipule `product_ref`. Le serveur résout l’UUID interne avant délégation.

`product_ref` n’est pas modifiable depuis le Workspace Canonical.

### Validation humaine

Canonical délègue à `services/catalog-approval.js` :

- approve ;
- reject ;
- override + approve.

Le navigateur utilise encore `product_ref`, jamais l’UUID produit.

### Taxonomie

LOT 4C extrait les mutations de `routes/admin-boutique-categories.js` dans `services/boutique-taxonomy-admin.js`.

Legacy et Canonical utilisent donc la **même** autorité pour :

- création / modification / désactivation catégorie ;
- création / modification / désactivation sous-catégorie ;
- invalidation du cache catégories.

Canonical n’expose pas le hard-delete de sous-catégorie.

## Projection de lecture

`GET /api/admin/workspaces/catalog`

```json
{
  "scope": { "mode": "global_catalog" },
  "summary": {},
  "categories": [],
  "products": [],
  "approval": []
}
```

Aucun UUID produit, catégorie ou marché n’est exposé dans cette projection.

### Summary

- `total_products`
- `active_products`
- `inactive_products`
- `approval_pending`
- `needs_review`
- `categories`

## Routes d’action

### Produit

- `POST /products`
- `POST /products/:productRef/update`
- `POST /products/:productRef/deactivate`

### Validation

- `POST /approval/:productRef/approve`
- `POST /approval/:productRef/reject`
- `POST /approval/:productRef/override`

### Taxonomie

- `POST /categories`
- `POST /categories/:key/update`
- `POST /categories/:key/deactivate`
- `POST /categories/:key/subcategories`
- `POST /categories/:key/subcategories/:subKey/update`
- `POST /categories/:key/subcategories/:subKey/deactivate`

Toutes exigent :

1. session authentifiée ;
2. rôle `admin` ;
3. grant `catalog_global_access_grants` actif.

## Browser invariants

Le module Canonical :

- appelle uniquement `/api/admin/workspaces/catalog...` ;
- n’appelle pas `/api/products` ;
- n’appelle pas `/api/admin/boutique-categories` ;
- n’appelle pas `/api/admin/catalog/approval-queue` ;
- n’importe pas `ProductsView`, `CategoriesView`, `CatalogApprovalView` ou `ApiClient` ;
- ne transmet aucun UUID ;
- ne recalcule ni règles de publication, ni validation taxonomique, ni overrides ;
- recharge la projection après mutation ;
- ouvre `/admin/products/:productRef` pour le détail Product 360.

## Hors périmètre

LOT 4C ne :

- crée pas de catalogue par pays ;
- supprime pas les vues Legacy ;
- duplique pas Product 360 ;
- réécrit pas les moteurs de publication ou d’override ;
- expose pas les variantes avancées dans le Workspace V1 ;
- gère pas encore l’upload média dans Canonical ;
- effectue pas le cutover final Legacy.

Les variantes et médias restent explicables via Product 360 et leurs autorités existantes jusqu’à un lot dédié si nécessaire.
