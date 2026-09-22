/**
 * @komerce-arch
 * @role          external-provider-batch-proof-test
 * @domain        external-provider-contracts
 * @layer         test
 * @criticality   high
 * @inputs        synthetic registry and stubbed PayPal sandbox transport
 * @outputs       proofs that batch selection, fail-closed and redaction remain safe
 * @depends       scripts/external-provider-batch-proof.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  external-provider-contracts, tests
 */
'use strict';

const { parseArgs, selection, plan, safeProofResult, paypalSandboxRead, runBatch } =
  require('../../scripts/external-provider-batch-proof');

const registry = { providers: [
  { id: 'paypal', family: 'payment', highest_proof: 'UNQUALIFIED', analysis_document: null },
  { id: 'ebay', family: 'supplier', highest_proof: 'P3', analysis_document: null },
  { id: 'aliexpress', family: 'supplier', highest_proof: 'UNQUALIFIED', analysis_document: null },
] };

test('inventory is entirely offline, preserves declared proof as metadata only', async () => {
  const result = await runBatch(parseArgs(['--mode=inventory']), {}, { registry });
  expect(result.summary).toEqual({ total: 3, probe_pass: 0, blocked: 0, not_run: 3 });
  expect(result.providers[1].declared_highest_proof).toBe('P3');
  expect(result.providers[1].probe.status).toBe('NOT_RUN');
  expect(result.providers[0].analysis_document_exists).toBe(false);
});

test('missing probes fail closed and previously proved probes do not rerun by default', () => {
  const opts = parseArgs(['--mode=sandbox-read']);
  expect(plan(registry.providers[0], opts).probe.status).toBe('PENDING');
  expect(plan(registry.providers[1], opts).probe.reason_code)
    .toBe('PREVIOUSLY_PROVED_RECHECK_NOT_REQUESTED');
  expect(plan(registry.providers[2], opts).probe.reason_code)
    .toBe('NO_APPROVED_READ_ONLY_PROBE');
});

test('unknown providers, duplicate arguments and off-main live runs reject before network', async () => {
  expect(() => selection(registry, parseArgs(['--providers=unknown'])))
    .toThrow('BATCH_UNKNOWN_PROVIDER');
  expect(() => parseArgs(['--mode=inventory', '--mode=sandbox-read']))
    .toThrow('BATCH_ARGUMENT_INVALID');
  await expect(runBatch(parseArgs(['--mode=sandbox-read']), {}, { registry }))
    .rejects.toThrow('BATCH_LIVE_PROOF_MAIN_ACTIONS_ONLY');
});

test('PayPal proof is only OAuth and exact webhook GET, never an order or payment', async () => {
  const seen = [];
  const fetchImpl = jest.fn(async (url, init) => {
    seen.push({ url, method: init.method });
    if (url.endsWith('/v1/oauth2/token')) {
      return { ok: true, json: async () => ({ access_token: 'private-token' }) };
    }
    return { ok: true, json: async () => ({ id: 'wh-id', status: 'ACTIVE' }) };
  });
  const proof = await paypalSandboxRead({
    PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_WEBHOOK_ID: 'wh-id',
  }, fetchImpl);
  expect(proof.status).toBe('PASS');
  expect(proof.operation).toBe('PAYPAL_SANDBOX_OAUTH_AND_WEBHOOK_READ');
  expect(seen).toEqual([
    { url: 'https://api-m.sandbox.paypal.com/v1/oauth2/token', method: 'POST' },
    { url: 'https://api-m.sandbox.paypal.com/v1/notifications/webhooks/wh-id', method: 'GET' },
  ]);
  expect(JSON.stringify(proof)).not.toMatch(/private-token|secret|CLIENT_ID/);
});

test('PayPal rejects production/missing secrets and mismatch without exposing payload', async () => {
  const failFetch = jest.fn();
  const blocked = await paypalSandboxRead({ PAYPAL_ENV: 'production' }, failFetch);
  expect(blocked.reason_code).toBe('PAYPAL_SANDBOX_REQUIRED');
  expect(failFetch).not.toHaveBeenCalled();
  const proof = await paypalSandboxRead({
    PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_WEBHOOK_ID: 'wh-id',
  }, async url => ({ ok: true, json: async () =>
    url.endsWith('/token') ? { access_token: 'secret' } : { id: 'wrong' } }));
  expect(proof.status).toBe('BLOCKED');
  expect(proof.reason_code).toBe('PAYPAL_WEBHOOK_ID_MISMATCH');
});

test('sourced proof is narrowed to bounded P0/P1 codes (never raw diagnostics)', () => {
  const proof = safeProofResult({
    conversation: { status: 'PASS' },
    stages: [
      { id: 'P0', status: 'PASS', failed_checks: [] },
      { id: 'P1', status: 'BLOCKED', failed_checks: ['TOKEN_MISSING', 'secret=bad'] },
      { id: 'P4', status: 'PASS', failed_checks: [] },
    ],
  }, 'SANDBOX', 'READ_ONLY');
  expect(proof.status).toBe('BLOCKED');
  expect(proof.stages).toEqual([
    { id: 'P0', status: 'PASS', failed_checks: [] },
    { id: 'P1', status: 'BLOCKED', failed_checks: ['TOKEN_MISSING'] },
  ]);
});
