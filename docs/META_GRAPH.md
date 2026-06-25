# Méta-graphe des coutures — les 3 territoires

> ⚠️ Généré par `scripts/gen-meta-graph.js`. Ne pas éditer à la main.
> Régénéré le 2026-06-25T22:02:42.811Z.
> Clé de voûte : le contrat OpenAPI. Chaque endpoint consommé est remonté
> jusqu'à sa route backend → services → tables (`x-route-file`).

## Sources cousues

- Backend : **665** nœuds · Contrat : **426** endpoints
- Boutique : **70** modules, 55 endpoints
- Dashboards : **40** modules, 111 arêtes d'appel

## Synthèse des coutures

- Endpoints consommés par au moins un front : **85**
- 🔗 Endpoints **partagés** (boutique + dashboards) : **2** — rayon de casse amplifié
- 🔴 Coutures **fantômes** (front → hors contrat) : **1**
- ⚠️ Tables touchées par **les deux** fronts : **11**

## 1. Endpoints partagés — toucher = casse double

| Endpoint | Route backend | Boutique | Dashboards | Tables |
|---|---|---|---|---|
| `/api/orders` | `routes/orders.js` | b-checkout, b-tracking, komerce-api | OrdersLogisticsView, ProblemsView | — |
| `/api/products` | `routes/products.js` | komerce-api | EconomicFlowView, PricingStrategyView | `product_variants`, `products` |

## 2. Coutures fantômes (à trancher)

Endpoints appelés par un front mais absents du contrat backend — route legacy non nettoyée, ou bug qui couve (classe `.orders` / `getCosting`).

| Endpoint | Appelé par |
|---|---|
| `/api/v2/scan` ❌ | dashboards:HubRelaisView |

## 3. Tables à rayon de casse maximal (lues/écrites pour les 2 fronts)

| Table | Routes | Modules boutique | Vues dashboards |
|---|---|---|---|
| `invoices` | 2 | 1 | 1 |
| `order_items` | 4 | 2 | 1 |
| `orders` | 16 | 5 | 11 |
| `parcel_items` | 3 | 1 | 2 |
| `parcels` | 10 | 2 | 9 |
| `product_variants` | 2 | 1 | 4 |
| `products` | 9 | 4 | 6 |
| `relais` | 7 | 4 | 6 |
| `scan_events` | 2 | 1 | 1 |
| `transaction_documents` | 2 | 2 | 2 |
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
  ep__api_v2_scan["/api/v2/scan ❌"]:::phantom
  DASH((dashboards)) -->|1| ep__api_v2_scan
  classDef phantom fill:#fdd,stroke:#c00;
```

---
*Vérifié en pre-commit par `meta:graph:check` (cliquet sur les coutures fantômes).*
