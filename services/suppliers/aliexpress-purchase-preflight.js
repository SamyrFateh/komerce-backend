'use strict';

/**
 * @komerce-arch
 * @role          aliexpress-purchase-preflight
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        NormalizedSupplierProduct V2, selected supplier SKU, destination
 * @outputs       live-checkable freight request + place-order payload (never executed here)
 * @depends       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/ALIEXPRESS_BUSINESS_READINESS.md
 * @impact-areas  purchasing, supplier-integration, catalog
 * @version       2026-09-ae-prepayment-v1
 */

const METHODS = Object.freeze({
  FREIGHT: 'aliexpress.logistics.buyer.freight.calculate',
  PLACE_ORDER: 'aliexpress.trade.buy.placeorder',
  ORDER_DETAIL: 'aliexpress.trade.ds.order.get',
  TRACKING: 'aliexpress.logistics.ds.trackinginfo.query',
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function positiveInt(value, name = 'quantity') {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} doit être un entier >= 1`);
  return n;
}

function sourceDetail(contract = {}) {
  const detail = contract?.raw_payload?.aliexpress?.detail || {};
  return detail?.result || detail || {};
}

function rawSkus(contract = {}) {
  return asArray(sourceDetail(contract)?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o);
}

function rawSkuIdentity(rawSku = {}, productId = '', index = 0) {
  return String(rawSku.sku_code || rawSku.id || `${productId}:sku:${index + 1}`).slice(0, 128);
}

function rawSkuId(rawSku = {}) {
  const value = rawSku.id ?? rawSku.sku_id ?? rawSku.skuId;
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim().slice(0, 128);
}

function buildSkuAttr(rawSku = {}) {
  const props = asArray(rawSku?.ae_sku_property_dtos?.ae_sku_property_d_t_o);
  const pairs = [];
  for (const prop of props) {
    const propertyId = String(prop?.sku_property_id ?? '').trim();
    const valueId = String(prop?.sku_property_value ?? '').trim();
    if (!propertyId || propertyId === '0' || !valueId || valueId === '0') continue;
    pairs.push(`${propertyId}:${valueId}`);
  }
  return pairs.length ? pairs.join(';') : null;
}

function resolveOrderableUnit(contract, supplierSku, quantity = 1) {
  const qty = positiveInt(quantity);
  const supplierProductId = String(contract?.supplier_product_id || '').trim();
  if (!/^\d{5,20}$/.test(supplierProductId)) {
    throw new Error('supplier_product_id AliExpress absent ou invalide');
  }

  const sku = String(supplierSku || '').trim();
  if (!sku) throw new Error('supplier_sku requis');

  const unit = asArray(contract?.sellable_units).find((candidate) => String(candidate?.supplier_sku || '') === sku);
  if (!unit) throw new Error(`supplier_sku introuvable dans le contrat V2: ${sku}`);
  if (unit.is_active === false) throw new Error(`supplier_sku inactif: ${sku}`);
  if (unit.stock_available == null) throw new Error(`stock fournisseur inconnu pour ${sku}`);
  if (Number(unit.stock_available) < qty) {
    throw new Error(`stock fournisseur insuffisant pour ${sku}: ${unit.stock_available} < ${qty}`);
  }
  if (!(Number(unit.purchase_price) > 0)) throw new Error(`prix fournisseur invalide pour ${sku}`);
  const currency = String(unit.currency || contract.currency || '').toUpperCase();
  if (!['AED', 'EUR', 'USD', 'KMF'].includes(currency)) throw new Error(`devise fournisseur invalide: ${currency || 'absente'}`);

  const skus = rawSkus(contract);
  const rawIndex = skus.findIndex((candidate, index) => rawSkuIdentity(candidate, supplierProductId, index) === sku);
  if (rawIndex < 0) {
    throw new Error(`SKU ${sku} présent dans V2 mais introuvable dans le payload AliExpress brut`);
  }
  const rawSku = skus[rawIndex];

  return {
    supplier_product_id: supplierProductId,
    supplier_sku: sku,
    raw_sku_id: rawSkuId(rawSku),
    sku_attr: buildSkuAttr(rawSku),
    quantity: qty,
    stock_available: Number(unit.stock_available),
    unit_price: Number(unit.purchase_price),
    currency,
  };
}

function buildFreightBusinessParams(resolved, destination = {}) {
  if (!resolved) throw new Error('resolved unit requis');
  const countryCode = String(destination.country_code || destination.countryCode || 'KM').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryCode)) throw new Error(`country_code invalide: ${countryCode}`);

  const dto = {
    product_id: Number(resolved.supplier_product_id),
    product_num: positiveInt(resolved.quantity),
    country_code: countryCode,
    price: String(resolved.unit_price),
    price_currency: resolved.currency,
  };
  if (resolved.raw_sku_id) dto.sku_id = resolved.raw_sku_id;
  if (destination.province_code) dto.province_code = String(destination.province_code);
  if (destination.city_code) dto.city_code = String(destination.city_code);
  if (destination.send_goods_country_code) dto.send_goods_country_code = String(destination.send_goods_country_code).toUpperCase();

  return {
    param_aeop_freight_calculate_for_buyer_d_t_o: JSON.stringify(dto),
  };
}

function buildPlaceOrderBusinessParams(resolved, logisticsAddress, options = {}) {
  if (!resolved) throw new Error('resolved unit requis');
  const address = logisticsAddress && typeof logisticsAddress === 'object' ? { ...logisticsAddress } : null;
  if (!address || !String(address.address || '').trim()) {
    throw new Error('logistics_address.address requis pour préparer place-order');
  }

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
  const list = root?.aeop_freight_calculate_result_for_buyer_d_t_o_list
    || root?.aeop_freight_calculate_result_for_buyer_dtolist
    || root?.result
    || null;
  return {
    success: success == null ? null : Boolean(success),
    has_options: Boolean(list),
    error: root?.error_desc || root?.error_msg || null,
  };
}

function classifyApiError(error) {
  const message = String(error?.message || error || '');
  if (/access|permission|authorize|unauthor|forbidden|isv\.access/i.test(message)) return 'permission';
  if (/token|session|signature|sign/i.test(message)) return 'auth';
  if (/parameter|param|invalid|illegal/i.test(message)) return 'parameter';
  if (/stock|inventory/i.test(message)) return 'inventory';
  return 'other';
}

module.exports = {
  METHODS,
  asArray,
  positiveInt,
  sourceDetail,
  rawSkus,
  rawSkuIdentity,
  rawSkuId,
  buildSkuAttr,
  resolveOrderableUnit,
  buildFreightBusinessParams,
  buildPlaceOrderBusinessParams,
  summarizeFreightResponse,
  classifyApiError,
};
