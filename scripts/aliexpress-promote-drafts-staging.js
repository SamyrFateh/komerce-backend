#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          aliexpress-staging-draft-promoter
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL, KOMERCE_ENV=staging, KOMERCE_ALLOW_ALIEXPRESS_DRAFT_PROMOTION=1
 * @outputs       inactive canonical product drafts from eligible AliExpress sourcing candidates
 * @depends       db.js, services/sourcing-candidate-actions.js
 * @used-by       bounded GitHub staging operator workflow
 * @db-read       sourcing_candidates, products, product_market_exposure
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog promotion tables
 * @db-txn        one canonical promotion transaction per candidate; advisory lock serializes batch runs
 * @doctrine      refinery_filters_before_catalog, inactive_drafts_only, economic_reference_is_not_market_truth, no_auto_publish
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const { promoteCandidate } = require('../services/sourcing-candidate-actions');

const SUPPLIER = 'AliExpress';
const EXPECTED_CLEAN = 500;
const FLAG = 'KOMERCE_ALLOW_ALIEXPRESS_DRAFT_PROMOTION';
const LOCK_NAMESPACE = 'komerce';
const LOCK_KEY = 'aliexpress-promote-drafts-staging';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const ALLOWED_DECISIONS = new Set(['TEST', 'PRIORITY']);
const EXPECTED_PRICE_AUTHORITY = 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION';

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  let limit = DEFAULT_LIMIT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_LIMIT}`);
  }
  return { mode, limit };
}

function assertRuntime({ mode }, env = process.env) {
  const runtime = runtimeEnvironment(env);
  if (runtime !== 'staging') {
    throw new Error(`REFUS: KOMERCE_ENV=staging requis (reçu: ${runtime || '<vide>'})`);
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (mode === 'execute' && !isTruthy(env[FLAG])) {
    throw new Error(`REFUS: ${FLAG}=1 requis pour --execute`);
  }
}

function cleanStockSql(alias = 'sc') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Alias SQL invalide: ${alias}`);
  return `(
    ${alias}.normalized_source_contract ? 'stock_available'
    AND (${alias}.normalized_source_contract->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'
    AND (${alias}.normalized_source_contract->>'stock_available')::numeric > 0
  )`;
}

async function loadCleanCandidates(queryable = db) {
  const { rows } = await queryable.query(
    `SELECT sc.id,
            sc.supplier_product_id,
            sc.product_name,
            sc.state,
            sc.product_id,
            sc.scan_result,
            sc.normalized_source_contract,
            sc.purchase_price_kmf,
            sc.komerce_category,
            sc.created_at
       FROM sourcing_candidates sc
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned', 'imported_to_catalog')
        AND COALESCE(sc.product_name, '') <> ''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price IS NOT NULL
        AND sc.purchase_price > 0
        AND ${cleanStockSql('sc')}
      ORDER BY sc.created_at, sc.id`,
    [SUPPLIER]
  );
  return rows;
}

function decisionOf(candidate) {
  return String(candidate?.scan_result?.sourcing_decision || '').trim().toUpperCase() || 'UNKNOWN';
}

function testPriceOf(candidate) {
  const value = Number(candidate?.scan_result?.test_price_kmf);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function priceAuthorityOf(candidate) {
  return String(candidate?.scan_result?.price_authority || '').trim() || null;
}

function contractVersionOf(candidate) {
  return String(candidate?.normalized_source_contract?.schema_version || '').trim() || null;
}

function classifyCandidate(candidate) {
  if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
    return { status: 'already_promoted' };
  }

  if (candidate.state !== 'scanned' || candidate.product_id) {
    return { status: 'blocked', reason: 'state_or_product_link' };
  }

  const decision = decisionOf(candidate);
  if (!ALLOWED_DECISIONS.has(decision)) {
    return { status: 'blocked', reason: `decision:${decision}` };
  }

  if (contractVersionOf(candidate) !== '2') {
    return { status: 'blocked', reason: `contract_v${contractVersionOf(candidate) || 'missing'}` };
  }

  const price = testPriceOf(candidate);
  if (!(price > 0)) {
    return { status: 'blocked', reason: 'test_price_missing' };
  }

  const authority = priceAuthorityOf(candidate);
  if (authority !== EXPECTED_PRICE_AUTHORITY) {
    return { status: 'blocked', reason: `price_authority:${authority || 'missing'}` };
  }

  return {
    status: 'promotable',
    price_kmf: price,
    decision,
    price_authority: authority,
  };
}

function summarizeCandidates(candidates) {
  const summary = {
    clean_total: candidates.length,
    already_promoted: 0,
    promotable: 0,
    blocked: 0,
    blocked_by_reason: {},
    decisions: {},
    test_price_kmf: { min: null, max: null },
  };

  for (const candidate of candidates) {
    const decision = decisionOf(candidate);
    summary.decisions[decision] = (summary.decisions[decision] || 0) + 1;
    const classification = classifyCandidate(candidate);
    if (classification.status === 'already_promoted') {
      summary.already_promoted += 1;
    } else if (classification.status === 'promotable') {
      summary.promotable += 1;
      const price = classification.price_kmf;
      summary.test_price_kmf.min = summary.test_price_kmf.min == null ? price : Math.min(summary.test_price_kmf.min, price);
      summary.test_price_kmf.max = summary.test_price_kmf.max == null ? price : Math.max(summary.test_price_kmf.max, price);
    } else {
      summary.blocked += 1;
      summary.blocked_by_reason[classification.reason] = (summary.blocked_by_reason[classification.reason] || 0) + 1;
    }
  }

  return summary;
}

async function auditPromotedDrafts(queryable = db) {
  const { rows: [row] } = await queryable.query(
    `SELECT
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND sc.product_id IS NOT NULL)::int AS promoted,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND p.is_active = TRUE)::int AS active_promoted,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND pme.product_id IS NOT NULL)::int AS exposed_promoted,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND p.lifecycle_status IS DISTINCT FROM 'candidate')::int AS wrong_lifecycle
     FROM sourcing_candidates sc
     LEFT JOIN products p ON p.id = sc.product_id
     LEFT JOIN product_market_exposure pme ON pme.product_id = p.id
    WHERE sc.supplier_name = $1`,
    [SUPPLIER]
  );
  return {
    promoted: Number(row?.promoted || 0),
    active_promoted: Number(row?.active_promoted || 0),
    exposed_promoted: Number(row?.exposed_promoted || 0),
    wrong_lifecycle: Number(row?.wrong_lifecycle || 0),
  };
}

async function auditState(queryable = db) {
  const candidates = await loadCleanCandidates(queryable);
  if (candidates.length !== EXPECTED_CLEAN) {
    throw new Error(`REFUS: pool AliExpress clean attendu ${EXPECTED_CLEAN}, trouvé ${candidates.length}`);
  }
  const summary = summarizeCandidates(candidates);
  const drafts = await auditPromotedDrafts(queryable);
  if (drafts.active_promoted !== 0 || drafts.exposed_promoted !== 0 || drafts.wrong_lifecycle !== 0) {
    throw new Error(`REFUS: audit drafts invalide ${JSON.stringify(drafts)}`);
  }
  return { candidates, summary, drafts };
}

async function acquireRunLock() {
  const client = await db.getClient();
  try {
    const { rows: [row] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
    if (!row?.locked) {
      client.release();
      return null;
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseRunLock(client) {
  if (!client) return;
  try {
    await client.query(
      'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
      [LOCK_NAMESPACE, LOCK_KEY]
    );
  } finally {
    client.release();
  }
}

async function executeBatch(before, limit) {
  const promotable = before.candidates
    .map(candidate => ({ candidate, classification: classifyCandidate(candidate) }))
    .filter(item => item.classification.status === 'promotable')
    .slice(0, limit);

  const promoted = [];
  for (const item of promotable) {
    const { candidate, classification } = item;
    // The owner-triggered staging operator explicitly chooses the canonical
    // test_price_kmf as the temporary inactive-draft price. It is NOT market
    // truth and creates no exposure; local-market pricing remains a later gate.
    // eslint-disable-next-line no-await-in-loop
    const result = await promoteCandidate(candidate.id, {
      price_kmf: classification.price_kmf,
    }, null);

    promoted.push({
      candidate_id: candidate.id,
      supplier_product_id: candidate.supplier_product_id,
      product_id: result.product_id,
      price_kmf: classification.price_kmf,
      source_price_authority: classification.price_authority,
      sourcing_decision: classification.decision,
      enrichment_status: result.enrichment?.status || null,
    });
  }
  return promoted;
}

async function main() {
  const args = parseArgs();
  assertRuntime(args);

  const before = await auditState();
  console.log(`[aliexpress-draft-promotion] BEFORE ${JSON.stringify({
    mode: args.mode,
    limit: args.limit,
    runtime: runtimeEnvironment(),
    ...before.summary,
    drafts: before.drafts,
  }, null, 2)}`);

  if (args.mode === 'dry-run') {
    console.log('[aliexpress-draft-promotion] DRY_RUN aucun changement écrit');
    return { before, promoted: [] };
  }

  const lockClient = await acquireRunLock();
  if (!lockClient) throw new Error('REFUS: un autre batch de promotion AliExpress est actif');

  let promoted;
  try {
    promoted = await executeBatch(before, args.limit);
  } finally {
    await releaseRunLock(lockClient);
  }

  const after = await auditState();
  if (after.drafts.active_promoted !== 0 || after.drafts.exposed_promoted !== 0) {
    throw new Error(`REFUS audit final: publication inattendue ${JSON.stringify(after.drafts)}`);
  }

  console.log(`[aliexpress-draft-promotion] EXECUTED ${JSON.stringify({
    promoted_this_run: promoted.length,
    sample: promoted.slice(0, 10),
  }, null, 2)}`);
  console.log(`[aliexpress-draft-promotion] AFTER ${JSON.stringify({
    ...after.summary,
    drafts: after.drafts,
  }, null, 2)}`);
  return { before, promoted, after };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[aliexpress-draft-promotion] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  EXPECTED_CLEAN,
  FLAG,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ALLOWED_DECISIONS,
  EXPECTED_PRICE_AUTHORITY,
  isTruthy,
  runtimeEnvironment,
  parseArgs,
  assertRuntime,
  cleanStockSql,
  decisionOf,
  testPriceOf,
  priceAuthorityOf,
  contractVersionOf,
  classifyCandidate,
  summarizeCandidates,
  loadCleanCandidates,
  auditPromotedDrafts,
  auditState,
  executeBatch,
  main,
};