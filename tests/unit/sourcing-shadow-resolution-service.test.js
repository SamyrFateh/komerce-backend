'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db');
const db = require('../../db');
const resolution = require('../../services/sourcing-shadow-resolution-service');

function productObservation(overrides = {}) {
  return {
    observation_id: '11111111-1111-4111-8111-111111111111',
    capture_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    grain: 'product',
    source_id: 'api:cj',
    source_ref: 'P-1',
    principal_ref: null,
    parent_observation_id: null,
    observed_at: '2026-09-14T08:00:00.000Z',
    normalized: { product_name: 'PowerGo 65W', brand: 'PowerGo', specifications: [] },
    ...overrides,
  };
}

function clientWith(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

describe('sourcing shadow resolution service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('alloue puis lie une nouvelle identite canonique quand aucun candidat existe', async () => {
    const observation = productObservation();
    const seen = [];
    const client = clientWith(async (sql) => {
      const text = String(sql);
      seen.push(text);
      if (text.includes('FROM sourcing_observations o') && text.includes('JOIN sourcing_captures')) return { rows: [observation] };
      if (text.includes('SELECT canonical_entity_id FROM sourcing_resolution_bindings')) return { rows: [] };
      if (text.includes('FROM sourcing_resolution_decisions')) return { rows: [] };
      if (text.includes('FROM sourcing_canonical_entity_refs cer')) return { rows: [] };
      if (text.includes('SELECT DISTINCT rb.canonical_entity_id') && text.includes('current_e')) return { rows: [] };
      if (text.includes('INSERT INTO sourcing_canonical_entities')) return { rows: [{ canonical_entity_id: 'c1111111-1111-4111-8111-111111111111' }] };
      if (text.includes('SELECT canonical_entity_id FROM sourcing_canonical_entity_refs')) return { rows: [] };
      if (text.includes('INSERT INTO sourcing_resolution_decisions')) return { rows: [{ decision_id: 'd1111111-1111-4111-8111-111111111111' }] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);

    const out = await resolution.resolveCaptureShadow(observation.capture_id);

    expect(out.status).toBe('resolved');
    expect(out.new_canonical).toBe(1);
    expect(out.linked).toBe(0);
    expect(seen.some((sql) => sql.includes('INSERT INTO sourcing_canonical_entity_refs'))).toBe(true);
    expect(seen.some((sql) => sql.includes('INSERT INTO sourcing_resolution_bindings'))).toBe(true);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  test('reutilise une identite par exact source_ref et persiste MatchProposal + LINK', async () => {
    const observation = productObservation();
    const candidateId = 'c2222222-2222-4222-8222-222222222222';
    const client = clientWith(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM sourcing_observations o') && text.includes('JOIN sourcing_captures')) return { rows: [observation] };
      if (text.includes('SELECT canonical_entity_id FROM sourcing_resolution_bindings')) return { rows: [] };
      if (text.includes('FROM sourcing_resolution_decisions')) return { rows: [] };
      if (text.includes('FROM sourcing_canonical_entity_refs cer')) return { rows: [{ canonical_entity_id: candidateId }] };
      if (text.includes('SELECT DISTINCT rb.canonical_entity_id') && text.includes('current_e')) return { rows: [] };
      if (text.includes('SELECT DISTINCT e.evidence_type')) {
        return { rows: [{ evidence_type: 'source_ref', evidence_key: 'source_scoped_ref', value: '["api:cj","P-1"]' }] };
      }
      if (text.includes('INSERT INTO sourcing_match_proposals')) return { rows: [{ proposal_id: 'p2222222-2222-4222-8222-222222222222' }] };
      if (text.includes('SELECT canonical_entity_id FROM sourcing_canonical_entity_refs')) return { rows: [{ canonical_entity_id: candidateId }] };
      if (text.includes('INSERT INTO sourcing_resolution_decisions')) return { rows: [{ decision_id: 'd2222222-2222-4222-8222-222222222222' }] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);

    const out = await resolution.resolveCaptureShadow(observation.capture_id);

    expect(out.linked).toBe(1);
    expect(out.new_canonical).toBe(0);
    expect(out.proposals).toBe(1);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO sourcing_match_proposals'))).toBe(true);
    expect(client.query.mock.calls.some(([sql, params]) => String(sql).includes('INSERT INTO sourcing_resolution_decisions') && params?.[0] === 'LINK')).toBe(true);
  });

  test('differe Offer/Unit tant que le parent canonique n est pas resolu', async () => {
    const observation = productObservation({
      grain: 'offer',
      source_ref: null,
      observation_id: '33333333-3333-4333-8333-333333333333',
      parent_observation_id: '44444444-4444-4444-8444-444444444444',
      normalized: { purchase_price: 10, currency: 'USD' },
    });
    let bindingLookups = 0;
    const client = clientWith(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM sourcing_observations o') && text.includes('JOIN sourcing_captures')) return { rows: [observation] };
      if (text.includes('SELECT canonical_entity_id FROM sourcing_resolution_bindings')) {
        bindingLookups++;
        return { rows: [] };
      }
      if (text.includes('FROM sourcing_resolution_decisions')) return { rows: [] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);

    const out = await resolution.resolveCaptureShadow(observation.capture_id);

    expect(out.deferred_parent).toBe(1);
    expect(bindingLookups).toBeGreaterThanOrEqual(2);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO sourcing_canonical_entities'))).toBe(false);
  });
});
