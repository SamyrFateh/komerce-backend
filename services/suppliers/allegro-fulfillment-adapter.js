/**
 * @komerce-arch
 * @role          allegro-sandbox-fulfillment-adapter
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        exact sandbox offer identity, quantity, external checkout reference (reconcile)
 * @outputs       live stock/price evidence, exact manual procurement payload, reconciled purchase evidence (reconcile, GAP-5)
 * @depends       services/suppliers/connectors/allegro-connector.js, services/suppliers/supplier-fulfillment-readiness.js, services/suppliers/allegro-purchase-reconciliation.js
 * @used-by       services/suppliers/execution-adapter-registry.js (via canonical-unit-purchasing-gate.js GAP-4A, services/purchasing-admin-service.js GAP-5), scripts/allegro-sandbox-check.js, scripts/allegro-golden-prebuyer-proof.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration
 */
'use strict';
const connector = require('./connectors/allegro-connector');
const { VERDICT, result } = require('./supplier-fulfillment-readiness');
const reconciliation = require('./allegro-purchase-reconciliation');
const adapterContract = require('./supplier-fulfillment-adapter-contract');
const provider = 'allegro';

function exactOfferId(row, identity) {
  const id = identity?.payload?.offer_id;
  if (identity?.provider !== provider || identity.version !== 1 || identity.payload.environment !== 'sandbox'
    || typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id) || row?.supplier_unit_ref !== id
    || row.supplier_sku !== `allegro-sandbox:${id}`) return null;
  return id;
}

async function evaluate({ row, identity, quantity, context = {} }) {
  const evidence = {
    provider,
    environment: 'sandbox',
    execution_mode: 'manual',
    manual_procurement_ready: false,
    auto_order_ready: false,
    buyer_checkout_api_supported: false,
    place_order_invoked: false,
    payment_invoked: false,
  };
  const id = exactOfferId(row, identity);
  if (!id) return result(VERDICT.BLOCKED_IDENTITY, evidence, 'ALLEGRO_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(quantity) || quantity < 1) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'INVALID_QUANTITY');
  let fetched;
  try { fetched = await connector.fetchProducts({ productIds: [id], client: context.allegroClient }); }
  catch { return result(VERDICT.SUPPLIER_UNAVAILABLE, evidence, 'ALLEGRO_LIVE_READ_FAILED'); }
  if (fetched.products.length !== 1 || fetched.invalid.length) return result(VERDICT.PREFLIGHT_FAILED, evidence, 'ALLEGRO_INVALID_LIVE_OFFER');
  const unit = fetched.products[0].sellable_units[0];
  Object.assign(evidence, {
    supplier_unit_ref: id,
    supplier_sku: `allegro-sandbox:${id}`,
    supplier_offer_url: `https://allegro.pl.allegrosandbox.pl/oferta/${id}`,
    quantity,
    stock_available: unit.stock_available,
    unit_price: unit.purchase_price,
    currency: unit.currency,
    exact_unit_resolved: true,
    live_stock_checked: true,
    live_price_checked: true,
    supplier_leg_checked: false,
  });
  if (!unit.is_active) return result(VERDICT.SKU_INACTIVE, evidence, 'ALLEGRO_OFFER_NOT_ACTIVE');
  if (unit.stock_available < quantity) return result(VERDICT.OUT_OF_STOCK, evidence, 'ALLEGRO_INSUFFICIENT_STOCK');

  // Allegro does not expose a REST buyer checkout creation endpoint. That is an
  // auto-order capability limit, not a reason to deny exact manual procurement.
  evidence.manual_procurement_ready = true;
  return result(VERDICT.READY, evidence);
}

async function buildOrderPayload({ items, preflights } = {}) {
  const checked = adapterContract.validateItems(items);
  if (!checked.ok) throw new Error('INVALID_ITEMS');
  // Allegro n'a pas de panier multi-offres côté Komerce : l'opérateur détache pour faire des PO à une ligne.
  if (items.length !== 1) throw new Error('ALLEGRO_MULTI_ITEM_UNSUPPORTED');
  const { identity, quantity } = items[0];
  const preflight = Array.isArray(preflights) ? preflights[0] : null;
  const id = identity?.payload?.offer_id;
  if (identity?.provider !== provider || identity?.version !== 1 || identity?.payload?.environment !== 'sandbox'
    || typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id)) throw new Error('ALLEGRO_IDENTITY_MISMATCH');
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('INVALID_QUANTITY');
  if (!preflight?.ready || preflight?.evidence?.manual_procurement_ready !== true) throw new Error('ALLEGRO_MANUAL_PREFLIGHT_REQUIRED');
  return {
    provider,
    environment: 'sandbox',
    execution_mode: 'manual',
    supplier_unit_ref: id,
    supplier_sku: `allegro-sandbox:${id}`,
    offer_id: id,
    offer_url: `https://allegro.pl.allegrosandbox.pl/oferta/${id}`,
    quantity,
    expected_unit_price: preflight.evidence.unit_price,
    expected_currency: preflight.evidence.currency,
    auto_order_ready: false,
    place_order_invoked: false,
  };
}

/**
 * GAP-5 — Execution Evidence Boundary. Traduit l'appel générique de la
 * frontière (services/suppliers/purchase-order-confirmation-boundary.js)
 * vers le contrat Allegro-spécifique de allegro-purchase-reconciliation.js,
 * et traduit son résultat natif vers le minimum canonique attendu par le
 * cœur : { provider, external_ref, commitment_verdict, evidence }. Le
 * cœur ne voit jamais `READY_FOR_PROCESSING` (le statut natif Allegro) ni
 * les codes d'erreur `ALLEGRO_RECONCILIATION_*` — seulement `committed`
 * ou `rejected`, et le détail opaque dans `evidence`.
 *
 * `client` d'API sandbox injectable via `context.allegroSandboxClient`
 * (même convention que `context.aliexpressConnected` chez l'adapter
 * AliExpress) — sans injection, le client réel de
 * allegro-sandbox-client.js est utilisé (comportement de production
 * inchangé).
 *
 * @param {object} params
 * @param {string} params.externalRef Référence externe à vérifier (pour
 *   Allegro : le checkoutFormId communiqué par l'opérateur après achat
 *   manuel).
 * @param {Array<{identity: object, supplier_unit_ref: string, supplier_sku: string, quantity: number}>} params.items
 *   Un seul élément pour Allegro (ALLEGRO_MULTI_ITEM_UNSUPPORTED sinon : verdict `rejected`).
 * @param {object} [params.context]
 */
async function readOrderDetail(checkoutFormId, context = {}) {
  const id = String(checkoutFormId || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('ALLEGRO_CHECKOUT_FORM_ID_INVALID');

  const api = context.allegroSandboxClient || require('./allegro-sandbox-client');
  if (!api || typeof api.getSellerOrder !== 'function') {
    throw new Error('ALLEGRO_FULFILLMENT_CLIENT_INVALID');
  }

  const payload = await api.getSellerOrder(id);
  const lines = Array.isArray(payload?.lineItems) ? payload.lineItems : [];
  return {
    raw: payload,
    facts: {
      checkout_form_id: String(payload?.id || id).trim().toLowerCase(),
      order_status: String(payload?.status || '').trim().toUpperCase() || null,
      fulfillment_status: String(payload?.fulfillment?.status || '').trim().toUpperCase() || null,
      delivery_method: String(payload?.delivery?.method?.name || '').trim() || null,
      line_items: lines.map((line) => ({
        line_item_id: typeof line?.id === 'string' ? line.id : null,
        offer_id: String(line?.offer?.id || '').trim() || null,
        quantity: Number(line?.quantity ?? 0),
      })),
    },
  };
}

async function reconcile({ externalRef, items, context = {} } = {}) {
  try {
    const checked = adapterContract.validateItems(items);
    if (!checked.ok) throw new Error('INVALID_ITEMS');
    if (items.length !== 1) throw new Error('ALLEGRO_MULTI_ITEM_UNSUPPORTED');
    const { identity, supplier_unit_ref: supplierUnitRef, supplier_sku: supplierSku, quantity } = items[0];
    const verified = await reconciliation.reconcile({
      client: context.allegroSandboxClient,
      checkoutFormId: externalRef,
      identity,
      supplierUnitRef,
      supplierSku,
      quantity,
    });
    // verifyCheckoutForm() (appelée par reconciliation.reconcile) lève déjà
    // si le statut natif n'est pas READY_FOR_PROCESSING — atteindre ce
    // point garantit donc un engagement fournisseur confirmé.
    return {
      provider,
      external_ref: verified.supplier_order_id,
      commitment_verdict: 'committed',
      evidence: verified,
    };
  } catch (error) {
    return {
      provider,
      external_ref: externalRef || null,
      commitment_verdict: 'rejected',
      evidence: { reason: String(error?.message || error) },
    };
  }
}

module.exports = { provider, exactOfferId, evaluate, buildOrderPayload, readOrderDetail, reconcile };

