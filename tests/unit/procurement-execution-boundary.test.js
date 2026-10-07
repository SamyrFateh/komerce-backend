'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/procurement-execution-boundary.test.js
 *
 * GAP-4B — Procurement Execution Boundary. N'est franchie que si un
 * adapter expose buildOrderPayload ET placeOrder sur LE MÊME provider.
 * Allegro reste volontairement manuel. AliExpress et CJ exposent désormais
 * le contrat d'exécution mais restent fail-closed sans contexte/opt-in runtime.
 */

const { evaluateProcurementExecutionBoundary, NOT_REACHED } = require('../../services/suppliers/procurement-execution-boundary');
const { EXECUTION_ADAPTER_REGISTRY } = require('../../services/suppliers/execution-adapter-registry');

const soi = (provider, payload) => ({ provider, version: 1, payload });

function provenRegistry(provider, environment = 'SANDBOX') {
  return {
    providers: {
      [provider]: [{
        capability: 'purchasing.auto_order',
        classification: 'CONFIRMED',
        availability: 'PROVEN',
        highest_proof: 'P4',
        environment,
        evidence: [],
        limitations: [],
      }],
    },
  };
}

function certifiedContext(provider, environment = 'SANDBOX') {
  return {
    certification_environment: environment,
    certification_registry: provenRegistry(provider, environment),
  };
}

function fullAdapter(provider, overrides = {}) {
  return {
    provider,
    evaluate: jest.fn(async () => ({ ready: true, status: 'FULFILLMENT_READY', evidence: {}, reason: null })),
    buildOrderPayload: jest.fn(async ({ items: [{ identity }] }) => ({ provider: identity.provider, native: identity.payload })),
    placeOrder: jest.fn(async () => ({ supplier_order_id: 'EXT-1', tracking_url: 'https://track.test/1' })),
    ...overrides,
  };
}

describe('caractérisation — capabilities runtime réelles', () => {
  test('Allegro reste hors boundary automatique', async () => {
    const out = await evaluateProcurementExecutionBoundary({
      identity: soi('allegro', { offer_id: '1' }), quantity: 1, canonicalUnit: {}, adapters: EXECUTION_ADAPTER_REGISTRY,
    });
    expect(out).toMatchObject({ crossed: false, status: NOT_REACHED, reason: 'CERTIFICATION_CAPABILITY_CLOSED' });
  });

  test('AliExpress est un execution adapter complet mais reste fail-closed sans destination/preflight', async () => {
    const out = await evaluateProcurementExecutionBoundary({
      identity: soi('aliexpress', { product_id: '1005010358671233', sku_id: '12000052119244345', sku_attr: '14:Beige' }),
      quantity: 1,
      canonicalUnit: { supplier_unit_ref: '12000052119244345' },
      preflight: { ready: true, evidence: { provider: 'aliexpress', auto_order_ready: true, supplier_product_id: '1005010358671233' } },
      adapters: EXECUTION_ADAPTER_REGISTRY,
      context: {},
    });
    expect(out).toMatchObject({ crossed: false, status: NOT_REACHED, reason: 'CERTIFICATION_ENVIRONMENT_MISMATCH' });
  });

  test('CJ est un execution adapter complet mais reste fail-closed sans contexte runtime', async () => {
    const out = await evaluateProcurementExecutionBoundary({
      identity: soi('cj', { pid: 'P', vid: 'V', variant_sku: 'S' }),
      quantity: 1,
      canonicalUnit: { supplier_unit_ref: 'V' },
      preflight: { ready: true, evidence: { auto_order_ready: true } },
      adapters: EXECUTION_ADAPTER_REGISTRY,
      context: {},
    });
    expect(out).toMatchObject({ crossed: false, status: NOT_REACHED, reason: 'CERTIFICATION_RUNTIME_ENVIRONMENT_REQUIRED' });
  });
});

describe('certification runtime guard', () => {
  test('une capability GAP bloque avant buildOrderPayload/placeOrder', async () => {
    const adapter = fullAdapter('cj');
    const registry = {
      providers: {
        cj: [{
          capability: 'purchasing.auto_order',
          classification: 'GAP',
          availability: 'IMPLEMENTED_NOT_LIVE_PROVEN',
          highest_proof: 'P2',
          environment: 'SANDBOX',
          evidence: [],
          limitations: [],
        }],
      },
    };
    const out = await evaluateProcurementExecutionBoundary({
      identity: soi('cj', { vid: 'V1' }),
      quantity: 1,
      canonicalUnit: {},
      adapters: { cj: adapter },
      context: { certification_registry: registry, certification_environment: 'SANDBOX' },
    });
    expect(out).toMatchObject({
      crossed: false,
      reason: 'CERTIFICATION_CAPABILITY_GAP',
      place_order_invoked: false,
    });
    expect(adapter.buildOrderPayload).not.toHaveBeenCalled();
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  test('une certification SANDBOX ne peut pas autoriser une exécution production', async () => {
    const adapter = fullAdapter('cj');
    const out = await evaluateProcurementExecutionBoundary({
      identity: soi('cj', { vid: 'V1' }),
      quantity: 1,
      canonicalUnit: {},
      adapters: { cj: adapter },
      context: {
        certification_environment: 'LIVE',
        certification_registry: provenRegistry('cj', 'SANDBOX'),
      },
    });
    expect(out).toMatchObject({
      crossed: false,
      reason: 'CERTIFICATION_ENVIRONMENT_MISMATCH',
      evidence: {
        runtime_environment: 'LIVE',
        certified_environment: 'SANDBOX',
      },
    });
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });
});

describe('evaluateProcurementExecutionBoundary — franchissement complet', () => {
  test('adapter avec buildOrderPayload + placeOrder → boundary franchie, placeOrder invoqué avec le payload natif', async () => {
    const adapter = fullAdapter('cj');
    const identity = soi('cj', { vid: 'V1' });
    const out = await evaluateProcurementExecutionBoundary({
      identity, quantity: 3, canonicalUnit: { canonical_unit_id: 'u1' }, preflight: { ready: true },
      adapters: { cj: adapter },
      context: certifiedContext('cj'),
    });
    expect(out).toMatchObject({
      crossed: true, status: 'EXECUTION_BOUNDARY_CROSSED', place_order_invoked: true,
      provider: 'cj', payload: { provider: 'cj', native: { vid: 'V1' } },
      result: { supplier_order_id: 'EXT-1', tracking_url: 'https://track.test/1' },
    });
    expect(adapter.buildOrderPayload).toHaveBeenCalledTimes(1);
    expect(adapter.placeOrder).toHaveBeenCalledWith(out.payload, expect.any(Object));
  });

  test('identity absente → not reached sans toucher au registry', async () => {
    const out = await evaluateProcurementExecutionBoundary({ quantity: 1, adapters: {} });
    expect(out).toMatchObject({ crossed: false, status: NOT_REACHED, reason: 'IDENTITY_REQUIRED' });
  });

  test('adapter absent pour ce provider → not reached, jamais une exception', async () => {
    const out = await evaluateProcurementExecutionBoundary({
      identity: soi('cj', { vid: 'V1' }),
      adapters: {},
      context: certifiedContext('cj'),
    });
    expect(out).toMatchObject({ crossed: false, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
  });

  test('adapter avec buildOrderPayload seul (pas de placeOrder) → not reached', async () => {
    const adapter = fullAdapter('cj', { placeOrder: undefined });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter }, context: certifiedContext('cj') });
    expect(out).toMatchObject({ crossed: false, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
  });

  test('adapter avec placeOrder seul (pas de buildOrderPayload) → not reached', async () => {
    const adapter = fullAdapter('cj', { buildOrderPayload: undefined });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter }, context: certifiedContext('cj') });
    expect(out).toMatchObject({ crossed: false, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
  });

  test('buildOrderPayload lève → not reached fail-closed, jamais un crash', async () => {
    const adapter = fullAdapter('cj', { buildOrderPayload: jest.fn(async () => { throw new Error('boom'); }) });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter }, context: certifiedContext('cj') });
    expect(out).toMatchObject({ crossed: false, reason: 'BUILD_ORDER_PAYLOAD_ERROR' });
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  test('buildOrderPayload retourne null/undefined → not reached, placeOrder jamais invoqué', async () => {
    const adapter = fullAdapter('cj', { buildOrderPayload: jest.fn(async () => null) });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter }, context: certifiedContext('cj') });
    expect(out).toMatchObject({ crossed: false, reason: 'BUILD_ORDER_PAYLOAD_EMPTY' });
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  test('placeOrder lève → not reached fail-closed, payload déjà construit n\'est pas perdu silencieusement', async () => {
    const adapter = fullAdapter('cj', { placeOrder: jest.fn(async () => { throw new Error('provider down'); }) });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter }, context: certifiedContext('cj') });
    expect(out).toMatchObject({ crossed: false, reason: 'PLACE_ORDER_ERROR', place_order_invoked: true });
  });
});


test('PLACE_ORDER_ERROR conserve code et message provider non sensibles', async () => {
  const error = Object.assign(new Error('provider rejected'), {
    payload: { code: 12345, message: 'sandbox contract rejected' },
  });
  const adapter = fullAdapter('cj', { placeOrder: jest.fn(async () => { throw error; }) });
  const out = await evaluateProcurementExecutionBoundary({
    identity: soi('cj', { vid: 'V1' }),
    quantity: 1,
    canonicalUnit: {},
    adapters: { cj: adapter },
    context: certifiedContext('cj'),
  });

  expect(out).toMatchObject({
    crossed: false,
    reason: 'PLACE_ORDER_ERROR',
    place_order_invoked: true,
    evidence: {
      provider: 'cj',
      provider_code: 12345,
      provider_message: 'sandbox contract rejected',
    },
  });
});


test('la boundary documente le replay comme capability séparée de placeOrder', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'suppliers', 'procurement-execution-boundary.js'),
    'utf8'
  );
  expect(src).toContain('CJ et AliExpress exposent désormais les deux');
  expect(src).toContain('une clé locale Komerce ne prouve jamais l\'idempotence');
  expect(src).not.toContain('ce chemin n\'est jamais exercé en production');
});
