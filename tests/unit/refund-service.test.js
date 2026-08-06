'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

    it('rembourse via Stripe pour une commande stripe_eur, avec cle idempotente stable', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-stripe-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_direct_001' });

      const result = await processRefund(client, makeStripeOrder(), 6000, 12.2, 'cancel', 'Annulation client', 'admin-001', null);

      expect(result.method).toBe('stripe');
      expect(result.stripeRefundId).toBe('re_direct_001');
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_001', amount: 1220 }),
        { idempotencyKey: 'refund_order-001_cancel_full' }
      );
      expect(client.calls[1].params).toEqual(['stripe', 're_direct_001', null, 'refund-stripe-001']);
    });

    it('reutilise la ligne refund existante via SELECT si INSERT est ignore par ON CONFLICT', async () => {
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'refund-existing-002' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_retry_002' });

      const result = await processRefund(client, makeStripeOrder(), 5000, 10, 'cancel', 'Retry', 'admin-001', null);

      expect(result.refundRowId).toBe('refund-existing-002');
      expect(client.calls[1].sql).toContain('SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1');
      expect(client.calls[2].params).toEqual(['stripe', 're_retry_002', null, 'refund-existing-002']);
    });

    it('applique la raison par defaut quand reason est absent', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-default-reason' }] },
        { rows: [], rowCount: 1 },
      ]);
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-002' } });

      await processRefund(client, makeCashOrder(), 4000, 0, 'cancel', undefined, 'admin-001', null);

      expect(client.calls[0].params).toEqual(
        expect.arrayContaining(['Annulation client'])
      );
    });

    it('inclut parcel_id dans les metadata Stripe quand fourni', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-parcel-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_parcel_001' });

      await processRefund(client, makeStripeOrder(), 3000, 6, 'partial', 'Retour partiel', 'admin-001', 'parcel-xyz');

      expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ parcel_id: 'parcel-xyz' }) }),
        expect.anything()
      );
    });

    it('utilise le parcelId par defaut (non fourni) sans erreur', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-noparcel-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-noparcel' } });

      const result = await processRefund(client, makeCashOrder(), 2000, 0, 'cancel', 'Sans parcelId', 'admin-001');

      expect(result.method).toBe('wallet_credit');
      expect(walletService.credit).toHaveBeenCalledWith(client, expect.objectContaining({
        idempotencyKey: 'refund_order-cash-001_cancel_full',
      }));
    });

    it("ne met a jour aucune ligne si refundRowId n'a jamais pu etre resolu (INSERT et SELECT vides)", async () => {
      const client = makeClient([
        { rows: [] }, // INSERT ignoré (ON CONFLICT)
        { rows: [] }, // SELECT fallback : aucune ligne trouvée non plus
      ]);
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-orphan' } });

      const result = await processRefund(client, makeCashOrder(), 1000, 0, 'cancel', 'Cas limite', 'admin-001', null);

      expect(result.refundRowId).toBeNull();
      // Aucune 3e requête (pas d'UPDATE) car refundRowId est null
      expect(client.calls).toHaveLength(2);
    });
  });

  describe('processRefundWithFallback — cas additionnels', () => {
    it("met a jour via order_id/refund_type quand aucune ligne refund n'a pu etre resolue (double retry concurrent)", async () => {
      const client = makeClient([
        { rows: [] },              // INSERT ignoré (ON CONFLICT)
        { rows: [] },               // SELECT fallback ne trouve rien non plus
        { rows: [], rowCount: 1 }, // UPDATE par (order_id, refund_type, status='pending')
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_concurrent_001' });

      const result = await processRefundWithFallback(client, makeStripeOrder(), 6000, 12.2, 'cancel', 'Retry concurrent', 'admin-001', null);

      expect(result.refundRowId).toBeNull();
      expect(client.calls[2].sql).toContain("WHERE order_id = $4 AND refund_type = $5 AND status = 'pending'");
      expect(client.calls[2].params).toEqual(['stripe', 're_concurrent_001', null, 'order-001', 'cancel']);
    });

    it('applique la raison par defaut ("Annulation") quand reason est absent', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-fb-default-reason' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockResolvedValue({ id: 're_fb_001' });

      await processRefundWithFallback(client, makeStripeOrder(), 6000, 12.2, 'cancel', undefined, 'admin-001', null);

      expect(client.calls[0].params).toEqual(expect.arrayContaining(['Annulation']));
    });

    it("bascule en wallet avec cle 'full' quand Stripe echoue et qu'aucun parcelId n'est fourni", async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-fb-full' }] },
        { rows: [], rowCount: 1 },
      ]);
      mockStripeRefundsCreate.mockRejectedValue(new Error('stripe down'));
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-full' } });

      const result = await processRefundWithFallback(client, makeStripeOrder(), 7500, 15.24, 'cancel', 'Annulation client', 'admin-001', null);

      expect(result.method).toBe('wallet_credit');
      expect(walletService.credit).toHaveBeenCalledWith(client, expect.objectContaining({
        idempotencyKey: 'refund_fb_order-001_cancel_full',
      }));
    });

    it('credite directement le wallet quand la commande est stripe_eur mais sans stripe_payment_id', async () => {
      const client = makeClient([
        { rows: [{ id: 'refund-fb-nostripe' }] },
        { rows: [], rowCount: 1 },
      ]);
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-nostripe' } });

      const order = makeStripeOrder({ stripe_payment_id: null });
      const result = await processRefundWithFallback(client, order, 5000, 10, 'cancel', 'Sans PI', 'admin-001', null);

      expect(result.method).toBe('wallet_credit');
      expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    });
  });
});
