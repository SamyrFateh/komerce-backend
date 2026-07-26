# Boutique 360 — carte d'architecture front (générée)

> ⚠️ Généré par `scripts/gen-boutique-360.js`. Ne pas éditer à la main.
> Régénéré le 2026-07-26T10:21:28.366Z.
> Couplage par **bus d'événements**. Couture backend par **endpoints → contrat OpenAPI**.

## Synthèse

- Modules JS : **73** (73 headés) · Événements bus : **20** · Bundles CSS : **3**
- Endpoints appelés : **52** — 🔴 0 hors contrat · ⚪ 30 non prouvés · 🔵 24 dynamiques
- Santé bus : 1 émission(s) orpheline(s), 1 écouteur(s) orphelin(s), 8 non déclaré(s)

## 1. Couture API → backend (résolue au contrat OpenAPI)

| Endpoint | Appelé par | Statut contrat |
|---|---|---|
| `/api/auth/login` | komerce-api | ⚪ non prouvé |
| `/api/auth/logout` | komerce-api | ⚪ non prouvé |
| `/api/auth/me` | b-greeting, komerce-api | ⚪ non prouvé |
| `/api/auth/otp/request` | b-identity, b-tracking | ⚪ non prouvé |
| `/api/auth/otp/verify` | b-identity, b-tracking | ⚪ non prouvé |
| `/api/boutique/suggestions` | b-modal-core | ⚪ non prouvé |
| `/api/carriers` | komerce-api | ⚪ non prouvé |
| `/api/carriers/{id}` | komerce-api | 🔵 dynamique |
| `/api/categories` | shop-schema | ⚪ non prouvé |
| `/api/client/tracking` | b-tracking | ⚪ non prouvé |
| `/api/health` | komerce-api | ⚪ non prouvé |
| `/api/hub/pack` | komerce-api | ⚪ non prouvé |
| `/api/hub/scan` | komerce-api | ⚪ non prouvé |
| `/api/hub/seal` | komerce-api | ⚪ non prouvé |
| `/api/logistics/shipments` | komerce-api | ⚪ non prouvé |
| `/api/logistics/shipments/{id}` | komerce-api | 🔵 dynamique |
| `/api/orders` | b-checkout, b-tracking, komerce-api | ⚪ non prouvé |
| `/api/orders/{id}` | komerce-api | 🔵 dynamique |
| `/api/parcels` | komerce-api | ⚪ non prouvé |
| `/api/parcels/bootstrap/{id}` | komerce-api | 🔵 dynamique |
| `/api/parcels/optimize` | komerce-api | ⚪ non prouvé |
| `/api/parcels/{id}` | komerce-api | 🔵 dynamique |
| `/api/parcels/{id}/items` | komerce-api | 🔵 dynamique |
| `/api/payments/paypal/capture/{id}` | b-paypal | 🔵 dynamique |
| `/api/payments/paypal/create-order` | b-paypal | ⚪ non prouvé |
| `/api/payments/stripe/intent` | b-checkout | ⚪ non prouvé |
| `/api/products` | komerce-api | ⚪ non prouvé |
| `/api/products/{id}` | komerce-api | 🔵 dynamique |
| `/api/products/{id}/detail` | b-modal-product-detail-bootstrap | 🔵 dynamique |
| `/api/public/config` | b-checkout, b-paypal | ⚪ non prouvé |
| `/api/purchasing/suppliers` | komerce-api | ⚪ non prouvé |
| `/api/purchasing/suppliers/{id}` | komerce-api | 🔵 dynamique |
| `/api/relais` | b-checkout | ⚪ non prouvé |
| `/api/relais/public` | b-nav | ⚪ non prouvé |
| `/api/scans` | komerce-api | ⚪ non prouvé |
| `/api/shared-carts/from-cart-items` | b-share-cart | ⚪ non prouvé |
| `/api/shared-carts/mine` | b-share-cart, group-api | ⚪ non prouvé |
| `/api/shared-carts/public/{id}` | b-group-banner, group-api | 🔵 dynamique |
| `/api/shared-carts/public/{id}/contributions` | group-api | 🔵 dynamique |
| `/api/shared-carts/public/{id}/estimations` | group-api | 🔵 dynamique |
| `/api/shared-carts/public/{id}/estimations/by-phone` | group-api | 🔵 dynamique |
| `/api/shared-carts/public/{id}/estimations/{id}` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}/as-cart-items` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}/cancel` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}/close` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}/extend-window` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}/finalize` | group-api | 🔵 dynamique |
| `/api/shared-carts/{id}/items` | b-cart | 🔵 dynamique |
| `/api/shares` | b-cart, b-favs | ⚪ non prouvé |
| `/api/wallet` | b-checkout, b-wallet | ⚪ non prouvé |
| `/api/wallet/transactions` | b-wallet | ⚪ non prouvé |

## 2. Topologie du bus

| Événement | Émetteurs | Écouteurs | Statut |
|---|---|---|---|
| `carousel:changed` | b-modal-product | b-modal-image-ux | 🟡 non déclaré |
| `cart:update` | b-cart-core | b-cart, b-cart-core, b-cart-pill, b-mini-cart, b-modal-suggestions, b-nav | 🟢 sain |
| `cat:select` | b-catalog | b-catalog | 🟢 sain |
| `catalog:cat-changed` | b-catalog, b-store | b-catalog, b-home-premium-v1 | 🟢 sain |
| `checkout:open` | b-cart | boutique | 🟢 sain |
| `chip:center` | b-pager | b-catalog | 🟢 sain |
| `favorites:view-refresh` | b-catalog | b-favs | 🟡 non déclaré |
| `modal:close` | b-cart, b-checkout | b-modal-core | 🟢 sain |
| `modal:closed` | b-modal-core | b-modal-product-detail-bootstrap, b-pager | 🟡 non déclaré |
| `modal:composition-synced` | b-modal-product-detail-bootstrap | b-modal-core, b-modal-desktop-enhancers | 🟡 non déclaré |
| `modal:detail-ready` | b-modal-product-detail-bootstrap | b-modal-cart | 🟢 sain |
| `modal:open` | b-cart, b-modal-nav, b-modal-suggestions | b-modal-core, b-product-open-contract | 🟢 sain |
| `modal:opened` | b-modal-core | b-modal-desktop-enhancers, b-modal-product-detail-bootstrap, b-pager, b-pdp-curation-suggestions, boutique | 🟡 non déclaré |
| `modal:product-changed` | — | b-modal-social-proof | 🟠 écouteur orphelin |
| `modal:suggestions-rendered` | b-modal-suggestions | b-pdp-curation-suggestions | 🟢 sain |
| `nav:goto-track` | b-checkout | b-nav | 🟢 sain |
| `product:open-from-cart` | b-product-open-contract | b-product-open-contract | 🟢 sain |
| `side-cart:render` | b-cart, b-cart-core, b-group-view | b-cart | 🟢 sain |
| `sidebar:built` | b-desktop-sidebar | — | 🔴 émission orpheline |
| `view:changed` | b-nav | b-catalog-desktop-enhancers, b-home-premium-v1 | 🟡 non déclaré |

### Diagramme

```mermaid
graph LR
  b_cart_core["b-cart-core"] -->|side-cart:render| b_cart["b-cart"]
  b_group_view["b-group-view"] -->|side-cart:render| b_cart["b-cart"]
  b_cart_core["b-cart-core"] -->|cart:update| b_cart["b-cart"]
  b_cart_core["b-cart-core"] -->|cart:update| b_cart_pill["b-cart-pill"]
  b_cart_core["b-cart-core"] -->|cart:update| b_mini_cart["b-mini-cart"]
  b_cart_core["b-cart-core"] -->|cart:update| b_modal_suggestions["b-modal-suggestions"]
  b_cart_core["b-cart-core"] -->|cart:update| b_nav["b-nav"]
  b_cart["b-cart"] -->|modal:close| b_modal_core["b-modal-core"]
  b_checkout["b-checkout"] -->|modal:close| b_modal_core["b-modal-core"]
  b_cart["b-cart"] -->|modal:open| b_modal_core["b-modal-core"]
  b_cart["b-cart"] -->|modal:open| b_product_open_contract["b-product-open-contract"]
  b_modal_nav["b-modal-nav"] -->|modal:open| b_modal_core["b-modal-core"]
  b_modal_nav["b-modal-nav"] -->|modal:open| b_product_open_contract["b-product-open-contract"]
  b_modal_suggestions["b-modal-suggestions"] -->|modal:open| b_modal_core["b-modal-core"]
  b_modal_suggestions["b-modal-suggestions"] -->|modal:open| b_product_open_contract["b-product-open-contract"]
  b_cart["b-cart"] -->|checkout:open| boutique["boutique"]
  b_nav["b-nav"] -->|view:changed| b_catalog_desktop_enhancers["b-catalog-desktop-enhancers"]
  b_nav["b-nav"] -->|view:changed| b_home_premium_v1["b-home-premium-v1"]
  b_catalog["b-catalog"] -->|catalog:cat-changed| b_home_premium_v1["b-home-premium-v1"]
  b_store["b-store"] -->|catalog:cat-changed| b_catalog["b-catalog"]
  b_store["b-store"] -->|catalog:cat-changed| b_home_premium_v1["b-home-premium-v1"]
  b_catalog["b-catalog"] -->|favorites:view-refresh| b_favs["b-favs"]
  b_pager["b-pager"] -->|chip:center| b_catalog["b-catalog"]
  b_checkout["b-checkout"] -->|nav:goto-track| b_nav["b-nav"]
  b_modal_product_detail_bootstrap["b-modal-product-detail-bootstrap"] -->|modal:detail-ready| b_modal_cart["b-modal-cart"]
  b_modal_core["b-modal-core"] -->|modal:opened| b_modal_desktop_enhancers["b-modal-desktop-enhancers"]
  b_modal_core["b-modal-core"] -->|modal:opened| b_modal_product_detail_bootstrap["b-modal-product-detail-bootstrap"]
  b_modal_core["b-modal-core"] -->|modal:opened| b_pager["b-pager"]
  b_modal_core["b-modal-core"] -->|modal:opened| b_pdp_curation_suggestions["b-pdp-curation-suggestions"]
  b_modal_core["b-modal-core"] -->|modal:opened| boutique["boutique"]
  b_modal_core["b-modal-core"] -->|modal:closed| b_modal_product_detail_bootstrap["b-modal-product-detail-bootstrap"]
  b_modal_core["b-modal-core"] -->|modal:closed| b_pager["b-pager"]
  b_modal_product_detail_bootstrap["b-modal-product-detail-bootstrap"] -->|modal:composition-synced| b_modal_core["b-modal-core"]
  b_modal_product_detail_bootstrap["b-modal-product-detail-bootstrap"] -->|modal:composition-synced| b_modal_desktop_enhancers["b-modal-desktop-enhancers"]
  b_modal_product["b-modal-product"] -->|carousel:changed| b_modal_image_ux["b-modal-image-ux"]
  b_modal_suggestions["b-modal-suggestions"] -->|modal:suggestions-rendered| b_pdp_curation_suggestions["b-pdp-curation-suggestions"]
```

## 3. Bundles CSS

| Bundle | Sources |
|---|---|
| `css/dist/base.css` | `tokens`, `reset`, `layout`, `hero` |
| `css/dist/components.css` | `categories`, `products`, `modal-shell`, `modal-media`, `modal-product`, `modal-product-lot4-hybrid`, `modal-mobile-canonical`, `modal-enriched-content`, `modal-cart-sku-guard`, `cart`, `interactions`, `modal-mobile-suggestion-actions`, `hero-cart-proxy`, `group-cart-flow`, `share-cart`, `shared-followup`, `identity`, `paypal`, `wallet` |
| `css/dist/desktop.css` | `boutique-desktop` |

---
*Carte vérifiée en pre-commit par `boutique:360:check` (cliquet bus + endpoints hors contrat).*
