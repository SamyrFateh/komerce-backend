/**
 * @komerce-arch
 * @role          aliexpress-purchase-preflight
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        NormalizedSupplierProduct V2, selected Supplier Order Identity, destination
 * @outputs       live-checkable freight request + place-order payload (never executed here)
 * @depends       services/suppliers/supplier-order-identity.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/ALIEXPRESS_BUSINESS_READINESS.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing, supplier-integration, catalog
 * @version       2026-09-ae-prepayment-v2
 */
'use strict';

const supplierIdentity = require('./supplier-order-identity');

const METHODS = Object.freeze({
  FREIGHT: 'aliexpress.logistics.buyer.freight.calculate',
  PLACE_ORDER: 'aliexpress.trade.buy.placeorder',
  ORDER_DETAIL: 'aliexpress.trade.ds.order.get',
  TRACKING: 'aliexpress.logistics.ds.trackinginfo.query',
});

function positiveInt(value, name = 'quantity') {
  return supplierIdentity.positiveInt(value, name);
}

/**
 * Interprétation AliExpress d'une Supplier Order Identity déjà produite par
 * le connecteur. Un snapshot historique sans identité peut être résolu pour
 * identifier le SKU à rafraîchir uniquement si l'appelant le demande
 * explicitement avec requireOrderIdentity:false.
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

  // `sku_id` est un identifiant natif AliExpress. `supplier_unit_ref` peut
  // légitimement contenir un `sku_attr`; il ne doit donc jamais être promu
  // silencieusement en `sku_id` pour les appels fournisseur.
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

function buildFreightBusinessParams(resolved, destination = {}) {
  if (!resolved) throw new Error('resolved unit requis');
  requireCanonicalIdentity(resolved);
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
  requireCanonicalIdentity(resolved);
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
  positiveInt,
  resolveOrderableUnit,
  buildFreightBusinessParams,
  buildPlaceOrderBusinessParams,
  summarizeFreightResponse,
  classifyApiError,
};
