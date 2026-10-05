/**
 * @komerce-arch
 * @role          aliexpress-purchase-preflight
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        NormalizedSupplierProduct V2, selected Supplier Order Identity, destination
 * @outputs       live-checkable supplier-leg quote request + place-order payload (never executed here)
 * @depends       services/suppliers/supplier-order-identity.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/ALIEXPRESS_BUSINESS_READINESS.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration, catalog
 * @version       2026-09-ae-prepayment-v5
 */
'use strict';

const supplierIdentity = require('./supplier-order-identity');

const METHODS = Object.freeze({
  // Canonical supplier-leg quote for a specific AliExpress orderable SKU.
  FREIGHT: 'aliexpress.logistics.buyer.freight.get',
  // Kept only for compatibility/diagnostics: product-level calculator.
  FREIGHT_CALCULATE: 'aliexpress.logistics.buyer.freight.calculate',
  PLACE_ORDER: 'aliexpress.trade.buy.placeorder',
  ORDER_DETAIL: 'aliexpress.trade.ds.order.get',
  TRACKING: 'aliexpress.logistics.ds.trackinginfo.query',
});

function positiveInt(value, name = 'quantity') {
  return supplierIdentity.positiveInt(value, name);
}

/**
 * AliExpress-specific interpretation of the opaque Supplier Order Identity.
 * The Komerce core never interprets sku_id or sku_attr itself.
 */
function resolveOrderableUnit(contract, supplierSku, quantity = 1, options = {}) {
  const requireOrderIdentity = options.requireOrderIdentity !== false;
  const resolved = supplierIdentity.resolveSupplierUnit(
    contract,
    supplierSku,
    quantity,
    { ...options, requireOrderIdentity }
  );
  const identity = resolved.supplier_order_identity;

  if (!identity) {
    return {
      ...resolved,
      supplier_product_id: resolved.supplier_product_ref,
      raw_sku_id: null,
      sku_attr: null,
    };
  }

  if (identity.provider !== 'aliexpress') {
    throw supplierIdentity.blockedSupplierIdentity(
      `Supplier Order Identity incompatible avec AliExpress: ${identity.provider}`,
      { expected_provider: 'aliexpress', actual_provider: identity.provider }
    );
  }
  if (identity.version !== 1) {
    throw supplierIdentity.blockedSupplierIdentity(
      `Supplier Order Identity AliExpress version non supportée: ${identity.version}`,
      { provider: 'aliexpress', version: identity.version }
    );
  }

  const rawSkuId = String(identity.payload.sku_id || '').trim() || null;
  const skuAttr = String(identity.payload.sku_attr || '').trim() || null;
  if (!rawSkuId && !skuAttr) {
    throw supplierIdentity.blockedSupplierIdentity(
      `Supplier Order Identity AliExpress inexploitable pour ${supplierSku}`,
      { supplier_sku: supplierSku }
    );
  }

  const supplierProductId = String(resolved.supplier_product_ref || '').trim();
  if (!/^\d{5,20}$/.test(supplierProductId)) {
    throw supplierIdentity.blockedSupplierIdentity(
      'supplier_product_id AliExpress absent ou invalide',
      { supplier_product_ref: resolved.supplier_product_ref || null }
    );
  }

  return {
    ...resolved,
    supplier_product_id: supplierProductId,
    raw_sku_id: rawSkuId,
    sku_attr: skuAttr,
  };
}

function requireCanonicalIdentity(resolved) {
  if (!resolved?.supplier_order_identity) {
    throw supplierIdentity.blockedSupplierIdentity(
      'Supplier Order Identity requise avant appel fournisseur'
    );
  }
}

function normalizeSupplierLegDestination(destination = {}) {
  const countryCode = String(destination.country_code || destination.countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryCode)) throw new Error(`country_code invalide: ${countryCode || 'absent'}`);

  const sendGoodsCountryCode = String(
    destination.send_goods_country_code || destination.sendGoodsCountryCode || ''
  ).trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(sendGoodsCountryCode)) {
    throw new Error('send_goods_country_code requis pour le fret AliExpress');
  }

  return { countryCode, sendGoodsCountryCode };
}

/**
 * SKU-aware supplier-leg quote. Live proof on 2026-09-13 established that
 * freight.get requires the native numeric AliExpress sku_id. The descriptive
 * composite `id` is not accepted as sku_id.
 */
function buildFreightQuoteParams(resolved, destination = {}) {
  if (!resolved) throw new Error('resolved unit requis');
  requireCanonicalIdentity(resolved);

  const { countryCode, sendGoodsCountryCode } = normalizeSupplierLegDestination(destination);
  const nativeSkuId = String(resolved.raw_sku_id || '').trim();
  if (!/^\d{5,30}$/.test(nativeSkuId)) {
    throw supplierIdentity.blockedSupplierIdentity(
      'sku_id natif AliExpress numérique requis pour le quote de fret',
      { sku_id: nativeSkuId || null, supplier_sku: resolved.supplier_sku || null }
    );
  }

  const dto = {
    country_code: countryCode,
    send_goods_country_code: sendGoodsCountryCode,
    product_id: Number(resolved.supplier_product_id),
    product_num: positiveInt(resolved.quantity),
    sku_id: nativeSkuId,
  };
  if (destination.province_code) dto.province_code = String(destination.province_code);
  if (destination.city_code) dto.city_code = String(destination.city_code);
  if (destination.price != null) dto.price = String(destination.price);
  if (destination.price_currency) dto.price_currency = String(destination.price_currency).toUpperCase();

  return {
    aeopFreightCalculateForBuyerDTO: JSON.stringify(dto),
  };
}

/**
 * Legacy product-level calculator retained for diagnostics and compatibility.
 * It is not the canonical exact-SKU readiness path.
 */
function buildFreightBusinessParams(resolved, destination = {}) {
  if (!resolved) throw new Error('resolved unit requis');
  requireCanonicalIdentity(resolved);
  const { countryCode, sendGoodsCountryCode } = normalizeSupplierLegDestination(destination);

  const dto = {
    product_id: Number(resolved.supplier_product_id),
    product_num: positiveInt(resolved.quantity),
    country_code: countryCode,
    send_goods_country_code: sendGoodsCountryCode,
    price: String(resolved.unit_price),
    price_currency: resolved.currency,
  };
  if (destination.province_code) dto.province_code = String(destination.province_code);
  if (destination.city_code) dto.city_code = String(destination.city_code);

  return {
    param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify(dto),
  };
}

function normalizePlaceOrderAddress(logisticsAddress) {
  const source = logisticsAddress && typeof logisticsAddress === 'object' ? logisticsAddress : {};
  const country = String(source.country_code || source.country || '').trim().toUpperCase();
  let mobileNo = String(source.mobile_no || source.phone || '').trim();
  let phoneCountry = String(source.phone_country || source.phoneCountry || '').trim();
  if (country === 'AE') {
    mobileNo = mobileNo.replace(/[\s()-]/g, '');
    if (mobileNo.startsWith('+971')) mobileNo = mobileNo.slice(4);
    else if (mobileNo.startsWith('00971')) mobileNo = mobileNo.slice(5);
    if (mobileNo.startsWith('0')) mobileNo = mobileNo.slice(1);

    if (!phoneCountry) phoneCountry = '+971';
    else if (phoneCountry === '971' || phoneCountry === '00971') phoneCountry = '+971';
  }
  const address = {
    address: String(source.address || source.address1 || '').trim(),
    ...(String(source.address2 || '').trim() ? { address2: String(source.address2).trim() } : {}),
    city: String(source.city || '').trim(),
    contact_person: String(source.contact_person || source.customer_name || source.full_name || '').trim(),
    country,
    full_name: String(source.full_name || source.customer_name || source.contact_person || '').trim(),
    mobile_no: mobileNo,
    ...(phoneCountry ? { phone_country: phoneCountry } : {}),
    province: String(source.province || '').trim(),
    zip: String(source.zip || source.postal_code || '').trim(),
    locale: String(source.locale || 'en_US').trim(),
  };
  if (country === 'AE' && !/^5\d{8}$/.test(address.mobile_no)) {
    throw new Error('ALIEXPRESS_LOGISTICS_ADDRESS_MOBILE_NO_AE_INVALID');
  }
  if (country === 'AE' && address.phone_country !== '+971') {
    throw new Error('ALIEXPRESS_LOGISTICS_ADDRESS_PHONE_COUNTRY_AE_INVALID');
  }
  for (const [key, value] of Object.entries(address)) {
    if (!value && ['address', 'city', 'contact_person', 'country', 'full_name', 'mobile_no', 'province', 'zip'].includes(key)) {
      throw new Error(`ALIEXPRESS_LOGISTICS_ADDRESS_${key.toUpperCase()}_REQUIRED`);
    }
  }
  return address;
}

function buildOrderDetailBusinessParams(orderId) {
  const id = String(orderId || '').trim();
  if (!/^\d{5,30}$/.test(id)) throw new Error('ALIEXPRESS_ORDER_ID_INVALID');
  return { single_order_query: JSON.stringify({ order_id: id }) };
}

function buildPlaceOrderBusinessParams(resolved, logisticsAddress, options = {}) {
  if (!resolved) throw new Error('resolved unit requis');
  requireCanonicalIdentity(resolved);
  const address = normalizePlaceOrderAddress(logisticsAddress);

  const item = {
    product_count: positiveInt(resolved.quantity),
    product_id: Number(resolved.supplier_product_id),
  };
  if (resolved.sku_attr) item.sku_attr = resolved.sku_attr;
  if (options.logistics_service_name) item.logistics_service_name = String(options.logistics_service_name);
  if (options.order_memo) item.order_memo = String(options.order_memo).slice(0, 500);

  return {
    param_place_order_request4_open_api_d_t_o: JSON.stringify({
      logistics_address: address,
      product_items: [item],
    }),
  };
}

function summarizeFreightResponse(payload = {}) {
  const root = payload?.result || payload?.resp_result?.result || payload;
  const success = root?.success ?? root?.result_success ?? null;
  const raw = root?.aeop_freight_calculate_result_for_buyer_d_t_o_list
    || root?.aeop_freight_calculate_result_for_buyer_dtolist
    || root?.result
    || null;
  const nested = raw?.aeop_freight_calculate_result_for_buyer_d_t_o
    || raw?.aeop_freight_calculate_result_for_buyer_dto
    || raw;
  const options = Array.isArray(nested) ? nested : (nested ? [nested] : []);

  function amountOf(option) {
    const freight = option?.freight || {};
    const direct = Number(freight.amount);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const cent = Number(freight.cent);
    return Number.isFinite(cent) && cent >= 0 ? cent / 100 : null;
  }

  const usable = options
    .map((option) => ({
      option,
      service_name: String(option?.service_name || option?.logistics_service_name || '').trim() || null,
      amount: amountOf(option),
    }))
    .filter((row) => row.service_name);

  usable.sort((a, b) => {
    if (a.amount == null && b.amount != null) return 1;
    if (a.amount != null && b.amount == null) return -1;
    if (a.amount != null && b.amount != null && a.amount !== b.amount) return a.amount - b.amount;
    return a.service_name.localeCompare(b.service_name);
  });
  const selected = usable[0] || null;
  const freight = selected?.option?.freight || {};

  return {
    success: success == null ? null : Boolean(success),
    has_options: usable.length > 0,
    option_count: usable.length,
    service_name: selected?.service_name || null,
    shipping_method: selected?.option?.shipping_method || null,
    estimated_delivery_time: selected?.option?.estimated_delivery_time || null,
    freight_amount: selected?.amount ?? null,
    freight_currency: String(freight.currency_code || '').trim().toUpperCase() || null,
    tracking_available: selected?.option?.tracking_available ?? null,
    error: root?.error_desc || root?.error_msg || null,
  };
}

function classifyApiError(error) {
  const message = String(error?.message || error || '');
  if (/access|permission|authorize|unauthor|forbidden|isv\.access/i.test(message)) return 'permission';
  if (/token|session|signature|sign/i.test(message)) return 'auth';
  if (/parameter|param|invalid|illegal|argument type mismatch/i.test(message)) return 'parameter';
  if (/stock|inventory/i.test(message)) return 'inventory';
  return 'other';
}

module.exports = {
  METHODS,
  positiveInt,
  resolveOrderableUnit,
  normalizeSupplierLegDestination,
  buildFreightQuoteParams,
  buildFreightBusinessParams,
  normalizePlaceOrderAddress,
  buildOrderDetailBusinessParams,
  buildPlaceOrderBusinessParams,
  summarizeFreightResponse,
  classifyApiError,
};
