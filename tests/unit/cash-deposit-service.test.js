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
jest.mock('../../services/market-delegation-service', () => ({ audit: jest.fn(async () => {}) }));
jest.mock('../../services/cash-custody-service', () => {
  class CashCustodyError extends Error {
    constructor(code, message, status = 400) { super(message || code); this.code = code; this.status = status; }
  }
  return {
    RECEIVE_CAPABILITY: 'cash.custody.receive',
    CashCustodyError,
    assertAuthorizedRecipient: jest.fn(async () => ({})),
    assertActiveDestination: jest.fn(async () => ({ id: 'dest-1', kind: 'BANK', currency: 'XAF' })),
    holdingOf: jest.fn(async () => 1000000),
    mapDbError: jest.fn(error => error),
  };
});
const db = require('../../db');
const custody = require('../../services/cash-custody-service');
const { audit } = require('../../services/market-delegation-service');
const service = require('../../services/cash-deposit-service');

beforeEach(() => jest.clearAllMocks());

const target = { recipient_user_id: 'user-r' };

test('createDeposit exige une cible : personne habilitée OU destination finale, jamais les deux', async () => {
  await expect(service.createDeposit({ agentId: 'agent-1', payload: { amount_kmf: 100 } }))
    .rejects.toMatchObject({ code: 'deposit_target_required', status: 422 });
  await expect(service.createDeposit({ agentId: 'agent-1', payload: { amount_kmf: 100, recipient_user_id: 'u', destination_id: 'd' } }))
    .rejects.toMatchObject({ code: 'deposit_target_required' });
});

// createDeposit : tout dans une transaction (client dédié). Le Market vient du serveur.
function txInsert(row, { market = 'market-1' } = {}) {
  const client = {
    query: jest.fn(async sql => {
      if (/INSERT INTO cash_deposits/.test(sql)) return { rows: [row] };
      if (/FROM users u JOIN relais r/.test(sql)) return { rows: market ? [{ market_id: market }] : [] };
      if (/movement_kind = 'LEGACY'/.test(sql)) return { rows: [{ id: 'legacy-1' }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValueOnce(client);
  return client;
}
const insertCall = client => client.query.mock.calls.find(c => /INSERT INTO cash_deposits/.test(String(c[0])));

test('createDeposit : remise de garde TRANSFER au nom de l acteur, Market serveur, sans allocation FIFO, avec audit', async () => {
  const client = txInsert({ id: 'uuid', deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending', movement_kind: 'TRANSFER' });
  const result = await service.createDeposit({
    agentId: 'agent-1',
    payload: { ...target, amount_kmf: 5000, reference: 'MM-1' },
  });
  expect(result.deposit_ref).toBe('KDP-000001');
  const params = insertCall(client)[1];
  expect(params[0]).toBe('agent-1');
  expect(params[2]).toBe('physical');
  expect(params.slice(8)).toEqual([5000, 'KMF', 1, 'identity:KMF', 'market-1', 'TRANSFER', 'user-r', null, null]);
  expect(custody.assertAuthorizedRecipient).toHaveBeenCalledWith(client, { marketId: 'market-1', userId: 'user-r' });
  expect(client.query.mock.calls.some(c => /cash_allocate_fifo/.test(String(c[0])))).toBe(false);
  expect(audit).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'CASH_TRANSFER_DECLARED', marketId: 'market-1', actorUserId: 'agent-1' }));
  const order = client.query.mock.calls.map(c => String(c[0]));
  expect(order[0]).toBe('BEGIN');
  expect(order[order.length - 1]).toBe('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

test('createDeposit : remise FINAL vers une destination ACTIVE de même devise ; méthode dérivée du type', async () => {
  const client = txInsert({ id: 'f1', deposit_ref: 'KDP-F' });
  await service.createDeposit({ agentId: 'a', marketId: 'market-9', payload: { destination_id: 'dest-1', declared_amount: 400, declared_currency: 'XAF' } });
  const params = insertCall(client)[1];
  expect(params[2]).toBe('bank');
  expect(params.slice(8)).toEqual([400, 'XAF', 0.75, 'currency_parities:XAF->EUR->KMF', 'market-9', 'FINAL', null, 'dest-1', null]);
  expect(custody.assertActiveDestination).toHaveBeenCalledWith(expect.anything(), { marketId: 'market-9', destinationId: 'dest-1' });
  txInsert({ id: 'f2' });
  await expect(service.createDeposit({ agentId: 'a', marketId: 'm', payload: { destination_id: 'dest-1', declared_amount: 400, declared_currency: 'KMF' } }))
    .rejects.toMatchObject({ code: 'deposit_destination_currency_mismatch', status: 422 });
});

test('createDeposit : montant supérieur à la garde, Market introuvable, cible refusée, régularisation inconnue', async () => {
  custody.holdingOf.mockResolvedValueOnce(100);
  txInsert({ id: 'x' });
  await expect(service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5000 } }))
    .rejects.toMatchObject({ code: 'deposit_exceeds_holding', status: 409 });
  txInsert({ id: 'x' }, { market: null });
  await expect(service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5 } }))
    .rejects.toMatchObject({ code: 'deposit_market_unresolved', status: 403 });
  custody.assertAuthorizedRecipient.mockRejectedValueOnce(new custody.CashCustodyError('custody_recipient_not_authorized', 'non habilité', 403));
  txInsert({ id: 'x' });
  await expect(service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5 } }))
    .rejects.toMatchObject({ code: 'custody_recipient_not_authorized', status: 403, name: 'CashDepositError' });
  const client = txInsert({ id: 'r1', deposit_ref: 'KDP-R' });
  await service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5, regularizes_deposit_ref: 'KDP-OLD' } });
  expect(insertCall(client)[1][16]).toBe('legacy-1');
  const none = { query: jest.fn(async sql => (/movement_kind = 'LEGACY'/.test(sql) ? { rows: [] } : /FROM users u JOIN relais r/.test(sql) ? { rows: [{ market_id: 'm' }] } : { rows: [] })), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(none);
  await expect(service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5, regularizes_deposit_ref: 'KDP-NOPE' } }))
    .rejects.toMatchObject({ code: 'deposit_regularizes_not_found', status: 404 });
});

test('createDeposit : une violation d invariant SQL est traduite en erreur métier ; toute autre erreur est conservée', async () => {
  const violation = Object.assign(new Error('cash_deposits: Σ régularisations'), { code: '23514' });
  custody.mapDbError.mockImplementationOnce(() => new custody.CashCustodyError('custody_rule_violation', 'Σ régularisations', 409));
  const ko = { query: jest.fn(async sql => { if (/INSERT INTO cash_deposits/.test(String(sql))) throw violation; if (/FROM users u JOIN relais r/.test(String(sql))) return { rows: [{ market_id: 'm' }] }; return { rows: [] }; }), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(ko);
  await expect(service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5 } })).rejects.toMatchObject({ code: 'custody_rule_violation', status: 409 });
  expect(ko.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
  const other = { query: jest.fn(async sql => { if (/INSERT INTO cash_deposits/.test(String(sql))) throw new Error('db down'); if (/FROM users u JOIN relais r/.test(String(sql))) return { rows: [{ market_id: 'm' }] }; return { rows: [] }; }), release: jest.fn() };
  db.getClient.mockResolvedValueOnce(other);
  await expect(service.createDeposit({ agentId: 'a', payload: { ...target, amount_kmf: 5 } })).rejects.toThrow('db down');
});

test('une remise de garde ne se résout jamais par revue de dépôt (réception + contrôle uniquement)', async () => {
  const row = (extra = {}) => ({ rows: [{ id: 'uuid', deposit_ref: 'KDP-9', agent_id: 'agent-9', status: 'pending', amount_kmf: 1, movement_kind: 'TRANSFER', ...extra }] });
  await expect(service.verifyDeposit({ depositId: 'uuid', verifierId: 'a', dbClient: { query: jest.fn(async () => row()) } }))
    .rejects.toMatchObject({ code: 'deposit_review_legacy_only', status: 409 });
  await expect(service.disputeDeposit({ depositId: 'uuid', verifierId: 'a', reason: 'r', dbClient: { query: jest.fn(async () => row({ movement_kind: 'FINAL' })) } }))
    .rejects.toMatchObject({ code: 'deposit_review_legacy_only' });
});

// Client scripté : BEGIN/COMMIT/ROLLBACK neutres ; les autres requêtes consomment `results`.
function fakeClient(...results) {
  return { query: jest.fn(async sql => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? { rows: [] } : (results.shift() || { rows: [] }))) };
}
const locked = (status, extra = {}) => ({ rows: [{ id: 'uuid', deposit_ref: 'KDP-1', movement_kind: 'LEGACY', agent_id: 'agent-9', status, amount_kmf: 1, review_market_id: 'm1', verified_by: 'old-admin', verified_at: 'T0', notes: 'n0', ...extra }] });
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
  const [, au] = audit.mock.calls.at(-1);
  expect(au.action).toBe('CASH_DEPOSIT_CENTRAL_CORRECTED');
  expect(au.marketId).toBe('m1');
  expect(au.before).toMatchObject({ status: 'verified', verified_by: 'old-admin', verified_at: 'T0', previous_notes: 'n0' });
  expect(au.after).toMatchObject({ status: 'disputed', note: 'relevé non conforme' });
});

test('voie centrale : audit sur verify (note) ; sans central aucun audit ; marché inconnu toléré', async () => {
  const c = fakeClient(locked('disputed', { review_market_id: null }), updated('verified'));
  await service.verifyDeposit({ depositId: 'uuid', verifierId: 'admin-1', notes: 'ok', central: true, dbClient: c });
  const [, au] = audit.mock.calls.at(-1);
  expect(au.action).toBe('CASH_DEPOSIT_CENTRAL_VERIFIED');
  expect(au.marketId).toBeNull();
  const c2 = fakeClient(locked('pending'), updated('verified'));
  await service.verifyDeposit({ depositId: 'uuid', dbClient: c2 });
  audit.mockClear();
  await service.verifyDeposit({ depositId: 'uuid', dbClient: fakeClient(locked('pending'), updated('verified')) });
  expect(audit).not.toHaveBeenCalled();
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

const base = { ...target, deposit_method: 'physical', period_start: '2026-08-20', period_end: '2026-08-26' };

test('dépôt déclaré en XAF : amount_kmf dérivé des parités et snapshot figé', async () => {
  const client = txInsert({ id: 'd2', deposit_ref: 'KDP-2', amount_kmf: 75000 });
  await service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 100000, declared_currency: 'XAF' } });
  const params = insertCall(client)[1];
  expect(params[1]).toBe(75000);
  expect(params.slice(8, 12)).toEqual([100000, 'XAF', 0.75, 'currency_parities:XAF->EUR->KMF']);
});

test('dépôt déclaré en KMF : taux 1, aucun lookup de parité', async () => {
  const { getCurrencyParity } = require('../../utils/currency');
  getCurrencyParity.mockClear();
  const client = txInsert({ id: 'd3' });
  await service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 5000, declared_currency: 'KMF' } });
  const params = insertCall(client)[1];
  expect(params[1]).toBe(5000);
  expect(params.slice(8, 12)).toEqual([5000, 'KMF', 1, 'identity:KMF']);
  expect(getCurrencyParity).not.toHaveBeenCalled();
});

test('chemin historique amount_kmf : traité comme déclaré en KMF (devise figée, jamais NULL)', async () => {
  const client = txInsert({ id: 'd4' });
  await service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 5000 } });
  expect(insertCall(client)[1].slice(8, 12)).toEqual([5000, 'KMF', 1, 'identity:KMF']);
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
  await expect(service.resolveDeclaredAmount()).resolves.toEqual({ payload: {}, snapshot: null });
  await expect(service.resolveDeclaredAmount({ declared_currency: 42 })).rejects.toMatchObject({ code: 'deposit_currency_invalid' });
  expect(() => service.normalizePayload()).toThrow();
  expect(() => service.normalizePayload({ amount_kmf: 1, deposit_method: 'crypto' })).toThrow(/Méthode/);
  const today = new Date().toISOString().slice(0, 10);
  expect(service.normalizePayload({ amount_kmf: 1, deposit_method: 'bank' })).toMatchObject({ period_start: today, period_end: today });
  const client = txInsert({ id: 'd' });
  await service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 10, reference: 'R', proof_url: 'u', notes: 'n' } });
  expect(insertCall(client)[1].slice(3, 8)).toEqual(['R', 'u', '2026-08-20', '2026-08-26', 'n']);
});

test('CashDepositError : statut 400 par défaut', () => {
  expect(new service.CashDepositError('x', 'y').status).toBe(400);
});

test('la couverture canonique lit la vue unique et ne compte ni remise historique ni déclaration', () => {
  expect(service.UNCOVERED_COLLECTIONS_CTE).toContain('cash_custody_movements');
  expect(service.UNCOVERED_COLLECTIONS_CTE).not.toContain('cash_deposit_allocations');
  expect(service.UNCOVERED_COLLECTIONS_CTE).toContain("'TRANSFER_OUT', 'FINAL_CLOSURE', 'LOSS'");
});

describe('UNCOVERED_COLLECTIONS_CTE — partition par Market', () => {
  test('encaissements et décharges sont partitionnés par (agent, Market)', () => {
    const cte = service.UNCOVERED_COLLECTIONS_CTE;
    expect(cte).toMatch(/PARTITION BY cc\.collected_by, cash_collection_market\(cc\.relais_id, cc\.collected_by\)/);
    expect(cte).toMatch(/GROUP BY holder_id, market_id/);
    expect(cte).toMatch(/rel\.market_id IS NOT DISTINCT FROM r\.market_id/);
  });
});
