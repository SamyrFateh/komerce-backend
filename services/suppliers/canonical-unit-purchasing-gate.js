/**
 * @komerce-arch
 * @role          canonical-unit-purchasing-hard-stop-gate
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        product_sku_id, quantity, canonical Unit resolver, provider adapters, provider authority
 * @outputs       blocked_verdict_or_readiness_verdict_or_built_payload_hard_stop
 * @depends       services/sourcing-canonical-unit-product-sku-resolution.js, services/suppliers/supplier-order-identity.js, services/suppliers/supplier-fulfillment-adapter-contract.js, services/suppliers/provider-authority.js
 * @used-by       services/purchasing-trigger-service.js (GAP-4A, evaluateCanonicalProcurementReadiness), scripts/allegro-golden-prebuyer-proof.js (prepareCanonicalUnitPurchase)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md, docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md
 * @impact-areas  purchasing, sourcing
 * @version       2026-09
 *
 * GAP-4 a été scindé en deux frontières distinctes après une preuve réelle
 * (voir docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md) :
 *
 *   GAP-4A — evaluateCanonicalProcurementReadiness()
 *     "Cette unité × cette quantité est-elle commandable maintenant ?"
 *     Ne construit JAMAIS de payload natif. N'exige JAMAIS buildOrderPayload.
 *     Le besoin de preflight distant est décidé par l'AUTORITÉ provider
 *     (provider-authority.js:remotePreflightRequirement), jamais dérivé de
 *     la présence/absence d'un adapter dans le registry injecté — un
 *     adapter manquant pour un provider dont le preflight est REQUIRED est
 *     un HARD_STOP, jamais un fallback silencieux vers "pas nécessaire".
 *     Cross-check fort sold-identity ↔ canonical-identity OBLIGATOIRE
 *     dès qu'une identité vendue est fournie (via
 *     supplier-order-identity.js:identitiesMatch, autorité unique).
 *
 *   GAP-4B — services/suppliers/procurement-execution-boundary.js
 *     "comment construire/exécuter l'ordre natif provider ?"
 *     buildOrderPayload/placeOrder appartiennent à cette frontière
 *     d'exécution, jamais à la readiness. evaluateCanonicalProcurementReadiness
 *     expose `canonical_unit` (donnée brute déjà résolue, pas un payload
 *     construit) précisément pour que GAP-4B puisse s'en servir sans
 *     re-résoudre une seconde fois la Canonical Unit.
 *
 * prepareCanonicalUnitPurchase() (le composition root pré-existant, seul
 * consommé aujourd'hui par le script de preuve prébuyer Allegro) reste
 * INCHANGÉ dans son contrat et son comportement — il continue d'exiger un
 * adapter complet (evaluate + buildOrderPayload) pour tout provider, y
 * compris hypothétique/futur, sans consulter provider-authority (c'est
 * précisément ce qui permet à tests/unit/sourcing-golden-e2e-service.test.js
 * de prouver l'extensibilité par contrat opaque à un provider non encore
 * onboardé). Les deux fonctions partagent la résolution canonique et les
 * checks natifs stock/prix via des helpers internes, pour ne jamais
 * dupliquer cette logique.
 */
'use strict';

const canonicalResolver = require('../sourcing-canonical-unit-product-sku-resolution');
const identityContract = require('./supplier-order-identity');
const adapterContract = require('./supplier-fulfillment-adapter-contract');
const providerAuthority = require('./provider-authority');

const BLOCKED = 'BLOCKED_SUPPLIER_IDENTITY';
const READY = 'FULFILLMENT_READY';

function blocked(reason, evidence = {}) {
  return { status: BLOCKED, ready: false, reason, evidence, place_order_invoked: false };
}

/**
 * Étape partagée : résout la Canonical Unit pour ce product_sku_id et
 * normalise son identité. Identique pour prepareCanonicalUnitPurchase et
 * evaluateCanonicalProcurementReadiness — ne jamais dupliquer cette
 * logique dans les deux fonctions.
 */
async function resolveCanonicalUnitAndIdentity({ productSkuId, quantity, query, resolveFn }) {
  const requestedQuantity = Number(quantity);
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return { blockedResult: blocked('INVALID_QUANTITY', { product_sku_id: productSkuId, quantity }) };
  }

  let resolution;
  try {
    resolution = await resolveFn(productSkuId, query);
  } catch (error) {
    return { blockedResult: blocked('CANONICAL_RESOLUTION_UNAVAILABLE', { product_sku_id: productSkuId, error_name: error?.name || 'Error' }) };
  }
  if (resolution.status !== canonicalResolver.STATUS.RESOLVED) {
    return { blockedResult: blocked(resolution.status, { product_sku_id: productSkuId, canonical_resolution: resolution.status }) };
  }

  let identity;
  try {
    identity = identityContract.normalizeIdentity(
      resolution.supplier_order_identity,
      resolution.supplier_unit_ref
    );
  } catch (error) {
    return { blockedResult: blocked(error.message, { product_sku_id: productSkuId, canonical_unit_id: resolution.canonical_unit_id }) };
  }

  return { resolution, identity, requestedQuantity };
}

/**
 * Étape partagée : stock/prix/devise natifs Komerce sur l'état courant de
 * la Canonical Unit. Identique pour les deux fonctions.
 */
function checkNativeAvailability(resolution, requestedQuantity) {
  const state = resolution.canonical_unit.current_state || {};
  if (state.is_active === false) return { blockedResult: blocked('INACTIVE_UNIT', { canonical_unit_id: resolution.canonical_unit_id }) };

  if (state.stock_available === null || state.stock_available === undefined || state.stock_available === '') {
    return { blockedResult: blocked('STOCK_UNAVAILABLE', { canonical_unit_id: resolution.canonical_unit_id }) };
  }
  const stock = Number(state.stock_available);
  if (!Number.isFinite(stock)) return { blockedResult: blocked('STOCK_UNAVAILABLE', { stock_available: state.stock_available }) };
  if (stock < requestedQuantity) return { blockedResult: blocked('OUT_OF_STOCK', { stock_available: stock, quantity: requestedQuantity }) };

  const price = Number(state.purchase_price);
  if (!Number.isFinite(price) || price <= 0) return { blockedResult: blocked('PRICE_UNAVAILABLE') };
  const currency = String(state.currency || '').trim();
  if (!currency) return { blockedResult: blocked('CURRENCY_UNAVAILABLE') };

  return { money: { unit_price: price, currency: currency.toUpperCase() } };
}

async function prepareCanonicalUnitPurchase({
  productSkuId,
  quantity = 1,
  query,
  adapters = {},
  context = {},
  resolveFn = canonicalResolver.resolveCanonicalUnitForProductSku,
} = {}) {
  const step1 = await resolveCanonicalUnitAndIdentity({ productSkuId, quantity, query, resolveFn });
  if (step1.blockedResult) return step1.blockedResult;
  const { resolution, identity, requestedQuantity } = step1;

  const adapterCheck = adapterContract.validateAdapter(identity.provider, adapters[identity.provider]);
  if (!adapterCheck.ok) return blocked(adapterCheck.reason, { provider: identity.provider });

  const availability = checkNativeAvailability(resolution, requestedQuantity);
  if (availability.blockedResult) return availability.blockedResult;

  let verdict;
  try {
    verdict = await adapterCheck.adapter.evaluate({
      row: { ...resolution.legacy_sku, supplier_unit_ref: resolution.supplier_unit_ref },
      identity,
      quantity: requestedQuantity,
      context,
      canonicalUnit: resolution.canonical_unit,
    });
  } catch (error) {
    return blocked('PREFLIGHT_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
  }
  if (!verdict?.ready) return { ...verdict, place_order_invoked: false };
  if (typeof adapterCheck.adapter.buildOrderPayload !== 'function') {
    return blocked('BUILD_ORDER_PAYLOAD_CAPABILITY_UNAVAILABLE', { provider: identity.provider });
  }

  let payload;
  try {
    payload = await adapterCheck.adapter.buildOrderPayload({
      identity,
      quantity: requestedQuantity,
      canonicalUnit: resolution.canonical_unit,
      preflight: verdict,
      context,
    });
  } catch (error) {
    return blocked('BUILD_ORDER_PAYLOAD_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
  }
  if (payload === null || payload === undefined) {
    return blocked('BUILD_ORDER_PAYLOAD_EMPTY', { provider: identity.provider });
  }

  return {
    status: 'HARD_STOP',
    ready: false,
    provider: identity.provider,
    canonical_unit_id: resolution.canonical_unit_id,
    payload,
    preflight: verdict,
    place_order_invoked: false,
  };
}

/**
 * GAP-4A — Canonical Procurement Readiness.
 *
 * Moteur unique de décision "cette unité × cette quantité est-elle
 * commandable maintenant ?", consommé par le chemin réel Purchasing
 * (purchasing-trigger-service.js). Ne construit jamais de payload natif —
 * ça appartient à GAP-4B (Procurement Execution Boundary), jamais
 * exercé ici.
 *
 * @param {object} params
 * @param {string} params.productSkuId
 * @param {number} params.quantity
 * @param {object} [params.soldIdentity] Identité SOI déjà normalisée du
 *   product_sku réellement vendu (ex. via loadExactSoldSku). Quand fournie,
 *   le cross-check fort provider+version+payload contre l'identité
 *   canonique est OBLIGATOIRE et fail-closed sur mismatch. Omise
 *   uniquement par des appelants qui n'exécutent pas de commande vendue
 *   (ex. scripts de preuve prospective) — jamais par le trigger réel.
 * @param {object} params.query
 * @param {object} [params.adapters] registry provider→adapter (réutiliser
 *   EXECUTION_ADAPTER_REGISTRY de GAP-2, ne pas en construire un second).
 * @param {object} [params.context]
 * @param {Function} [params.resolveFn]
 */
async function evaluateCanonicalProcurementReadiness({
  productSkuId,
  quantity = 1,
  soldIdentity = null,
  query,
  adapters = {},
  context = {},
  resolveFn = canonicalResolver.resolveCanonicalUnitForProductSku,
} = {}) {
  const step1 = await resolveCanonicalUnitAndIdentity({ productSkuId, quantity, query, resolveFn });
  if (step1.blockedResult) return step1.blockedResult;
  const { resolution, identity, requestedQuantity } = step1;

  // Cross-check fort OBLIGATOIRE dès qu'une identité vendue est fournie.
  // Autorité unique : supplier-order-identity.js:identitiesMatch. Ne jamais
  // réimplémenter cette comparaison ici.
  if (soldIdentity && !identityContract.identitiesMatch(identity, soldIdentity)) {
    return blocked('Supplier Order Identity canonique divergente du SKU vendu', {
      product_sku_id: productSkuId,
      canonical_unit_id: resolution.canonical_unit_id,
    });
  }

  const availability = checkNativeAvailability(resolution, requestedQuantity);
  if (availability.blockedResult) return availability.blockedResult;
  const { money } = availability;

  // Le besoin de preflight distant est une capability PROUVÉE, décidée par
  // l'autorité provider — jamais dérivée de la présence d'un adapter dans
  // le registry injecté. Un adapter absent pour un provider REQUIRED est
  // un HARD_STOP, jamais un fallback vers "pas nécessaire".
  const requirement = providerAuthority.remotePreflightRequirement(identity.provider);

  if (requirement === providerAuthority.PREFLIGHT_REQUIREMENT.UNKNOWN) {
    return blocked('REMOTE_PREFLIGHT_REQUIREMENT_UNKNOWN', { provider: identity.provider });
  }

  let preflight = null;
  if (requirement === providerAuthority.PREFLIGHT_REQUIREMENT.REQUIRED) {
    const adapterCheck = adapterContract.validateAdapter(identity.provider, adapters[identity.provider]);
    if (!adapterCheck.ok) {
      return blocked('REMOTE_PREFLIGHT_ADAPTER_UNAVAILABLE', { provider: identity.provider, reason: adapterCheck.reason });
    }
    try {
      preflight = await adapterCheck.adapter.evaluate({
        row: { ...resolution.legacy_sku, supplier_unit_ref: resolution.supplier_unit_ref },
        identity,
        quantity: requestedQuantity,
        context,
        canonicalUnit: resolution.canonical_unit,
      });
    } catch (error) {
      return blocked('PREFLIGHT_ERROR', { provider: identity.provider, error_name: error?.name || 'Error' });
    }
    if (!preflight?.ready) return { ...preflight, place_order_invoked: false };
  }
  // requirement === NOT_REQUIRED : aucune vérification distante n'a jamais
  // existé pour ce provider (fait constaté par l'autorité, pas supposé) —
  // les checks natifs Komerce ci-dessus suffisent à la readiness.

  return {
    status: READY,
    ready: true,
    provider: identity.provider,
    canonical_unit_id: resolution.canonical_unit_id,
    canonical_unit: resolution.canonical_unit,
    supplier_unit_ref: resolution.supplier_unit_ref,
    identity,
    money,
    preflight,
    place_order_invoked: false,
  };
}

module.exports = { BLOCKED, READY, prepareCanonicalUnitPurchase, evaluateCanonicalProcurementReadiness };
