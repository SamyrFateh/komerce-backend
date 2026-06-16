'use strict';

/**
 * Applies @komerce-arch headers to backend business-critical Komerce files.
 * Idempotent and documentation-only.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const HEADERS = {
  'services/payment-stripe.js': `/**
 * @komerce-arch
 * @role          stripe-payment-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        payment_intent, stripe_event, order_reference, metadata
 * @outputs       payment_confirmation, processed_event, stock_transition, notifications
 * @depends       services/order-payment-confirmation.js, services/notification-service.js, services/loyalty-service.js, routes/pickup-secret.js
 * @used-by       routes/payments.js, stripe_webhooks
 * @doctrine      idempotence_stripe, payment_to_stock_single_entry, raw_body_webhook_intact, wallet_non_modifie_ici
 * @impact-areas  payments, orders, stock, pickup, notifications, loyalty, sourcing
 * @version       2026-06
 */`,

  'services/payment-cash-confirm.js': `/**
 * @komerce-arch
 * @role          cash-payment-confirmation-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        cash_ref_code, relais_actor, order_reference
 * @outputs       payment_confirmation, stock_transition, rollback_or_alert
 * @depends       services/order-payment-confirmation.js, db.js
 * @used-by       routes/payments.js, relais-dashboard
 * @doctrine      payment_to_stock_single_entry, cash_validation_tracee, cash_rollback_vs_stripe_alert
 * @impact-areas  cash, orders, stock, relais, notifications, sourcing
 * @version       2026-06
 */`,

  'services/order-status-machine.js': `/**
 * @komerce-arch
 * @role          order-status-state-machine
 * @domain        orders
 * @layer         machine
 * @criticality   critical
 * @inputs        order_id, current_status, target_status, actor, reason
 * @outputs       validated_transition, order_history, side_effects
 * @depends       db.js, services/notification-service.js
 * @used-by       order-payment-confirmation.js, routes/orders.js, cancellation-flows, admin-flows
 * @doctrine      status_transition_source_unique, payment_to_stock_single_entry, annulation_tracee
 * @impact-areas  orders, payments, stock, wallet, sourcing, notifications, dashboards
 * @version       2026-06
 */`,

  'services/order-service.js': `/**
 * @komerce-arch
 * @role          order-domain-helpers
 * @domain        orders
 * @layer         service
 * @criticality   high
 * @inputs        order_payload, wallet_context, reference_seed
 * @outputs       order_reference, pickup_code, wallet_applied_state
 * @depends       db.js, services/wallet-service.js
 * @used-by       routes/orders.js, shared-cart-engine.js, checkout-flows
 * @doctrine      reference_commande_lisible, wallet_applique_une_fois, helpers_sans_route_http
 * @impact-areas  checkout, orders, wallet, tracking, shared-cart
 * @version       2026-06
 */`,

  'services/notification-service.js': `/**
 * @komerce-arch
 * @role          customer-notification-orchestrator
 * @domain        notification
 * @layer         service
 * @criticality   high
 * @inputs        phone, template_context, notification_event, channel_preferences
 * @outputs       whatsapp_message, sms_fallback, email_fallback, delivery_log
 * @depends       services/whatsapp-meta.js, providers/authkey, email-provider
 * @used-by       otp.js, payment-stripe.js, order-status-machine.js, shared-cart-engine.js, reminders
 * @doctrine      notification_non_bloquante, otp_message_lisible, fallback_trace
 * @impact-areas  otp, checkout, shared-cart, orders, customer-support, whatsapp
 * @version       2026-06
 */`,

  'services/whatsapp-meta.js': `/**
 * @komerce-arch
 * @role          meta-whatsapp-adapter
 * @domain        notification
 * @layer         external-adapter
 * @criticality   high
 * @inputs        phone_number_id, template_name, recipient_phone, message_payload
 * @outputs       meta_message_id, delivery_response, adapter_error
 * @depends       Meta Graph API, env META_WA_*
 * @used-by       notification-service.js, routes/meta-whatsapp.js
 * @doctrine      whatsapp_template_trace, provider_adapter_isole, secrets_env_only
 * @impact-areas  whatsapp, otp, notifications, shared-cart, checkout
 * @version       2026-06
 */`,

  'routes/orders.js': `/**
 * @komerce-arch
 * @role          orders-http-facade
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        cart_items, client_identity, relais_id, payment_mode, wallet_choice
 * @outputs       order, order_history, tracking_data, wallet_application
 * @depends       services/order-service.js, services/order-status-machine.js, services/inventory-service.js, services/notification-service.js, db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js, public/boutique/js/b-tracking.js
 * @doctrine      paiement_seul_acte_engageant, order_creation_idempotent, stock_apres_paiement
 * @impact-areas  checkout, orders, tracking, wallet, stock, notifications, shared-cart
 * @version       2026-06
 */`,

  'routes/products.js': `/**
 * @komerce-arch
 * @role          products-http-facade
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        product_filters, product_id, admin_product_payload
 * @outputs       product_list, product_detail, product_mutation_result
 * @depends       db.js, validators.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-catalog.js, public/boutique/js/b-modal-core.js, komerce-api.js
 * @doctrine      catalogue_source_db, produit_reference_stable, produit_desactive_non_supprime
 * @impact-areas  catalog, product-discovery, modal, admin-products, suggestions
 * @version       2026-06
 */`,

  'services/shared-cart-estimation-service.js': `/**
 * @komerce-arch
 * @role          shared-cart-estimation-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        shared_cart_id, participant_identity, estimated_amount
 * @outputs       estimation_snapshot, aggregate_estimation, creator_visibility
 * @depends       db.js, services/shared-cart-queries.js
 * @used-by       routes/shared-cart.js, b-group-view.js
 * @doctrine      estimations_indicatives, paiement_seul_acte_engageant, visibilite_createur
 * @impact-areas  participant-flow, creator-flow, shared-cart-progress, notifications
 * @version       2026-06
 */`,

  'services/shared-cart-financial-guard.js': `/**
 * @komerce-arch
 * @role          shared-cart-financial-guard
 * @domain        shared-cart
 * @layer         policy
 * @criticality   critical
 * @inputs        contribution_event, stripe_event, shared_cart_state, amount
 * @outputs       validated_contribution, rejected_event, financial_alert
 * @depends       db.js, services/shared-cart-queries.js
 * @used-by       routes/shared-cart.js, services/shared-cart-engine.js
 * @doctrine      idempotence_financiere, paiement_seul_acte_engageant, no_overcollection_silent
 * @impact-areas  shared-cart, payments, stripe, participant-flow, creator-flow
 * @version       2026-06
 */`,

  'services/shared-cart-items-service.js': `/**
 * @komerce-arch
 * @role          shared-cart-items-update-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        shared_cart_id, cart_items, actor_identity, open_cart_state
 * @outputs       updated_cart_items, snapshot_recalculation, participant_notification_signal
 * @depends       db.js, services/shared-cart-queries.js, services/shared-cart-v41-transitions.js
 * @used-by       routes/shared-cart.js, public/boutique/js/b-cart.js
 * @doctrine      panier_ouvert_modifiable, snapshot_fige_apres_fermeture, participant_lecture_seule
 * @impact-areas  shared-cart-editing, creator-flow, participant-flow, cart, notifications
 * @version       2026-06
 */`,

  'services/shared-cart-v41-transitions.js': `/**
 * @komerce-arch
 * @role          shared-cart-v41-transition-projector
 * @domain        shared-cart
 * @layer         machine
 * @criticality   critical
 * @inputs        shared_cart_status, event_date, payment_window, creator_choice, contribution_state
 * @outputs       projected_status, deadline_state, allowed_actions
 * @depends       doctrine/V4.1, utils/rules.js
 * @used-by       services/shared-cart-engine.js, services/shared-cart-items-service.js, routes/shared-cart.js
 * @doctrine      panier_ouvert_ferme, fenetre_paiement_48h, choix_createur_72h, paiement_seul_acte_engageant
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout, crons
 * @version       2026-06
 */`,

  'services/shared-cart-queries.js': `/**
 * @komerce-arch
 * @role          shared-cart-db-query-service
 * @domain        shared-cart
 * @layer         data-service
 * @criticality   high
 * @inputs        shared_cart_id, token, user_id, status_filters
 * @outputs       shared_cart_records, contribution_records, participant_records
 * @depends       db.js
 * @used-by       routes/shared-cart.js, shared-cart-engine.js, shared-cart-services
 * @doctrine      backend_source_verite, lookup_centralise, token_public_controle
 * @impact-areas  shared-cart, participant-flow, creator-flow, admin-debug, crons
 * @version       2026-06
 */`,

  'routes/wallet.js': `/**
 * @komerce-arch
 * @role          wallet-http-facade
 * @domain        wallet
 * @layer         route
 * @criticality   high
 * @inputs        client_session, wallet_mutation, order_reference
 * @outputs       wallet_balance, ledger_entries, wallet_application_result
 * @depends       services/wallet-service.js, middleware/auth.js, db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js, dashboards
 * @doctrine      wallet_ledger_trace, credit_debit_idempotent, wallet_non_cadeau_cache
 * @impact-areas  checkout, wallet, orders, refunds, admin-dashboard
 * @version       2026-06
 */`,

  'routes/admin-boutique-categories.js': `/**
 * @komerce-arch
 * @role          boutique-taxonomy-admin-api
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        admin_category_payload, subcategory_payload, ordering
 * @outputs       category_config, subcategory_config, taxonomy_mutation_result
 * @depends       db.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js, admin-dashboard, shop-schema-sync
 * @doctrine      categories_maj_sans_code, taxonomy_source_db, no_hardcoded_taxonomy
 * @impact-areas  catalog, boutique-admin, category-navigation, product-discovery
 * @version       2026-06
 */`,

  'routes/boutique-suggestions.js': `/**
 * @komerce-arch
 * @role          boutique-suggestions-http-facade
 * @domain        recommendations
 * @layer         route
 * @criticality   high
 * @inputs        visitor_context, navigation_context, product_context
 * @outputs       ranked_products, discovery_sections, personalization_debug
 * @depends       services/boutique-suggestion-service.js, product-store, doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md
 * @used-by       bootstrap/api-routes.js, modal-suggestions, home-personalization
 * @doctrine      suggestions_decouverte_non_intrusives, personnalisation_navigation, boutique_canal_decouverte
 * @impact-areas  product-discovery, modal, home-ranking, personalization, catalog
 * @version       2026-06
 */`
};

function applyHeader(relativePath, header) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return { file: relativePath, status: 'missing' };
  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes('@komerce-arch')) return { file: relativePath, status: 'skipped-existing' };
  fs.writeFileSync(filePath, `${header}\n\n${src}`, 'utf8');
  return { file: relativePath, status: 'updated' };
}

const results = Object.entries(HEADERS).map(([file, header]) => applyHeader(file, header));
const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

for (const result of results) console.log(`${result.status.padEnd(16)} ${result.file}`);
console.log('\nSummary:', counts);
