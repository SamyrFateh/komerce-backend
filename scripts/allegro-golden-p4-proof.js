/**
 * @komerce-arch
 * @role          allegro-golden-p4-prepurchase-proof
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        proven Allegro P0-P3 contract, guarded sandbox seller, optional explicit catalog price
 * @outputs       active seller offer, imported/promoted exact SKU/SOI and Purchasing HARD_STOP evidence
 * @depends       scripts/allegro-offer-prerequisites-proof.js, scripts/allegro-sandbox-check.js, services/sourcing-candidate-actions.js, services/suppliers/canonical-unit-purchasing-gate.js, services/suppliers/allegro-fulfillment-adapter.js, db.js
 * @used-by       operator CLI, Allegro Golden P4 proof
 * @db-read       sourcing_candidates, product_skus, canonical sourcing projection tables
 * @db-write-via:scripts/allegro-sandbox-check.js supplier_catalog_imports, sourcing_candidates, sourcing observations
 * @db-write-via:services/sourcing-candidate-actions.js products, product_skus, catalog promotion tables, sourcing_candidates
 * @db-txn        canonical service owners only
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md, docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  catalog, sourcing, purchasing, supplier-integration
 */
'use strict';

const db = require('../db');
const sandboxClient = require('../services/suppliers/allegro-sandbox-client');
const fulfillmentAdapter = require('../services/suppliers/allegro-fulfillment-adapter');
const candidateActions = require('../services/sourcing-candidate-actions');
const purchasingGate = require('../services/suppliers/canonical-unit-purchasing-gate');
const offerPrerequisites = require('./allegro-offer-prerequisites-proof');
const sellerGolden = require('./allegro-sandbox-check');

const SUPPLIER_NAME = 'Allegro Sandbox';
const SUPPLIER_SKU_PREFIX = 'allegro-sandbox:';
const READY = 'PRE_PURCHASE_READY';
const BLOCKED_PRICE = 'BLOCKED_EXPLICIT_CATALOG_PRICE_REQUIRED';

function explicitPriceKmf(argv = [], env = process.env) {
  const priceArg = argv.find(arg => arg.startsWith('--price-kmf='));
  const unknown = argv.filter(arg => !arg.startsWith('--price-kmf='));
  if (unknown.length || argv.filter(arg => arg.startsWith('--price-kmf=')).length > 1) {
    throw new Error('Usage: node scripts/allegro-golden-p4-proof.js [--price-kmf=POSITIVE_INTEGER]');
  }
  const raw = priceArg ? priceArg.slice('--price-kmf='.length) : env.ALLEGRO_GOLDEN_PRICE_KMF;
  if (raw == null || String(raw).trim() === '') return null;
  if (!/^[1-9][0-9]{0,8}$/.test(String(raw).trim())) throw new Error('ALLEGRO_GOLDEN_PRICE_KMF_INVALID');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('ALLEGRO_GOLDEN_PRICE_KMF_INVALID');
  return value;
}

function exactOfferId(report) {
  if (!report || report.mode !== 'golden') throw new Error('ALLEGRO_P4_SELLER_GOLDEN_MISSING');
  const ids = Array.isArray(report.offer_ids) ? report.offer_ids.map(String) : [];
  if (ids.length !== 1 || !/^[0-9]{1,30}$/.test(ids[0])) throw new Error('ALLEGRO_P4_EXACT_OFFER_REQUIRED');
  const activation = Array.isArray(report.activations)
    ? report.activations.find(row => String(row?.offer_id || '') === ids[0])
    : null;
  if (!activation || String(activation.publication_status || '').toUpperCase() !== 'ACTIVE') {
    throw new Error('ALLEGRO_P4_OFFER_NOT_ACTIVE');
  }
  if (report.invalid?.length) throw new Error('ALLEGRO_P4_CONNECTOR_INVALID');
  if (report.accepted !== 1) throw new Error('ALLEGRO_P4_ONE_ACCEPTED_OFFER_REQUIRED');
  if (!report.imported || report.imported.status >= 400
    || report.imported.body?.accepted !== 1 || Number(report.imported.body?.rejected || 0) !== 0) {
    throw new Error('ALLEGRO_P4_IMPORT_NOT_PROVEN');
  }
  const preflight = Array.isArray(report.checks) ? report.checks[0] : null;
  if (!preflight?.ready || preflight?.evidence?.manual_procurement_ready !== true
    || preflight?.evidence?.auto_order_ready !== false
    || preflight?.evidence?.place_order_invoked !== false
    || preflight?.evidence?.payment_invoked !== false) {
    throw new Error('ALLEGRO_P4_PROVIDER_PREFLIGHT_NOT_READY');
  }
  return ids[0];
}

async function exactCandidate(query, offerId) {
  const result = await query(
    `SELECT id, state, product_id, supplier_name, supplier_product_id
       FROM sourcing_candidates
      WHERE supplier_name = $1 AND supplier_product_id = $2
      ORDER BY id`,
    [SUPPLIER_NAME, offerId]
  );
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (rows.length !== 1) throw new Error(`ALLEGRO_P4_CANDIDATE_CARDINALITY_${rows.length}`);
  return rows[0];
}

function normalizedSoi(value) {
  let soi = value;
  if (typeof soi === 'string') {
    try { soi = JSON.parse(soi); } catch { throw new Error('ALLEGRO_P4_SOI_INVALID'); }
  }
  if (!soi || typeof soi !== 'object' || Array.isArray(soi)) throw new Error('ALLEGRO_P4_SOI_INVALID');
  return soi;
}

async function exactProductSku(query, productId, offerId) {
  const supplierSku = `${SUPPLIER_SKU_PREFIX}${offerId}`;
  const result = await query(
    `SELECT id, product_id, supplier_sku, supplier_unit_ref, supplier_order_identity, source, is_active
       FROM product_skus
      WHERE product_id = $1
        AND supplier_sku = $2
        AND supplier_unit_ref = $3
        AND source = 'SUPPLIER'
      ORDER BY id`,
    [productId, supplierSku, offerId]
  );
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (rows.length !== 1) throw new Error(`ALLEGRO_P4_SKU_CARDINALITY_${rows.length}`);
  const row = rows[0];
  const soi = normalizedSoi(row.supplier_order_identity);
  if (String(soi.provider || '').toLowerCase() !== 'allegro' || Number(soi.version) !== 1
    || soi.payload?.environment !== 'sandbox' || String(soi.payload?.offer_id || '') !== offerId) {
    throw new Error('ALLEGRO_P4_SOI_MISMATCH');
  }
  if (row.is_active !== true) throw new Error('ALLEGRO_P4_SKU_INACTIVE');
  return { ...row, supplier_order_identity: soi };
}

function sellerEvidence(report) {
  return {
    offer_ids: report.offer_ids,
    activations: report.activations,
    accepted: report.accepted,
    imported: report.imported,
    checks: report.checks,
  };
}

async function runP4(argv = [], {
  env = process.env,
  client = sandboxClient,
  query = db.query.bind(db),
  proveP3 = offerPrerequisites.proveOfferPrerequisites,
  runSellerGolden = sellerGolden.run,
  promoteCandidate = candidateActions.promoteCandidate,
  preparePurchase = purchasingGate.prepareCanonicalUnitPurchase,
  adapter = fulfillmentAdapter,
} = {}) {
  if (typeof query !== 'function') throw new Error('ALLEGRO_P4_QUERY_REQUIRED');
  const priceKmf = explicitPriceKmf(argv, env);

  // P4 is composition, never discovery: no mutation before the complete P0-P3
  // conversation has been proven in the current runtime.
  const p3 = await proveP3(client);

  const golden = await runSellerGolden(['--golden'], { client, env });
  const offerId = exactOfferId(golden);
  let candidate = await exactCandidate(query, offerId);
  let productId = candidate.product_id || null;
  let promotion = null;

  if (!(candidate.state === 'imported_to_catalog' && productId)) {
    if (priceKmf === null) {
      return {
        status: BLOCKED_PRICE,
        p4_status: 'BLOCKED',
        blocker: 'EXPLICIT_CATALOG_PRICE_REQUIRED',
        offer_id: offerId,
        candidate: { id: candidate.id, state: candidate.state, product_id: candidate.product_id || null },
        p0_p3: p3.contract_proof,
        seller_golden: sellerEvidence(golden),
        place_order_invoked: false,
        payment_invoked: false,
      };
    }
    promotion = await promoteCandidate(candidate.id, {
      price_kmf: priceKmf,
      enrichment_mode: 'source_only',
    }, null);
    productId = promotion?.product_id || null;
    if (!productId) throw new Error('ALLEGRO_P4_PROMOTION_PRODUCT_ID_MISSING');
    candidate = await exactCandidate(query, offerId);
    if (candidate.state !== 'imported_to_catalog' || String(candidate.product_id) !== String(productId)) {
      throw new Error('ALLEGRO_P4_PROMOTION_READBACK_FAILED');
    }
  }

  const sku = await exactProductSku(query, productId, offerId);
  const hardStop = await preparePurchase({
    productSkuId: sku.id,
    quantity: 1,
    query,
    adapters: { allegro: adapter },
    context: { allegroClient: client },
  });

  if (hardStop?.status !== 'HARD_STOP' || hardStop?.provider !== 'allegro'
    || hardStop?.place_order_invoked !== false
    || hardStop?.payload?.execution_mode !== 'manual'
    || String(hardStop?.payload?.offer_id || '') !== offerId
    || hardStop?.payload?.quantity !== 1
    || hardStop?.payload?.auto_order_ready !== false
    || hardStop?.payload?.place_order_invoked !== false) {
    throw new Error('ALLEGRO_P4_PURCHASING_HARD_STOP_NOT_PROVEN');
  }

  return {
    status: READY,
    p4_status: 'BLOCKED_MANUAL_BUYER_PURCHASE',
    offer_id: offerId,
    product_id: productId,
    product_sku_id: sku.id,
    supplier_unit_ref: sku.supplier_unit_ref,
    supplier_order_identity: sku.supplier_order_identity,
    catalog_price_kmf: priceKmf,
    promotion_reused: promotion === null,
    p0_p3: p3.contract_proof,
    seller_golden: sellerEvidence(golden),
    purchasing_hard_stop: hardStop,
    next_required_proof: 'MANUAL_BUYER_SANDBOX_PURCHASE_AND_CHECKOUT_FORM_RECONCILIATION',
    place_order_invoked: false,
    payment_invoked: false,
  };
}

async function run(argv = process.argv.slice(2)) {
  return runP4(argv);
}

if (require.main === module) {
  run().then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== READY) process.exitCode = 1;
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(async () => {
    await db.pool.end();
    process.exit(process.exitCode || 0);
  });
}

module.exports = {
  SUPPLIER_NAME,
  SUPPLIER_SKU_PREFIX,
  READY,
  BLOCKED_PRICE,
  explicitPriceKmf,
  exactOfferId,
  exactCandidate,
  exactProductSku,
  runP4,
  run,
};
