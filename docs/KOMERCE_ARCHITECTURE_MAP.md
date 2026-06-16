# Komerce Architecture Map

Version initiale: 2026-06.

This map is the mandatory entry point before modifying Komerce code. It combines technical dependencies, business roles, doctrine and impact areas.

## Backend Critical Nodes

### server.js

- Role: Express API runtime entrypoint.
- Domain: bootstrap.
- Layer: entrypoint.
- Criticality: critical.
- Depends: `bootstrap/env.js`, `bootstrap/security.js`, `bootstrap/api-routes.js`, `bootstrap/html-routes.js`, `bootstrap/crons.js`, `routes/shared-cart.js`, `routes/shared-cart-refund-admin.js`.
- Used by: Railway/runtime Node.
- Doctrine: `raw_body_webhook_intact`, `routes_canoniques`, `static_boutique_served`.
- Impact areas: all-api, shared-cart, payments, boutique, crons, auth.

### bootstrap/api-routes.js

- Role: API route manifest.
- Domain: bootstrap.
- Layer: route-manifest.
- Criticality: critical.
- Depends: `routes/auth.js`, `routes/products.js`, `routes/orders.js`, `routes/payments.js`, `routes/otp.js`, `routes/shared-cart-cash.js`, `routes/meta-whatsapp.js`, `routes/economic-engine.js`, `routes/boutique-suggestions.js`, `routes/admin-boutique-categories.js`.
- Used by: `server.js`.
- Doctrine: `routes_canoniques`, `stripe_raw_body_preserve`, `alias_historiques_limites`.
- Impact areas: all-api, checkout, shared-cart, payment, dashboard, economic-engine, boutique.

### bootstrap/crons.js

- Role: operational cron startup.
- Domain: bootstrap.
- Layer: cron.
- Criticality: critical.
- Depends: `services/cash-reminder-service.js`, `services/inventory-service.js`, `services/shared-cart-engine.js`, `utils/rules.js`.
- Used by: `server.js`.
- Doctrine: `shared_cart_state_machine_v41`, `idempotence_cron`, `retention_snapshots`.
- Impact areas: shared-cart, cash-reminders, inventory, auth-security, economic-engine.

### services/shared-cart-engine.js

- Role: shared cart V4.1 business engine and state machine.
- Domain: shared-cart.
- Layer: service/machine.
- Criticality: critical.
- Depends: `db.js`, `services/whatsapp-meta.js`, `services/order-service.js`, `services/routing.js`, `services/order-payment-confirmation.js`, `utils/rates.js`.
- Used by: `routes/shared-cart.js`, `bootstrap/crons.js`.
- Doctrine: `paiement_seul_acte_engageant`, `panier_ouvert_ferme`, `snapshot_fige`, `fenetre_paiement_48h`, `choix_createur_72h`, `idempotence_financiere`.
- Impact areas: participant-flow, creator-flow, checkout, orders, notifications, stock, economic-engine.

### routes/shared-cart.js

- Role: shared cart V4.1 HTTP facade.
- Domain: shared-cart.
- Layer: route.
- Criticality: critical.
- Depends: `services/shared-cart-engine.js`, `services/shared-cart-estimation-service.js`, `services/shared-cart-financial-guard.js`, `services/shared-cart-items-service.js`, `services/shared-cart-v41-transitions.js`, `services/shared-cart-queries.js`, `services/whatsapp-meta.js`, `services/cancel-shared-cart-with-refunds.js`.
- Used by: `server.js`, `public/boutique/js/b-group-view.js`, `public/boutique/js/b-share-cart.js`, `public/boutique/js/b-cart.js`.
- Doctrine: `paiement_seul_acte_engageant`, `estimations_indicatives`, `participant_peut_verifier`, `retour_stripe_boutique`, `panier_ouvert_ferme`.
- Impact areas: shared-cart, checkout, participant-flow, creator-dashboard, Stripe, WhatsApp, boutique.

### routes/payments.js

- Role: standard payment HTTP facade.
- Domain: payment.
- Layer: route.
- Criticality: critical.
- Depends: `services/payment-stripe.js`, `services/payment-cash-confirm.js`, `routes/purchasing.js`, `utils/rates.js`, `validators.js`.
- Used by: `bootstrap/api-routes.js`, `public/boutique/js/b-checkout.js`.
- Doctrine: `raw_body_webhook_intact`, `idempotence_stripe`, `payment_to_stock_single_entry`.
- Impact areas: checkout, orders, stock, cash, sourcing, notifications.

### services/order-payment-confirmation.js

- Role: single entry point from payment to stock/order transitions.
- Domain: order-payment.
- Layer: service.
- Criticality: critical.
- Depends: `services/order-status-machine.js`, `db.js`.
- Used by: `services/payment-stripe.js`, `services/payment-cash-confirm.js`, `services/shared-cart-engine.js`, PayPal flows, wallet-full order flows.
- Doctrine: `transaction_existante_obligatoire`, `confirmPaymentCycle_unique`, `stock_for_update`, `cash_rollback_vs_stripe_alert`.
- Impact areas: orders, stock, payments, shared-cart, wallet, sourcing, loyalty.

### routes/otp.js

- Role: client OTP request and verification.
- Domain: auth.
- Layer: route.
- Criticality: high.
- Depends: `services/notification-service.js`, `services/otp-test-mode.js`, `utils/phone.js`, `db.js`.
- Used by: `bootstrap/api-routes.js`, `public/boutique/js/b-identity.js`, `public/boutique/js/b-tracking.js`, checkout.
- Doctrine: `otp_une_fois`, `session_client_legere`, `test_mode_never_prod`, `phone_normalization`.
- Impact areas: checkout, participant-flow, tracking, shared-cart-access, auth.

### routes/economic-engine.js / services/economic-engine-queries.js

- Role: admin facade and service for economic model calculations.
- Domain: economic-engine.
- Layer: route/service.
- Criticality: high.
- Depends: `utils/eco-bridge.js`, `db.js`, `middleware/auth.js`.
- Used by: `bootstrap/api-routes.js`, admin dashboards.
- Doctrine: `moteur_economique_lisible`, `couts_repartis_par_commande`, `coherence_model_economique`, `snapshot_debounce`, `sov_drift`.
- Impact areas: admin-dashboard, pricing, margin, cost-model, snapshots.

## Boutique Critical Nodes

### public/boutique/js/boutique.js

- Role: main boutique UI orchestrator.
- Domain: boutique.
- Layer: ui-page.
- Criticality: critical.
- Depends: `b-store.js`, `b-cart-core.js`, `b-catalog.js`, `b-modal.js`, `b-cart.js`, `b-checkout.js`, `b-nav.js`, `b-share-cart.js`, `b-group-banner.js`.
- Used by: `public/boutique/index.html`.
- Doctrine: `boutique_canal_decouverte`, `navigation_sans_friction`, `side_cart_non_intrusif`.
- Impact areas: boutique-home, product-discovery, side-cart, checkout, shared-cart, responsive-layout.

### public/boutique/js/b-cart.js

- Role: cart UI, drawer, side-cart and shared cart item editing.
- Domain: boutique.
- Layer: ui-component/ui-state.
- Criticality: critical.
- Depends: `b-store.js`, `b-cart-core.js`, `b-catalog.js`, `b-scroll-owner.js`, `shop-schema.js`, API `/api/shared-carts/:id/items`, API `/api/shares`.
- Used by: `b-boutique.js`, `b-checkout.js`, `b-modal-core.js`, `b-nav.js`, `b-share-cart.js`, `b-subcat.js`.
- Doctrine: `panier_ouvert_ferme`, `participant_lecture_seule`, `side_cart_non_intrusif`, `modal_produit_sans_chevauchement`.
- Impact areas: checkout-entry, side-cart, shared-cart-editing, participant-flow, responsive-layout.

### public/boutique/js/b-checkout.js

- Role: boutique checkout orchestrator.
- Domain: checkout.
- Layer: ui-component.
- Criticality: critical.
- Depends: `b-store.js`, `b-cart-core.js`, `b-cart.js`, `b-identity.js`, `b-checkout-render.js`, `b-phone.js`, API `/api/orders`, API `/api/payments/stripe/intent`, API `/api/relais`, API `/api/wallet`.
- Used by: `b-boutique.js`, `b-nav.js`, `b-share-cart.js`.
- Doctrine: `paiement_seul_acte_engageant`, `otp_une_fois`, `checkout_sans_friction`.
- Impact areas: checkout, payments, OTP, order-creation, cart, shared-cart.

### public/boutique/js/b-group-view.js

- Role: shared cart creator/participant view.
- Domain: shared-cart.
- Layer: ui-component.
- Criticality: critical.
- Depends: `group/group-api.js`, `group/group-state.js`, `group/group-helpers.js`, `group/group-render-creator.js`, `b-identity.js`, `b-group-banner.js`, `b-cart-core.js`.
- Used by: `b-nav.js`, `b-share-cart.js`, public shared-cart links.
- Doctrine: `paiement_seul_acte_engageant`, `estimations_indicatives`, `participant_peut_verifier`, `createur_decide_gap`.
- Impact areas: participant-flow, creator-flow, checkout, notifications, side-cart.

### public/boutique/js/b-catalog.js / b-subcat.js

- Role: catalog rendering, category and subcategory navigation.
- Domain: catalog.
- Layer: ui-component.
- Criticality: high.
- Depends: `b-store.js`, `b-subcat.js`, `b-pager.js`, `b-modal.js`, `shop-schema.js`, `render/render-product-card.js`, `render/render-home-sections.js`, `product-store.js`, `controllers/home-controller.js`.
- Used by: `b-boutique.js`, `b-desktop-sidebar.js`, `b-nav.js`.
- Doctrine: `boutique_canal_decouverte`, `categorie_souscategorie_switch_fluide`, `navigation_sans_friction`, `mobile_desktop_coherence`.
- Impact areas: product-discovery, category-navigation, modal-entry, side-cart-layout.

### public/boutique/js/b-share-cart.js

- Role: shared cart creation from boutique cart.
- Domain: shared-cart.
- Layer: ui-component.
- Criticality: critical.
- Depends: `b-store.js`, `b-cart-core.js`, `b-cart.js`, `b-group-view.js`, `b-group-banner.js`, `b-phone.js`, `b-checkout.js`, `b-identity.js`, API `/api/shared-carts/from-cart-items`.
- Used by: `b-boutique.js`, `b-modal-approche-c-hybrid.js`.
- Doctrine: `partager_geste_natif`, `panier_ouvert_ferme`, `paiement_seul_acte_engageant`, `boutique_canal_decouverte`.
- Impact areas: shared-cart-creation, checkout, participant-flow, creator-flow, local-cart.

## Intervention Maps

### Modify shared cart backend

Check: `routes/shared-cart.js`, `services/shared-cart-engine.js`, `bootstrap/crons.js`, `services/shared-cart-financial-guard.js`, `services/shared-cart-items-service.js`, `public/boutique/js/b-group-view.js`, `public/boutique/js/b-share-cart.js`, `public/boutique/js/b-cart.js`.

Preserve: payment as only committing act, indicative estimations, frozen snapshot, 48h payment window, 72h creator decision, Stripe/contribution idempotency.

### Modify checkout boutique

Check: `public/boutique/js/b-checkout.js`, `public/boutique/js/b-checkout-render.js`, `public/boutique/js/b-cart.js`, `public/boutique/js/b-identity.js`, `routes/orders.js`, `routes/payments.js`, `routes/otp.js`.

Preserve: OTP once, payment as only committing act, coherent cart state, understandable payment return.

### Modify side-cart or catalog layout

Check: `public/boutique/js/b-cart.js`, `public/boutique/js/b-catalog.js`, `public/boutique/js/b-subcat.js`, `public/boutique/js/b-modal-core.js`, `public/boutique/css/cart.css`, `public/boutique/css/layout.css`, `public/boutique/css/boutique-desktop.css`.

Preserve: non-intrusive side-cart, mobile/desktop coherence, no modal/image/description overlap, categories and subcategories always navigable.
