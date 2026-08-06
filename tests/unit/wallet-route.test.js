/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/wallet (Lot B2)
 *
 * Couvre la façade HTTP wallet : auth, guards IDOR/statuts (NEW-01, NEW-02,
 * R2 FIX) faits en ligne dans la route via db.getClient(), et dispatch vers
 * services/wallet-service.js (mocké — déjà testé isolément dans
 * wallet-service.test.js). Le reçu wallet (services/documents/wallet-receipt)
 * est post-commit / non-bloquant : on vérifie qu'il est déclenché sans
 * bloquer la réponse HTTP.
 *
 * Run : npx jest tests/unit/wallet-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
  getClient: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'user-1', role: 'client' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
}));

jest.mock('../../services/wallet-service', () => ({
  getBalance: jest.fn(),
  getTransactions: jest.fn(),
  applyToOrder: jest.fn(),
  removeFromOrder: jest.fn(),
  listWallets: jest.fn(),
  getWalletDetail: jest.fn(),
  credit: jest.fn(),
  createCreditFromCancel: jest.fn(),
  reverseLot: jest.fn(),
}));

jest.mock('../../services/documents/wallet-receipt', () => ({ issue: jest.fn() }));

const db = require('../../db');
const walletService = require('../../services/wallet-service');
const walletReceiptService = require('../../services/documents/wallet-receipt');
const router = require('../../routes/wallet');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wallet', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/wallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    mockUser = { id: 'user-1', role: 'client' };
    walletReceiptService.issue.mockResolvedValue({});
  });

  test('toutes les routes exigent une authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/wallet');
    expect(res.status).toBe(401);
  });

  describe('GET / — solde', () => {
    test('renvoie le solde et la date d\'expiration du wallet', async () => {
      walletService.getBalance.mockResolvedValueOnce(15000);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ expires_at: '2026-12-01' }] });

      const res = await request(buildApp()).get('/api/wallet');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ balance_kmf: 15000, user_id: 'user-1', expires_at: '2026-12-01' });
    });

    test('expires_at est null si aucun lot avec expiration', async () => {
      walletService.getBalance.mockResolvedValueOnce(0);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ expires_at: null }] });

      const res = await request(buildApp()).get('/api/wallet');

      expect(res.body.expires_at).toBeNull();
    });
  });

  describe('GET /transactions', () => {
    test('applique les bornes limit/offset par défaut', async () => {
      walletService.getTransactions.mockResolvedValueOnce({ count: 0, transactions: [] });

      const res = await request(buildApp()).get('/api/wallet/transactions');

      expect(res.status).toBe(200);
      expect(walletService.getTransactions).toHaveBeenCalledWith('user-1', { limit: 20, offset: 0 });
    });

    test('plafonne limit à 100', async () => {
      walletService.getTransactions.mockResolvedValueOnce({ count: 0, transactions: [] });

      await request(buildApp()).get('/api/wallet/transactions').query({ limit: 999, offset: 5 });

      expect(walletService.getTransactions).toHaveBeenCalledWith('user-1', { limit: 100, offset: 5 });
    });
  });

  describe('POST /apply', () => {
    test('exige order_id', async () => {
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/apply').send({});

      expect(res.status).toBe(400);
      expect(walletService.applyToOrder).not.toHaveBeenCalled();
    });

    test('404 si la commande est introuvable', async () => {
      const client = makeClient([{ rows: [] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/apply').send({ order_id: 'o1' });

      expect(res.status).toBe(404);
      expectTransactionRolledBack(client);
    });

    test('403 si la commande n\'appartient pas à l\'utilisateur (IDOR NEW-01)', async () => {
      const client = makeClient([{ rows: [{ user_id: 'other-user', payment_status: 'pending', status: 'confirmed' }] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/apply').send({ order_id: 'o1' });

      expect(res.status).toBe(403);
      expectTransactionRolledBack(client);
      expect(walletService.applyToOrder).not.toHaveBeenCalled();
    });

    test('409 si la commande est déjà payée', async () => {
      const client = makeClient([{ rows: [{ user_id: 'user-1', payment_status: 'paid', status: 'confirmed' }] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/apply').send({ order_id: 'o1' });

      expect(res.status).toBe(409);
      expectTransactionRolledBack(client);
    });

    test.each(['cancelled', 'refunded', 'collected'])('409 si le statut commande est %s (R2 FIX)', async (status) => {
      const client = makeClient([{ rows: [{ user_id: 'user-1', payment_status: 'pending', status }] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/apply').send({ order_id: 'o1' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(status);
      expectTransactionRolledBack(client);
    });

    test('applique le wallet et commit la transaction', async () => {
      const client = makeClient([{ rows: [{ user_id: 'user-1', payment_status: 'pending', status: 'confirmed' }] }]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.applyToOrder.mockResolvedValueOnce({
        applied_kmf: 3000, remaining_to_pay: 2000, transaction: { id: 'tx1' },
      });

      const res = await request(buildApp()).post('/api/wallet/apply').send({ order_id: 'o1', amount_kmf: 3000 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: '3000 KMF appliqués',
        applied_kmf: 3000,
        remaining_to_pay: 2000,
        transaction: { id: 'tx1' },
      });
      expect(walletService.applyToOrder).toHaveBeenCalledWith(client, {
        userId: 'user-1', orderId: 'o1', amountKmf: 3000,
      });
      expectTransactionCommitted(client);
    });

    test('rollback et propage l\'erreur si le service échoue', async () => {
      const client = makeClient([{ rows: [{ user_id: 'user-1', payment_status: 'pending', status: 'confirmed' }] }]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.applyToOrder.mockRejectedValueOnce(new Error('solde insuffisant'));

      const res = await request(buildApp()).post('/api/wallet/apply').send({ order_id: 'o1' });

      expect(res.status).toBe(500);
      expectTransactionRolledBack(client);
    });
  });

  describe('POST /remove', () => {
    test('exige order_id', async () => {
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/remove').send({});

      expect(res.status).toBe(400);
    });

    test('404 si la commande est introuvable', async () => {
      const client = makeClient([{ rows: [] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/remove').send({ order_id: 'o1' });

      expect(res.status).toBe(404);
      expectTransactionRolledBack(client);
    });

    test('403 si la commande n\'appartient pas à l\'utilisateur (IDOR NEW-02)', async () => {
      const client = makeClient([{ rows: [{ user_id: 'other-user' }] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/remove').send({ order_id: 'o1' });

      expect(res.status).toBe(403);
      expectTransactionRolledBack(client);
    });

    test('retire le wallet et commit', async () => {
      const client = makeClient([{ rows: [{ user_id: 'user-1', payment_status: 'pending' }] }]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.removeFromOrder.mockResolvedValueOnce({ reversed_kmf: 3000, transaction: { id: 'tx2' } });

      const res = await request(buildApp()).post('/api/wallet/remove').send({ order_id: 'o1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: '3000 KMF remboursés au wallet',
        reversed_kmf: 3000,
        transaction: { id: 'tx2' },
      });
      expectTransactionCommitted(client);
    });

    // P5-N2 (§7) : le retrait self-service est bloqué une fois la commande payée —
    // seul le chemin d'annulation métier (order-status-machine) peut re-créditer
    // le wallet d'une commande déjà 'paid'.
    test('409 si la commande est déjà payée', async () => {
      const client = makeClient([{ rows: [{ user_id: 'user-1', payment_status: 'paid' }] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/remove').send({ order_id: 'o1' });

      expect(res.status).toBe(409);
      expect(walletService.removeFromOrder).not.toHaveBeenCalled();
      expectTransactionRolledBack(client);
    });
  });

  describe('Admin guard', () => {
    test.each([
      ['GET', '/api/wallet/admin'],
      ['GET', '/api/wallet/admin/user-9'],
      ['POST', '/api/wallet/admin/credit'],
      ['POST', '/api/wallet/admin/order-credit/o1'],
      ['POST', '/api/wallet/admin/reverse-lot'],
    ])('%s %s refuse un client non-admin', async (method, url) => {
      const res = await request(buildApp())[method.toLowerCase()](url).send({});
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin — liste des wallets', () => {
    test('liste avec pagination et recherche (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      walletService.listWallets.mockResolvedValueOnce({ count: 1, wallets: [] });

      const res = await request(buildApp()).get('/api/wallet/admin').query({ limit: 10, offset: 0, search: 'ali' });

      expect(res.status).toBe(200);
      expect(walletService.listWallets).toHaveBeenCalledWith({ limit: 10, offset: 0, search: 'ali' });
    });

    test('plafonne limit à 100', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      walletService.listWallets.mockResolvedValueOnce({ count: 0, wallets: [] });

      await request(buildApp()).get('/api/wallet/admin').query({ limit: 500 });

      expect(walletService.listWallets).toHaveBeenCalledWith({ limit: 100, offset: 0, search: null });
    });
  });

  describe('GET /admin/:userId', () => {
    test('404 si wallet introuvable (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      walletService.getWalletDetail.mockResolvedValueOnce(null);

      const res = await request(buildApp()).get('/api/wallet/admin/user-9');

      expect(res.status).toBe(404);
    });

    test('renvoie le détail wallet (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      walletService.getWalletDetail.mockResolvedValueOnce({ user_id: 'user-9', balance_kmf: 1000 });

      const res = await request(buildApp()).get('/api/wallet/admin/user-9');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user_id: 'user-9', balance_kmf: 1000 });
    });
  });

  describe('POST /admin/credit', () => {
    test('valide user_id et amount_kmf > 0 (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/admin/credit').send({ user_id: 'u9', amount_kmf: 0 });

      expect(res.status).toBe(400);
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    test('404 si utilisateur introuvable (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([{ rows: [] }]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp())
        .post('/api/wallet/admin/credit')
        .send({ user_id: 'u9', amount_kmf: 5000 });

      expect(res.status).toBe(404);
      expectTransactionRolledBack(client);
    });

    test('crédite et déclenche l\'émission du reçu (post-commit, non bloquant)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([{ rows: [{ id: 'u9', full_name: 'Fatima', phone: '123' }] }]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.credit.mockResolvedValueOnce({
        transaction: { id: 'tx3' }, lot: { id: 'lot1' }, duplicate: false,
      });

      const res = await request(buildApp())
        .post('/api/wallet/admin/credit')
        .send({ user_id: 'u9', amount_kmf: 5000, reason: 'geste_commercial' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.transaction).toEqual({ id: 'tx3' });
      expectTransactionCommitted(client);
      expect(walletReceiptService.issue).toHaveBeenCalledWith('tx3', { issuedBy: 'admin-1' });
    });

    test('n\'émet pas de reçu si le crédit est un doublon idempotent', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([{ rows: [{ id: 'u9', full_name: 'Fatima', phone: '123' }] }]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.credit.mockResolvedValueOnce({
        transaction: { id: 'tx3' }, lot: null, duplicate: true,
      });

      await request(buildApp()).post('/api/wallet/admin/credit').send({ user_id: 'u9', amount_kmf: 5000 });

      expect(walletReceiptService.issue).not.toHaveBeenCalled();
    });

    test('ne bloque pas la réponse si l\'émission du reçu échoue', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([{ rows: [{ id: 'u9', full_name: 'Fatima', phone: '123' }] }]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.credit.mockResolvedValueOnce({ transaction: { id: 'tx3' }, lot: {}, duplicate: false });
      walletReceiptService.issue.mockRejectedValueOnce(new Error('pdf down'));

      const res = await request(buildApp()).post('/api/wallet/admin/credit').send({ user_id: 'u9', amount_kmf: 5000 });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /admin/order-credit/:orderId', () => {
    test('crée un avoir depuis commande annulée et émet un reçu (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.createCreditFromCancel.mockResolvedValueOnce({
        duplicate: false, transaction: { id: 'tx4' }, reversed_kmf: 4000,
      });

      const res = await request(buildApp()).post('/api/wallet/admin/order-credit/o1');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expectTransactionCommitted(client);
      expect(walletReceiptService.issue).toHaveBeenCalledWith('tx4', { issuedBy: 'admin-1' });
    });

    test('rollback et renvoie le résultat idempotent si l\'avoir existe déjà', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.createCreditFromCancel.mockResolvedValueOnce({
        duplicate: true, transaction: { id: 'tx4' },
      });

      const res = await request(buildApp()).post('/api/wallet/admin/order-credit/o1');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/idempotent/);
      expectTransactionRolledBack(client);
      expect(walletReceiptService.issue).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/reverse-lot', () => {
    test('exige lot_id (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);

      const res = await request(buildApp()).post('/api/wallet/admin/reverse-lot').send({});

      expect(res.status).toBe(400);
      expect(walletService.reverseLot).not.toHaveBeenCalled();
    });

    test('annule un lot et émet un reçu (admin)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.reverseLot.mockResolvedValueOnce({
        reversed_kmf: 2000, transaction: { id: 'tx5' }, walletTxId: 'tx5',
      });

      const res = await request(buildApp())
        .post('/api/wallet/admin/reverse-lot')
        .send({ lot_id: 'lot1', note: 'erreur saisie' });

      expect(res.status).toBe(200);
      expect(res.body.reversed_kmf).toBe(2000);
      expectTransactionCommitted(client);
      expect(walletReceiptService.issue).toHaveBeenCalledWith('tx5', { issuedBy: 'admin-1' });
    });

    test.each([
      ['Lot introuvable', 422],
      ['Lot déjà annulé', 422],
      ['Lot partiellement consommé', 422],
      ['Reversal causerait un solde négatif', 422],
      ['Lot en attente — reversal impossible', 422],
    ])('mappe l\'erreur métier "%s" en 422', async (message, expected) => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.reverseLot.mockRejectedValueOnce(new Error(message));

      const res = await request(buildApp())
        .post('/api/wallet/admin/reverse-lot')
        .send({ lot_id: 'lot1' });

      expect(res.status).toBe(expected);
      expectTransactionRolledBack(client);
    });

    test('propage une erreur technique inattendue au handler global (500)', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      const client = makeClient([]);
      db.getClient.mockResolvedValueOnce(client);
      walletService.reverseLot.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(buildApp())
        .post('/api/wallet/admin/reverse-lot')
        .send({ lot_id: 'lot1' });

      expect(res.status).toBe(500);
      expectTransactionRolledBack(client);
    });
  });
});
