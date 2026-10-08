'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
const mockAck = jest.fn();
const mockSnooze = jest.fn();
jest.mock('../../services/signal-admin-service', () => ({ acknowledgeByRef: (...a) => mockAck(...a), snoozeByRef: (...a) => mockSnooze(...a) }));
beforeEach(() => { mockQuery.mockReset(); mockAck.mockReset(); mockSnooze.mockReset(); });
const service = require('../../services/action-center-agent-scope');

test('chaque rôle agent a un jeu de propriétaires fixe ; seul agent_relais est borné par relais', () => {
  expect(Object.keys(service.AGENT_SCOPES).sort()).toEqual(['agent_hub', 'agent_relais', 'agent_transitaire']);
  expect(service.AGENT_SCOPES.agent_relais.relayBound).toBe(true);
  expect(service.AGENT_SCOPES.agent_hub.relayBound).toBe(false);
  expect(service.AGENT_SCOPES.agent_transitaire.ownerRoles).toEqual(['customs']);
});

test('resolveScope : fail-closed sans relais, relais repris de la session', async () => {
  await expect(service.resolveScope({ role: 'agent_relais' })).rejects.toThrow(/Aucun relais/);
  expect(await service.resolveScope({ role: 'agent_relais', relais_id: 'r1' })).toEqual({ ownerRoles: ['relais'], relaisId: 'r1', marketIds: null });
});

test('resolveScope : hub/transitaire bornés aux marchés explicitement rattachés, refus sans rattachement', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ market_id: 'm1' }, { market_id: 'm2' }] });
  expect(await service.resolveScope({ id: 'u', role: 'agent_hub', relais_id: 'ignored' })).toEqual({ ownerRoles: ['hub'], relaisId: null, marketIds: ['m1', 'm2'] });
  expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL');
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await expect(service.resolveScope({ id: 'u', role: 'agent_transitaire' })).rejects.toMatchObject({ status: 403, code: 'agent_action_center_market_scope_missing' });
});

test('allowedActions : acquitter/reporter seulement, jamais résoudre', () => {
  expect(service.allowedActions('open')).toEqual(['acknowledge', 'snooze']);
  expect(service.allowedActions('acknowledged')).toEqual(['snooze']);
  expect(service.allowedActions('resolved')).toEqual([]);
});

test('acknowledge / snooze : signal du périmètre uniquement, marché repris du signal serveur', async () => {
  const user = { id: 'u', role: 'agent_relais', relais_id: 'r1' };
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-1', status: 'open', market_id: 'mk' }] });
  mockAck.mockResolvedValueOnce({ signal_ref: 'KSG-1', status: 'acknowledged' });
  expect(await service.acknowledge(user, 'KSG-1')).toEqual({ signal_ref: 'KSG-1', status: 'acknowledged', actions: ['snooze'] });
  expect(mockAck).toHaveBeenCalledWith('KSG-1', 'mk');
  mockSnooze.mockResolvedValueOnce({ signal_ref: 'KSG-1', status: 'snoozed', snoozed_until: 'T' });
  expect((await service.snooze(user, 'KSG-1', 6)).status).toBe('snoozed');
  expect(mockSnooze).toHaveBeenCalledWith('KSG-1', 6, 'mk');
  mockSnooze.mockResolvedValueOnce(null);
  await expect(service.snooze(user, 'KSG-1')).rejects.toMatchObject({ status: 409 });
  expect(mockSnooze).toHaveBeenLastCalledWith('KSG-1', 24, 'mk');
  mockAck.mockResolvedValueOnce(null);
  await expect(service.acknowledge(user, 'KSG-1')).rejects.toMatchObject({ status: 409 });
});

test('signal hors périmètre : 404, aucune mutation ; report > 24 h ou invalide : 400', async () => {
  const user = { id: 'u', role: 'agent_relais', relais_id: 'r1' };
  mockQuery.mockResolvedValue({ rows: [] });
  await expect(service.acknowledge(user, 'KSG-9')).rejects.toMatchObject({ status: 404 });
  await expect(service.snooze(user, 'KSG-9', 6)).rejects.toMatchObject({ status: 404 });
  for (const h of [25, 0, -1, 'x']) await expect(service.snooze(user, 'KSG-1', h)).rejects.toMatchObject({ status: 400 });
  expect(mockAck).not.toHaveBeenCalled();
  expect(mockSnooze).not.toHaveBeenCalled();
});

test('normalizePage borne limit/offset', () => {
  expect(service.normalizePage({ limit: '9999', offset: '-1' })).toEqual({ limit: 100, offset: 0 });
  expect(service.normalizePage({})).toEqual({ limit: 50, offset: 0 });
});

test('publicSignal n’expose aucun identifiant interne', () => {
  const out = service.publicSignal({ signal_ref: 'KSG-1', entity_id: 'x', market_id: 'y', id: 'z', title: 'T' });
  expect(out).not.toHaveProperty('entity_id');
  expect(out).not.toHaveProperty('market_id');
  expect(out.actions).toEqual([]);
  expect(service.publicSignal({ status: 'open' }).actions).toEqual(['acknowledge', 'snooze']);
});
