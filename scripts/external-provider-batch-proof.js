#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          external-provider-batch-proof
 * @domain        external-provider-contracts
 * @layer         script
 * @criticality   high
 * @inputs        external-provider-registry.json, opt-in dedicated sandbox credentials
 * @outputs       one bounded, secret-free batch report across every registered provider
 * @depends       node:fs, node:path, scripts/stripe-provider-contract-proof.js, scripts/ebay-sandbox-browse-proof.js
 * @used-by       manual Github Actions provider characterization campaign
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  external-provider-contracts, governance, payments, sourcing
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'governance/external-provider-registry.json');
const SAFE_PROBES = Object.freeze({
  paypal: 'PAYPAL_SANDBOX_OAUTH_AND_WEBHOOK_READ',
  ebay: 'EBAY_SANDBOX_BROWSE_READ',
  stripe: 'STRIPE_TEST_ACCOUNT_READ',
});
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_CODE = /^[A-Z0-9_]{1,120}$/;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = /^--(mode|providers|include-proven|out)=(.+)$/.exec(arg);
    if (!m || Object.hasOwn(args, m[1])) throw new Error('BATCH_ARGUMENT_INVALID');
    args[m[1]] = m[2];
  }
  const mode = args.mode || 'inventory';
  if (!['inventory', 'sandbox-read'].includes(mode)) throw new Error('BATCH_MODE_INVALID');
  const includeProven = args['include-proven'] === 'true';
  if (args['include-proven'] && !['true', 'false'].includes(args['include-proven'])) {
    throw new Error('BATCH_INCLUDE_PROVEN_INVALID');
  }
  const providers = args.providers && args.providers !== 'all'
    ? args.providers.split(',').map(id => id.trim()) : null;
  if (providers && (!providers.length || providers.some(id => !SAFE_ID.test(id)) ||
    new Set(providers).size !== providers.length)) throw new Error('BATCH_PROVIDERS_INVALID');
  return { mode, providers, includeProven, out: args.out || null };
}

function selection(registry, options) {
  if (!registry || !Array.isArray(registry.providers)) throw new Error('BATCH_REGISTRY_INVALID');
  const ids = new Set(registry.providers.map(p => p.id));
  if (ids.size !== registry.providers.length || [...ids].some(id => !SAFE_ID.test(id))) {
    throw new Error('BATCH_REGISTRY_INVALID');
  }
  if (options.providers && options.providers.some(id => !ids.has(id))) {
    throw new Error('BATCH_UNKNOWN_PROVIDER');
  }
  return registry.providers.filter(p => !options.providers || options.providers.includes(p.id));
}

function plan(provider, options, root = ROOT) {
  const declared = provider.highest_proof || 'UNQUALIFIED';
  const proven = ['P1', 'P2', 'P3', 'P4'].includes(declared);
  const analysis = provider.analysis_document || null;
  // Avoid treating arbitrary registry paths as evidence from outside the repository.
  const safeAnalysis = typeof analysis === 'string' &&
    /^docs\/external-providers\/[a-zA-Z0-9/_-]+\.md$/.test(analysis) &&
    !analysis.split('/').includes('..') ? analysis : null;
  let status = 'NOT_RUN', reason_code = 'INVENTORY_ONLY';
  if (options.mode === 'sandbox-read') {
    if (!SAFE_PROBES[provider.id]) {
      status = 'BLOCKED'; reason_code = 'NO_APPROVED_READ_ONLY_PROBE';
    } else if (proven && !options.includeProven) {
      reason_code = 'PREVIOUSLY_PROVED_RECHECK_NOT_REQUESTED';
    } else {
      status = 'PENDING'; reason_code = 'READY_FOR_PREREQUISITE_CHECK';
    }
  }
  return {
    provider: provider.id,
    family: provider.family || 'unknown',
    declared_highest_proof: declared, // Inventory metadata, NOT newly established proof.
    analysis_document: safeAnalysis,
    analysis_document_exists: Boolean(safeAnalysis && fs.existsSync(path.join(root, safeAnalysis))),
    probe: {
      operation: SAFE_PROBES[provider.id] || null,
      status, reason_code,
      environment: null,
      stages: [],
    },
  };
}

function stageSummary(report) {
  const stages = Array.isArray(report && report.stages) ? report.stages : [];
  return stages.map(stage => ({
    id: SAFE_CODE.test(String(stage.id)) ? stage.id : 'UNKNOWN',
    status: stage.status === 'PASS' ? 'PASS' : 'BLOCKED',
    failed_checks: (stage.failed_checks || [])
      .filter(code => typeof code === 'string' && SAFE_CODE.test(code)).slice(0, 15),
  }));
}

function safeProofResult(report, environment, operation) {
  let blocked = report.conversation?.status !== 'PASS';
  const stages = stageSummary(report);
  blocked = blocked || ['P0', 'P1'].some(id => !stages.some(s => s.id === id && s.status === 'PASS'));
  return {
    operation,
    status: blocked ? 'BLOCKED' : 'PASS',
    reason_code: blocked ? 'CONVERSATION_OR_READ_PROOF_INCOMPLETE' : 'P0_P1_READ_PROVED',
    environment,
    stages: stages.filter(s => s.id === 'P0' || s.id === 'P1'),
  };
}

async function paypalSandboxRead(env, fetchImpl = global.fetch) {
  const operation = SAFE_PROBES.paypal;
  const environment = 'SANDBOX';
  const blocked = code => ({ operation, status: 'BLOCKED', reason_code: code, environment, stages: [] });
  if (env.PAYPAL_ENV !== 'sandbox') return blocked('PAYPAL_SANDBOX_REQUIRED');
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID) {
    return blocked('PAYPAL_DEDICATED_SANDBOX_CREDENTIALS_MISSING');
  }
  const base = 'https://api-m.sandbox.paypal.com';
  const basic = Buffer.from(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET).toString('base64');
  try {
    const oauth = await fetchImpl(base + '/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(7000),
    });
    if (!oauth.ok) return blocked('PAYPAL_OAUTH_REJECTED');
    const token = (await oauth.json()).access_token;
    if (!token || typeof token !== 'string') return blocked('PAYPAL_TOKEN_MISSING');
    const webhook = await fetchImpl(base + '/v1/notifications/webhooks/' +
      encodeURIComponent(env.PAYPAL_WEBHOOK_ID), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(7000),
    });
    if (!webhook.ok) return blocked('PAYPAL_WEBHOOK_READ_REJECTED');
    const payload = await webhook.json();
    if (payload.id !== env.PAYPAL_WEBHOOK_ID) return blocked('PAYPAL_WEBHOOK_ID_MISMATCH');
    // Read-only proof does not assert payment creation, capture, refund, or webhook delivery.
    return {
      operation, status: 'PASS', reason_code: 'SANDBOX_OAUTH_AND_EXACT_WEBHOOK_READ_PROVED',
      environment,
      stages: [{ id: 'P0', status: 'PASS', failed_checks: [] },
        { id: 'P1', status: 'PASS', failed_checks: [] }],
    };
  } catch {
    return blocked('PAYPAL_NETWORK_OR_RESPONSE_ERROR');
  }
}

async function runProbe(entry, env, deps = {}) {
  const id = entry.provider;
  if (id === 'paypal') return paypalSandboxRead(env, deps.fetchImpl);
  if (id === 'ebay') {
    if (env.EBAY_ENV !== 'sandbox') {
      return { operation: SAFE_PROBES.ebay, status: 'BLOCKED',
        reason_code: 'EBAY_SANDBOX_REQUIRED', environment: 'SANDBOX', stages: [] };
    }
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
      return { operation: SAFE_PROBES.ebay, status: 'BLOCKED',
        reason_code: 'EBAY_DEDICATED_SANDBOX_CREDENTIALS_MISSING', environment: 'SANDBOX', stages: [] };
    }
    const { runEbayBrowseReadOnlyProof } = require('./ebay-sandbox-browse-proof');
    const result = await runEbayBrowseReadOnlyProof({
      env: { EBAY_ENV: 'sandbox', EBAY_CLIENT_ID: env.EBAY_CLIENT_ID,
        EBAY_CLIENT_SECRET: env.EBAY_CLIENT_SECRET, EBAY_MARKETPLACE_ID: env.EBAY_MARKETPLACE_ID,
        EBAY_ITEM_ID: env.EBAY_ITEM_ID, EBAY_SEARCH_QUERY: env.EBAY_SEARCH_QUERY,
        EBAY_SEARCH_LIMIT: '3' },
      fetchImpl: deps.fetchImpl || global.fetch,
    });
    return safeProofResult(result.report, 'SANDBOX', SAFE_PROBES.ebay);
  }
  if (id === 'stripe') {
    if (!/^(sk|rk)_test_/.test(String(env.STRIPE_SECRET_KEY || ''))) {
      return { operation: SAFE_PROBES.stripe, status: 'BLOCKED',
        reason_code: 'STRIPE_DEDICATED_TEST_KEY_REQUIRED', environment: 'TEST', stages: [] };
    }
    const { runStripeReadOnlyProof } = require('./stripe-provider-contract-proof');
    const Stripe = require('stripe');
    const stripe = deps.stripeClient || new Stripe(env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 0, timeout: 7000, ...(env.STRIPE_API_VERSION ? { apiVersion: env.STRIPE_API_VERSION } : {}),
    });
    const result = await runStripeReadOnlyProof({ stripeClient: stripe, env });
    return safeProofResult(result.report, 'TEST', SAFE_PROBES.stripe);
  }
  return { operation: null, status: 'BLOCKED',
    reason_code: 'NO_APPROVED_READ_ONLY_PROBE', environment: null, stages: [] };
}

async function runBatch(options, env = process.env, deps = {}) {
  const root = deps.root || ROOT;
  const registry = deps.registry || JSON.parse(fs.readFileSync(path.join(root,
    'governance/external-provider-registry.json'), 'utf8'));
  const rows = selection(registry, options).map(provider => plan(provider, options, root));
  if (options.mode === 'sandbox-read' &&
    (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main')) {
    throw new Error('BATCH_LIVE_PROOF_MAIN_ACTIONS_ONLY');
  }
  // Serial, bounded calls. A failure of one operation must not prevent the rest of the batch.
  for (const row of rows) {
    if (row.probe.status !== 'PENDING') continue;
    try {
      row.probe = await runProbe(row, env, deps);
    } catch {
      row.probe = { operation: SAFE_PROBES[row.provider], status: 'BLOCKED',
        reason_code: 'READ_PROBE_FAILED', environment: null, stages: [] };
    }
  }
  return { schema_version: 1, mode: options.mode, evidence_scope: 'read-only',
    generated_at: new Date().toISOString(),
    summary: { total: rows.length,
      probe_pass: rows.filter(x => x.probe.status === 'PASS').length,
      blocked: rows.filter(x => x.probe.status === 'BLOCKED').length,
      not_run: rows.filter(x => x.probe.status === 'NOT_RUN').length },
    providers: rows };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.out && (!options.out.startsWith('artifacts/provider-contract-batch/') ||
    !/^artifacts\/provider-contract-batch\/[a-z0-9-]+\.json$/.test(options.out))) {
    throw new Error('BATCH_OUTPUT_PATH_INVALID');
  }
  const report = await runBatch(options);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, json, { mode: 0o600 });
  }
  process.stdout.write('BATCH_REPORT total=' + report.summary.total +
    ' pass=' + report.summary.probe_pass + ' blocked=' + report.summary.blocked +
    ' not_run=' + report.summary.not_run + '\n');
}

if (require.main === module) main().catch(() => {
  // No provider free-text, request payload, URL query, credential or token in job logs.
  process.stderr.write('BATCH_REPORT_FAILED\n');
  process.exitCode = 1;
});

module.exports = {
  parseArgs, selection, plan, stageSummary, safeProofResult,
  paypalSandboxRead, runProbe, runBatch,
};
