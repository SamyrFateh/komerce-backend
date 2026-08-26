'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
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
