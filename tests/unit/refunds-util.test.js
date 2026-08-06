'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/refunds-util.test.js
 *
 * Tests du module utils/refunds.js — processRefund()
 *
 * Couverture :
 *   ✓ Stripe : succès (création refund + insertion row 'completed')
 *   ✓ Stripe : échec (insertion row 'failed' + error renvoyée, pas de throw)
 *   ✓ Store credit (cash_relais) : appelle walletService.credit + insertion row
 *   ✓ Store credit : fallback walletTx.id si pas de transaction_id
 *   ✓ Calcul amountKmf / amountEur (arrondis, refundPct partiel)
 *   ✓ reason par défaut si non fourni
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockStripeRefundsCreate = jest.fn();
jest.mock('stripe', () => {
  return jest.fn(() => ({
    refunds: {
      create: (...args) => mockStripeRefundsCreate(...args),
    },
  }));
});

const mockWalletCredit = jest.fn();
jest.mock('../../services/wallet-service', () => ({
  credit: (...args) => mockWalletCredit(...args),
}));

const { processRefund } = require('../../utils/refunds');

function makeClient() {
  return { query: jest.fn() };
}

const baseOrderStripe = {
  id: 'order-1',
  reference: 'CMD-001',
  payment_mode: 'stripe_eur',
  stripe_payment_id: 'pi_123',
  total_kmf: 100000,
  total_eur: '200.00',
  user_id: 'user-1',
};

const baseOrderCash = {
  id: 'order-2',
  reference: 'CMD-002',
  payment_mode: 'cash_relais',
  total_kmf: 50000,
  total_eur: null,
  user_id: 'user-2',
};

describe('processRefund — Stripe', () => {
  it('rembourse intégralement via Stripe et insère une row completed', async () => {
    const client = makeClient();
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: 'rf_abc' });
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'refund-1', status: 'completed' }],
    });

    const result = await processRefund(client, {
      order: baseOrderStripe,
      refundType: 'full',
      refundPct: 100,
      reason: 'Annulation',
      initiatedBy: 'admin-1',
    });

    expect(result.error).toBeNull();
    expect(result.refund).toEqual({ id: 'refund-1', status: 'completed' });

    // Stripe appelé avec le montant en centimes EUR
    expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: 'pi_123',
        amount: 20000, // 200.00 EUR * 100
        metadata: expect.objectContaining({
          order_reference: 'CMD-001',
          refund_type: 'full',
          komerce: 'true',
        }),
      })
    );

    // Insertion finale avec montant KMF correct et méthode stripe
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO refunds/),
      expect.arrayContaining(['order-1', 100000, 200, 'full', 'stripe', 'rf_abc'])
    );
  });

  it('rembourse partiellement (50%) avec arrondi correct', async () => {
    const client = makeClient();
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: 'rf_partial' });
    client.query.mockResolvedValueOnce({ rows: [{ id: 'refund-2' }] });

    await processRefund(client, {
      order: baseOrderStripe,
      refundType: 'partial',
      refundPct: 50,
      initiatedBy: 'admin-1',
    });

    // amountKmf = round(100000 * 50/100) = 50000
    // amountEur = 200 * 50/100 = 100.00 → Stripe amount = 10000 centimes
    expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10000 })
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['order-1', 50000, 100])
    );
  });

  it('utilise la raison par défaut si non fournie', async () => {
    const client = makeClient();
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: 'rf_x' });
    client.query.mockResolvedValueOnce({ rows: [{ id: 'refund-3' }] });

    await processRefund(client, {
      order: baseOrderStripe,
      refundType: 'full',
      refundPct: 100,
      initiatedBy: 'admin-1',
    });

    const insertArgs = client.query.mock.calls[0][1];
    expect(insertArgs).toContain('Annulation client');
  });

  it('gère un échec Stripe : insère une row failed et renvoie error sans throw', async () => {
    const client = makeClient();
    mockStripeRefundsCreate.mockRejectedValueOnce(new Error('card_declined'));
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'refund-failed', status: 'failed' }],
    });

    const result = await processRefund(client, {
      order: baseOrderStripe,
      refundType: 'full',
      refundPct: 100,
      initiatedBy: 'admin-1',
    });

    expect(result.error).toBe('card_declined');
    expect(result.refund).toEqual({ id: 'refund-failed', status: 'failed' });

    // Une seule requête DB (insertion du refund échoué), pas de deuxième insert
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toMatch(/'failed'/);
  });
});

describe('processRefund — Store credit (cash_relais)', () => {
  it('crédite le wallet et insère une row completed avec store_credit_id', async () => {
    const client = makeClient();
    mockWalletCredit.mockResolvedValueOnce({ transaction_id: 'wtx-1' });
    client.query.mockResolvedValueOnce({ rows: [{ id: 'refund-cash-1' }] });

    const result = await processRefund(client, {
      order: baseOrderCash,
      refundType: 'full',
      refundPct: 100,
      reason: 'Annulation client',
      initiatedBy: 'admin-2',
    });

    expect(result.error).toBeNull();
    expect(mockWalletCredit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        userId: 'user-2',
        amountKmf: 50000,
        reason: 'order_cancel',
        referenceId: 'order-2',
        idempotencyKey: 'refund_cancel_order-2',
      })
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO refunds/),
      expect.arrayContaining(['order-2', 50000, null, 'full', 'store_credit', null, 'wtx-1'])
    );
  });

  it('utilise walletTx.id en repli si transaction_id absent', async () => {
    const client = makeClient();
    mockWalletCredit.mockResolvedValueOnce({ id: 'wtx-fallback' });
    client.query.mockResolvedValueOnce({ rows: [{ id: 'refund-cash-2' }] });

    await processRefund(client, {
      order: baseOrderCash,
      refundType: 'partial',
      refundPct: 20,
      initiatedBy: 'admin-2',
    });

    const insertArgs = client.query.mock.calls[0][1];
    expect(insertArgs).toContain('wtx-fallback');
    // amountKmf = round(50000 * 20/100) = 10000
    expect(insertArgs).toContain(10000);
  });

  it("n'appelle pas Stripe pour une commande cash même si stripe_payment_id absent", async () => {
    const client = makeClient();
    mockWalletCredit.mockResolvedValueOnce({ transaction_id: 'wtx-2' });
    client.query.mockResolvedValueOnce({ rows: [{ id: 'refund-cash-3' }] });

    await processRefund(client, {
      order: baseOrderCash,
      refundType: 'full',
      refundPct: 100,
      initiatedBy: 'admin-2',
    });

    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });
});
