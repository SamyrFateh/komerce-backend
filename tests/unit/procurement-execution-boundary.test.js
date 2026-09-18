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
 * Aujourd'hui aucun adapter du registry réel (allegro, aliexpress) ne
 * satisfait ce contrat — voir la caractérisation dédiée ci-dessous, qui
 * fige ce fait pour que toute évolution future du registry le remarque.
 */

const { evaluateProcurementExecutionBoundary, NOT_REACHED } = require('../../services/suppliers/procurement-execution-boundary');
const { EXECUTION_ADAPTER_REGISTRY } = require('../../services/suppliers/execution-adapter-registry');

const soi = (provider, payload) => ({ provider, version: 1, payload });

function fullAdapter(provider, overrides = {}) {
  return {
    provider,
    evaluate: jest.fn(async () => ({ ready: true, status: 'FULFILLMENT_READY', evidence: {}, reason: null })),
    buildOrderPayload: jest.fn(async ({ identity }) => ({ provider: identity.provider, native: identity.payload })),
    placeOrder: jest.fn(async () => ({ supplier_order_id: 'EXT-1', tracking_url: 'https://track.test/1' })),
    ...overrides,
  };
}

describe('caractérisation — aucun adapter réel n\'a placeOrder+buildOrderPayload aujourd\'hui', () => {
  test('allegro et aliexpress ne satisfont jamais validateExecutionAdapter (fait du domaine, pas une lacune)', async () => {
    for (const provider of Object.keys(EXECUTION_ADAPTER_REGISTRY)) {
      const out = await evaluateProcurementExecutionBoundary({
        identity: soi(provider, { x: 1 }), quantity: 1, canonicalUnit: {}, adapters: EXECUTION_ADAPTER_REGISTRY,
      });
      expect(out).toMatchObject({ crossed: false, status: NOT_REACHED, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
    }
  });
});

describe('evaluateProcurementExecutionBoundary — franchissement complet', () => {
  test('adapter avec buildOrderPayload + placeOrder → boundary franchie, placeOrder invoqué avec le payload natif', async () => {
    const adapter = fullAdapter('cj');
    const identity = soi('cj', { vid: 'V1' });
    const out = await evaluateProcurementExecutionBoundary({
      identity, quantity: 3, canonicalUnit: { canonical_unit_id: 'u1' }, preflight: { ready: true },
      adapters: { cj: adapter },
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
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: {} });
    expect(out).toMatchObject({ crossed: false, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
  });

  test('adapter avec buildOrderPayload seul (pas de placeOrder) → not reached', async () => {
    const adapter = fullAdapter('cj', { placeOrder: undefined });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter } });
    expect(out).toMatchObject({ crossed: false, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
  });

  test('adapter avec placeOrder seul (pas de buildOrderPayload) → not reached', async () => {
    const adapter = fullAdapter('cj', { buildOrderPayload: undefined });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter } });
    expect(out).toMatchObject({ crossed: false, reason: 'EXECUTION_ADAPTER_INCOMPLETE' });
  });

  test('buildOrderPayload lève → not reached fail-closed, jamais un crash', async () => {
    const adapter = fullAdapter('cj', { buildOrderPayload: jest.fn(async () => { throw new Error('boom'); }) });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter } });
    expect(out).toMatchObject({ crossed: false, reason: 'BUILD_ORDER_PAYLOAD_ERROR' });
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  test('buildOrderPayload retourne null/undefined → not reached, placeOrder jamais invoqué', async () => {
    const adapter = fullAdapter('cj', { buildOrderPayload: jest.fn(async () => null) });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter } });
    expect(out).toMatchObject({ crossed: false, reason: 'BUILD_ORDER_PAYLOAD_EMPTY' });
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  test('placeOrder lève → not reached fail-closed, payload déjà construit n\'est pas perdu silencieusement', async () => {
    const adapter = fullAdapter('cj', { placeOrder: jest.fn(async () => { throw new Error('provider down'); }) });
    const out = await evaluateProcurementExecutionBoundary({ identity: soi('cj', { vid: 'V1' }), adapters: { cj: adapter } });
    expect(out).toMatchObject({ crossed: false, reason: 'PLACE_ORDER_ERROR' });
  });
});
