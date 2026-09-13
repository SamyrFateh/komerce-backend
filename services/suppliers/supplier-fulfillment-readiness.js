/**
 * @komerce-arch
 * @role          supplier-fulfillment-readiness
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        product_sku.id, quantity, procurementRoute
 * @outputs       supplier_fulfillment_verdict
 * @depends       services/suppliers/supplier-order-identity.js, services/suppliers/supplier-fulfillment-adapter-contract.js, services/suppliers/aliexpress-fulfillment-adapter.js
 * @used-by       internal purchasing callers
 * @db-read       product_skus
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration, catalog
 */
'use strict';

const supplierIdentity = require('./supplier-order-identity');
const adapterContract = require('./supplier-fulfillment-adapter-contract');
const aliexpressAdapter = require('./aliexpress-fulfillment-adapter');

const ROUTE_MODE = Object.freeze({ PROCUREMENT_HUB: 'PROCUREMENT_HUB' });

const VERDICT = Object.freeze({
  READY: 'FULFILLMENT_READY',
  BLOCKED_IDENTITY: 'BLOCKED_SUPPLIER_IDENTITY',
  PROCUREMENT_ROUTE_UNRESOLVED: 'PROCUREMENT_ROUTE_UNRESOLVED',
  SKU_INACTIVE: 'SKU_INACTIVE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SUPPLIER_UNAVAILABLE: 'SUPPLIER_UNAVAILABLE',
  PRICE_DRIFT_BLOCKED: 'PRICE_DRIFT_BLOCKED',
  NOT_SHIPPABLE: 'NOT_SHIPPABLE',
  FREIGHT_UNAVAILABLE: 'FREIGHT_UNAVAILABLE',
  PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
});

const DEFAULT_ADAPTERS = Object.freeze({ aliexpress: aliexpressAdapter });

function result(status, evidence = {}, reason = null) {
  return { ready: status === VERDICT.READY, status, reason, evidence };
}

function normalizeProcurementRoute(route) {
  if (!route || typeof route !== 'object') {
    throw new Error('procurementRoute explicite requis; destination brute interdite');
  }
  if (String(route.mode || '').trim().toUpperCase() !== ROUTE_MODE.PROCUREMENT_HUB) {
    throw new Error('seul PROCUREMENT_HUB est ouvert dans le moteur Purchasing actuel');
  }
  const hub = route.hub && typeof route.hub === 'object' ? route.hub : null;
  if (!hub) throw new Error('procurementRoute.hub requis');
  const hubRef = String(hub.id || hub.code || hub.name || '').trim();
  if (!hubRef) throw new Error('procurementRoute.hub doit avoir id, code ou name');
  const countryCode = String(hub.country_code || hub.countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryCode)) throw new Error('procurementRoute.hub.country_code requis');
  const supplierDestination = {
    country_code: countryCode,
    province_code: hub.province_code || hub.provinceCode || null,
    city_code: hub.city_code || hub.cityCode || null,
  };
  return {
    mode: ROUTE_MODE.PROCUREMENT_HUB,
    hub: {
      id: hub.id || null,
      code: hub.code || null,
      name: hub.name || null,
      ...supplierDestination,
    },
    supplier_destination: supplierDestination,
  };
}

async function loadPersistedSku(db, productSkuId) {
  const { rows: [row] } = await db.query(
    `SELECT id, product_id, supplier_sku, supplier_unit_ref,
            supplier_order_identity, stock, is_active, source
       FROM product_skus
      WHERE id = $1`,
    [productSkuId]
  );
  if (!row) {
    const error = new Error('product_sku introuvable');
    error.status = 404;
    throw error;
  }
  return row;
}

function canonicalIdentity(row) {
  if (!row.supplier_unit_ref || !row.supplier_order_identity) {
    throw supplierIdentity.blockedSupplierIdentity(
      'Supplier Order Identity persistée requise avant fulfillment preflight',
      { product_sku_id: row.id }
    );
  }
  return supplierIdentity.normalizeIdentity(row.supplier_order_identity, row.supplier_unit_ref);
}

async function evaluateSupplierFulfillmentReadiness(options = {}) {
  const { db, productSkuId, procurementRoute, context = {} } = options;
  const adapters = { ...DEFAULT_ADAPTERS, ...(options.adapters || {}) };
  if (!db || typeof db.query !== 'function') throw new Error('db.query requis');
  if (!productSkuId) throw new Error('productSkuId requis');
  const quantity = supplierIdentity.positiveInt(options.quantity ?? 1, 'quantity');

  let route;
  try {
    route = normalizeProcurementRoute(procurementRoute);
  } catch (error) {
    return result(
      VERDICT.PROCUREMENT_ROUTE_UNRESOLVED,
      { product_sku_id: productSkuId },
      String(error.message || error)
    );
  }

  const row = await loadPersistedSku(db, productSkuId);

  if (!row.is_active) return result(VERDICT.SKU_INACTIVE, { product_sku_id: row.id });
  if (row.source !== 'SUPPLIER') {
    return result(VERDICT.BLOCKED_IDENTITY, { product_sku_id: row.id }, 'SKU non fournisseur');
  }

  let identity;
  try {
    identity = canonicalIdentity(row);
  } catch (error) {
    return result(VERDICT.BLOCKED_IDENTITY, { product_sku_id: row.id }, String(error.message || error));
  }

  const adapterCheck = adapterContract.validateAdapter(identity.provider, adapters[identity.provider]);
  if (!adapterCheck.ok) {
    return result(
      VERDICT.SUPPLIER_UNAVAILABLE,
      { product_sku_id: row.id, provider: identity.provider },
      adapterCheck.reason
    );
  }

  let verdict;
  try {
    verdict = await adapterCheck.adapter.evaluate({
      db,
      row,
      identity,
      quantity,
      destination: route.supplier_destination,
      procurementRoute: route,
      context,
      VERDICT,
      result,
    });
  } catch (error) {
    return result(
      VERDICT.PREFLIGHT_FAILED,
      { product_sku_id: row.id, provider: identity.provider },
      `Adapter fulfillment ${identity.provider} a levé une erreur non normalisée: ${String(error.message || error)}`
    );
  }

  const verdictCheck = adapterContract.validateVerdict(verdict, VERDICT);
  if (!verdictCheck.ok) {
    return result(
      VERDICT.PREFLIGHT_FAILED,
      { product_sku_id: row.id, provider: identity.provider },
      verdictCheck.reason
    );
  }

  return {
    ...verdict,
    evidence: {
      procurement_route_mode: route.mode,
      procurement_hub_code: route.hub.code || null,
      procurement_hub_country_code: route.hub.country_code,
      ...verdict.evidence,
    },
  };
}

module.exports = {
  ROUTE_MODE,
  VERDICT,
  DEFAULT_ADAPTERS,
  result,
  normalizeProcurementRoute,
  loadPersistedSku,
  canonicalIdentity,
  evaluateSupplierFulfillmentReadiness,
};
