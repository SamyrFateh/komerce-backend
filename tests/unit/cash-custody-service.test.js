'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockResolve = jest.fn();
const mockAudit = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...a) => mockResolve(...a),
  audit: (...a) => mockAudit(...a),
}));
const mockRule = jest.fn();
jest.mock('../../utils/rules', () => ({ getRuleNumber: (...a) => mockRule(...a) }));

const service = require('../../services/cash-custody-service');

const authz = { market_id: 'm1', assignment_id: 'a1', membership_id: 'mb1', currency: 'KMF', capabilities: ['finance.read', 'cash_control.policy.manage'] };
const fakeDb = (...results) => {
  const query = jest.fn();
  results.forEach(r => (r instanceof Error ? query.mockRejectedValueOnce(r) : query.mockResolvedValueOnce(r)));
  return { query };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve.mockResolvedValue(authz);
  mockRule.mockImplementation(async (_k, d) => d);
});

test('limites centrales : défauts, surcharge business_rules, défaut jamais au-dessus du plafond central', async () => {
  expect(await service.centralLimits()).toEqual({ max_holding_kmf: 5000000, default_holding_kmf: 1000000, max_days: 30, default_days: 7 });
  mockRule.mockImplementation(async k => ({ CASH_CUSTODY_MAX_HOLDING_KMF: 100, CASH_CUSTODY_DEFAULT_HOLDING_KMF: 500, CASH_CUSTODY_MAX_DAYS: 2, CASH_CUSTODY_DEFAULT_DAYS: 9 }[k]));
  expect(await service.centralLimits()).toEqual({ max_holding_kmf: 100, default_holding_kmf: 100, max_days: 2, default_days: 2 });
});

test('bornage du délai et du plafond de détention', () => {
  const limits = { max_holding_kmf: 100, default_holding_kmf: 40, max_days: 10, default_days: 5 };
  expect(service.boundDays(null, limits)).toBe(5);
  expect(service.boundDays(3, limits)).toBe(3);
  expect(service.boundDays(99, limits)).toBe(10);
  expect(service.boundHolding(null, limits)).toBe(40);
  expect(service.boundHolding('70.5', limits)).toBe(70.5);
  expect(service.boundHolding(1e9, limits)).toBe(100);
});

test('listRecipients / assertAuthorizedRecipient : habilité accepté, autre refusé', async () => {
  const row = { membership_id: 'mb', user_id: 'u1', full_name: 'Ali', role: 'client', limit_amount: '250000', granted_at: 't' };
  const list = await service.listRecipients(fakeDb({ rows: [row] }), 'm1');
  expect(list[0]).toMatchObject({ user_id: 'u1', holding_limit_kmf: 250000 });
  await expect(service.assertAuthorizedRecipient(fakeDb({ rows: [row] }), { marketId: 'm1', userId: 'u1' })).resolves.toMatchObject({ user_id: 'u1' });
  await expect(service.assertAuthorizedRecipient(fakeDb({ rows: [row] }), { marketId: 'm1', userId: 'u2' }))
    .rejects.toMatchObject({ code: 'custody_recipient_not_authorized', status: 403 });
});

test('assertActiveDestination : seule une destination ACTIVE du Market est acceptée', async () => {
  await expect(service.assertActiveDestination(fakeDb({ rows: [{ id: 'd', status: 'ACTIVE' }] }), { marketId: 'm1', destinationId: 'd' })).resolves.toMatchObject({ id: 'd' });
  await expect(service.assertActiveDestination(fakeDb({ rows: [{ id: 'd', status: 'PROPOSED' }] }), { marketId: 'm1', destinationId: 'd' })).rejects.toMatchObject({ status: 409 });
  await expect(service.assertActiveDestination(fakeDb({ rows: [] }), { marketId: 'm1', destinationId: 'd' })).rejects.toMatchObject({ code: 'custody_destination_not_active' });
});

test('délai de garde du Market : valeur configurée bornée, sinon défaut', async () => {
  const limits = { max_days: 10, default_days: 5 };
  expect(await service.marketCustodyDays(fakeDb({ rows: [{ custody_max_days: 30 }] }), 'm1', limits)).toBe(10);
  expect(await service.marketCustodyDays(fakeDb({ rows: [] }), 'm1', limits)).toBe(5);
});

test('readCustody exige finance.read et expose can_manage', async () => {
  const db = fakeDb({ rows: [] }, { rows: [] }, { rows: [] });
  const view = await service.readCustody(db, { userId: 'u', marketCode: 'KM' });
  expect(mockResolve).toHaveBeenCalledWith(db, { userId: 'u', marketCode: 'KM', requiredCapability: 'finance.read' });
  expect(view).toMatchObject({ can_manage: true, recipients: [], destinations: [] });
});

describe('proposeDestination', () => {
  const base = { kind: 'bank', label: 'Banque', account_ref: 'IBAN …1234' };
  test('succès : audité, devise du Market par défaut', async () => {
    const db = fakeDb({ rows: [{ id: 'd1', status: 'PROPOSED' }] });
    const res = await service.proposeDestination(db, { userId: 'u', marketCode: 'KM', payload: base });
    expect(res.id).toBe('d1');
    expect(db.query.mock.calls[0][1]).toEqual(['m1', 'BANK', 'Banque', 'KMF', 'IBAN …1234', null, 'u']);
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_DESTINATION_PROPOSED', marketId: 'm1' }));
  });
  test('refus : type, devise, champs, doublon, contrainte, erreur inconnue', async () => {
    const run = (payload, db = fakeDb({ rows: [] })) => service.proposeDestination(db, { userId: 'u', marketCode: 'KM', payload });
    await expect(run({ ...base, kind: 'CASH' })).rejects.toMatchObject({ code: 'custody_destination_kind_invalid' });
    await expect(run({ ...base, currency: 'euro' })).rejects.toMatchObject({ code: 'custody_destination_field_invalid' });
    await expect(run({ ...base, label: 'x' })).rejects.toMatchObject({ code: 'custody_destination_field_invalid' });
    await expect(run(base, fakeDb(Object.assign(new Error('dup'), { code: '23505' })))).rejects.toMatchObject({ code: 'custody_destination_exists', status: 409 });
    await expect(run(base, fakeDb(Object.assign(new Error('chk'), { code: '23514' })))).rejects.toMatchObject({ status: 422 });
    await expect(run(base, fakeDb(new Error('boom')))).rejects.toThrow('boom');
  });
});

describe('transitionDestination', () => {
  const row = (status, proposedBy = 'p') => ({ rows: [{ id: 'd', status, proposed_by: proposedBy }] });
  const run = (db, verb, extra = {}) => service.transitionDestination(db, { userId: 'u', marketCode: 'KM', destinationId: 'd', verb, ...extra });
  test('activation par un autre que le proposant, auditée', async () => {
    const db = fakeDb(row('PROPOSED'), { rows: [{ id: 'd', status: 'ACTIVE' }] });
    expect(await run(db, 'activate')).toMatchObject({ status: 'ACTIVE' });
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_DESTINATION_ACTIVATED', before: { status: 'PROPOSED' } }));
  });
  test('refus : verbe inconnu, introuvable, transition, même acteur, motif manquant', async () => {
    await expect(run(fakeDb(), 'x')).rejects.toMatchObject({ code: 'custody_destination_action_invalid' });
    await expect(run(fakeDb({ rows: [] }), 'activate')).rejects.toMatchObject({ status: 404 });
    await expect(run(fakeDb(row('CLOSED')), 'activate')).rejects.toMatchObject({ code: 'custody_destination_transition_forbidden' });
    await expect(run(fakeDb(row('PROPOSED', 'u')), 'activate')).rejects.toMatchObject({ code: 'custody_destination_two_actors_required', status: 403 });
    await expect(run(fakeDb(row('ACTIVE')), 'suspend')).rejects.toMatchObject({ code: 'custody_destination_reason_required' });
    await expect(run(fakeDb(row('ACTIVE')), 'close', { reason: 'ab' })).rejects.toMatchObject({ code: 'custody_destination_reason_required' });
  });
  test('suspension et clôture motivées', async () => {
    const db = fakeDb(row('ACTIVE'), { rows: [{ id: 'd', status: 'SUSPENDED' }] });
    expect(await run(db, 'suspend', { reason: 'doute' })).toMatchObject({ status: 'SUSPENDED' });
    expect(db.query.mock.calls[1][1]).toEqual(['d', 'SUSPENDED', 'u', 'doute']);
  });
});
