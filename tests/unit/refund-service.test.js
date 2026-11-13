'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient } = require('../integration/test-harness/mock-db');

const mockStripeRefundsCreate = jest.fn();

jest.mock('../../services/cost-allocation/canonical-margin-writer', () => ({
  isEnabled: jest.fn().mockResolvedValue(false),
  refreshCanonicalMarginForOrders: jest.fn().mockResolvedValue({ enabled: false }),
}));
jest.mock('stripe', () => jest.fn(() => ({
  refunds: { create: mockStripeRefundsCreate },
})));

jest.mock('../../services/order-fx-snapshot', () => ({
  prorateMarketAmount: (amount, num, den) => Math.round((Number(amount) * Number(num)) / Number(den)),
  assertRefundWithinCaptured: jest.fn().mockResolvedValue(undefined),
  assertRefundRecordCompatible: jest.fn().mockResolvedValue(undefined),
}));

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

    it.each([
      ['timeout apres traitement PSP', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })],
      ['connexion coupee', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
      ['refus Stripe sans preuve de non-execution', new Error('stripe down')],
    ])('FA-04 : %s ne declenche jamais de double remboursement via wallet', async (_label, stripeError) => {
      const client = makeClient([{ rows: [{ id: 'refund-002' }] }]);
      mockStripeRefundsCreate.mockRejectedValueOnce(stripeError);
      walletService.credit.mockResolvedValue({ transaction: { id: 'wallet-tx-001' } });

      await expect(processRefundWithFallback(
        client, makeStripeOrder(), 7500, 15.24, 'cancel',
        'Annulation client', 'admin-001', 'parcel-001'
      )).rejects.toMatchObject({
        code: 'REFUND_STRIPE_OUTCOME_UNKNOWN',
        statusCode: 409,
        cause: stripeError,
      });

      expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_001', amount: 1524 }),
        { idempotencyKey: 'refund_order-001_cancel_parcel-001' }
      );
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(client.calls.some(c => /UPDATE refunds/.test(String(c.sql)))).toBe(false);
    });

    it('FA-04 : commande Stripe sans reference capture refuse avant DB, sans wallet', async () => {
      const client = makeClient([]);
      await expect(processRefundWithFallback(
        client, makeStripeOrder({ stripe_payment_id: null }), 5000, 10,
        'partial', 'x', 'admin-001', 'parcel-002'
      )).rejects.toMatchObject({ code: 'REFUND_STRIPE_CAPTURE_MISSING', statusCode: 409 });
      expect(client.query).not.toHaveBeenCalled();
      expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
      expect(walletService.credit).not.toHaveBeenCalled();
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

  describe('wallet multi-devise par marché', () => {
    const pendingInsert = { rows: [{ id: 'refund-xaf' }] };
    const xafOrder = (extra = {}) => makeCashOrder({
      market_id: 'm-cm', total_kmf: 10000,
      fx_snapshot: { market: { currency: 'XAF', amount: 15000, minor_unit: 0 } }, ...extra,
    });

    it('processRefund : marché XAF → wallet crédité en XAF au prorata du montant de marché figé', async () => {
      walletService.credit.mockResolvedValueOnce({ transaction: { id: 'tx-xaf' } });
      const client = makeClient([pendingInsert, { rows: [{ currency: 'XAF' }] }, { rows: [{ kmf: '0' }] }, { rows: [], rowCount: 1 }]);
      const r = await processRefund(client, xafOrder(), 5000, 7.6, 'partial', 'x', 'admin-1');
      expect(r.method).toBe('wallet_credit');
      expect(walletService.credit).toHaveBeenCalledWith(client, expect.objectContaining({ amountKmf: 7500, currency: 'XAF' }));
    });

    it('remboursement du reste complet : solde exact du montant de marché moins les crédits wallet déjà émis', async () => {
      walletService.credit.mockResolvedValueOnce({ transaction: { id: 'tx-xaf2' } });
      const client = makeClient([pendingInsert, { rows: [{ currency: 'XAF' }] }, { rows: [{ kmf: '5000' }] }, { rows: [{ amt: '7500' }] }, { rows: [], rowCount: 1 }]);
      await processRefund(client, xafOrder(), 5000, 7.6, 'full', 'x', 'admin-1');
      expect(walletService.credit).toHaveBeenCalledWith(client, expect.objectContaining({ amountKmf: 7500, currency: 'XAF' }));
    });

    it('FA-04 : Stripe incertain sur un marché XAF, ni XAF ni KMF credits', async () => {
      mockStripeRefundsCreate.mockRejectedValueOnce(new Error('timeout'));
      const client = makeClient([pendingInsert]);
      await expect(processRefundWithFallback(
        client, xafOrder({ payment_mode: 'stripe_eur', stripe_payment_id: 'pi_1' }),
        5000, 7.6, 'partial', 'x', 'admin-1'
      )).rejects.toMatchObject({ code: 'REFUND_STRIPE_OUTCOME_UNKNOWN' });
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(client.calls.some(c => String(c.sql).includes('SELECT currency FROM markets'))).toBe(false);
    });

    it('montant de marché figé absent → refus fail-closed, wallet jamais crédité', async () => {
      const client = makeClient([pendingInsert, { rows: [{ currency: 'XAF' }] }]);
      await expect(processRefund(client, xafOrder({ fx_snapshot: null }), 5000, 7.6, 'cancel', 'x', 'admin-1'))
        .rejects.toMatchObject({ code: 'REFUND_WALLET_MARKET_AMOUNT_MISSING', statusCode: 409 });
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    it('marché inconnu → refus fail-closed', async () => {
      const client = makeClient([pendingInsert, { rows: [] }]);
      await expect(processRefund(client, makeCashOrder({ market_id: 'm-ghost' }), 5000, 7.6, 'cancel', 'x', 'admin-1'))
        .rejects.toMatchObject({ code: 'REFUND_WALLET_CURRENCY_UNKNOWN' });
    });

    it('devise KMF avec espaces/casse → toujours reconnue (pas de blocage à tort)', async () => {
      walletService.credit.mockResolvedValueOnce({ transaction: { id: 'tx-2' } });
      const client = makeClient([pendingInsert, { rows: [{ currency: ' kmf ' }] }, { rows: [], rowCount: 1 }]);
      const r = await processRefund(client, makeCashOrder({ market_id: 'm-km' }), 5000, 7.6, 'cancel', 'x', 'admin-1');
      expect(r.method).toBe('wallet_credit');
    });

    it('marché KMF → wallet crédité comme avant', async () => {
      walletService.credit.mockResolvedValueOnce({ transaction: { id: 'tx-1' } });
      const client = makeClient([pendingInsert, { rows: [{ currency: 'KMF' }] }, { rows: [], rowCount: 1 }]);
      const r = await processRefund(client, makeCashOrder({ market_id: 'm-km' }), 5000, 7.6, 'cancel', 'x', 'admin-1');
      expect(r.method).toBe('wallet_credit');
      expect(walletService.credit).toHaveBeenCalledTimes(1);
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

    it("FA-04 : appel Stripe incertain sans parcelId ne credite jamais le wallet", async () => {
      const client = makeClient([{ rows: [{ id: 'refund-fb-full' }] }]);
      mockStripeRefundsCreate.mockRejectedValue(new Error('stripe down'));

      await expect(processRefundWithFallback(
        client, makeStripeOrder(), 7500, 15.24, 'cancel',
        'Annulation client', 'admin-001', null
      )).rejects.toMatchObject({ code: 'REFUND_STRIPE_OUTCOME_UNKNOWN' });
      expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
        expect.anything(), { idempotencyKey: 'refund_order-001_cancel_full' }
      );
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    it('FA-04 : Stripe sans reference de capture, aucun repli wallet', async () => {
      const client = makeClient([]);
      const order = makeStripeOrder({ stripe_payment_id: null });

      await expect(processRefundWithFallback(
        client, order, 5000, 10, 'cancel', 'Sans PI', 'admin-001', null
      )).rejects.toMatchObject({ code: 'REFUND_STRIPE_CAPTURE_MISSING' });
      expect(client.query).not.toHaveBeenCalled();
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    });

  });
});
