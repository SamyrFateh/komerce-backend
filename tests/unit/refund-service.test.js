'use strict';

const { makeClient } = require('../integration/test-harness/mock-db');

const mockStripeRefundsCreate = jest.fn();

jest.mock('stripe', () => jest.fn(() => ({
  refunds: { create: mockStripeRefundsCreate },
})));

jest.mock('../../services/wallet-service', () => ({
  credit: jest.fn(),
}));

jest.mock('../../services/documents/refund-receipt', () => ({
  issue: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const walletService = require('../../services/wallet-service');
const { processRefund, processRefundWithFallback, _buildIdempotencyKey } = require('../../services/refund-service');

function makeStripeOrder(overrides = {}) {
  return {
    id: 'order-001',
    reference: 'CMD-001',
    user_id: 'user-001',
    payment_mode: 'stripe_eur',
    stripe_payment_id: 'pi_001',
    ...overrides,
  };
}

function makeCashOrder(overrides = {}) {
  return {
    id: 'order-cash-001',
    reference: 'CMD-CASH-001',
    user_id: 'user-001',
    payment_mode: 'cash_relais',
    stripe_payment_id: null,
    ...overrides,
  };
}

describe('refund-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStripeRefundsCreate.mockReset();
    walletService.credit.mockReset();
  });

  describe('_buildIdempotencyKey', () => {
    it('construit une cle deterministe', () => {
      expect(_buildIdempotencyKey('order-001', 'cancel', null)).toBe('refund_order-001_cancel_full');
      expect(_buildIdempotencyKey('order-001', 'cancel', 'parcel-001')).toBe('refund_order-001_cancel_parcel-001');
    });
  });

  describe('processRefundWithFallback', () => {
    it('rembourse Stripe nominalement avec une cle idempotente stable', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_001' });

      const result = await processRefundWithFallback(
        client,
        makeStripeOrder(),
        6000,
        12.2,
        'cancel',
        'Annulation client',
        'admin-001',
        null
      );

      expect(result.method).toBe('stripe');
      expect(result.stripeRefundId).toBe('re_001');
      expect(result.refundRowId).toBe('refund-001');
      expect(client.calls[0].sql).toContain('INSERT INTO refunds');
      expect(client.calls[0].sql).toContain('ON CONFLICT (order_id, refund_type) DO NOTHING');
      expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_001', amount: 1220 }),
        { idempotencyKey: 'refund_order-001_cancel_full' }
      );
      expect(client.calls[1].params).toEqual(['stripe', 're_001', null, 'refund-001']);
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    it('bascule en wallet credit si le remboursement Stripe echoue', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-002' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockRejectedValue(new Error('stripe down'));
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-001' } });

      const result = await processRefundWithFallback(
        client,
        makeStripeOrder(),
        7500,
        15.24,
        'cancel',
        'Annulation client',
        'admin-001',
        'parcel-001'
      );

      expect(result.method).toBe('wallet_credit');
      expect(result.walletTxId).toBe('wallet-tx-001');
      expect(walletService.credit).toHaveBeenCalledWith(client, expect.objectContaining({
        userId: 'user-001',
        amountKmf: 7500,
        referenceId: 'order-001',
        idempotencyKey: 'refund_fb_order-001_cancel_parcel-001',
      }));
      expect(client.calls[1].params).toEqual(['wallet_credit', null, 'wallet-tx-001', 'refund-002']);
    });

    it('reutilise la ligne refund existante si INSERT est ignore par ON CONFLICT', async () => {
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'refund-existing' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_retry' });

      const result = await processRefundWithFallback(client, makeStripeOrder(), 5000, 10, 'cancel', 'Retry', 'admin-001', null);

      expect(result.refundRowId).toBe('refund-existing');
      expect(client.calls[1].sql).toContain('SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1');
      expect(mockStripeRefundsCreate).toHaveBeenCalledWith(expect.any(Object), { idempotencyKey: 'refund_order-001_cancel_full' });
      expect(client.calls[2].params).toEqual(['stripe', 're_retry', null, 'refund-existing']);
    });

    it('ignore un remboursement a montant zero sans appel DB ni effet externe', async () => {
      const client = makeClient([]);

      const result = await processRefundWithFallback(client, makeStripeOrder(), 0, 0, 'cancel', 'No-op', 'admin-001', null);

      expect(result).toEqual(expect.objectContaining({ method: 'none', skipped: true, reason: 'zero_amount' }));
      expect(client.query).not.toHaveBeenCalled();
      expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
      expect(walletService.credit).not.toHaveBeenCalled();
    });
  });

  describe('processRefund', () => {
    it('credite le wallet directement pour une commande cash', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-cash-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-cash-001' } });

      const result = await processRefund(client, makeCashOrder(), 4000, 0, 'cancel', 'Annulation cash', 'admin-001', null);

      expect(result.method).toBe('wallet_credit');
      expect(result.walletTxId).toBe('wallet-tx-cash-001');
      expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
      expect(walletService.credit).toHaveBeenCalledWith(client, expect.objectContaining({
        userId: 'user-001',
        amountKmf: 4000,
        idempotencyKey: 'refund_order-cash-001_cancel_full',
      }));
    });
  });
});
