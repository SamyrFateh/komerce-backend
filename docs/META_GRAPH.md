# Méta-graphe des coutures — les 3 territoires

> ⚠️ Généré par `scripts/gen-meta-graph.js`. Ne pas éditer à la main.
> Régénéré le 2026-07-12T20:19:57.560Z.
> Clé de voûte : le contrat OpenAPI. Chaque endpoint consommé est remonté
> jusqu'à sa route backend → services → tables (`x-route-file`).

## Sources cousues

- Backend : **727** nœuds · Contrat : **433** endpoints
- Boutique : **66** modules, 51 endpoints
- Dashboards : **41** modules, 112 arêtes d'appel

## Synthèse des coutures

- Endpoints consommés par au moins un front : **85**
- 🔗 Endpoints **partagés** (boutique + dashboards) : **2** — rayon de casse amplifié
- 🔴 Coutures **fantômes** (front → hors contrat) : **0**
- ⚠️ Tables touchées par **les deux** fronts : **11**

## 1. Endpoints partagés — toucher = casse double

| Endpoint | Route backend | Boutique | Dashboards | Tables |
|---|---|---|---|---|
| `/api/orders` | `routes/orders.js` | b-checkout, b-tracking, komerce-api | OrdersLogisticsView, ProblemsView | — |
| `/api/products` | `routes/products.js` | komerce-api | EconomicFlowView, PricingStrategyView | `product_skus`, `product_variants`, `products` |

## 3. Tables à rayon de casse maximal (lues/écrites pour les 2 fronts)

| Table | Routes | Modules boutique | Vues dashboards |
|---|---|---|---|
| `invoices` | 2 | 1 | 1 |
| `order_items` | 4 | 2 | 1 |
| `orders` | 16 | 5 | 11 |
| `parcel_items` | 3 | 1 | 2 |
| `parcels` | 10 | 2 | 9 |
| `product_skus` | 1 | 1 | 2 |
| `product_variants` | 2 | 1 | 4 |
| `products` | 9 | 4 | 6 |
| `relais` | 7 | 4 | 6 |
| `scan_events` | 2 | 1 | 1 |
| `users` | 9 | 6 | 5 |

## 4. Carte des coutures (partagés + fantômes)

```mermaid
graph TD
  subgraph FRONTS
    direction LR
  end
  ep__api_orders["/api/orders"] --> rt_routes_orders_js["routes/orders.js"]
  BTQ((boutique)) -->|3| ep__api_orders
  DASH((dashboards)) -->|2| ep__api_orders
  ep__api_products["/api/products"] --> rt_routes_products_js["routes/products.js"]
  BTQ((boutique)) -->|1| ep__api_products
  DASH((dashboards)) -->|2| ep__api_products
  classDef phantom fill:#fdd,stroke:#c00;
```

---
*Vérifié en pre-commit par `meta:graph:check` (cliquet sur les coutures fantômes).*
