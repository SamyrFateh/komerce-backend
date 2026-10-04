/**
 * @komerce-arch
 * @role          cj-purchasing-contract
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical supplier identity, destination, logistics, quantity
 * @outputs       validated CJ createOrderV2 payload + read-back contract
 * @depends       none
 * @used-by       future CJ fulfillment adapter / P1 proof
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PURCHASING_PROVIDER_GOLDEN_E2E.md, docs/external-providers/suppliers/CJ_PURCHASING_CONTRACT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';

const provider = 'cj';

const ENDPOINTS = Object.freeze({
  create_order_v2: '/api2.0/v1/shopping/order/createOrderV2',
  get_order_detail: '/api2.0/v1/shopping/order/getOrderDetail',
  confirm_order: '/api2.0/v1/shopping/order/confirmOrder',
  pay_balance_v2: '/api2.0/v1/shopping/pay/payBalanceV2',
  freight_calculate: '/api2.0/v1/logistic/freightCalculate',
});

function assertString(value, code, max = 200) {
  const s = String(value || '').trim();
  if (!s || s.length > max) throw new Error(code);
  return s;
}

function assertCountry(value, code) {
  const s = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(s)) throw new Error(code);
  return s;
}

function extractIdentity(identity) {
  if (identity?.provider !== provider || identity?.version !== 1) {
    throw new Error('CJ_IDENTITY_MISMATCH');
  }
  const payload = identity.payload || {};
  const pid = assertString(payload.pid, 'CJ_PID_REQUIRED', 128);
  const vid = assertString(payload.vid, 'CJ_VID_REQUIRED', 128);
  const variantSku = assertString(payload.variant_sku, 'CJ_VARIANT_SKU_REQUIRED', 128);
  return { pid, vid, variantSku };
}

function buildCreateOrderV2Payload({
  orderNumber,
  identity,
  quantity,
  destination,
  logisticName,
  fromCountryCode,
  platform = 'komerce',
  storeLineItemId = null,
  remark = null,
  sandbox = false,
} = {}) {
  const { vid } = extractIdentity(identity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('CJ_QUANTITY_INVALID');

  const d = destination || {};
  const payload = {
    orderNumber: assertString(orderNumber, 'CJ_ORDER_NUMBER_REQUIRED', 200),
    shippingZip: assertString(d.postal_code ?? d.zip ?? d.shippingZip, 'CJ_SHIPPING_ZIP_REQUIRED', 100),
    shippingCountryCode: assertCountry(d.country_code ?? d.countryCode, 'CJ_SHIPPING_COUNTRY_CODE_REQUIRED'),
    shippingCountry: assertString(d.country ?? d.shippingCountry, 'CJ_SHIPPING_COUNTRY_REQUIRED', 100),
    shippingProvince: assertString(d.province ?? d.state ?? d.shippingProvince, 'CJ_SHIPPING_PROVINCE_REQUIRED', 100),
    shippingCity: assertString(d.city ?? d.shippingCity, 'CJ_SHIPPING_CITY_REQUIRED', 100),
    shippingCustomerName: assertString(d.customer_name ?? d.name ?? d.shippingCustomerName, 'CJ_SHIPPING_NAME_REQUIRED', 200),
    shippingAddress: assertString(d.address1 ?? d.address ?? d.shippingAddress, 'CJ_SHIPPING_ADDRESS_REQUIRED', 300),
    shippingPhone: assertString(d.phone ?? d.shippingPhone, 'CJ_SHIPPING_PHONE_REQUIRED', 100),
    logisticName: assertString(logisticName, 'CJ_LOGISTIC_NAME_REQUIRED', 100),
    fromCountryCode: assertCountry(fromCountryCode, 'CJ_FROM_COUNTRY_CODE_REQUIRED'),
    platform: assertString(platform, 'CJ_PLATFORM_REQUIRED', 50),
    payType: 3,
    ...(sandbox ? { isSandbox: 1 } : {}),
    products: [{
      vid,
      quantity,
      ...(storeLineItemId ? { storeLineItemId: assertString(storeLineItemId, 'CJ_STORE_LINE_ITEM_ID_INVALID', 200) } : {}),
    }],
  };

  if (d.county ?? d.shippingCounty) payload.shippingCounty = String(d.county ?? d.shippingCounty).trim();
  if (d.address2 ?? d.shippingAddress2) payload.shippingAddress2 = String(d.address2 ?? d.shippingAddress2).trim();
  if (d.email) payload.email = String(d.email).trim();
  if (remark) payload.remark = String(remark).trim().slice(0, 500);

  return payload;
}

function parseCreateOrderResponse(body) {
  if (!body || body.result !== true || !body.data || typeof body.data !== 'object') {
    throw new Error('CJ_CREATE_ORDER_REJECTED');
  }
  const orderId = assertString(body.data.orderId, 'CJ_ORDER_ID_MISSING', 200);
  const orderNumber = assertString(body.data.orderNumber, 'CJ_ORDER_NUMBER_MISSING', 200);
  return {
    provider,
    external_ref: orderId,
    order_number: orderNumber,
    shipment_order_id: body.data.shipmentOrderId ? String(body.data.shipmentOrderId) : null,
    product_amount: body.data.productAmount ?? null,
    postage_amount: body.data.postageAmount ?? null,
    currency: 'USD',
    request_id: body.requestId ? String(body.requestId) : null,
    commitment_verdict: 'created_unpaid',
  };
}

function buildOrderDetailQuery(orderId) {
  return { orderId: assertString(orderId, 'CJ_ORDER_ID_REQUIRED', 200) };
}

module.exports = {
  provider,
  ENDPOINTS,
  extractIdentity,
  buildCreateOrderV2Payload,
  parseCreateOrderResponse,
  buildOrderDetailQuery,
};
