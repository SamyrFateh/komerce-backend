'use strict';

const preflight = require('./aliexpress-purchase-preflight');
const connected = require('./connectors/aliexpress-connected-connector');

async function resolveSupplierProductRef(db, row, identity) {
  const fromIdentity = String(identity?.payload?.product_id || '').trim();
  if (fromIdentity) return fromIdentity;

  const { rows } = await db.query(
    `SELECT DISTINCT supplier_product_id
       FROM sourcing_candidates
      WHERE product_id = $1
        AND supplier_name = 'AliExpress'
        AND state = 'imported_to_catalog'
        AND supplier_product_id IS NOT NULL`,
    [row.product_id]
  );
  const refs = rows.map(r => String(r.supplier_product_id || '').trim()).filter(Boolean);
  if (refs.length !== 1) {
    const error = new Error(`supplier_product_id AliExpress non univoque (${refs.length})`);
    error.code = 'BLOCKED_SUPPLIER_IDENTITY';
    throw error;
  }
  return refs[0];
}

function classify(error, VERDICT) {
  const message = String(error?.message || error || '');
  if (error?.code === 'BLOCKED_SUPPLIER_IDENTITY' || /Supplier Order Identity|supplier_product_id|ambigu/i.test(message)) {
    return VERDICT.BLOCKED_IDENTITY;
  }
  if (/stock|inventory|quantit/i.test(message)) return VERDICT.OUT_OF_STOCK;
  const kind = preflight.classifyApiError(error);
  if (kind === 'auth' || kind === 'permission') return VERDICT.SUPPLIER_UNAVAILABLE;
  return VERDICT.PREFLIGHT_FAILED;
}

async function evaluate({ db, row, identity, quantity, destination, context = {}, VERDICT, result }) {
  const api = context.aliexpressConnected || connected;
  const pf = context.aliexpressPreflight || preflight;
  let productRef;
  try {
    productRef = await resolveSupplierProductRef(db, row, identity);
  } catch (error) {
    return result(VERDICT.BLOCKED_IDENTITY, { product_sku_id: row.id, provider: 'aliexpress' }, String(error.message || error));
  }

  const shipTo = String(destination.country_code || destination.countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(shipTo)) {
    return result(VERDICT.PREFLIGHT_FAILED, { product_sku_id: row.id, provider: 'aliexpress' }, 'destination.country_code requis');
  }

  let liveContract;
  try {
    const live = await api.fetchProducts({
      env: context.env || process.env,
      productIds: [productRef],
      countryCode: shipTo,
    });
    liveContract = live.products?.[0];
  } catch (error) {
    return result(classify(error, VERDICT), { product_sku_id: row.id, provider: 'aliexpress', supplier_product_id: productRef }, String(error.message || error));
  }
  if (!liveContract) {
    return result(VERDICT.SUPPLIER_UNAVAILABLE, { product_sku_id: row.id, provider: 'aliexpress', supplier_product_id: productRef }, 'Produit fournisseur absent du refresh live');
  }

  let resolved;
  try {
    resolved = pf.resolveOrderableUnit(liveContract, row.supplier_sku, quantity, { requireOrderIdentity: true });
  } catch (error) {
    return result(classify(error, VERDICT), { product_sku_id: row.id, provider: 'aliexpress', supplier_product_id: productRef }, String(error.message || error));
  }

  let freightPayload;
  try {
    const params = pf.buildFreightBusinessParams(resolved, destination);
    freightPayload = await api.invokeTop(pf.METHODS.FREIGHT, params, { env: context.env || process.env });
  } catch (error) {
    const kind = pf.classifyApiError(error);
    const status = kind === 'auth' || kind === 'permission' ? VERDICT.SUPPLIER_UNAVAILABLE : VERDICT.FREIGHT_UNAVAILABLE;
    return result(status, {
      product_sku_id: row.id,
      provider: 'aliexpress',
      supplier_product_id: productRef,
      supplier_unit_ref: row.supplier_unit_ref,
      stock_available: resolved.stock_available,
      unit_price: resolved.unit_price,
      currency: resolved.currency,
      freight_error_class: kind,
    }, String(error.message || error));
  }

  const freight = pf.summarizeFreightResponse(freightPayload);
  if (freight.success === false || !freight.has_options) {
    return result(VERDICT.NOT_SHIPPABLE, {
      product_sku_id: row.id,
      provider: 'aliexpress',
      supplier_product_id: productRef,
      supplier_unit_ref: row.supplier_unit_ref,
      stock_available: resolved.stock_available,
      unit_price: resolved.unit_price,
      currency: resolved.currency,
      freight,
    }, freight.error || 'Aucune option de fret disponible');
  }

  return result(VERDICT.READY, {
    product_sku_id: row.id,
    provider: 'aliexpress',
    supplier_product_id: productRef,
    supplier_unit_ref: row.supplier_unit_ref,
    quantity,
    destination_country_code: shipTo,
    stock_available: resolved.stock_available,
    unit_price: resolved.unit_price,
    currency: resolved.currency,
    freight,
    place_order_invoked: false,
    payment_invoked: false,
  });
}

module.exports = { resolveSupplierProductRef, classify, evaluate };
