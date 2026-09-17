'use strict';

/**
 * @komerce-arch
 * @role          allegro-golden-native-money-operator-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        existing Golden order/product/SKU, admin runtime credential
 * @outputs       supplier API mapping + canonical Purchase Order proof
 * @depends       db.js, official purchasing HTTP API, services/purchasing-trigger-service.js
 * @used-by       operator CLI / Golden E2E
 * @db-read       users, product_suppliers, purchase_orders, suppliers
 * @db-write-via  routes/purchasing.js, services/purchasing-trigger-service.js
 * @db-txn        delegated
 * @doctrine      exact_sku_identity, canonical_supplier_money, official_api_no_sql_bypass
 * @impact-areas  purchasing, supplier-integration, e2e
 * @version       2026-09
 */

const db = require('../db');

function readArg(argv, name) {
  const inline = argv.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseArgs(argv = process.argv.slice(2)) {
  const orderId = readArg(argv, '--order-id');
  const productId = readArg(argv, '--product-id');
  const supplierSku = readArg(argv, '--supplier-sku');
  const supplierName = readArg(argv, '--supplier-name') || 'Allegro Sandbox';
  if (!orderId || !productId || !supplierSku) {
    throw new Error('Usage: --order-id <uuid> --product-id <uuid> --supplier-sku <ref> [--supplier-name <name>]');
  }
  return { orderId, productId, supplierSku, supplierName };
}

async function responseJson(response) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!response.ok) {
    const error = new Error(`HTTP_${response.status}_${JSON.stringify(body)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function authCookie(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  const raw = setCookies[0] || response.headers.get('set-cookie');
  if (!raw) throw new Error('LOGIN_COOKIE_MISSING');
  return raw.split(';')[0];
}

async function runGoldenNativeMoneyProof({
  orderId,
  productId,
  supplierSku,
  supplierName = 'Allegro Sandbox',
  apiUrl = process.env.KOMERCE_API_URL || process.env.PUBLIC_BASE_URL || 'https://komerce.co',
  adminPassword = process.env.ADMIN_PASSWORD,
  query = db.query.bind(db),
  fetchImpl = global.fetch,
  triggerPurchasing,
} = {}) {
  if (!orderId || !productId || !supplierSku) throw new Error('GOLDEN_INPUTS_REQUIRED');
  if (!adminPassword) throw new Error('ADMIN_PASSWORD_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_REQUIRED');

  const { rows: admins } = await query(
    'SELECT email, phone FROM users WHERE role = $1 ORDER BY created_at ASC LIMIT 1',
    ['admin']
  );
  const admin = admins[0];
  if (!admin || (!admin.email && !admin.phone)) throw new Error('ADMIN_IDENTITY_NOT_FOUND');

  const loginPayload = admin.email
    ? { email: admin.email, password: adminPassword }
    : { phone: admin.phone, password: adminPassword };
  const loginResponse = await fetchImpl(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(loginPayload),
  });
  await responseJson(loginResponse);
  const cookie = authCookie(loginResponse);
  const origin = new URL(apiUrl).origin;
  const authHeaders = { Cookie: cookie, Origin: origin };
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };

  const supplierList = await responseJson(await fetchImpl(
    `${apiUrl}/api/purchasing/suppliers?platform=allegro`,
    { headers: authHeaders }
  ));
  if (!Array.isArray(supplierList)) throw new Error('ALLEGRO_SUPPLIER_LIST_INVALID');
  if (supplierList.length > 1) throw new Error(`ALLEGRO_SUPPLIER_AMBIGUOUS_${supplierList.length}`);

  let supplier = supplierList[0] || null;
  let supplierCreated = false;
  if (!supplier) {
    supplier = await responseJson(await fetchImpl(`${apiUrl}/api/purchasing/suppliers`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: supplierName,
        platform: 'allegro',
        auto_order: false,
        lead_time_days: 2,
        notes: `Golden ${orderId} exact SKU/SOI`,
      }),
    }));
    supplierCreated = true;
  }
  if (!supplier?.id || String(supplier.platform || '').toLowerCase() !== 'allegro') {
    throw new Error('ALLEGRO_SUPPLIER_INVALID');
  }

  const mapping = await responseJson(await fetchImpl(
    `${apiUrl}/api/purchasing/suppliers/${supplier.id}/map`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        product_id: productId,
        supplier_sku: supplierSku,
        min_order_qty: 1,
        priority: 1,
        notes: `Golden ${orderId} canonical native-money mapping`,
      }),
    }
  ));
  if (mapping?.supplier_price_aed !== null) throw new Error('MAPPING_LEGACY_AED_NOT_NULL');

  const trigger = triggerPurchasing
    || require('../services/purchasing-trigger-service').triggerPurchasing;
  const triggerResult = await trigger(orderId);

  const { rows: purchaseOrders } = await query(`
    SELECT po.id,
           po.order_id,
           ps.product_id,
           po.product_sku_id,
           po.supplier_id,
           po.supplier_sku,
           po.supplier_unit_ref,
           po.supplier_order_identity,
           po.qty,
           po.unit_price_aed,
           po.supplier_unit_price,
           po.supplier_currency,
           po.supplier_total_price,
           po.status,
           po.trigger_mode,
           s.name AS supplier_name,
           s.platform,
           ps.supplier_price_aed AS mapping_supplier_price_aed
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN product_suppliers ps ON ps.id = po.product_supplier_id
     WHERE po.order_id = $1
     ORDER BY po.created_at ASC
  `, [orderId]);

  if (purchaseOrders.length !== 1) {
    throw new Error(`GOLDEN_PURCHASE_ORDER_NOT_EXACT_${purchaseOrders.length}`);
  }
  const po = purchaseOrders[0];
  if (po.product_id !== productId || po.supplier_sku !== supplierSku) {
    throw new Error('GOLDEN_PURCHASE_ORDER_IDENTITY_MISMATCH');
  }
  if (po.mapping_supplier_price_aed !== null || po.unit_price_aed !== null) {
    throw new Error('GOLDEN_LEGACY_AED_LEAK');
  }
  if (!(Number(po.supplier_unit_price) > 0) || !/^[A-Z]{3}$/.test(String(po.supplier_currency || ''))) {
    throw new Error('GOLDEN_NATIVE_MONEY_INVALID');
  }

  return {
    stage: 'PURCHASING_NATIVE_MONEY',
    status: 'PASS',
    supplier_created: supplierCreated,
    supplier: {
      id: supplier.id,
      name: supplier.name,
      platform: supplier.platform,
      auto_order: supplier.auto_order,
    },
    mapping: {
      id: mapping.id,
      product_id: mapping.product_id,
      supplier_id: mapping.supplier_id,
      supplier_sku: mapping.supplier_sku,
      supplier_price_aed: mapping.supplier_price_aed,
      is_active: mapping.is_active,
    },
    trigger: triggerResult,
    purchase_order: po,
  };
}

async function main() {
  try {
    const report = await runGoldenNativeMoneyProof(parseArgs());
    console.log(`KOMERCE_GOLDEN_PURCHASING=${JSON.stringify(report)}`);
  } catch (error) {
    console.error(`KOMERCE_GOLDEN_PURCHASING_ERROR=${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
  }
}

if (require.main === module) main();

module.exports = {
  readArg,
  parseArgs,
  responseJson,
  authCookie,
  runGoldenNativeMoneyProof,
};
