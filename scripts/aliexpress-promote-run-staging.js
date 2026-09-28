/**
 * @komerce-arch
 * @role          staging-import-run-catalog-promotion
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        import_runtime_runs.run_ref, sourcing_candidates certified outcomes
 * @outputs       inactive catalog drafts for one exact import run
 * @depends       db.js, services/sourcing-certification.js, services/sourcing-candidate-actions.js
 * @used-by       .github/workflows/staging-catalog-ops.yml
 * @db-read       import_runtime_runs, sourcing_candidates, products, product_market_exposure
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog promotion tables
 * @db-txn        one canonical promotion transaction per candidate; advisory lock serializes one run
 * @doctrine      exact_run_scope, sourcing_certified_only, inactive_drafts_only, explicit_operator_temporary_price, no_auto_publish
 * @impact-areas  sourcing, catalog, staging
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const { evaluateSourcingCandidateOutcome } = require('../services/sourcing-certification');
const { promoteCandidate } = require('../services/sourcing-candidate-actions');

const SUPPLIER = 'AliExpress';
const FLAG = 'KOMERCE_ALLOW_IMPORT_RUN_PROMOTION';
const LOCK_NAMESPACE = 'komerce';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const EXPECTED_PRICE_AUTHORITY = 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION';
const ENRICHMENT_MODE = 'source_only';

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimeEnvironment(env = process.env) {
  return String(env.KOMERCE_ENV || '').trim().toLowerCase();
}

function normalizeRunRef(value) {
  const runRef = String(value || '').trim().toUpperCase();
  if (!/^KIR-\d{6}$/.test(runRef)) throw new Error('run_ref doit respecter KIR-000000');
  return runRef;
}

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  let limit = DEFAULT_LIMIT;
  let runRef = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--run-ref') runRef = argv[++i];
    else if (arg.startsWith('--run-ref=')) runRef = arg.split('=', 2)[1];
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_LIMIT}`);
  }

  return { mode, limit, runRef: normalizeRunRef(runRef) };
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

async function loadRun(runRef, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT id, run_ref, provider, source_type, source_ref, import_id, status, intake
       FROM import_runtime_runs
      WHERE run_ref = $1`,
    [runRef]
  );
  if (!rows.length) throw new Error(`REFUS: run introuvable ${runRef}`);
  const run = rows[0];
  if (String(run.provider || '').trim().toLowerCase() !== SUPPLIER.toLowerCase()) {
    throw new Error(`REFUS: ${runRef} n'est pas un run AliExpress`);
  }
  if (run.source_type !== 'api') throw new Error(`REFUS: ${runRef} n'est pas une source API`);
  if (!run.import_id) throw new Error(`REFUS: ${runRef} sans import_id`);
  if (run.intake?.pipeline_status !== 'CANONICAL_RESOLVED') {
    throw new Error(`REFUS: ${runRef} pipeline non certifié (${run.intake?.pipeline_status || 'inconnu'})`);
  }
  return run;
}

async function loadRunCandidates(importId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT sc.id,
            sc.import_id,
            sc.supplier_name,
            sc.supplier_product_id,
            sc.product_name,
            sc.state,
            sc.product_id,
            sc.rejected_reason,
            sc.raw_payload,
            sc.scan_result,
            sc.normalized_source_contract,
            sc.purchase_price_kmf,
            sc.komerce_category,
            sc.image_url,
            sc.created_at
       FROM sourcing_candidates sc
      WHERE sc.import_id = $1
      ORDER BY sc.created_at, sc.id`,
    [importId]
  );
  return rows;
}

function decisionOf(candidate) {
  return String(
    candidate?.sourcing_decision
      ?? candidate?.scan_result?.sourcing_decision
      ?? ''
  ).trim().toUpperCase() || 'UNKNOWN';
}

function testPriceOf(candidate) {
  const value = Number(candidate?.scan_result?.test_price_kmf);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function priceAuthorityOf(candidate) {
  const scan = candidate?.scan_result || {};
  return String(scan.recommended_price_authority || scan.price_authority || '').trim() || null;
}

function classifyCandidate(candidate) {
  if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
    return { status: 'already_promoted' };
  }

  const verdict = evaluateSourcingCandidateOutcome(candidate);
  if (!(verdict?.outcome_valid && verdict?.sourcing_certified)) {
    return {
      status: 'not_certified',
      reason: `outcome:${verdict?.outcome || 'unknown'}`,
      decision: decisionOf(candidate),
    };
  }

  if (candidate.state !== 'scanned' || candidate.product_id) {
    return { status: 'blocked', reason: 'state_or_product_link' };
  }

  const price = testPriceOf(candidate);
  if (!(price > 0)) return { status: 'blocked', reason: 'test_price_missing' };

  const authority = priceAuthorityOf(candidate);
  if (authority !== EXPECTED_PRICE_AUTHORITY) {
    return { status: 'blocked', reason: `price_authority:${authority || 'missing'}` };
  }

  return {
    status: 'promotable',
    price_kmf: price,
    decision: decisionOf(candidate),
    price_authority: authority,
  };
}

function summarizeCandidates(candidates) {
  const summary = {
    run_total: candidates.length,
    certified_total: 0,
    promotable: 0,
    already_promoted: 0,
    not_certified: 0,
    blocked: 0,
    by_decision: {},
    blocked_by_reason: {},
    test_price_kmf: { min: null, max: null },
  };

  for (const candidate of candidates) {
    const decision = decisionOf(candidate);
    summary.by_decision[decision] = (summary.by_decision[decision] || 0) + 1;

    const classification = classifyCandidate(candidate);
    if (classification.status === 'already_promoted') {
      summary.already_promoted += 1;
      summary.certified_total += 1;
    } else if (classification.status === 'promotable') {
      summary.promotable += 1;
      summary.certified_total += 1;
      const price = classification.price_kmf;
      summary.test_price_kmf.min = summary.test_price_kmf.min == null ? price : Math.min(summary.test_price_kmf.min, price);
      summary.test_price_kmf.max = summary.test_price_kmf.max == null ? price : Math.max(summary.test_price_kmf.max, price);
    } else if (classification.status === 'not_certified') {
      summary.not_certified += 1;
    } else {
      summary.blocked += 1;
      summary.certified_total += 1;
      summary.blocked_by_reason[classification.reason] = (summary.blocked_by_reason[classification.reason] || 0) + 1;
    }
  }
  return summary;
}

async function auditPromotedDrafts(importId, queryable = db) {
  const { rows: [row] } = await queryable.query(
    `SELECT
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND sc.product_id IS NOT NULL)::int AS promoted,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND p.is_active = TRUE)::int AS active_promoted,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND pme.product_id IS NOT NULL)::int AS exposed_promoted,
       COUNT(*) FILTER (WHERE sc.state = 'imported_to_catalog' AND p.lifecycle_status IS DISTINCT FROM 'candidate')::int AS wrong_lifecycle
     FROM sourcing_candidates sc
     LEFT JOIN products p ON p.id = sc.product_id
     LEFT JOIN product_market_exposure pme ON pme.product_id = p.id
    WHERE sc.import_id = $1`,
    [importId]
  );
  return {
    promoted: Number(row?.promoted || 0),
    active_promoted: Number(row?.active_promoted || 0),
    exposed_promoted: Number(row?.exposed_promoted || 0),
    wrong_lifecycle: Number(row?.wrong_lifecycle || 0),
  };
}

async function auditRun(runRef, queryable = db) {
  const run = await loadRun(runRef, queryable);
  const candidates = await loadRunCandidates(run.import_id, queryable);
  const summary = summarizeCandidates(candidates);
  const drafts = await auditPromotedDrafts(run.import_id, queryable);

  if (summary.certified_total !== Number(run.intake?.ready_for_refinery || 0)) {
    throw new Error(
      `REFUS: divergence certification ${runRef}: projection=${run.intake?.ready_for_refinery || 0}, candidats=${summary.certified_total}`
    );
  }
  if (drafts.active_promoted !== 0 || drafts.exposed_promoted !== 0 || drafts.wrong_lifecycle !== 0) {
    throw new Error(`REFUS: audit drafts invalide ${JSON.stringify(drafts)}`);
  }
  return { run, candidates, summary, drafts };
}

async function acquireRunLock(runRef) {
  const client = await db.getClient();
  try {
    const { rows: [row] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [LOCK_NAMESPACE, `import-run-promotion:${runRef}`]
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

async function releaseRunLock(client, runRef) {
  if (!client) return;
  try {
    await client.query(
      'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
      [LOCK_NAMESPACE, `import-run-promotion:${runRef}`]
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
    // Explicit staging operation = operator choice of the existing temporary
    // test_price_kmf for an INACTIVE draft only. It never becomes market truth
    // and creates no market exposure.
    // eslint-disable-next-line no-await-in-loop
    const result = await promoteCandidate(candidate.id, {
      price_kmf: classification.price_kmf,
      enrichment_mode: ENRICHMENT_MODE,
    }, null);

    promoted.push({
      candidate_id: candidate.id,
      supplier_product_id: candidate.supplier_product_id,
      product_id: result.product_id,
      price_kmf: classification.price_kmf,
      sourcing_decision: classification.decision,
      price_authority: classification.price_authority,
    });
  }
  return promoted;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  assertRuntime(args, env);

  const before = await auditRun(args.runRef);
  console.log(`[import-run-promotion] BEFORE ${JSON.stringify({
    run_ref: args.runRef,
    mode: args.mode,
    limit: args.limit,
    runtime: runtimeEnvironment(env),
    ...before.summary,
    drafts: before.drafts,
  }, null, 2)}`);

  if (args.mode === 'dry-run') {
    console.log('[import-run-promotion] DRY_RUN aucun changement écrit');
    return { before, promoted: [] };
  }

  if (before.summary.blocked > 0) {
    throw new Error(`REFUS: ${before.summary.blocked} candidat(s) certifié(s) bloqué(s) avant promotion`);
  }

  const lockClient = await acquireRunLock(args.runRef);
  if (!lockClient) throw new Error(`REFUS: promotion déjà active pour ${args.runRef}`);

  let promoted;
  try {
    promoted = await executeBatch(before, args.limit);
  } finally {
    await releaseRunLock(lockClient, args.runRef);
  }

  const after = await auditRun(args.runRef);
  if (after.drafts.active_promoted !== 0 || after.drafts.exposed_promoted !== 0 || after.drafts.wrong_lifecycle !== 0) {
    throw new Error(`REFUS audit final: publication inattendue ${JSON.stringify(after.drafts)}`);
  }

  console.log(`[import-run-promotion] EXECUTED ${JSON.stringify({
    run_ref: args.runRef,
    promoted_this_run: promoted.length,
    sample: promoted.slice(0, 10),
  }, null, 2)}`);
  console.log(`[import-run-promotion] AFTER ${JSON.stringify({
    ...after.summary,
    drafts: after.drafts,
  }, null, 2)}`);
  return { before, promoted, after };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[import-run-promotion] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SUPPLIER,
  FLAG,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  EXPECTED_PRICE_AUTHORITY,
  ENRICHMENT_MODE,
  isTruthy,
  runtimeEnvironment,
  normalizeRunRef,
  parseArgs,
  assertRuntime,
  loadRun,
  loadRunCandidates,
  decisionOf,
  testPriceOf,
  priceAuthorityOf,
  classifyCandidate,
  summarizeCandidates,
  auditPromotedDrafts,
  auditRun,
  executeBatch,
  main,
};
