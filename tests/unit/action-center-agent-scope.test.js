'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const service = require('../../services/action-center-agent-scope');

test('chaque rôle agent a un jeu de propriétaires fixe ; seul agent_relais est borné par relais', () => {
  expect(Object.keys(service.AGENT_SCOPES).sort()).toEqual(['agent_hub', 'agent_relais', 'agent_transitaire']);
  expect(service.AGENT_SCOPES.agent_relais.relayBound).toBe(true);
  expect(service.AGENT_SCOPES.agent_hub.relayBound).toBe(false);
  expect(service.AGENT_SCOPES.agent_transitaire.ownerRoles).toEqual(['customs']);
});

test('resolveScope : fail-closed sans relais, relais repris de la session', () => {
  expect(() => service.resolveScope({ role: 'agent_relais' })).toThrow(/Aucun relais/);
  expect(service.resolveScope({ role: 'agent_relais', relais_id: 'r1' })).toEqual({ ownerRoles: ['relais'], relaisId: 'r1' });
  expect(service.resolveScope({ role: 'agent_hub', relais_id: 'ignored' }).relaisId).toBeNull();
});

test('normalizePage borne limit/offset', () => {
  expect(service.normalizePage({ limit: '9999', offset: '-1' })).toEqual({ limit: 100, offset: 0 });
  expect(service.normalizePage({})).toEqual({ limit: 50, offset: 0 });
});

test('publicSignal n’expose ni identifiant interne ni action', () => {
  const out = service.publicSignal({ signal_ref: 'KSG-1', entity_id: 'x', market_id: 'y', id: 'z', title: 'T' });
  expect(out).not.toHaveProperty('entity_id');
  expect(out).not.toHaveProperty('market_id');
  expect(out.actions).toEqual([]);
});
