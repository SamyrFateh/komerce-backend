/**
 * @komerce-arch
 * @role          aliexpress-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        persisted Supplier Order Identity, destination, quantity
 * @outputs       live AliExpress fulfillment evidence
 * @depends       services/suppliers/aliexpress-purchase-preflight.js, services/suppliers/connectors/aliexpress-connected-connector.js
 * @used-by       supplier fulfillment composition root / callers
 * @db-read       sourcing_candidates
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration, catalog
 */
'use strict';

const preflight = require('./aliexpress-purchase-preflight');
const connected = require('./connectors/aliexpress-connected-connector');

const provider = 'aliexpress';

async function resolveSupplierProductRef(db, row, identity) {
  const native = String(identity?.payload?.product_id || '').trim();
  if (native) return native;

  const { rows } = await db.query(
    `SELECT DISTINCT supplier_product_id
       FROM sourcing_candidates
      WHERE product_id = $1
        AND supplier_name = 'AliExpress'
        AND state = 'imported_to_catalog'
        AND supplier_product_id IS NOT NULL`,
    [row.product_id]
  );
  const refs = rows
    .map((item) => String(item.supplier_product_id || '').trim())
    .filter(Boolean);
  if (refs.length !== 1) {
    const error = new Error(`supplier_product_id AliExpress non univoque (${refs.length})`);
    error.code = 'BLOCKED_SUPPLIER_IDENTITY';
    throw error;
  }
  return refs[0];
}

function classify(error, VERDICT) {
  const message = String(error?.message || error || '');
  if (
    error?.code === 'BLOCKED_SUPPLIER_IDENTITY'
    || /Supplier Order Identity|supplier_product_id|ambigu/i.test(message)
  ) return VERDICT.BLOCKED_IDENTITY;
  if (/stock|inventory|quantit/i.test(message)) return VERDICT.OUT_OF_STOCK;
  const kind = preflight.classifyApiError(error);
  return kind === 'auth' || kind === 'permission'
    ? VERDICT.SUPPLIER_UNAVAILABLE
    : VERDICT.PREFLIGHT_FAILED;
}

function resolveSendGoodsCountry(live, context = {}) {
  const explicit = String(
    context.send_goods_country_code
    || context.sendGoodsCountryCode
    || context.env?.KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE
    || process.env.KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE
    || ''
  ).trim().toUpperCase();
  if (/^[A-Z]{2,3}$/.test(explicit)) return explicit;

  const raw = live?.raw_payload?.aliexpress?.detail || {};
  const observed = String(
    raw?.ae_store_info?.store_country_code
    || raw?.logistics_info_dto?.ship_from_country
    || ''
  ).trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(observed) ? observed : null;
}

async function evaluate({ db, row, identity, quantity, destination, context = {}, VERDICT, result }) {
  const api = context.aliexpressConnected || connected;
  const pf = context.aliexpressPreflight || preflight;

  let supplierProductId;
  try {
    supplierProductId = await resolveSupplierProductRef(db, row, identity);
  } catch (error) {
    return result(
      VERDICT.BLOCKED_IDENTITY,
      { product_sku_id: row.id, provider },
      String(error.message || error)
    );
  }

  const countryCode = String(destination.country_code || destination.countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryCode)) {
    return result(
      VERDICT.PREFLIGHT_FAILED,
      { product_sku_id: row.id, provider },
      'destination.country_code requis'
    );
  }

  let live;
  try {
    const fetched = await api.fetchProducts({
      env: context.env || process.env,
      productIds: [supplierProductId],
      countryCode,
    });
    live = fetched.products?.[0];
  } catch (error) {
    return result(
      classify(error, VERDICT),
      { product_sku_id: row.id, provider, supplier_product_id: supplierProductId },
      String(error.message || error)
    );
  }

  if (!live) {
    return result(
      VERDICT.SUPPLIER_UNAVAILABLE,
      { product_sku_id: row.id, provider, supplier_product_id: supplierProductId },
      'Produit fournisseur absent du refresh live'
    );
  }

  let unit;
  try {
    unit = pf.resolveOrderableUnit(live, row.supplier_sku, quantity, { requireOrderIdentity: true });
  } catch (error) {
    return result(
      classify(error, VERDICT),
      { product_sku_id: row.id, provider, supplier_product_id: supplierProductId },
      String(error.message || error)
    );
  }

  const sendGoodsCountryCode = resolveSendGoodsCountry(live, context);
  if (!sendGoodsCountryCode) {
    return result(
      VERDICT.FREIGHT_UNAVAILABLE,
      {
        product_sku_id: row.id,
        provider,
        supplier_product_id: supplierProductId,
        supplier_unit_ref: row.supplier_unit_ref,
        stock_available: unit.stock_available,
        unit_price: unit.unit_price,
        currency: unit.currency,
      },
      'Origine d’expédition fournisseur non résolue'
    );
  }

  let payload;
  try {
    payload = await api.invokeTop(
      pf.METHODS.FREIGHT,
      pf.buildFreightQuoteParams(unit, {
        ...destination,
        send_goods_country_code: sendGoodsCountryCode,
      }),
      { env: context.env || process.env }
    );
  } catch (error) {
    const kind = pf.classifyApiError(error);
    const status = classify(error, VERDICT);
    const evidence = {
      product_sku_id: row.id,
      provider,
      supplier_product_id: supplierProductId,
      supplier_unit_ref: row.supplier_unit_ref,
      stock_available: unit.stock_available,
      unit_price: unit.unit_price,
      currency: unit.currency,
      supplier_origin_country_code: sendGoodsCountryCode,
      freight_error_class: kind,
    };
    if (status === VERDICT.BLOCKED_IDENTITY) {
      return result(VERDICT.BLOCKED_IDENTITY, evidence, String(error.message || error));
    }
    return result(
      kind === 'auth' || kind === 'permission'
        ? VERDICT.SUPPLIER_UNAVAILABLE
        : VERDICT.FREIGHT_UNAVAILABLE,
      evidence,
      String(error.message || error)
    );
  }

  const freight = pf.summarizeFreightResponse(payload);
  const evidence = {
    product_sku_id: row.id,
    provider,
    supplier_product_id: supplierProductId,
    supplier_unit_ref: row.supplier_unit_ref,
    quantity,
    destination_country_code: countryCode,
    supplier_origin_country_code: sendGoodsCountryCode,
    stock_available: unit.stock_available,
    unit_price: unit.unit_price,
    currency: unit.currency,
    exact_unit_resolved: true,
    live_stock_checked: true,
    live_price_checked: true,
    supplier_leg_checked: true,
    freight,
  };

  if (freight.success === false || !freight.has_options) {
    return result(
      VERDICT.NOT_SHIPPABLE,
      evidence,
      freight.error || 'Aucune option de fret disponible'
    );
  }

  return result(VERDICT.READY, {
    ...evidence,
    place_order_invoked: false,
    payment_invoked: false,
  });
}

module.exports = {
  provider,
  resolveSupplierProductRef,
  resolveSendGoodsCountry,
  classify,
  evaluate,
};
