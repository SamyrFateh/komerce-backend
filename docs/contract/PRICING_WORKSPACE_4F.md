# LOT 4F — Pricing Workspace Canonical

## Mission

Le Pricing Workspace est la surface d’action centrale pour comprendre la construction du prix, simuler l’impact d’une hypothèse, calibrer les composants de coût et appliquer une décision tarifaire.

Doctrine :

> Dashboard observe. Workspace agit. Entity 360 explique.

Il absorbe les besoins légitimes de :

- `PricingView` ;
- `PricingWorkshopView` ;
- `PricingStrategyView` ;
- `EconomicFlowView`.

`SimulatorView` est explicitement hors 4F : malgré le classement historique du LOT 0A, le code réel pilote des scénarios opérationnels de commandes (`start`, `stop`, `cleanup`, douane, relais, litiges). Cette surface appartient au staging/opérationnel, pas au pricing économique.

## Surface stable

- HTML : `GET /admin/workspaces/pricing`
- alias build : `/admin-next/workspaces/pricing`
- API : `/api/admin/workspaces/pricing`

LOT 4J ferme uniquement les anciens **points d’entrée** déjà prouvés couverts par 4F :

- `/admin/pricing` ;
- `/admin/pricing-workshop` ;
- `/admin/pricing-strategy` ;
- `/admin/economic-flow`.

Sans query de rollback, ils redirigent vers `/admin/workspaces/pricing`. `?legacy=1` sert encore Legacy 1 au même pathname pendant la fenêtre de cutover. `CostingView`, `EconomicView`, `SettingsView` et `SimulatorView` restent hors de cette bascule tant que leur absorption n’est pas prouvée.

## Pricing global, pas market-scoped

Le moteur actuel de pricing est global : `products.price_kmf`, `cost_components`, `pricing_strategies`, `competitor_prices` et les routes historiques n’emploient pas `market_id` comme autorité.

Les dimensions `channel`, `island`, `scope`, catégorie ou produit sont des paramètres économiques du moteur ; elles ne sont pas une délégation pays.

Canonical refuse explicitement toute autorité marché envoyée par le navigateur.

Migration `152_pricing_workspace_global_authority.sql` crée `pricing_global_access_grants`. Le bootstrap conserve l’autorité historique des administrateurs, puis la table devient le grant explicite de la surface Canonical.

## Références métier navigateur

Le navigateur ne manipule aucun UUID interne :

- produit : `product_ref` (`KPR-...`) ;
- observation concurrente : `competitor_ref` (`KPC-...`) ;
- composant de coût : `cost_components.key`.

Les `product_id`, `competitor_id`, `component_id`, `market_id` et variantes camelCase sont refusés par l’API Canonical.

## Autorités métier réutilisées

### Calcul / simulation

`services/pricing-workspace.js` résout `product_ref` côté serveur puis délègue :

- recommandation à `pricing-recommend` ;
- carte économique à `pricing-engine`.

Aucun calcul de CDR, marge, plancher ou recommandation n’est réimplémenté dans le navigateur.

### Application du prix

Canonical délègue à `services/pricing-apply.js`, qui conserve la garde de survie, l’écriture propriétaire produit via `catalog-product-mutation-service` et l’audit `price_history`.

### Stratégie et concurrence

Canonical délègue à `services/pricing-strategy-service.js`. Le Workspace résout `product_ref`, retire les identifiants internes de la projection et utilise `competitor_ref` pour la désactivation d’une observation.

### Composants de coût

LOT 4F extrait la mutation de `routes/admin-cost-components.js` vers `services/cost-component-admin-service.js`.

Legacy et Canonical utilisent désormais la même autorité pour :

- création ;
- modification ;
- activation/désactivation ;
- audit des changements.

Canonical n’expose pas le hard-delete.

## Projection principale

`GET /api/admin/workspaces/pricing`

```json
{
  "scope": { "mode": "global_pricing" },
  "summary": {},
  "products": [],
  "recommendations": [],
  "cost_components": [],
  "cost_meta": {},
  "rates": {}
}
```

Aucun UUID interne n’est exposé.

## Routes Canonical

### Lecture

- `GET /`
- `GET /strategy?product_ref=...|category=...`

### Calcul sans mutation

- `POST /simulate`
- `POST /flow`

### Décision produit

- `POST /products/:productRef/apply-price`
- `POST /strategy/apply`

### Concurrence

- `POST /competitors`
- `POST /competitors/:competitorRef/deactivate`

### Atelier des coûts

- `POST /cost-components`
- `POST /cost-components/:key/update`
- `POST /cost-components/:key/toggle`

Toutes les routes exigent session, rôle admin et grant `pricing_global_access_grants` actif.

## Browser invariants

Le module Canonical :

- appelle uniquement `/api/admin/workspaces/pricing...` ;
- n’appelle ni `/api/pricing`, ni `/api/admin/cost-components` ;
- n’importe aucune vue Legacy ni `ApiClient` / `KmcApi` ;
- ne transmet aucun UUID ;
- ne transmet aucune dimension marché ;
- ne recalcule aucun prix, coût ou stratégie ;
- recharge la projection après mutation ;
- conserve Product 360 comme drill-down produit.

## Hors périmètre

LOT 4F ne :

- crée pas de pricing par pays tant qu’aucune vérité métier market-scoped n’existe ;
- déplace pas le simulateur opérationnel de commandes dans Pricing ;
- remplace pas Product 360 ;
- expose pas de hard-delete `cost_components` ;
- réécrit pas `pricing-engine`, `pricing-recommend`, `pricing-apply` ou `pricing-strategy-service` ;
- supprime pas les vues Legacy avant preuve runtime.
