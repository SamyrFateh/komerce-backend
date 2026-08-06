'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/orders-cancel-route.test.js
 *
 * Tests du router routes/orders/cancel.js (POST /:id/cancel).
 *
 * Couverture :
 *   ✓ 404 si commande introuvable
 *   ✓ 403 si client tente d'annuler la commande d'un autre utilisateur
 *     (admin a accès à toutes les commandes)
 *   ✓ 422 si déjà cancelled/refunded, ou si collected
 *   ✓ 422 si statut au-delà du cutoff (CANCEL_CUTOFF_STATUS)
 *   ✓ Calcul du remboursement : fenêtre gratuite 100% vs partiel,
 *     uniquement si payment_status === 'paid'
 *   ✓ processRefund : appelé si isPaid && refundAmountKmf > 0,
 *     erreur → rollback + next(err)
 *   ✓ transitionOrderStatus : échec → rollback 422 ;
 *     succès → commit
 *   ✓ Reçu remboursement (post-commit, non bloquant)
 *   ✓ notifyCancellation appelé
 *   ✓ Message de réponse selon les cas (rien prélevé / wallet / stripe / cash)
 *   ✓ Erreur DB générique → rollback + next(err)
 */

const { makeClient, expectTransactionRolledBack, expectTransactionCommitted } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));

const mockState = { user: { id: 'user-1', role: 'client' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, _res, next) => next(),
}));

jest.mock('../../utils/rules', () => ({
  getRule: jest.fn(),
}));

jest.mock('../../services/refund-service', () => ({
  processRefund: jest.fn(),
}));

jest.mock('../../services/notification-service', () => ({
  notifyCancellation: jest.fn(),
}));

jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn(),
}));

jest.mock('../../services/documents/refund-receipt', () => ({
  issue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { getRule } = require('../../utils/rules');
const { processRefund } = require('../../services/refund-service');
const { notifyCancellation } = require('../../services/notification-service');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const refundReceiptService = require('../../services/documents/refund-receipt');

const express = require('express');
const request = require('supertest');

let app;

function orderRow(overrides = {}) {
  return {
    id: 'order-1', reference: 'CMD-001', user_id: 'user-1', status: 'pending',
    payment_status: 'unpaid', total_kmf: 10000, total_eur: 20.33,
    created_at: new Date().toISOString(), ordered_at: null,
    ...overrides,
  };
}

function defaultMocks() {
  getRule.mockImplementation((key, fallback) => Promise.resolve(fallback));
  transitionOrderStatus.mockResolvedValue({ success: true, cancelEffects: {} });
  db.query.mockResolvedValue({ rows: [] });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'user-1', role: 'client' };
  defaultMocks();

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/orders/cancel');
    app.use('/api/orders', router);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('orders/cancel — accès', () => {
  it('404 si commande introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(404);
    expectTransactionRolledBack(client);
  });

  it('403 si client tente d\'annuler la commande d\'un autre', async () => {
    mockState.user = { id: 'someone-else', role: 'client' };
    const client = makeClient([{ rows: [orderRow({ user_id: 'owner-1' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(403);
    expectTransactionRolledBack(client);
  });

  it('admin peut annuler la commande d\'un autre utilisateur', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    const client = makeClient([{ rows: [orderRow({ user_id: 'owner-1' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
  });
});

describe('orders/cancel — statuts bloquants', () => {
  it.each(['cancelled', 'refunded'])('422 si déjà %s', async (status) => {
    const client = makeClient([{ rows: [orderRow({ status })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(422);
    expect(res.body.current_status).toBe(status);
    expectTransactionRolledBack(client);
  });

  it('422 si déjà collected', async () => {
    const client = makeClient([{ rows: [orderRow({ status: 'collected' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/déjà collectée/);
    expectTransactionRolledBack(client);
  });

  it('422 si statut au-delà du cutoff', async () => {
    getRule.mockImplementation((key, fallback) => Promise.resolve(key === 'CANCEL_CUTOFF_STATUS' ? 'shipped' : fallback));
    const client = makeClient([{ rows: [orderRow({ status: 'shipped' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(422);
    expect(res.body.cutoff_status).toBe('shipped');
    expectTransactionRolledBack(client);
  });

  it('autorise l\'annulation juste avant le cutoff', async () => {
    getRule.mockImplementation((key, fallback) => Promise.resolve(key === 'CANCEL_CUTOFF_STATUS' ? 'shipped' : fallback));
    const client = makeClient([{ rows: [orderRow({ status: 'preparation' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
  });
});

describe('orders/cancel — calcul remboursement', () => {
  it('pas de remboursement si commande non payée', async () => {
    const client = makeClient([{ rows: [orderRow({ payment_status: 'unpaid' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
    expect(processRefund).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/aucun prélèvement/);
  });

  it('remboursement 100% dans la fenêtre gratuite', async () => {
    getRule.mockImplementation((key, fallback) => {
      if (key === 'CANCEL_FREE_WINDOW_HOURS') return Promise.resolve(24);
      if (key === 'CANCEL_PARTIAL_REFUND_PCT') return Promise.resolve(80);
      return Promise.resolve(fallback);
    });
    const recentOrder = orderRow({
      payment_status: 'paid', total_kmf: 10000, total_eur: 20.33,
      created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    });
    const client = makeClient([{ rows: [recentOrder] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue({ method: 'stripe', amountEur: 20.33, amountKmf: 10000, stripeRefundId: 'rf_1' });

    const res = await request(app).post('/api/orders/o1/cancel').send({ reason: 'changement avis' });

    expect(res.status).toBe(200);
    expect(processRefund).toHaveBeenCalledWith(
      client, recentOrder, 10000, 20.33, 'full', 'changement avis', 'user-1'
    );
    expect(res.body.refund.cash_refund.in_free_window).toBe(true);
    expect(res.body.refund.cash_refund.type).toBe('full');
  });

  it('remboursement partiel hors fenêtre gratuite', async () => {
    getRule.mockImplementation((key, fallback) => {
      if (key === 'CANCEL_FREE_WINDOW_HOURS') return Promise.resolve(24);
      if (key === 'CANCEL_PARTIAL_REFUND_PCT') return Promise.resolve(80);
      return Promise.resolve(fallback);
    });
    const oldOrder = orderRow({
      payment_status: 'paid', total_kmf: 10000, total_eur: 20.33,
      created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    });
    const client = makeClient([{ rows: [oldOrder] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue({ method: 'stripe', amountEur: 16.26, amountKmf: 8000, stripeRefundId: 'rf_2' });

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
    expect(processRefund).toHaveBeenCalledWith(
      client, oldOrder, 8000, expect.any(Number), 'partial', 'Annulation client', 'user-1'
    );
    expect(res.body.refund.cash_refund.in_free_window).toBe(false);
    expect(res.body.refund.cash_refund.type).toBe('partial');
  });

  it('erreur pendant processRefund → rollback + next(err)', async () => {
    const order = orderRow({ payment_status: 'paid', total_kmf: 10000, total_eur: 20.33 });
    const client = makeClient([{ rows: [order] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockRejectedValue(new Error('stripe indisponible'));

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(500);
    expectTransactionRolledBack(client);
  });
});

describe('orders/cancel — machine de statut', () => {
  it('422 si la transition échoue', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: false, error: 'transition invalide' });

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('transition invalide');
    expectTransactionRolledBack(client);
  });

  it('succès → commit, status cancelled', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expectTransactionCommitted(client);
  });
});

describe('orders/cancel — effets post-commit', () => {
  it('émet le reçu de remboursement si refundResult présent', async () => {
    const order = orderRow({ payment_status: 'paid', total_kmf: 10000, total_eur: 20.33 });
    const client = makeClient([{ rows: [order] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue({ method: 'stripe', amountEur: 20.33, amountKmf: 10000 });
    db.query.mockResolvedValue({ rows: [{ id: 'refund-row-1' }] });

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    expect(refundReceiptService.issue).toHaveBeenCalledWith('refund-row-1', { issuedBy: 'user-1' });
  });

  it('notifyCancellation appelé avec les infos de remboursement', async () => {
    const order = orderRow({ payment_status: 'paid', total_kmf: 10000, total_eur: 20.33 });
    const client = makeClient([{ rows: [order] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue({ method: 'stripe', amountEur: 20.33, amountKmf: 10000 });

    await request(app).post('/api/orders/o1/cancel').send({});

    expect(notifyCancellation).toHaveBeenCalledWith(order, {
      method: 'stripe', amountEur: 20.33, amountKmf: 10000,
    });
  });

  it('notifyCancellation appelé avec null si pas de remboursement cash', async () => {
    const order = orderRow({ payment_status: 'unpaid' });
    const client = makeClient([{ rows: [order] }]);
    db.getClient.mockResolvedValue(client);

    await request(app).post('/api/orders/o1/cancel').send({});

    expect(notifyCancellation).toHaveBeenCalledWith(order, null);
  });
});

describe('orders/cancel — message de réponse', () => {
  it('inclut le reversal wallet dans le message', async () => {
    const client = makeClient([{ rows: [orderRow({ payment_status: 'unpaid' })] }]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({
      success: true,
      cancelEffects: { walletReversalAmount: 3000, walletReversalTxId: 'tx-1' },
    });

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/3.000 KMF reversés sur votre wallet/);
    expect(res.body.refund.wallet_reversal).toEqual({ amount_kmf: 3000, wallet_tx_id: 'tx-1' });
  });

  it('message cash (non-stripe) avec montant KMF', async () => {
    const order = orderRow({ payment_status: 'paid', total_kmf: 10000, total_eur: 20.33 });
    const client = makeClient([{ rows: [order] }]);
    db.getClient.mockResolvedValue(client);
    processRefund.mockResolvedValue({ method: 'cash', amountEur: 20.33, amountKmf: 10000 });

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/crédités en avoir/);
  });
});

describe('orders/cancel — erreur générique', () => {
  it('erreur DB inattendue → rollback + next(err) → 500', async () => {
    const client = makeClient([{ error: new Error('connexion perdue') }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/orders/o1/cancel').send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'connexion perdue' });
    expectTransactionRolledBack(client);
  });
});
