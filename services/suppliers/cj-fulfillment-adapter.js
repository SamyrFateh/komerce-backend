/**
 * @komerce-arch
 * @role          cj-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        exact CJ SOI, quantity, procurement destination/logistics, CJ credentials
 * @outputs       live readiness + native order payload + idempotent create/read-back result
 * @depends       services/suppliers/connectors/cj-connector.js, services/suppliers/cj-purchasing-contract.js, services/suppliers/supplier-fulfillment-readiness.js
 * @used-by       candidate for services/suppliers/execution-adapter-registry.js after runtime cutover gate
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PURCHASING_CAPABILITY_DRIVEN_EXECUTION.md, docs/external-providers/suppliers/CJ_PURCHASING_CONTRACT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const connector = require('./connectors/cj-connector');
const contract = require('./cj-purchasing-contract');
const adapterContract = require('./supplier-fulfillment-adapter-contract');
const { VERDICT, result } = require('./supplier-fulfillment-readiness');

const provider = 'cj';

async function invoke(path, { method = 'GET', body = null, query = null, accessToken, fetchImpl = fetch } = {}) {
  const url = new URL(`${connector.BASE_URL}${path.replace('/api2.0/v1', '')}`);
  if (query) Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'CJ-Access-Token': accessToken,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch (_) { throw new Error(`CJ_NON_JSON_RESPONSE:${response.status}`); }
  if (!response.ok || payload?.result === false) {
    const error = new Error(`CJ_HTTP_ERROR:${response.status}:${payload?.message || 'unknown'}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function evaluate({ row, identity, quantity, context = {} } = {}) {
  const evidence = {
    provider,
    execution_mode: 'api',
    auto_order_ready: false,
    place_order_invoked: false,
    payment_invoked: false,
    confirmation_invoked: false,
  };

  let parsed;
  try { parsed = contract.extractIdentity(identity); }
  catch (_) { return result(VERDICT.BLOCKED_IDENTITY, evidence, 'CJ_IDENTITY_MISMATCH'); }

  if (String(row?.supplier_unit_ref || '') !== parsed.vid) {
    return result(VERDICT.BLOCKED_IDENTITY, evidence, 'CJ_UNIT_REF_MISMATCH');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return result(VERDICT.PREFLIGHT_FAILED, evidence, 'INVALID_QUANTITY');
  }

  let fetched;
  try {
    fetched = await connector.fetchProducts({
      productIds: [parsed.pid],
      fetchImpl: context.fetchImpl,
      env: context.env,
      credentials: context.credentials || null,
    });
  } catch (_) {
    return result(VERDICT.SUPPLIER_UNAVAILABLE, evidence, 'CJ_LIVE_READ_FAILED');
  }

  const product = fetched?.products?.[0];
  const units = Array.isArray(product?.sellable_units) ? product.sellable_units : [];
  const unit = units.find((candidate) =>
    String(candidate?.supplier_unit_ref || '') === parsed.vid
    && String(candidate?.supplier_sku || '') === parsed.variantSku
  );
  if (!unit) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'CJ_EXACT_UNIT_NOT_FOUND');

  Object.assign(evidence, {
    supplier_product_id: parsed.pid,
    supplier_unit_ref: parsed.vid,
    supplier_sku: parsed.variantSku,
    stock_available: Number(unit.stock_available),
    unit_price: Number(unit.purchase_price),
    currency: unit.currency,
    exact_unit_resolved: true,
    live_stock_checked: true,
    live_price_checked: true,
  });

  if (unit.is_active === false) return result(VERDICT.SKU_INACTIVE, evidence, 'CJ_UNIT_INACTIVE');
  if (!Number.isFinite(evidence.stock_available) || evidence.stock_available < quantity) {
    return result(VERDICT.OUT_OF_STOCK, evidence, 'CJ_INSUFFICIENT_STOCK');
  }
  if (!(evidence.unit_price > 0) || !evidence.currency) {
    return result(VERDICT.PREFLIGHT_FAILED, evidence, 'CJ_PRICE_OR_CURRENCY_INVALID');
  }

  evidence.auto_order_ready = true;
  return result(VERDICT.READY, evidence);
}

async function buildOrderPayload({ items, preflights, context = {} } = {}) {
  const checked = adapterContract.validateItems(items);
  if (!checked.ok) throw new Error('INVALID_ITEMS');
  if (items.length !== 1) throw new Error('CJ_MULTI_ITEM_UNSUPPORTED');

  const item = items[0];
  const preflight = Array.isArray(preflights) ? preflights[0] : null;
  if (!preflight?.ready || preflight?.evidence?.auto_order_ready !== true) {
    throw new Error('CJ_PREFLIGHT_REQUIRED');
  }

  const destination = context.procurement_destination || context.destination;
  if (!destination) throw new Error('CJ_PROCUREMENT_DESTINATION_REQUIRED');

  const native = contract.buildCreateOrderV2Payload({
    orderNumber: context.order_number,
    identity: item.identity,
    quantity: item.quantity,
    destination,
    logisticName: context.logistic_name,
    fromCountryCode: context.from_country_code,
    platform: 'komerce',
    storeLineItemId: context.store_line_item_id || null,
    remark: context.remark || null,
    sandbox: context.sandbox === true,
  });
  const { vid } = contract.extractIdentity(item.identity);

  return {
    provider,
    native,
    expected: {
      order_number: native.orderNumber,
      vid,
      quantity: item.quantity,
    },
    sandbox: context.sandbox === true,
  };
}

async function placeOrder(payload, context = {}) {
  if (context.cj_execution_authorized !== true) {
    throw new Error('CJ_EXECUTION_NOT_AUTHORIZED');
  }
  if (!payload || payload.provider !== provider || !payload.native || !payload.expected) {
    throw new Error('CJ_EXECUTION_PAYLOAD_INVALID');
  }

  const accessToken = await connector.getAccessToken({
    fetchImpl: context.fetchImpl,
    env: context.env || process.env,
    credentials: context.credentials || null,
  });
  const call = context.invoke || invoke;

  let created;
  let executionRecovery = 'CREATED_NOW';
  let detail;

  try {
    const createBody = await call(contract.ENDPOINTS.create_order_v2, {
      method: 'POST',
      body: payload.native,
      accessToken,
      fetchImpl: context.fetchImpl,
    });
    created = contract.parseCreateOrderResponse(createBody);
  } catch (error) {
    if (!contract.isDuplicateCreateError(error)) throw error;
    executionRecovery = 'RECOVERED_AFTER_DUPLICATE';

    detail = await call(contract.ENDPOINTS.get_order_detail, {
      method: 'GET',
      query: contract.buildOrderDetailQuery(payload.expected.order_number),
      accessToken,
      fetchImpl: context.fetchImpl,
    });
    const facts = contract.readOrderDetailFacts(detail);
    if (!facts.order_id && !facts.order_number) throw new Error('CJ_DUPLICATE_NOT_RESOLVABLE');
    created = {
      provider,
      external_ref: facts.order_id || payload.expected.order_number,
      order_number: facts.order_number || payload.expected.order_number,
      commitment_verdict: 'created_unpaid',
    };
  }

  if (!detail) {
    detail = await call(contract.ENDPOINTS.get_order_detail, {
      method: 'GET',
      query: contract.buildOrderDetailQuery(created.external_ref),
      accessToken,
      fetchImpl: context.fetchImpl,
    });
  }

  const readback = contract.verifyOrderDetail({
    created,
    detail,
    expectedOrderNumber: payload.expected.order_number,
    expectedVid: payload.expected.vid,
    expectedQuantity: payload.expected.quantity,
  });

  return {
    provider,
    supplier_order_id: created.external_ref,
    order_number: created.order_number,
    commitment_verdict: created.commitment_verdict,
    execution_recovery: executionRecovery,
    readback_status: readback.status,
    exact_vid_verified: true,
    exact_quantity_verified: true,
    readback_product_shape: readback.response_product_shape,
    payment_invoked: false,
    confirmation_invoked: false,
    tracking_url: null,
  };
}

module.exports = {
  provider,
  evaluate,
  buildOrderPayload,
  placeOrder,
  _invoke: invoke,
};
