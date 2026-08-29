# Méta-graphe des coutures — les 3 territoires

> ⚠️ Généré par `scripts/gen-meta-graph.js`. Ne pas éditer à la main.
> Régénéré le 2026-08-29T08:35:51.868Z.
> Clé de voûte : le contrat OpenAPI. Chaque endpoint consommé est remonté
> jusqu'à sa route backend → services → tables (`x-route-file`).

## Sources cousues

- Backend : **1031** nœuds · Contrat : **506** endpoints
- Boutique : **88** modules, 57 endpoints
- Dashboards : **41** modules, 111 arêtes d'appel

## Synthèse des coutures

- Endpoints consommés par au moins un front : **96**
- 🔗 Endpoints **partagés** (boutique + dashboards) : **2** — rayon de casse amplifié
- 🔴 Coutures **fantômes** (front → hors contrat) : **0**
- ⚠️ Tables touchées par **les deux** fronts : **15**

## 1. Endpoints partagés — toucher = casse double

| Endpoint | Route backend | Boutique | Dashboards | Tables |
|---|---|---|---|---|
| `/api/orders` | `routes/orders/create.js` | b-checkout, b-tracking, komerce-api | OrdersLogisticsView, ProblemsView | `orders`, `product_skus`, `product_variants`, `products`, `recipients`, `relais`, `shared_cart_items`, `shared_carts`, `order_items`, `order_status_history` |
| `/api/products` | `routes/products.js` | komerce-api | EconomicFlowView, PricingStrategyView | `product_skus`, `product_variants`, `products` |

## 3. Tables à rayon de casse maximal (lues/écrites pour les 2 fronts)

| Table | Routes | Modules boutique | Vues dashboards |
|---|---|---|---|
| `invoices` | 3 | 2 | 1 |
| `order_items` | 6 | 3 | 4 |
| `order_status_history` | 1 | 3 | 2 |
| `orders` | 19 | 7 | 9 |
| `parcel_items` | 4 | 1 | 3 |
| `parcels` | 9 | 2 | 6 |
| `product_skus` | 2 | 3 | 4 |
| `product_variants` | 3 | 3 | 5 |
| `products` | 10 | 4 | 8 |
| `recipients` | 1 | 3 | 2 |
| `relais` | 9 | 5 | 5 |
| `scan_events` | 3 | 1 | 3 |
| `shared_cart_items` | 1 | 3 | 2 |
| `shared_carts` | 1 | 3 | 2 |
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
  classDef phantom fill:#fdd,stroke:#c00;
```

---
*Vérifié en pre-commit par `meta:graph:check` (cliquet sur les coutures fantômes).*
