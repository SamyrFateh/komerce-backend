'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
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

test('createDeposit écrit au nom de l acteur fourni', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: 'uuid', deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending' }] });
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
  expect(db.query.mock.calls[0][1][0]).toBe('agent-1');
  expect(String(db.query.mock.calls[0][0])).toContain('INSERT INTO cash_deposits');
});

test('verifyDeposit conserve la mutation historique', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: 'uuid', deposit_ref: 'KDP-000001', status: 'verified' }] });
  const result = await service.verifyDeposit({ depositId: 'uuid', verifierId: 'admin-1', notes: 'OK' });
  expect(result.status).toBe('verified');
  expect(String(db.query.mock.calls[0][0])).toContain("status = 'verified'");
  expect(db.query.mock.calls[0][1]).toEqual(['admin-1', 'uuid', 'OK']);
});

test('disputeDeposit exige une raison puis conserve la mutation historique', async () => {
  await expect(service.disputeDeposit({ depositId: 'uuid', verifierId: 'admin-1', reason: '' }))
    .rejects.toMatchObject({ code: 'deposit_dispute_reason_required', status: 400 });

  db.query.mockResolvedValueOnce({ rows: [{ id: 'uuid', deposit_ref: 'KDP-000001', status: 'disputed' }] });
  const result = await service.disputeDeposit({ depositId: 'uuid', verifierId: 'admin-1', reason: 'Écart reçu' });
  expect(result.status).toBe('disputed');
  expect(String(db.query.mock.calls[0][0])).toContain("status = 'disputed'");
});

test('verify/dispute renvoient 404 si le dépôt a disparu', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  await expect(service.verifyDeposit({ depositId: 'missing', verifierId: 'admin-1' }))
    .rejects.toMatchObject({ code: 'deposit_not_found', status: 404 });
});

const base = { deposit_method: 'mobile_money', period_start: '2026-08-20', period_end: '2026-08-26' };

test('dépôt déclaré en XAF : amount_kmf dérivé des parités et snapshot figé', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ deposit_ref: 'KDP-2', amount_kmf: 75000 }] });
  await service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 100000, declared_currency: 'XAF' } });
  const params = db.query.mock.calls[0][1];
  expect(params[1]).toBe(75000);
  expect(params.slice(8)).toEqual([100000, 'XAF', 0.75, 'currency_parities:XAF->EUR->KMF']);
});

test('dépôt déclaré en KMF : taux 1, aucun lookup de parité', async () => {
  const { getCurrencyParity } = require('../../utils/currency');
  getCurrencyParity.mockClear();
  db.query.mockResolvedValueOnce({ rows: [{}] });
  await service.createDeposit({ agentId: 'a', payload: { ...base, declared_amount: 5000, declared_currency: 'KMF' } });
  const params = db.query.mock.calls[0][1];
  expect(params[1]).toBe(5000);
  expect(params.slice(8)).toEqual([5000, 'KMF', 1, 'identity:KMF']);
  expect(getCurrencyParity).not.toHaveBeenCalled();
});

test('chemin historique amount_kmf : snapshot NULL', async () => {
  db.query.mockResolvedValueOnce({ rows: [{}] });
  await service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 5000 } });
  expect(db.query.mock.calls[0][1].slice(8)).toEqual([null, null, null, null]);
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
  await expect(service.verifyDeposit({ verifierId: 'v' })).rejects.toMatchObject({ code: 'deposit_id_required' });
  db.query.mockResolvedValue({ rows: [{ id: 'd' }] });
  await service.verifyDeposit({ depositId: 'd' });
  await service.disputeDeposit({ depositId: 'd', reason: 'écart' });
  expect(db.query.mock.calls[0][1]).toEqual([null, 'd', null]);
  expect(db.query.mock.calls[1][1]).toEqual([null, 'd', 'écart']);
  await service.createDeposit({ agentId: 'a', payload: { ...base, amount_kmf: 10, reference: 'R', proof_url: 'u', notes: 'n' } });
  expect(db.query.mock.calls[2][1].slice(3, 8)).toEqual(['R', 'u', '2026-08-20', '2026-08-26', 'n']);
});

test('CashDepositError : statut 400 par défaut', () => {
  expect(new service.CashDepositError('x', 'y').status).toBe(400);
});

test('disputeDeposit : 404 si le dépôt est introuvable', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  await expect(service.disputeDeposit({ depositId: 'x', reason: 'r' })).rejects.toMatchObject({ status: 404 });
});
