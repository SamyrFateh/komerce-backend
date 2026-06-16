'use strict';

/**
 * Enriches existing @komerce-arch headers with DB touchpoint metadata.
 * Idempotent and documentation-only.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DB_FIELDS = {
  'services/shared-cart-engine.js': {
    read: 'shared_carts, shared_cart_items, shared_cart_contributions, orders, products',
    write: 'shared_carts, shared_cart_events, shared_cart_contributions, orders',
    txn: 'required_for_state_transition, idempotent_payment_events, snapshot_consistency'
  },
  'routes/shared-cart.js': {
    read: 'shared_carts, shared_cart_items, shared_cart_contributions, shared_cart_estimations, users',
    write: 'shared_carts, shared_cart_estimations, shared_cart_contributions, shared_cart_items',
    txn: 'delegated_to_shared_cart_services, stripe_webhook_idempotency'
  },
  'services/shared-cart-v41-transitions.js': {
    read: 'none',
    write: 'none',
    txn: 'pure_projection_no_db_write'
  },
  'services/shared-cart-items-service.js': {
    read: 'shared_carts, shared_cart_items, products',
    write: 'shared_cart_items, shared_cart_events, shared_carts',
    txn: 'open_cart_only, snapshot_locked_after_close'
  },
  'services/shared-cart-estimation-service.js': {
    read: 'shared_carts, shared_cart_estimations, users',
    write: 'shared_cart_estimations, shared_cart_events',
    txn: 'estimation_is_not_payment, aggregate_recalculation'
  },
  'services/shared-cart-financial-guard.js': {
    read: 'shared_carts, shared_cart_contributions, stripe_events',
    write: 'shared_cart_contributions, shared_cart_events, financial_alerts',
    txn: 'idempotent_contribution_event, no_silent_overcollection'
  },
  'services/shared-cart-queries.js': {
    read: 'shared_carts, shared_cart_items, shared_cart_contributions, shared_cart_estimations, users',
    write: 'none',
    txn: 'centralized_lookup_no_mutation'
  },
  'routes/payments.js': {
    read: 'orders, payments, transactions, rates',
    write: 'payments, transactions, stripe_events',
    txn: 'raw_body_preserved, mutation_delegated_to_payment_services'
  },
  'services/payment-stripe.js': {
    read: 'orders, payments, stripe_events, transactions',
    write: 'stripe_events, payments, transactions, order_status_history',
    txn: 'stripe_event_idempotency, payment_to_stock_single_entry'
  },
  'services/payment-cash-confirm.js': {
    read: 'orders, payments, transactions',
    write: 'payments, transactions, order_status_history',
    txn: 'cash_confirmation_idempotency, rollback_or_alert_on_stock_failure'
  },
  'services/order-payment-confirmation.js': {
    read: 'orders, order_items, products, stock_movements',
    write: 'orders, order_status_history, products, stock_movements, inventory_reservations',
    txn: 'caller_transaction_required, stock_for_update, confirmPaymentCycle_unique'
  },
  'services/order-status-machine.js': {
    read: 'orders, order_status_history',
    write: 'orders, order_status_history',
    txn: 'single_status_transition_gate, append_history_before_side_effects'
  },
  'services/order-service.js': {
    read: 'orders, wallet_accounts, wallet_ledger',
    write: 'orders, wallet_ledger',
    txn: 'order_reference_unique, wallet_application_idempotent'
  },
  'routes/orders.js': {
    read: 'orders, order_items, products, users, wallet_accounts, wallet_ledger',
    write: 'orders, order_items, order_status_history, wallet_ledger',
    txn: 'order_creation_idempotency, stock_after_payment_only'
  },
  'routes/products.js': {
    read: 'products, product_images, boutique_categories, boutique_subcategories',
    write: 'products, product_images',
    txn: 'product_reference_stable, deactivate_not_delete'
  },
  'routes/admin-boutique-categories.js': {
    read: 'boutique_categories, boutique_subcategories',
    write: 'boutique_categories, boutique_subcategories',
    txn: 'taxonomy_order_consistency, admin_only_mutation'
  },
  'routes/boutique-suggestions.js': {
    read: 'products, product_events, product_suggestions, visitor_navigation',
    write: 'suggestion_logs, personalization_events',
    txn: 'read_mostly, suggestions_non_blocking'
  },
  'routes/otp.js': {
    read: 'users, otp_codes, jwt_revocations',
    write: 'users, otp_codes, sessions',
    txn: 'otp_single_use, test_mode_never_prod, phone_normalization'
  },
  'routes/wallet.js': {
    read: 'wallet_accounts, wallet_ledger, orders',
    write: 'wallet_accounts, wallet_ledger',
    txn: 'ledger_append_only, credit_debit_idempotent'
  },
  'services/notification-service.js': {
    read: 'notification_templates, users, orders, shared_carts',
    write: 'notification_logs',
    txn: 'notification_non_blocking, failure_logged_not_rolled_back'
  },
  'services/whatsapp-meta.js': {
    read: 'none',
    write: 'none',
    txn: 'external_provider_only, secrets_env_only'
  },
  'routes/economic-engine.js': {
    read: 'economic_variables, economic_charges, economic_snapshots, orders, products',
    write: 'economic_variables, economic_charges, economic_snapshots',
    txn: 'invalidate_cache_after_mutation, admin_only_mutation'
  },
  'services/economic-engine-queries.js': {
    read: 'economic_variables, economic_charges, economic_snapshots, orders, products, pricing_benchmarks',
    write: 'economic_snapshots, economic_alerts',
    txn: 'snapshot_debounce, coherence_model_recalculation'
  }
};

function enrich(relativePath, fields) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return { file: relativePath, status: 'missing' };

  const src = fs.readFileSync(filePath, 'utf8');
  if (!src.includes('@komerce-arch')) return { file: relativePath, status: 'no-header' };
  if (src.includes('@db-read')) return { file: relativePath, status: 'skipped-existing' };

  const lines = [
    ` * @db-read       ${fields.read}`,
    ` * @db-write      ${fields.write}`,
    ` * @db-txn        ${fields.txn}`
  ].join('\n');

  const next = src.replace(/( \* @used-by\s+[^\n]+\n)/, `$1${lines}\n`);
  if (next === src) return { file: relativePath, status: 'anchor-not-found' };

  fs.writeFileSync(filePath, next, 'utf8');
  return { file: relativePath, status: 'updated' };
}

const results = Object.entries(DB_FIELDS).map(([file, fields]) => enrich(file, fields));
const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] || 0) + 1;
  return acc;
}, {});

for (const result of results) console.log(`${result.status.padEnd(18)} ${result.file}`);
console.log('\nSummary:', counts);
