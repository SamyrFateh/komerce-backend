'use strict';

/**
 * Applies @komerce-arch headers to critical Komerce files.
 *
 * Idempotent: files that already contain @komerce-arch are skipped.
 * Documentation-only: the script only prepends comments and does not alter code behavior.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const HEADERS = {
  'server.js': `/**
 * @komerce-arch
 * @role          api-server-entrypoint
 * @domain        bootstrap
 * @layer         entrypoint
 * @criticality   critical
 * @inputs        http_requests, env_vars, raw_webhooks, static_assets
 * @outputs       mounted_api, boutique_static, crons, server_lifecycle
 * @depends       bootstrap/env.js, bootstrap/security.js, bootstrap/api-routes.js, bootstrap/html-routes.js, bootstrap/crons.js, routes/shared-cart.js
 * @used-by       railway-runtime
 * @doctrine      raw_body_webhook_intact, routes_canoniques, static_boutique_served
 * @impact-areas  all-api, shared-cart, payments, boutique, crons, auth
 * @version       2026-06
 */`,

  'bootstrap/api-routes.js': `/**
 * @komerce-arch
 * @role          api-route-manifest
 * @domain        bootstrap
 * @layer         route-manifest
 * @criticality   critical
 * @inputs        express_app
 * @outputs       mounted_api_routes
 * @depends       routes/orders.js, routes/payments.js, routes/otp.js, routes/shared-cart-cash.js, routes/meta-whatsapp.js, routes/economic-engine.js, routes/boutique-suggestions.js
 * @used-by       server.js
 * @doctrine      routes_canoniques, stripe_raw_body_preserve, alias_historiques_limites
 * @impact-areas  all-api, checkout, shared-cart, payment, dashboard, economic-engine, boutique
 * @version       2026-06
 */`,

  'bootstrap/crons.js': `/**
 * @komerce-arch
 * @role          operational-crons
 * @domain        bootstrap
 * @layer         cron
 * @criticality   critical
 * @inputs        timers, database_state, rules
 * @outputs       automatic_transitions, purges, reminders
 * @depends       services/cash-reminder-service.js, services/inventory-service.js, services/shared-cart-engine.js, utils/rules.js
 * @used-by       server.js
 * @doctrine      shared_cart_state_machine_v41, idempotence_cron, retention_snapshots
 * @impact-areas  shared-cart, cash-reminders, inventory, auth-security, economic-engine
 * @version       2026-06
 */`,

  'services/shared-cart-engine.js': `/**
 * @komerce-arch
 * @role          shared-cart-state-machine
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        cart_id, token, cart_items, payment_event, timer_event, creator_action
 * @outputs       shared_cart, contribution, next_status, order, events
 * @depends       db.js, services/whatsapp-meta.js, services/order-service.js, services/routing.js, services/order-payment-confirmation.js, utils/rates.js
 * @used-by       routes/shared-cart.js, bootstrap/crons.js
 * @doctrine      paiement_seul_acte_engageant, panier_ouvert_ferme, snapshot_fige, fenetre_paiement_48h, choix_createur_72h, idempotence_financiere
 * @impact-areas  participant-flow, creator-flow, checkout, orders, notifications, stock, economic-engine
 * @version       2026-06
 */`,

  'routes/shared-cart.js': `/**
 * @komerce-arch
 * @role          shared-cart-http-facade
 * @domain        shared-cart
 * @layer         route
 * @criticality   critical
 * @inputs        public_token, auth_user, estimations, contributions, stripe_webhook, creator_actions
 * @outputs       shared_cart_api, stripe_sessions, notifications, admin_views
 * @depends       services/shared-cart-engine.js, services/shared-cart-estimation-service.js, services/shared-cart-financial-guard.js, services/shared-cart-items-service.js, services/shared-cart-v41-transitions.js, services/shared-cart-queries.js
 * @used-by       server.js, public/boutique/js/b-group-view.js, public/boutique/js/b-share-cart.js, public/boutique/js/b-cart.js
 * @doctrine      paiement_seul_acte_engageant, estimations_indicatives, participant_peut_verifier, retour_stripe_boutique, panier_ouvert_ferme
 * @impact-areas  shared-cart, checkout, participant-flow, creator-dashboard, stripe, whatsapp, boutique
 * @version       2026-06
 */`,

  'routes/payments.js': `/**
 * @komerce-arch
 * @role          payment-http-facade
 * @domain        payment
 * @layer         route
 * @criticality   critical
 * @inputs        order_reference, stripe_webhook, cash_ref_code
 * @outputs       stripe_intent, payment_confirmation, rates_config
 * @depends       services/payment-stripe.js, services/payment-cash-confirm.js, routes/purchasing.js, utils/rates.js, validators.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js
 * @doctrine      raw_body_webhook_intact, idempotence_stripe, payment_to_stock_single_entry
 * @impact-areas  checkout, orders, stock, cash, sourcing, notifications
 * @version       2026-06
 */`,

  'services/order-payment-confirmation.js': `/**
 * @komerce-arch
 * @role          payment-to-stock-single-entry
 * @domain        order-payment
 * @layer         service
 * @criticality   critical
 * @inputs        orderId, actor, source, dbClient
 * @outputs       confirmed_order, ordered_transition, stock_decrement, stockBlocked
 * @depends       services/order-status-machine.js, db.js
 * @used-by       services/payment-stripe.js, services/payment-cash-confirm.js, services/shared-cart-engine.js, paypal-flows, wallet-full-order-flows
 * @doctrine      transaction_existante_obligatoire, confirmPaymentCycle_unique, stock_for_update, cash_rollback_vs_stripe_alert
 * @impact-areas  orders, stock, payments, shared-cart, wallet, sourcing, loyalty
 * @version       2026-06
 */`,

  'routes/otp.js': `/**
 * @komerce-arch
 * @role          client-otp-session
 * @domain        auth
 * @layer         route
 * @criticality   high
 * @inputs        phone, code, name, purpose
 * @outputs       kmrc_jwt_cookie, lightweight_user, otp_state
 * @depends       services/notification-service.js, services/otp-test-mode.js, utils/phone.js, db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-identity.js, public/boutique/js/b-tracking.js, checkout
 * @doctrine      otp_une_fois, session_client_legere, test_mode_never_prod, phone_normalization
 * @impact-areas  checkout, participant-flow, tracking, shared-cart-access, auth
 * @version       2026-06
 */`,

  'routes/economic-engine.js': `/**
 * @komerce-arch
 * @role          economic-engine-http-facade
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        admin_requests, variable_mutations, charge_mutations
 * @outputs       executive_summary, variables, charges, coherence, history
 * @depends       services/economic-engine-queries.js, utils/eco-bridge.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js, admin-dashboards
 * @doctrine      moteur_economique_lisible, route_facade_service, invalidate_cache_after_mutation
 * @impact-areas  admin-dashboard, pricing, margin, cost-model, snapshots
 * @version       2026-06
 */`,

  'services/economic-engine-queries.js': `/**
 * @komerce-arch
 * @role          economic-engine-calculation-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        economic_variables, charges, trigger_event
 * @outputs       computed_variables, alerts, snapshots, executive_summary
 * @depends       db.js, utils/eco-bridge.js
 * @used-by       routes/economic-engine.js, admin-dashboards
 * @doctrine      couts_repartis_par_commande, coherence_model_economique, snapshot_debounce, sov_drift
 * @impact-areas  pricing, margin, dashboard, admin-economic, finance-config
 * @version       2026-06
 */`,

  'public/boutique/js/boutique.js': `/**
 * @komerce-arch
 * @role          boutique-ui-orchestrator
 * @domain        boutique
 * @layer         ui-page
 * @criticality   critical
 * @inputs        dom, state, bus_events
 * @outputs       catalog_init, cart_init, modal_init, checkout_init, navigation_init, share_cart_init
 * @depends       b-store.js, b-cart-core.js, b-catalog.js, b-modal.js, b-cart.js, b-checkout.js, b-nav.js, b-share-cart.js
 * @used-by       public/boutique/index.html
 * @doctrine      boutique_canal_decouverte, navigation_sans_friction, side_cart_non_intrusif
 * @impact-areas  boutique-home, product-discovery, side-cart, checkout, shared-cart, responsive-layout
 * @version       2026-06
 */`,

  'public/boutique/js/b-cart.js': `/**
 * @komerce-arch
 * @role          boutique-cart-and-side-cart
 * @domain        boutique
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, shared_cart_context, product_actions, viewport
 * @outputs       cart_drawer, side_cart, quantity_changes, shared_cart_item_updates
 * @depends       b-store.js, b-cart-core.js, b-catalog.js, b-scroll-owner.js, shop-schema.js, routes/shared-cart.js
 * @used-by       b-boutique.js, b-checkout.js, b-modal-core.js, b-nav.js, b-share-cart.js
 * @doctrine      panier_ouvert_ferme, participant_lecture_seule, side_cart_non_intrusif, modal_produit_sans_chevauchement
 * @impact-areas  checkout-entry, side-cart, shared-cart-editing, participant-flow, responsive-layout
 * @version       2026-06
 */`,

  'public/boutique/js/b-checkout.js': `/**
 * @komerce-arch
 * @role          boutique-checkout-orchestrator
 * @domain        checkout
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, identity, phone, relais, payment_mode
 * @outputs       order_creation, stripe_payment_intent, checkout_modal_state
 * @depends       b-store.js, b-cart-core.js, b-cart.js, b-identity.js, b-checkout-render.js, b-phone.js, routes/orders.js, routes/payments.js
 * @used-by       b-boutique.js, b-nav.js, b-share-cart.js
 * @doctrine      paiement_seul_acte_engageant, otp_une_fois, checkout_sans_friction
 * @impact-areas  checkout, payments, otp, order-creation, cart, shared-cart
 * @version       2026-06
 */`,

  'public/boutique/js/b-group-view.js': `/**
 * @komerce-arch
 * @role          shared-cart-boutique-view
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        share_token, public_cart_data, owner_identity, estimations, contributions
 * @outputs       group_view, payment_actions, creator_actions, polling, banner_state
 * @depends       group/group-api.js, group/group-state.js, group/group-helpers.js, group/group-render-creator.js, b-identity.js, b-group-banner.js
 * @used-by       b-nav.js, b-share-cart.js, public_shared_cart_links
 * @doctrine      paiement_seul_acte_engageant, estimations_indicatives, participant_peut_verifier, createur_decide_gap
 * @impact-areas  participant-flow, creator-flow, checkout, notifications, side-cart
 * @version       2026-06
 */`,

  'public/boutique/js/b-catalog.js': `/**
 * @komerce-arch
 * @role          boutique-catalog-renderer
 * @domain        catalog
 * @layer         ui-component
 * @criticality   high
 * @inputs        products, active_category, active_subcategory, search, pagination
 * @outputs       product_grid, home_sections, category_state
 * @depends       b-store.js, b-subcat.js, b-pager.js, b-modal.js, shop-schema.js, render/render-product-card.js, render/render-home-sections.js, product-store.js
 * @used-by       b-boutique.js, b-desktop-sidebar.js, b-subcat.js, b-nav.js
 * @doctrine      boutique_canal_decouverte, categorie_souscategorie_switch_fluide, navigation_sans_friction
 * @impact-areas  product-discovery, category-navigation, modal-entry, side-cart-layout
 * @version       2026-06
 */`,

  'public/boutique/js/b-subcat.js': `/**
 * @komerce-arch
 * @role          boutique-subcategory-navigation
 * @domain        catalog
 * @layer         ui-component
 * @criticality   high
 * @inputs        active_category, subcategory_chips, product_list, viewport
 * @outputs       subcategory_rail, filtered_grid, modal_product_entry
 * @depends       b-store.js, shop-schema.js, b-pager.js, b-catalog.js, b-modal.js, b-cart.js, b-scroll-owner.js
 * @used-by       b-boutique.js, b-catalog.js
 * @doctrine      categorie_souscategorie_switch_fluide, navigation_sans_friction, mobile_desktop_coherence
 * @impact-areas  category-navigation, product-grid, header-position, responsive-layout
 * @version       2026-06
 */`,

  'public/boutique/js/b-share-cart.js': `/**
 * @komerce-arch
 * @role          shared-cart-creation-from-boutique
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   critical
 * @inputs        cart_state, phone_identity, share_mode, delivery_date_options
 * @outputs       shared_cart_link, clear_local_cart_signal, group_view_transition
 * @depends       b-store.js, b-cart-core.js, b-cart.js, b-group-view.js, b-group-banner.js, b-phone.js, b-checkout.js, b-identity.js
 * @used-by       b-boutique.js, b-modal-approche-c-hybrid.js
 * @doctrine      partager_geste_natif, panier_ouvert_ferme, paiement_seul_acte_engageant, boutique_canal_decouverte
 * @impact-areas  shared-cart-creation, checkout, participant-flow, creator-flow, local-cart
 * @version       2026-06
 */`,

  'public/boutique/js/b-nav.js': `/**
 * @komerce-arch
 * @role          boutique-view-navigation
 * @domain        boutique
 * @layer         ui-state
 * @criticality   high
 * @inputs        tab_selection, dom_state, group_context
 * @outputs       active_view, cart_drawer, group_view, relais_preload
 * @depends       b-store.js, b-cart.js, b-checkout.js, b-catalog.js, b-favs.js, b-tracking.js, b-group-view.js, b-pager.js
 * @used-by       b-boutique.js
 * @doctrine      navigation_sans_friction, participant_peut_verifier, mobile_desktop_coherence
 * @impact-areas  boutique-navigation, group-view, cart, tracking, checkout
 * @version       2026-06
 */`
};

function applyHeader(relativePath, header) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, status: 'missing' };
  }

  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes('@komerce-arch')) {
    return { file: relativePath, status: 'skipped-existing' };
  }

  fs.writeFileSync(filePath, `${header}\n\n${src}`, 'utf8');
  return { file: relativePath, status: 'updated' };
}

function main() {
  const results = Object.entries(HEADERS).map(([file, header]) => applyHeader(file, header));
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  for (const result of results) {
    console.log(`${result.status.padEnd(16)} ${result.file}`);
  }
  console.log('\nSummary:', counts);
}

main();
