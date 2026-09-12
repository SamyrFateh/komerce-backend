/**
 * @komerce-arch
 * @role          supplier-fulfillment-readiness
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        product_sku supplier mapping, quantity, destination, supplier adapter, optional explicit price policy
 * @outputs       deterministic fulfillment readiness verdict
 * @depends       services/suppliers/supplier-order-identity.js
 * @used-by       supplier readiness audits, future purchasing hard gate
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  purchasing,supplier-integration,catalog
 * @version       2026-09-v1
 */
'use strict';

const {
  BLOCKED_SUPPLIER_IDENTITY,
  positiveInt,
  normalizeIdentity,
  blockedSupplierIdentity,
} = require('./supplier-order-identity');

const VERDICTS = Object.freeze({
  READY: 'FULFILLMENT_READY',
  BLOCKED_IDENTITY: 'BLOCKED_SUPPLIER_IDENTITY',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SUPPLIER_UNAVAILABLE: 'SUPPLIER_UNAVAILABLE',
  PRICE_DRIFT_BLOCKED: 'PRICE_DRIFT_BLOCKED',
  NOT_SHIPPABLE: 'NOT_SHIPPABLE',
  FREIGHT_UNAVAILABLE: 'FREIGHT_UNAVAILABLE',
  PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
});

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function mappingFromSku(sku) {
  if (!sku || typeof sku !== 'object' || Array.isArray(sku)) {
    throw blockedSupplierIdentity('product_sku requis pour le fulfillment');
  }
  if (sku.source && sku.source !== 'SUPPLIER') {
    throw blockedSupplierIdentity('un SKU manuel ne porte aucune autorité d’achat fournisseur', {
      product_sku_id: sku.id || null,
      source: sku.source,
    });
  }

  const supplierProductRef = cleanText(sku.supplier_product_ref);
  if (!supplierProductRef) {
    throw blockedSupplierIdentity('supplier_product_ref requis avant refresh fournisseur', {
      product_sku_id: sku.id || null,
    });
  }

  const supplierSku = cleanText(sku.supplier_sku);
  if (!supplierSku) {
    throw blockedSupplierIdentity('supplier_sku de réconciliation absent', {
      product_sku_id: sku.id || null,
    });
  }

  const supplierUnitRef = cleanText(sku.supplier_unit_ref);
  if (!supplierUnitRef) {
    throw blockedSupplierIdentity('supplier_unit_ref requis avant refresh fournisseur', {
      product_sku_id: sku.id || null,
    });
  }

  const identity = normalizeIdentity(sku.supplier_order_identity, supplierUnitRef);
  return {
    product_sku_id: sku.id || null,
    product_id: sku.product_id || null,
    supplier_sku: supplierSku,
    supplier_product_ref: supplierProductRef,
    supplier_unit_ref: supplierUnitRef,
    supplier_order_identity: identity,
  };
}

function publicIdentity(mapping) {
  return {
    supplier_product_ref: mapping.supplier_product_ref,
    supplier_unit_ref: mapping.supplier_unit_ref,
    provider: mapping.supplier_order_identity.provider,
    version: mapping.supplier_order_identity.version,
  };
}

function resultBase(mapping, quantity) {
  return {
    product_sku_id: mapping?.product_sku_id || null,
    product_id: mapping?.product_id || null,
    provider: mapping?.supplier_order_identity?.provider || null,
    quantity,
    identity: mapping ? publicIdentity(mapping) : null,
  };
}

function verdict(mapping, quantity, code, details = {}) {
  return {
    ...resultBase(mapping, quantity),
    ready: code === VERDICTS.READY,
    verdict: code,
    ...details,
  };
}

function normalizeLiveObservation(live) {
  if (!live || typeof live !== 'object' || Array.isArray(live)) {
    throw new Error('adapter.refresh doit retourner une observation fournisseur');
  }
  if (live.available === false) {
    return { unavailable: true, reason: live.reason || null };
  }
  const stock = Number(live.stock_available);
  const price = Number(live.unit_price);
  const currency = cleanText(live.currency).toUpperCase();
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error('stock fournisseur live invalide ou inconnu');
  }
  if (!(price > 0)) throw new Error('prix fournisseur live invalide ou inconnu');
  if (!currency) throw new Error('devise fournisseur live absente');
  return {
    unavailable: false,
    stock_available: stock,
    unit_price: price,
    currency,
    observed_at: live.observed_at || null,
  };
}

function evaluatePricePolicy(policy, live) {
  if (!policy) return { evaluated: false, blocked: false };
  const reference = Number(policy.reference_unit_price);
  const maxIncreasePct = Number(policy.max_increase_pct);
  const referenceCurrency = cleanText(policy.reference_currency).toUpperCase();
  if (!(reference > 0) || !(maxIncreasePct >= 0) || !referenceCurrency) {
    throw new Error('pricePolicy explicite invalide');
  }
  if (referenceCurrency !== live.currency) {
    return {
      evaluated: true,
      blocked: true,
      reason: 'CURRENCY_MISMATCH',
      reference_unit_price: reference,
      reference_currency: referenceCurrency,
      live_unit_price: live.unit_price,
      live_currency: live.currency,
      max_increase_pct: maxIncreasePct,
      delta_pct: null,
    };
  }
  const deltaPct = Number((((live.unit_price - reference) / reference) * 100).toFixed(4));
  return {
    evaluated: true,
    blocked: deltaPct > maxIncreasePct,
    reason: deltaPct > maxIncreasePct ? 'MAX_INCREASE_EXCEEDED' : null,
    reference_unit_price: reference,
    reference_currency: referenceCurrency,
    live_unit_price: live.unit_price,
    live_currency: live.currency,
    max_increase_pct: maxIncreasePct,
    delta_pct: deltaPct,
  };
}

function errorText(error) {
  return String(error?.message || error || '').slice(0, 600);
}

async function assessSupplierFulfillment({
  sku,
  quantity = 1,
  destination,
  adapter,
  pricePolicy = null,
  adapterOptions = {},
} = {}) {
  const qty = positiveInt(quantity);
  let mapping;
  try {
    mapping = mappingFromSku(sku);
  } catch (error) {
    if (error?.code === BLOCKED_SUPPLIER_IDENTITY) {
      return verdict(null, qty, VERDICTS.BLOCKED_IDENTITY, {
        product_sku_id: sku?.id || null,
        product_id: sku?.product_id || null,
        error: errorText(error),
        details: error.details || {},
      });
    }
    throw error;
  }

  const provider = mapping.supplier_order_identity.provider;
  if (!adapter || typeof adapter.refresh !== 'function' || typeof adapter.preflight !== 'function') {
    return verdict(mapping, qty, VERDICTS.SUPPLIER_UNAVAILABLE, {
      error: `Aucun adapter de fulfillment disponible pour ${provider}`,
    });
  }
  if (cleanText(adapter.provider).toLowerCase() !== provider) {
    return verdict(mapping, qty, VERDICTS.BLOCKED_IDENTITY, {
      error: `Adapter ${cleanText(adapter.provider) || 'absent'} incompatible avec ${provider}`,
    });
  }

  let refreshed;
  try {
    refreshed = await adapter.refresh(mapping, {
      quantity: qty,
      destination,
      options: adapterOptions,
    });
  } catch (error) {
    if (error?.code === BLOCKED_SUPPLIER_IDENTITY) {
      return verdict(mapping, qty, VERDICTS.BLOCKED_IDENTITY, {
        error: errorText(error),
        details: error.details || {},
      });
    }
    return verdict(mapping, qty, VERDICTS.SUPPLIER_UNAVAILABLE, {
      error: errorText(error),
      error_class: error?.error_class || null,
    });
  }

  let live;
  try {
    live = normalizeLiveObservation(refreshed);
  } catch (error) {
    return verdict(mapping, qty, VERDICTS.PREFLIGHT_FAILED, { error: errorText(error) });
  }
  if (live.unavailable) {
    return verdict(mapping, qty, VERDICTS.SUPPLIER_UNAVAILABLE, {
      live: { available: false },
      reason: live.reason,
    });
  }
  if (live.stock_available < qty) {
    return verdict(mapping, qty, VERDICTS.OUT_OF_STOCK, {
      live,
      shortage: qty - live.stock_available,
    });
  }

  let price;
  try {
    price = evaluatePricePolicy(pricePolicy, live);
  } catch (error) {
    return verdict(mapping, qty, VERDICTS.PREFLIGHT_FAILED, {
      live,
      error: errorText(error),
    });
  }
  if (price.blocked) {
    return verdict(mapping, qty, VERDICTS.PRICE_DRIFT_BLOCKED, { live, price });
  }

  let preflight;
  try {
    preflight = await adapter.preflight(mapping, refreshed, {
      quantity: qty,
      destination,
      options: adapterOptions,
    });
  } catch (error) {
    if (error?.code === BLOCKED_SUPPLIER_IDENTITY) {
      return verdict(mapping, qty, VERDICTS.BLOCKED_IDENTITY, {
        live,
        price,
        error: errorText(error),
        details: error.details || {},
      });
    }
    if (error?.code === VERDICTS.NOT_SHIPPABLE) {
      return verdict(mapping, qty, VERDICTS.NOT_SHIPPABLE, { live, price, error: errorText(error) });
    }
    return verdict(mapping, qty, VERDICTS.PREFLIGHT_FAILED, {
      live,
      price,
      error: errorText(error),
      error_class: error?.error_class || null,
    });
  }

  if (!preflight || preflight.ready !== true) {
    if (preflight?.shippable === false) {
      return verdict(mapping, qty, VERDICTS.NOT_SHIPPABLE, { live, price, preflight });
    }
    if (preflight?.freight_available === false) {
      return verdict(mapping, qty, VERDICTS.FREIGHT_UNAVAILABLE, { live, price, preflight });
    }
    return verdict(mapping, qty, VERDICTS.PREFLIGHT_FAILED, { live, price, preflight: preflight || null });
  }

  return verdict(mapping, qty, VERDICTS.READY, { live, price, preflight });
}

module.exports = {
  VERDICTS,
  mappingFromSku,
  evaluatePricePolicy,
  assessSupplierFulfillment,
};
