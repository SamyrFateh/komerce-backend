/**
 * @komerce-arch
 * @role          allegro-golden-prebuyer-proof
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        P3 offer prerequisite bundle, guarded Sandbox seed, explicit promotion price, canonical import
 * @outputs       active Allegro offer, promoted SKU and canonical Purchasing HARD_STOP
 * @depends       scripts/allegro-offer-prerequisites-proof.js, scripts/allegro-sandbox-check.js, services/sourcing-candidate-actions.js, services/suppliers/canonical-unit-purchasing-gate.js
 * @used-by       operator CLI before manual Allegro Sandbox buyer purchase
 * @db-read       supplier_oauth_connections, sourcing_candidates, product_skus, canonical sourcing projection
 * @db-write      supplier_oauth_connections; guarded Sandbox offer setup; delegated canonical import/promotion writes
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md, docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  catalog, purchasing, supplier-integration
 */
'use strict';

const sandboxCheck = require('./allegro-sandbox-check');
const prerequisiteProof = require('./allegro-offer-prerequisites-proof');
const connector = require('../services/suppliers/connectors/allegro-connector');
const fulfillmentAdapter = require('../services/suppliers/allegro-fulfillment-adapter');
const sandboxClient = require('../services/suppliers/allegro-sandbox-client');
const purchasingGate = require('../services/suppliers/canonical-unit-purchasing-gate');
const candidateActions = require('../services/sourcing-candidate-actions');
const db = require('../db');

function selectedFromPrerequisites(prerequisites) {
  const shippingRateId = String(prerequisites?.shipping_capability?.provider_ref || '').trim();
  const returnPolicyId = String(prerequisites?.return_policy_ref || '').trim();
  const impliedWarrantyId = String(prerequisites?.implied_warranty_ref || '').trim();
  if (!shippingRateId || !returnPolicyId || !impliedWarrantyId) {
    throw new Error('ALLEGRO_GOLDEN_P3_PREREQUISITES_INCOMPLETE');
  }
  if (prerequisites.shipping_capability.bindable_to_standard_offer !== true) {
    throw new Error('ALLEGRO_GOLDEN_P3_SHIPPING_NOT_BINDABLE');
  }
  return {
    shipping_rate_id: shippingRateId,
    return_policy_id: returnPolicyId,
    implied_warranty_id: impliedWarrantyId,
  };
}

function runConfig(argv) {
  if (!Array.isArray(argv)) {
    throw new Error('Usage: node scripts/allegro-golden-prebuyer-proof.js --price-kmf=POSITIVE_NUMBER [--seed-slot=1..3]');
  }
  const priceArgs = argv.filter(arg => String(arg).startsWith('--price-kmf='));
  const slotArgs = argv.filter(arg => String(arg).startsWith('--seed-slot='));
  if (priceArgs.length !== 1 || slotArgs.length > 1 || argv.length !== priceArgs.length + slotArgs.length) {
    throw new Error('Usage: node scripts/allegro-golden-prebuyer-proof.js --price-kmf=POSITIVE_NUMBER [--seed-slot=1..3]');
  }
  const priceKmf = Number(String(priceArgs[0]).slice('--price-kmf='.length));
  if (!Number.isFinite(priceKmf) || priceKmf <= 0) throw new Error('ALLEGRO_GOLDEN_PROMOTION_PRICE_INVALID');
  const seedSlot = slotArgs.length ? Number.parseInt(String(slotArgs[0]).slice('--seed-slot='.length), 10) : 1;
  if (!Number.isSafeInteger(seedSlot) || seedSlot < 1 || seedSlot > 3) {
    throw new Error('ALLEGRO_GOLDEN_SEED_SLOT_INVALID');
  }
  return { priceKmf, seedSlot };
}

function explicitPromotionPrice(argv) {
  return runConfig(argv).priceKmf;
}

async function prepareOfferIdsFromPrerequisites(ids, prerequisites, api = sandboxClient) {
  const selected = selectedFromPrerequisites(prerequisites);
  const producer = await api.ensureGoldenResponsibleProducer();
  const offers = [];
  for (const rawId of ids) {
    const id = connector.offerId(rawId);
    const current = await api.get(`/sale/product-offers/${id}`);
    if (String(current?.publication?.status || '').toUpperCase() === 'ACTIVE') {
      offers.push({ offer_id: id, skipped: true, reason: 'ALREADY_ACTIVE' });
      continue;
    }
    offers.push(await api.completeSeedOffer(id, {
      shippingRateId: selected.shipping_rate_id,
      returnPolicyId: selected.return_policy_id,
      impliedWarrantyId: selected.implied_warranty_id,
      responsibleProducerId: producer.id,
    }));
  }
  return { selected, responsible_producer_id: producer.id, offers };
}

function assertCandidateIdentity(candidate, offerId) {
  const units = Array.isArray(candidate?.normalized_source_contract?.sellable_units)
    ? candidate.normalized_source_contract.sellable_units : [];
  const exact = units.filter(unit => String(unit?.supplier_unit_ref || '') === String(offerId)
    && String(unit?.supplier_sku || '') === `allegro-sandbox:${offerId}`
    && unit?.supplier_order_identity?.provider === 'allegro'
    && unit?.supplier_order_identity?.version === 1
    && unit?.supplier_order_identity?.payload?.environment === 'sandbox'
    && String(unit?.supplier_order_identity?.payload?.offer_id || '') === String(offerId));
  if (exact.length !== 1) throw new Error(`ALLEGRO_GOLDEN_CANDIDATE_UNIT_NOT_EXACT_${exact.length}`);
  return exact[0];
}

async function findExactImportedCandidate(offerId, query = db.query.bind(db)) {
  const result = await query(`
    SELECT id, supplier_name, supplier_product_id, state, product_id, normalized_source_contract
      FROM sourcing_candidates
     WHERE supplier_name = 'Allegro Sandbox'
       AND supplier_product_id = $1
     ORDER BY created_at
  `, [String(offerId)]);
  const rows = result.rows || [];
  if (rows.length !== 1) throw new Error(`ALLEGRO_GOLDEN_IMPORTED_CANDIDATE_NOT_EXACT_${rows.length}`);
  assertCandidateIdentity(rows[0], offerId);
  return rows[0];
}

async function findExactImportedSku(offerId, query = db.query.bind(db)) {
  const supplierSku = `allegro-sandbox:${offerId}`;
  const result = await query(`
    SELECT id, supplier_unit_ref, supplier_sku, supplier_order_identity, is_active, source
      FROM product_skus
     WHERE supplier_unit_ref = $1
       AND supplier_sku = $2
       AND source = 'SUPPLIER'
       AND is_active = true
     ORDER BY id
  `, [String(offerId), supplierSku]);
  const rows = result.rows || [];
  if (rows.length !== 1) throw new Error(`ALLEGRO_GOLDEN_IMPORTED_SKU_NOT_EXACT_${rows.length}`);
  const row = rows[0];
  if (row?.supplier_order_identity?.provider !== 'allegro'
    || row?.supplier_order_identity?.version !== 1
    || row?.supplier_order_identity?.payload?.environment !== 'sandbox'
    || String(row?.supplier_order_identity?.payload?.offer_id || '') !== String(offerId)) {
    throw new Error('ALLEGRO_GOLDEN_IMPORTED_SOI_MISMATCH');
  }
  return row;
}

async function run(argv, {
  client = sandboxClient,
  env = process.env,
  provePrerequisites = prerequisiteProof.proveOfferPrerequisites,
  seedOfferIds = sandboxCheck.seedOfferIds,
  activateOfferIds = sandboxCheck.activateOfferIds,
  fetchProducts = connector.fetchProducts,
  importCatalog,
  query = db.query.bind(db),
  promoteCandidate = candidateActions.promoteCandidate,
  prepareCanonicalUnitPurchase = purchasingGate.prepareCanonicalUnitPurchase,
  sleepImpl,
  activationAttempts,
  activationPollMs,
} = {}) {
  const { priceKmf, seedSlot } = runConfig(argv);

  // P4 composition starts only after the already-proven read-only P3 boundary.
  const p3 = await provePrerequisites(client);
  const ids = await seedOfferIds(seedSlot, client, env);
  if (ids.length !== seedSlot) throw new Error('ALLEGRO_GOLDEN_SEED_SLOT_NOT_AVAILABLE');
  const offerId = connector.offerId(ids[seedSlot - 1]);

  const preparation = await prepareOfferIdsFromPrerequisites([offerId], p3.prerequisites, client);
  const activations = await activateOfferIds([offerId], client, {
    sleepImpl,
    attempts: activationAttempts,
    pollMs: activationPollMs,
  });
  if (activations[0]?.publication_status !== 'ACTIVE') throw new Error('ALLEGRO_GOLDEN_ACTIVE_NOT_PROVEN');

  const fetched = await fetchProducts({ productIds: [offerId], client });
  if (fetched.invalid?.length || fetched.products?.length !== 1) {
    throw new Error('ALLEGRO_GOLDEN_ACTIVE_OFFER_READ_INVALID');
  }

  const importer = importCatalog || require('../services/suppliers/catalog-import-orchestrator').importCatalog;
  const imported = await importer({
    source_type: 'api', supplier_id: 'allegro', supplier_name: 'Allegro Sandbox',
    product_ids: [offerId], is_full_snapshot: false,
  }, null, async () => fetched);
  if (imported?.status >= 400 || imported?.body?.rejected > 0 || imported?.body?.accepted === 0) {
    throw new Error('ALLEGRO_GOLDEN_CANONICAL_IMPORT_FAILED');
  }

  const candidate = await findExactImportedCandidate(offerId, query);
  let promotion;
  if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
    promotion = { candidate_id: candidate.id, product_id: candidate.product_id, skipped: true, reason: 'ALREADY_PROMOTED' };
  } else {
    promotion = await promoteCandidate(candidate.id, { price_kmf: priceKmf, enrichment_mode: 'source_only' }, null);
  }

  const sku = await findExactImportedSku(offerId, query);
  const purchasing = await prepareCanonicalUnitPurchase({
    productSkuId: sku.id,
    quantity: 1,
    query,
    adapters: { allegro: fulfillmentAdapter },
    context: { allegroClient: client },
  });
  if (purchasing?.status !== 'HARD_STOP'
    || purchasing?.provider !== 'allegro'
    || purchasing?.place_order_invoked !== false
    || String(purchasing?.payload?.offer_id || '') !== offerId
    || purchasing?.payload?.execution_mode !== 'manual') {
    throw new Error(`ALLEGRO_GOLDEN_PURCHASING_HARD_STOP_NOT_PROVEN_${String(purchasing?.status || 'UNKNOWN')}`);
  }

  return {
    environment: 'sandbox',
    phase: 'PRE_BUYER',
    offer_id: offerId,
    seed_slot: seedSlot,
    promotion_price_kmf: priceKmf,
    p3_contract_proof: p3.contract_proof,
    preparation,
    activations,
    imported,
    candidate_id: candidate.id,
    promotion,
    product_sku_id: sku.id,
    supplier_order_identity: sku.supplier_order_identity,
    purchasing,
    buyer_purchase_required: true,
    purchase_confirmed: false,
  };
}

if (require.main === module) {
  run(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await db.pool.end(); process.exit(process.exitCode || 0); });
}

module.exports = {
  selectedFromPrerequisites,
  runConfig,
  explicitPromotionPrice,
  prepareOfferIdsFromPrerequisites,
  assertCandidateIdentity,
  findExactImportedCandidate,
  findExactImportedSku,
  run,
};
