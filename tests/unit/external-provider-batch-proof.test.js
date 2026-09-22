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

const { parseArgs, selection, plan, safeProofResult, paypalSandboxRead, cjCatalogRead, metaWhatsappPhoneRead, runBatch } =
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

test('empty or partial stage summaries never produce a false PASS', () => {
  expect(safeProofResult({ conversation: { status: 'PASS' }, stages: [] }, 'TEST', 'READ').status).toBe('BLOCKED');
  expect(safeProofResult({ conversation: { status: 'PASS' }, stages: [
    { id: 'P0', status: 'PASS', failed_checks: [] },
  ] }, 'TEST', 'READ').status).toBe('BLOCKED');
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


test('CJ catalog read requires explicit live-read consent and a dedicated token', async () => {
  const fetchImpl = jest.fn();
  expect((await cjCatalogRead({}, fetchImpl)).reason_code)
    .toBe('CJ_LIVE_CATALOG_READ_NOT_AUTHORIZED');
  expect((await cjCatalogRead({ CJ_PROOF_ALLOW_CATALOG_READ: '1' }, fetchImpl)).reason_code)
    .toBe('CJ_DEDICATED_READ_TOKEN_MISSING');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('CJ probe only reads one catalogue item and exactly the same product id', async () => {
  const calls = [];
  const fetchImpl = jest.fn(async (url, init) => {
    calls.push({ url, method: init.method });
    if (url.includes('/product/listV2?')) return {
      ok: true, json: async () => ({ result: true, data: {
        content: [{ productList: [{ id: 'CJEXACT001', nameEn: 'Example' }] }],
      } }),
    };
    return { ok: true, json: async () => ({ result: true,
      data: { pid: 'CJEXACT001', nameEn: 'Example' } }) };
  });
  const proof = await cjCatalogRead({
    CJ_PROOF_ALLOW_CATALOG_READ: '1', CJ_PROOF_ACCESS_TOKEN: 'private-cj-token',
  }, fetchImpl);
  expect(proof).toMatchObject({
    operation: 'CJ_LIVE_CATALOG_BOUNDED_EXACT_READ', environment: 'LIVE_CATALOG_READ_ONLY',
    status: 'PASS',
  });
  expect(calls).toEqual([
    { url: 'https://developers.cjdropshipping.com/api2.0/v1/product/listV2?page=1&size=1',
      method: 'GET' },
    { url: 'https://developers.cjdropshipping.com/api2.0/v1/product/query?pid=CJEXACT001',
      method: 'GET' },
  ]);
  expect(JSON.stringify(proof)).not.toMatch(/private-cj-token|CJEXACT001/);
});

test('CJ rejects a response whose detail identity does not match search identity', async () => {
  const fetchImpl = jest.fn(async url => ({
    ok: true,
    json: async () => url.includes('listV2') ?
      { result: true, data: { content: [{ productList: [{ id: 'REAL01' }] }] } } :
      { result: true, data: { pid: 'OTHER02' } },
  }));
  const proof = await cjCatalogRead({
    CJ_PROOF_ALLOW_CATALOG_READ: '1', CJ_PROOF_ACCESS_TOKEN: 'private',
  }, fetchImpl);
  expect(proof.status).toBe('BLOCKED');
  expect(proof.reason_code).toBe('CJ_EXACT_PRODUCT_ID_NOT_CONFIRMED');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('CJ empty list and provider rejection stop without exact GET or false PASS', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () =>
    ({ result: true, data: { content: [] } }) }));
  const proof = await cjCatalogRead({
    CJ_PROOF_ALLOW_CATALOG_READ: '1', CJ_PROOF_ACCESS_TOKEN: 'private',
  }, fetchImpl);
  expect(proof.reason_code).toBe('CJ_EXACT_PRODUCT_ID_NOT_OBSERVED');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});


test('Meta phone probe is gated by explicit consent and separate read credentials', async () => {
  const fetchImpl = jest.fn();
  expect((await metaWhatsappPhoneRead({}, fetchImpl)).reason_code)
    .toBe('META_LIVE_ACCOUNT_READ_NOT_AUTHORIZED');
  expect((await metaWhatsappPhoneRead({ META_PROOF_ALLOW_ACCOUNT_READ: '1' }, fetchImpl)).reason_code)
    .toBe('META_DEDICATED_READ_CREDENTIALS_MISSING');
  expect((await metaWhatsappPhoneRead({
    META_PROOF_ALLOW_ACCOUNT_READ: '1', META_PROOF_READ_TOKEN: 'private',
    META_PROOF_PHONE_NUMBER_ID: 'not-an-id',
  }, fetchImpl)).reason_code).toBe('META_PHONE_ID_INVALID');
  expect((await metaWhatsappPhoneRead({
    META_PROOF_ALLOW_ACCOUNT_READ: '1', META_PROOF_READ_TOKEN: 'private',
    META_PROOF_PHONE_NUMBER_ID: '1234567890123456', META_PROOF_GRAPH_VERSION: 'v23.0/evil',
  }, fetchImpl)).reason_code).toBe('META_GRAPH_VERSION_INVALID');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('Meta phone probe makes one exact GET and emits no business metadata or credentials', async () => {
  const seen = [];
  const fetchImpl = jest.fn(async (url, init) => {
    seen.push({ url, method: init.method });
    return { ok: true, json: async () =>
      ({ id: '1234567890123456', verified_name: 'PRIVATE BRAND' }) };
  });
  const result = await metaWhatsappPhoneRead({
    META_PROOF_ALLOW_ACCOUNT_READ: '1', META_PROOF_READ_TOKEN: 'private-read-token',
    META_PROOF_PHONE_NUMBER_ID: '1234567890123456', META_PROOF_GRAPH_VERSION: 'v23.0',
  }, fetchImpl);
  expect(seen).toEqual([{
    url: 'https://graph.facebook.com/v23.0/1234567890123456?fields=id,verified_name',
    method: 'GET',
  }]);
  expect(result).toMatchObject({
    status: 'PASS', operation: 'META_WHATSAPP_EXACT_PHONE_METADATA_READ',
    environment: 'LIVE_ACCOUNT_READ_ONLY',
    reason_code: 'META_EXACT_PHONE_METADATA_READ_PROVED',
  });
  expect(JSON.stringify(result)).not.toMatch(/private-read-token|PRIVATE BRAND|1234567890123456/);
});

test('Meta phone proof blocks mismatched identity, missing metadata and rejected Graph responses', async () => {
  const env = {
    META_PROOF_ALLOW_ACCOUNT_READ: '1', META_PROOF_READ_TOKEN: 'private',
    META_PROOF_PHONE_NUMBER_ID: '1234567890123456',
  };
  const mismatch = await metaWhatsappPhoneRead(env, async () =>
    ({ ok: true, json: async () => ({ id: '9999999999999999', verified_name: 'Other' }) }));
  expect(mismatch.reason_code).toBe('META_EXACT_PHONE_ID_MISMATCH');
  const incomplete = await metaWhatsappPhoneRead(env, async () =>
    ({ ok: true, json: async () => ({ id: env.META_PROOF_PHONE_NUMBER_ID }) }));
  expect(incomplete.reason_code).toBe('META_VERIFIED_NAME_NOT_OBSERVED');
  const forbidden = await metaWhatsappPhoneRead(env, async () => ({ ok: false, status: 403 }));
  expect(forbidden.reason_code).toBe('META_PHONE_METADATA_HTTP_REJECTED');
  expect([mismatch, incomplete, forbidden].every(x => x.status === 'BLOCKED')).toBe(true);
});
