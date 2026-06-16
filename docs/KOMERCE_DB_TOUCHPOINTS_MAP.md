# Komerce Database Touchpoints Map

Version: 2026-06

This map complements `@komerce-arch` headers.
Headers should stay short; this file carries the broader database impact model.

## Principle

For AI intervention, database impact matters as much as file dependency impact.
A change can look local in code but affect:

- payment consistency
- stock correctness
- wallet ledger
- OTP/session security
- shared cart state machine
- checkout and order tracking
- catalog and recommendation behavior

## Header Rule

High/critical backend files that touch persistence should declare:

```js
 * @db-read       table_a, table_b
 * @db-write      table_c, table_d
 * @db-txn        transaction_or_idempotency_constraint
```

Use `none` when a file deliberately avoids DB access.
Use `@unknown` only as temporary debt before behavior changes.

## Sensitive Table Families

### Shared Cart

Expected table family:

- `shared_carts`
- `shared_cart_items`
- `shared_cart_contributions`
- `shared_cart_estimations`
- `shared_cart_events`
- `shared_cart_participants`

Critical doctrines:

- `paiement_seul_acte_engageant`
- `panier_ouvert_ferme`
- `snapshot_fige`
- `fenetre_paiement_48h`
- `choix_createur_72h`
- `idempotence_financiere`

Main code owners:

- `services/shared-cart-engine.js`
- `routes/shared-cart.js`
- `services/shared-cart-v41-transitions.js`
- `services/shared-cart-items-service.js`
- `services/shared-cart-estimation-service.js`
- `services/shared-cart-financial-guard.js`
- `services/shared-cart-queries.js`
- `bootstrap/crons.js`

Impact checks:

- participant payment flow
- creator gap decision
- shared cart expiration
- contribution aggregation
- Stripe/cash callback behavior
- notifications

### Orders And Stock

Expected table family:

- `orders`
- `order_items`
- `order_status_history`
- `products`
- `stock_movements`
- `inventory_reservations`

Critical doctrines:

- `payment_to_stock_single_entry`
- `status_transition_source_unique`
- `stock_apres_paiement`
- `confirmPaymentCycle_unique`
- `stock_for_update`

Main code owners:

- `routes/orders.js`
- `services/order-service.js`
- `services/order-status-machine.js`
- `services/order-payment-confirmation.js`
- `services/payment-stripe.js`
- `services/payment-cash-confirm.js`
- `services/inventory-service.js`

Impact checks:

- order creation
- Stripe confirmation
- cash confirmation
- cancellation/refund
- stock decrement
- tracking view
- dashboard totals

### Payment

Expected table family:

- `orders`
- `payments`
- `transactions`
- `stripe_events`
- `payment_attempts`
- `wallet_ledger`

Critical doctrines:

- `idempotence_stripe`
- `raw_body_webhook_intact`
- `payment_to_stock_single_entry`
- `wallet_non_modifie_ici`
- `cash_validation_tracee`

Main code owners:

- `routes/payments.js`
- `services/payment-stripe.js`
- `services/payment-cash-confirm.js`
- `services/order-payment-confirmation.js`
- `services/shared-cart-financial-guard.js`

Impact checks:

- duplicate webhook handling
- cash versus Stripe behavior
- payment retry
- stock movement
- wallet application
- shared cart contribution accounting

### Wallet

Expected table family:

- `wallet_accounts`
- `wallet_ledger`
- `wallet_transactions`
- `orders`
- `refunds`

Critical doctrines:

- `wallet_ledger_trace`
- `credit_debit_idempotent`
- `wallet_applique_une_fois`

Main code owners:

- `routes/wallet.js`
- `services/wallet-service.js`
- `routes/orders.js`
- refund/cancellation flows

Impact checks:

- duplicate credit idempotency
- order cancellation
- refund path
- checkout wallet application
- dashboard wallet balance

### Auth, OTP And Session

Expected table family:

- `users`
- `client_profiles`
- `otp_codes`
- `jwt_revocations`
- `sessions`

Critical doctrines:

- `otp_une_fois`
- `session_client_legere`
- `test_mode_never_prod`
- `phone_normalization`

Main code owners:

- `routes/otp.js`
- `services/notification-service.js`
- `services/otp-test-mode.js`
- `utils/phone.js`
- `public/boutique/js/b-identity.js`
- `public/boutique/js/b-phone.js`

Impact checks:

- first checkout
- shared cart participant access
- order tracking access
- WhatsApp OTP wording
- cookie/session behavior

### Catalog And Taxonomy

Expected table family:

- `products`
- `product_images`
- `boutique_categories`
- `boutique_subcategories`
- `product_taxonomy`
- `product_suggestions`

Critical doctrines:

- `catalogue_source_db`
- `produit_reference_stable`
- `categories_maj_sans_code`
- `taxonomy_source_db`
- `no_hardcoded_taxonomy`
- `boutique_canal_decouverte`

Main code owners:

- `routes/products.js`
- `routes/admin-boutique-categories.js`
- `routes/boutique-suggestions.js`
- `public/boutique/js/shop-schema.js`
- `public/boutique/js/product-store.js`
- `public/boutique/js/b-catalog.js`
- `public/boutique/js/b-modal-suggestions.js`

Impact checks:

- product display
- category navigation
- subcategory rail
- modal suggestions
- home personalization
- admin category updates

### Notifications And WhatsApp

Expected table family:

- `notification_logs`
- `otp_codes`
- `orders`
- `shared_carts`
- `message_templates`

Critical doctrines:

- `notification_non_bloquante`
- `otp_message_lisible`
- `whatsapp_template_trace`
- `provider_adapter_isole`

Main code owners:

- `services/notification-service.js`
- `services/whatsapp-meta.js`
- `routes/meta-whatsapp.js`
- OTP and shared cart flows

Impact checks:

- OTP delivery
- first payment notification
- shared cart reminders
- cash reminder
- order status updates

### Economic Engine

Expected table family:

- `economic_variables`
- `economic_charges`
- `economic_snapshots`
- `orders`
- `products`
- `pricing_benchmarks`

Critical doctrines:

- `moteur_economique_lisible`
- `couts_repartis_par_commande`
- `coherence_model_economique`
- `snapshot_debounce`
- `sov_drift`

Main code owners:

- `routes/economic-engine.js`
- `services/economic-engine-queries.js`
- `utils/eco-bridge.js`
- economic dashboards

Impact checks:

- pricing
- margin
- cost allocation
- dashboard live impact
- executive summary

## AI Intervention Checklist

Before changing a DB-touching file:

1. Read the file header.
2. Identify `@db-read`, `@db-write`, `@db-txn` if present.
3. Compare with this map.
4. Identify whether the change touches payment, stock, wallet, OTP, shared cart or economic totals.
5. If yes, list impacted flows before editing.
6. After editing, update the header if DB touchpoints changed.

## Next Work

- Enrich existing high/critical backend headers with `@db-read`, `@db-write`, `@db-txn`.
- Generate an automatic SQL/table scanner report.
- Cross-check declared DB touchpoints against actual queries.
- Promote mismatches into an architecture debt report.
