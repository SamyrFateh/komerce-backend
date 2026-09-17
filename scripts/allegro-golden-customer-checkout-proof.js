'use strict';

/**
 * @komerce-arch
 * @role          allegro-golden-customer-checkout-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        existing active catalog product, existing client, explicit relay
 * @outputs       one pending cash order whose exact order_item points to an Allegro product_sku
 * @depends       db.js, services/order-checkout-service.js
 * @db-read       users, orders, order_items, product_skus
 * @db-write-via:order-checkout-service orders, order_items, order_status_history, recipients
 * @db-txn        delegated_to_order_checkout_service
 * @doctrine      golden_composition_not_discovery, exact_sku_identity, no_payment_confirmation_here
 * @impact-areas  orders, checkout, purchasing, supplier-integration
 * @version       2026-09
 */

const db = require('../db');
const { runOrderCheckout } = require('../services/order-checkout-service');

function readArg(argv, name) {
  const inline = argv.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseArgs(argv = process.argv.slice(2)) {
  const productId = readArg(argv, '--product-id');
  const userId = readArg(argv, '--user-id');
  const relaisId = readArg(argv, '--relais-id');
  const quantity = Number(readArg(argv, '--quantity') || 1);
  if (!productId || !userId || !relaisId) {
    throw new Error('Usage: --product-id <uuid> --user-id <uuid> --relais-id <uuid> [--quantity 1]');
  }
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('--quantity doit être un entier >= 1');
  return { productId, userId, relaisId, quantity };
}

async function runGoldenCustomerCheckout({
  productId,
  userId,
  relaisId,
  quantity = 1,
  query = db.query.bind(db),
  checkout = runOrderCheckout,
} = {}) {
  const { rows: users } = await query(
    'SELECT id, full_name, phone, email, role FROM users WHERE id=$1 LIMIT 1',
    [userId]
  );
  const user = users[0];
  if (!user || user.role !== 'client') throw new Error('ALLEGRO_GOLDEN_CLIENT_NOT_FOUND');
  if (!user.full_name || !user.phone) throw new Error('ALLEGRO_GOLDEN_CLIENT_IDENTITY_INCOMPLETE');

  const result = await checkout({
    user,
    body: {
      items: [{ product_id: productId, quantity, variant_combo: null }],
      relais_id: relaisId,
      payment_mode: 'cash_relais',
      tracking_phone: user.phone,
      pickup_code_recipient: 'buyer',
    },
  });

  if (!result?.ok) {
    const error = new Error(`ALLEGRO_GOLDEN_CUSTOMER_CHECKOUT_BLOCKED_${result?.body?.code || result?.status || 'UNKNOWN'}`);
    error.checkout_result = result;
    throw error;
  }

  const { rows } = await query(
    `SELECT o.id AS order_id,
            o.reference,
            o.status,
            o.payment_status,
            o.payment_mode,
            o.cash_ref_code,
            o.relais_id,
            o.total_kmf,
            oi.id AS order_item_id,
            oi.product_id,
            oi.sku_id,
            oi.quantity,
            oi.price_kmf,
            oi.fulfillment_source,
            ps.supplier_sku,
            ps.supplier_unit_ref,
            ps.supplier_order_identity
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN product_skus ps ON ps.id = oi.sku_id
      WHERE o.id = $1`,
    [result.order.id]
  );

  if (rows.length !== 1) throw new Error(`ALLEGRO_GOLDEN_ORDER_ITEM_NOT_EXACT_${rows.length}`);
  const line = rows[0];
  if (line.product_id !== productId || !line.sku_id) throw new Error('ALLEGRO_GOLDEN_SOLD_SKU_MISSING');
  if (line.supplier_order_identity?.provider !== 'allegro') throw new Error('ALLEGRO_GOLDEN_SOLD_SKU_PROVIDER_MISMATCH');
  if (String(line.supplier_order_identity?.payload?.environment || '') !== 'sandbox') {
    throw new Error('ALLEGRO_GOLDEN_SOLD_SKU_ENVIRONMENT_MISMATCH');
  }
  if (line.payment_mode !== 'cash_relais' || line.payment_status !== 'pending') {
    throw new Error('ALLEGRO_GOLDEN_ORDER_PAYMENT_STATE_MISMATCH');
  }

  return {
    stage: 'CUSTOMER_CHECKOUT',
    status: 'PASS',
    order: line,
    payment_confirmed: false,
    purchasing_triggered: false,
  };
}

async function main() {
  try {
    const args = parseArgs();
    const report = await runGoldenCustomerCheckout(args);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      stage: 'CUSTOMER_CHECKOUT',
      status: 'BLOCKED',
      error: error.message,
      checkout_result: error.checkout_result || null,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
  }
}

if (require.main === module) main();

module.exports = { readArg, parseArgs, runGoldenCustomerCheckout };
