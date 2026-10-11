'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../utils/currency', () => ({
  getCurrencyParity: jest.fn(async c => {
    const rates = { KMF: 491.96775, XAF: 655.957 };
    if (!rates[c]) throw new Error('no parity');
    return rates[c];
  }),
  roundToMinorUnit: (a, m) => Math.round(a * 10 ** m) / 10 ** m,
}));
const db = require('../../db');
const service = require('../../services/cash-deposit-service');

beforeEach(() => jest.clearAllMocks());

test('createDeposit conserve les validations Legacy', async () => {
  await expect(service.createDeposit({ agentId: 'agent-1', payload: { amount_kmf: 0 } }))
    .rejects.toMatchObject({ code: 'deposit_amount_invalid', status: 400 });
  await expect(service.createDeposit({ agentId: 'agent-1', payload: {
    amount_kmf: 1000, deposit_method: 'crypto', period_start: '2026-08-01', period_end: '2026-08-02',
  } })).rejects.toMatchObject({ code: 'deposit_method_invalid', status: 400 });
});

// createDeposit : INSERT + allocation FIFO dans une transaction (client dédié).
function txInsert(row) {
  const client = {
    query: jest.fn(async sql => (/INSERT INTO cash_deposits/.test(sql) ? { rows: [row] } : { rows: [] })),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValueOnce(client);
  return client;
}
const insertCall = client => client.query.mock.calls.find(c => /INSERT INTO cash_deposits/.test(String(c[0])));

test('createDeposit écrit au nom de l acteur fourni', async () => {
  const client = txInsert({ id: 'uuid', deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending' });
  const result = await service.createDeposit({
    agentId: 'agent-1',
    payload: {
      amount_kmf: 5000,
      deposit_method: 'mobile_money',
      period_start: '2026-08-20',
      period_end: '2026-08-26',
      reference: 'MM-1',
    },
  });
  expect(result.deposit_ref).toBe('KDP-000001');
  expect(insertCall(client)[1][0]).toBe('agent-1');
  expect(String(insertCall(client)[0])).toContain('INSERT INTO cash_deposits');
  // allocation FIFO serveur, reconstruite, dans la même transaction
  const alloc = client.query.mock.calls.find(c => /cash_allocate_fifo/.test(String(c[0])));
  expect(alloc[1]).toEqual(['uuid', 'SERVER_FIFO']);
  const order = client.query.mock.calls.map(c => String(c[0]));
  expect(order[0]).toBe('BEGIN');
  expect(order[order.length - 1]).toBe('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

// Client scripté : BEGIN/COMMIT/ROLLBACK neutres ; les autres requêtes consomment `results`.
function fakeClient(...results) {
  return { query: jest.fn(async sql => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? { rows: [] } : (results.shift() || { rows: [] }))) };
}
const locked = (status, extra = {}) => ({ rows: [{ id: 'uuid', deposit_ref: 'KDP-1', agent_id: 'agent-9', status, amount_kmf: 1, review_market_id: 'm1', verified_by: 'old-admin', verified_at: 'T0', notes: 'n0', ...extra }] });
const updated = status => ({ rows: [{ id: 'uuid', deposit_ref: 'KDP-1', status }] });

test('verifyDeposit : pending → verified avec garde de statut (UPDATE conditionnel)', async () => {
  const c = fakeClient(locked('pending'), updated('verified'));
  const result = await service.verifyDeposit({ depositId: 'uuid', verifierId: 'admin-1', notes: 'OK', dbClient: c });
  expect(result.status).toBe('verified');
  const upd = c.query.mock.calls.find(x => String(x[0]).includes('UPDATE cash_deposits'));
  expect(String(upd[0])).toContain('AND status = $6');
  expect(upd[1]).toEqual(['admin-1', 'verified', 'OK', null, 'uuid', 'pending']);
});

test('disputeDeposit exige une raison, puis pending → disputed', async () => {
  await expect(service.disputeDeposit({ depositId: 'uuid', verifierId: 'admin-1', reason: '' }))
    .rejects.toMatchObject({ code: 'deposit_dispute_reason_required', status: 400 });
  const c = fakeClient(locked('pending'), updated('disputed'));
  const result = await service.disputeDeposit({ depositId: 'uuid', verifierId: 'admin-1', reason: 'Écart reçu', dbClient: c });
  expect(result.status).toBe('disputed');
});

test('revue : 404 si le dépôt a disparu, id requis', async () => {
  await expect(service.verifyDeposit({ depositId: 'missing', verifierId: 'a', dbClient: fakeClient({ rows: [] }) }))
    .rejects.toMatchObject({ code: 'deposit_not_found', status: 404 });
  await expect(service.disputeDeposit({ depositId: 'x', reason: 'r', dbClient: fakeClient({ rows: [] }) })).rejects.toMatchObject({ status: 404 });
  await expect(service.verifyDeposit({ verifierId: 'v' })).rejects.toMatchObject({ code: 'deposit_id_required' });
});

test('revue : le déposant ne peut jamais valider ni contester son propre dépôt', async () => {
  await expect(service.verifyDeposit({ depositId: 'uuid', verifierId: 'agent-9', dbClient: fakeClient(locked('pending')) }))
    .rejects.toMatchObject({ code: 'deposit_self_review_forbidden', status: 403 });
});

test('revue : verified est terminal (pas de re-vérification, pas de double contestation)', async () => {
  await expect(service.verifyDeposit({ depositId: 'uuid', verifierId: 'a', dbClient: fakeClient(locked('verified')) }))
    .rejects.toMatchObject({ code: 'deposit_transition_forbidden', status: 409 });
  await expect(service.disputeDeposit({ depositId: 'uuid', verifierId: 'a', reason: 'r', dbClient: fakeClient(locked('disputed')) }))
    .rejects.toMatchObject({ code: 'deposit_transition_forbidden', status: 409 });
});

test('revue : contester un dépôt vérifié exige correction explicite ET voie centrale', async () => {
  await expect(service.disputeDeposit({ depositId: 'uuid', verifierId: 'a', reason: 'r', dbClient: fakeClient(locked('verified')) }))
    .rejects.toMatchObject({ code: 'deposit_correction_required', status: 409 });
  await expect(service.disputeDeposit({ depositId: 'uuid', verifierId: 'a', reason: 'r', correction: true, dbClient: fakeClient(locked('verified')) }))
    .rejects.toMatchObject({ code: 'deposit_correction_required' });
});

test('correction centrale : audit avant/après conserve le validateur précédent', async () => {
  const c = fakeClient(locked('verified'), updated('disputed'));
  await service.disputeDeposit({ depositId: 'uuid', verifierId: 'admin-2', reason: 'relevé non conforme', correction: true, central: true, dbClient: c });
  const au = c.query.mock.calls.find(x => String(x[0]).includes('market_delegation_audit'));
  expect(au[1][4]).toBe('CASH_DEPOSIT_CENTRAL_CORRECTED');
  expect(au[1][8]).toBe('m1');
  expect(JSON.parse(au[1][5])).toMatchObject({ status: 'verified', verified_by: 'old-admin', verified_at: 'T0', previous_notes: 'n0' });
  expect(JSON.parse(au[1][6])).toMatchObject({ status: 'disputed', note: 'relevé non conforme' });
});

test('voie centrale : audit sur verify (note) ; sans central aucun audit ; marché inconnu toléré', async () => {
  const c = fakeClient(locked('disputed', { review_market_id: null }), updated('verified'));
  await service.verifyDeposit({ depositId: 'uuid', verifierId: 'admin-1', notes: 'ok', central: true, dbClient: c });
  const au = c.query.mock.calls.find(x => String(x[0]).includes('market_delegation_audit'));
  expect(au[1][4]).toBe('CASH_DEPOSIT_CENTRAL_VERIFIED');
  expect(au[1][8]).toBeNull();
  const c2 = fakeClient(locked('pending'), updated('verified'));
  await service.verifyDeposit({ depositId: 'uuid', dbClient: c2 });
  expect(c2.query.mock.calls.some(x => String(x[0]).includes('market_delegation_audit'))).toBe(false);
});

test('revue : changement concurrent de statut → 409 (UPDATE sans ligne)', async () => {
  await expect(service.verifyDeposit({ depositId: 'uuid', verifierId: 'a', dbClient: fakeClient(locked('pending'), { rows: [] }) }))
    .rejects.toMatchObject({ code: 'deposit_transition_forbidden', status: 409 });
});

test('transaction propre : COMMIT sur succès, ROLLBACK + release sur échec', async () => {
  const ok = { ...fakeClient(locked('pending'), updated('verified')), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(ok);
  await service.verifyDeposit({ depositId: 'uuid', verifierId: 'a' });
  expect(ok.query.mock.calls.map(x => x[0])).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
  expect(ok.release).toHaveBeenCalled();
  const ko = { ...fakeClient({ rows: [] }), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(ko);
  await expect(service.verifyDeposit({ depositId: 'x', verifierId: 'a' })).rejects.toMatchObject({ status: 404 });
  expect(ko.query.mock.calls.map(x => x[0])).toContain('ROLLBACK');
  expect(ko.release).toHaveBeenCalled();
  const bad = { query: jest.fn(async sql => { if (sql === 'ROLLBACK') throw new Error('rb'); if (sql === 'BEGIN') return { rows: [] }; throw new Error('boom'); }), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(bad);
  await expect(service.verifyDeposit({ depositId: 'x', verifierId: 'a' })).rejects.toThrow('boom');
});

const base = { deposit_method: 'mobile_money', period_start: '2026-08-20', period_end: '2026-08-26' };

test('dépôt déclaré en XAF : amount_kmf dérivé des parités et snapshot figé', async () => {
  const client = txInsert({ id: 'd2', deposit_ref: 'KDP-2', amount_kmf: 75000 });
  await service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 100000, declared_currency: 'XAF' } });
  const params = insertCall(client)[1];
  expect(params[1]).toBe(75000);
  expect(params.slice(8)).toEqual([100000, 'XAF', 0.75, 'currency_parities:XAF->EUR->KMF']);
});

test('dépôt déclaré en KMF : taux 1, aucun lookup de parité', async () => {
  const { getCurrencyParity } = require('../../utils/currency');
  getCurrencyParity.mockClear();
  const client = txInsert({ id: 'd3' });
  await service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 5000, declared_currency: 'KMF' } });
  const params = insertCall(client)[1];
  expect(params[1]).toBe(5000);
  expect(params.slice(8)).toEqual([5000, 'KMF', 1, 'identity:KMF']);
  expect(getCurrencyParity).not.toHaveBeenCalled();
});

test('chemin historique amount_kmf : snapshot NULL', async () => {
  const client = txInsert({ id: 'd4' });
  await service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 5000 } });
  expect(insertCall(client)[1].slice(8)).toEqual([null, null, null, null]);

  // l'allocation échoue : la remise est annulée (ROLLBACK), jamais une remise sans allocation silencieuse
  const ko = { query: jest.fn(async sql => { if (/cash_allocate_fifo/.test(String(sql))) throw new Error('alloc down'); return { rows: [{ id: 'd5' }] }; }), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(ko);
  await expect(service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 5000 } })).rejects.toThrow('alloc down');
  expect(ko.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
  expect(ko.release).toHaveBeenCalled();
});

test('devise sans parité : échec fermé 422, aucune écriture', async () => {
  await expect(service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 10, declared_currency: 'USD' } }))
    .rejects.toMatchObject({ code: 'deposit_currency_parity_missing', status: 422 });
  expect(db.query).not.toHaveBeenCalled();
});

test('devise malformée ou montant déclaré invalide : 400', async () => {
  await expect(service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 10, declared_currency: 'xaf' } }))
    .rejects.toMatchObject({ code: 'deposit_currency_invalid' });
  await expect(service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 0, declared_currency: 'XAF' } }))
    .rejects.toMatchObject({ code: 'deposit_amount_invalid' });
});

test('gardes et valeurs par défaut', async () => {
  await expect(service.createDeposit({ payload: {} })).rejects.toMatchObject({ code: 'deposit_agent_required' });
  await expect(service.createDeposit({ agentId: 'a' })).rejects.toMatchObject({ code: 'deposit_amount_invalid' });
  await expect(service.resolveDeclaredAmount()).resolves.toEqual({ payload: {}, snapshot: null });
  await expect(service.resolveDeclaredAmount({ declared_currency: 42 })).rejects.toMatchObject({ code: 'deposit_currency_invalid' });
  expect(() => service.normalizePayload()).toThrow();
  expect(() => service.normalizePayload({ amount_kmf: 1, deposit_method: 'bank' })).toThrow(/Période/);
  const client = txInsert({ id: 'd' });
  await service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 10, reference: 'R', proof_url: 'u', notes: 'n' } });
  expect(insertCall(client)[1].slice(3, 8)).toEqual(['R', 'u', '2026-08-20', '2026-08-26', 'n']);
});

test('CashDepositError : statut 400 par défaut', () => {
  expect(new service.CashDepositError('x', 'y').status).toBe(400);
});
