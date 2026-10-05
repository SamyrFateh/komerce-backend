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
const adapterContract = require('./supplier-fulfillment-adapter-contract');

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

  const executionAuthorized = context.aliexpress_execution_authorized === true
    || context.env?.KOMERCE_ALIEXPRESS_AUTO_ORDER_ENABLED === '1'
    || process.env.KOMERCE_ALIEXPRESS_AUTO_ORDER_ENABLED === '1';
  return result(VERDICT.READY, {
    ...evidence,
    execution_mode: executionAuthorized ? 'api' : 'manual',
    auto_order_ready: executionAuthorized,
    place_order_invoked: false,
    payment_invoked: false,
  });
}

function orderResultRoot(payload = {}) {
  return payload?.result || payload?.resp_result?.result || payload;
}

function parseCreatedOrder(payload = {}) {
  const root = orderResultRoot(payload);
  const success = root?.is_success ?? root?.success ?? root?.result_success;
  if (success === false) {
    throw new Error(`ALIEXPRESS_PLACE_ORDER_REJECTED:${root?.error_msg || root?.error_message || root?.msg || 'unknown'}`);
  }
  const raw = root?.order_list?.number ?? root?.order_list ?? root?.order_id ?? root?.trade_id ?? null;
  const ids = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!ids.length) throw new Error('ALIEXPRESS_PLACE_ORDER_ID_MISSING');
  return { supplier_order_ids: [...new Set(ids)] };
}

function parseOrderDetail(payload = {}) {
  const root = orderResultRoot(payload);
  const orderId = String(root?.order_id || root?.id || root?.trade_id || root?.orderId || '').trim() || null;
  const status = String(root?.order_status || root?.status || root?.orderStatus || '').trim() || null;
  const child = root?.child_order_list?.ae_child_order_info || root?.child_order_list || root?.child_orders || [];
  const children = Array.isArray(child) ? child : (child ? [child] : []);
  return { order_id: orderId, status, child_orders: children };
}

async function buildOrderPayload({ items, preflights, context = {} } = {}) {
  const checked = adapterContract.validateItems(items);
  if (!checked.ok) throw new Error('INVALID_ITEMS');
  if (!Array.isArray(preflights) || preflights.length !== items.length) {
    throw new Error('ALIEXPRESS_PREFLIGHTS_REQUIRED');
  }
  const destination = context.procurement_destination || context.destination;
  if (!destination || !String(destination.address || '').trim()) {
    throw new Error('ALIEXPRESS_PROCUREMENT_DESTINATION_REQUIRED');
  }

  const productItems = items.map((item, index) => {
    const pf = preflights[index];
    if (!pf?.ready || pf?.evidence?.provider !== provider || pf?.evidence?.auto_order_ready !== true) {
      throw new Error('ALIEXPRESS_PREFLIGHT_REQUIRED');
    }
    const identity = item.identity;
    if (!identity || identity.provider !== provider || identity.version !== 1) {
      throw new Error('ALIEXPRESS_IDENTITY_REQUIRED');
    }
    const supplierProductId = String(
      identity.payload?.product_id || pf.evidence.supplier_product_id || ''
    ).trim();
    if (!/^\d{5,20}$/.test(supplierProductId)) throw new Error('ALIEXPRESS_PRODUCT_ID_REQUIRED');

    const native = {
      product_count: item.quantity,
      product_id: Number(supplierProductId),
    };
    const skuAttr = String(identity.payload?.sku_attr || '').trim();
    if (skuAttr) native.sku_attr = skuAttr;
    if (pf.evidence.freight?.service_name) native.logistics_service_name = String(pf.evidence.freight.service_name);
    return native;
  });

  return {
    provider,
    native: {
      param_place_order_request4_open_api_d_t_o: JSON.stringify({
        logistics_address: { ...destination },
        product_items: productItems,
      }),
    },
    expected: {
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      product_count: items.length,
    },
  };
}

async function placeOrder(payload, context = {}) {
  const env = context.env || process.env;
  const authorized = context.aliexpress_execution_authorized === true
    || env.KOMERCE_ALIEXPRESS_AUTO_ORDER_ENABLED === '1';
  if (!authorized) throw new Error('ALIEXPRESS_EXECUTION_NOT_AUTHORIZED');
  if (!payload || payload.provider !== provider || !payload.native) {
    throw new Error('ALIEXPRESS_EXECUTION_PAYLOAD_INVALID');
  }

  const api = context.aliexpressConnected || connected;
  const created = parseCreatedOrder(await api.invokeTop(
    preflight.METHODS.PLACE_ORDER,
    payload.native,
    { env }
  ));

  const details = [];
  for (const supplierOrderId of created.supplier_order_ids) {
    // Read-back is mandatory: creation alone is not an execution proof.
    // eslint-disable-next-line no-await-in-loop
    const detailPayload = await api.invokeTop(
      preflight.METHODS.ORDER_DETAIL,
      { order_id: supplierOrderId },
      { env }
    );
    const detail = parseOrderDetail(detailPayload);
    if (detail.order_id && detail.order_id !== supplierOrderId) {
      throw new Error('ALIEXPRESS_ORDER_READBACK_ID_MISMATCH');
    }
    details.push({ ...detail, order_id: detail.order_id || supplierOrderId });
  }

  return {
    provider,
    supplier_order_id: created.supplier_order_ids[0],
    supplier_order_ids: created.supplier_order_ids,
    commitment_verdict: 'created_unpaid',
    execution_recovery: 'CREATED_NOW_NO_NATIVE_IDEMPOTENCY',
    readback_status: details[0]?.status || null,
    readback_orders: details,
    payment_invoked: false,
    confirmation_invoked: false,
    tracking_url: null,
  };
}

module.exports = {
  provider,
  resolveSupplierProductRef,
  resolveSendGoodsCountry,
  classify,
  evaluate,
  orderResultRoot,
  parseCreatedOrder,
  parseOrderDetail,
  buildOrderPayload,
  placeOrder,
};
