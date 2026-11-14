# Méta-graphe des coutures — les 3 territoires

> ⚠️ Généré par `scripts/gen-meta-graph.js`. Ne pas éditer à la main.
> Régénéré le 2026-11-13T02:02:34.687Z.
> Clé de voûte : le contrat OpenAPI. Chaque endpoint consommé est remonté
> jusqu'à sa route backend → services → tables (`x-route-file`).

## Sources cousues

- Backend : **2053** nœuds · Contrat : **760** endpoints
- Boutique : **103** modules, 65 endpoints
- Dashboards : **41** modules, 111 arêtes d'appel

## Synthèse des coutures

- Endpoints consommés par au moins un front : **98**
- 🔗 Endpoints **partagés** (boutique + dashboards) : **2** — rayon de casse amplifié
- 🔴 Coutures **fantômes** (front → hors contrat) : **1**
- ⚠️ Tables touchées par **les deux** fronts : **18**

## 1. Endpoints partagés — toucher = casse double

| Endpoint | Route backend | Boutique | Dashboards | Tables |
|---|---|---|---|---|
| `/api/orders` | `routes/orders/create.js` | b-checkout, b-tracking, komerce-api | OrdersLogisticsView, ProblemsView | `finance_config` |
| `/api/products` | `routes/products.js` | komerce-api | EconomicFlowView, PricingStrategyView | `product_skus`, `product_variants`, `products` |

## 2. Coutures fantômes (à trancher)

Endpoints appelés par un front mais absents du contrat backend — route legacy non nettoyée, ou bug qui couve (classe `.orders` / `getCosting`).

| Endpoint | Appelé par |
|---|---|
| `/api/hub/orders/mark-ordered` ❌ | dashboards:HubRelaisView |

## 3. Tables à rayon de casse maximal (lues/écrites pour les 2 fronts)

| Table | Routes | Modules boutique | Vues dashboards |
|---|---|---|---|
| `assignment_capability_ceiling` | 3 | 1 | 3 |
| `assignment_memberships` | 3 | 1 | 3 |
| `finance_config` | 3 | 3 | 4 |
| `invoices` | 3 | 2 | 1 |
| `market_operating_assignments` | 3 | 1 | 3 |
| `markets` | 7 | 5 | 4 |
| `membership_capabilities` | 3 | 1 | 3 |
| `order_items` | 6 | 2 | 6 |
| `orders` | 19 | 8 | 11 |
| `parcel_items` | 4 | 1 | 3 |
| `parcels` | 10 | 2 | 9 |
| `product_skus` | 1 | 1 | 2 |
| `product_variants` | 2 | 1 | 3 |
| `products` | 9 | 3 | 7 |
| `relais` | 11 | 7 | 7 |
| `scan_events` | 3 | 1 | 3 |
| `supplier_execution_payments` | 2 | 1 | 1 |
| `users` | 11 | 11 | 6 |

## 4. Carte des coutures (partagés + fantômes)

```mermaid
graph TD
  subgraph FRONTS
    direction LR
  end
  ep__api_orders["/api/orders"] --> rt_routes_orders_create_js["routes/orders/create.js"]
  BTQ((boutique)) -->|3| ep__api_orders
  DASH((dashboards)) -->|2| ep__api_orders
  ep__api_products["/api/products"] --> rt_routes_products_js["routes/products.js"]
  BTQ((boutique)) -->|1| ep__api_products
  DASH((dashboards)) -->|2| ep__api_products
  ep__api_hub_orders_mark_ordered["/api/hub/orders/mark-ordered ❌"]:::phantom
  DASH((dashboards)) -->|1| ep__api_hub_orders_mark_ordered
  classDef phantom fill:#fdd,stroke:#c00;
```

---
*Vérifié en pre-commit par `meta:graph:check` (cliquet sur les coutures fantômes).*
