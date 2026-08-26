'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const mockCreateDeposit = jest.fn();
const mockVerifyDeposit = jest.fn();
const mockDisputeDeposit = jest.fn();

jest.mock('../../services/cash-deposit-service', () => {
  class CashDepositError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    CashDepositError,
    createDeposit: (...args) => mockCreateDeposit(...args),
    verifyDeposit: (...args) => mockVerifyDeposit(...args),
    disputeDeposit: (...args) => mockDisputeDeposit(...args),
  };
});

const db = require('../../db');
const workspace = require('../../services/finance-accounting-workspace');

const market = { id: 'market-cm-id', code: 'CM', name: 'Comores', currency: 'KMF' };

beforeEach(() => {
  jest.clearAllMocks();
});

test('normalizeFilters borne le seuil et fournit des dates sûres', () => {
  expect(workspace.normalizeFilters({ from: '2026-08-01', to: '2026-08-26', hours: 9999 })).toEqual({
    from: '2026-08-01', to: '2026-08-26', hours: 720,
  });
});

test('buildWorkspace applique market_id à toutes les sources cash et factures', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ expected_kmf: '10000', expected_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ collected_kmf: '8000', collection_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ deposited_kmf: '5000', verified_kmf: '5000', pending_kmf: '0', disputed_kmf: '0', deposit_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ order_ref: 'CMD-1', amount_kmf: 8000 }] })
    .mockResolvedValueOnce({ rows: [{ deposit_ref: 'KDP-000001', status: 'verified', amount_kmf: 5000 }] })
    .mockResolvedValueOnce({ rows: [{ order_ref: 'CMD-2', total_kmf: 2000 }] })
    .mockResolvedValueOnce({ rows: [{ invoice_number: 'KOM-INV-2026-000001', order_ref: 'CMD-1' }] });

  const payload = await workspace.buildWorkspace({ market, from: '2026-08-20', to: '2026-08-26', hours: 48 });

  expect(payload.scope).toEqual({ code: 'CM', name: 'Comores', currency: 'KMF' });
  expect(payload.summary.expected_kmf).toBe(10000);
  expect(payload.summary.uncollected_kmf).toBe(2000);
  expect(payload.reconciliation.gap_collection_kmf).toBe(2000);
  expect(payload.reconciliation.gap_deposit_kmf).toBe(3000);

  const sql = db.query.mock.calls.map(call => String(call[0])).join('\n');
  expect(sql).toContain('o.market_id = $1');
  expect(sql).toContain('r.market_id = $1');
  expect(sql).toContain('JOIN orders o ON o.id = i.order_id');
  expect(db.query.mock.calls.every(call => call[1][0] === 'market-cm-id')).toBe(true);
});

test('déclaration refusée si acteur non rattaché à un relais du marché', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.createDeposit({
    amount_kmf: 5000,
    deposit_method: 'bank',
    period_start: '2026-08-20',
    period_end: '2026-08-26',
  }, market, { id: 'agent-x', role: 'agent_relais' })).rejects.toMatchObject({
    code: 'deposit_actor_market_mismatch', status: 403,
  });
  expect(mockCreateDeposit).not.toHaveBeenCalled();
});

test('déclaration délègue au service paiement avec acteur serveur', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ user_id: 'agent-1', relais_id: 'rel-1', relais_name: 'Relais 1' }] });
  mockCreateDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending' });
  const payload = { amount_kmf: 5000, deposit_method: 'bank', period_start: '2026-08-20', period_end: '2026-08-26' };
  const result = await workspace.createDeposit(payload, market, { id: 'agent-1', role: 'agent_relais' });
  expect(result).toEqual({ deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending' });
  expect(mockCreateDeposit).toHaveBeenCalledWith({ agentId: 'agent-1', payload });
});

test('verify résout deposit_ref dans le marché puis délègue l UUID seulement serveur-side', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: 'deposit-uuid-secret', deposit_ref: 'KDP-000001', status: 'pending' }] });
  mockVerifyDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'verified', verified_at: '2026-08-26T12:00:00Z' });

  const result = await workspace.verifyDeposit('KDP-000001', { notes: 'OK' }, market, { id: 'admin-1', role: 'admin' });
  expect(result.deposit_ref).toBe('KDP-000001');
  expect(mockVerifyDeposit).toHaveBeenCalledWith({
    depositId: 'deposit-uuid-secret', verifierId: 'admin-1', notes: 'OK',
  });
});

test('deposit_ref existant hors marché est invisible', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.verifyDeposit('KDP-000001', {}, market, { id: 'admin-1' })).rejects.toMatchObject({
    code: 'deposit_not_found', status: 404,
  });
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
});
