/**
 * KOMERCE — Tests Unitaires : routes/shared-cart-refund-admin (P0 shared-cart)
 *
 * Couvre POST /refund-queue/:contributionId/mark-refunded : garde admin,
 * délégation à markManualRefundProcessed, émission post-commit non bloquante
 * du reçu de remboursement (doctrine : refund_confirmed → reçu émis, jamais
 * avant COMMIT, et un échec d'émission ne doit jamais faire échouer la requête).
 *
 * Run : npx jest tests/unit/shared-cart-refund-admin.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé admin' });
    }
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const mockMarkManualRefundProcessed = jest.fn();
jest.mock('../../services/shared-cart-refund-queue', () => ({
  markManualRefundProcessed: (...args) => mockMarkManualRefundProcessed(...args),
}));

const mockIssue = jest.fn();
jest.mock('../../services/documents/refund-receipt', () => ({
  issue: (...args) => mockIssue(...args),
}));

const { router } = require('../../routes/shared-cart-refund-admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/shared-carts', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/shared-cart-refund-admin', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockMarkManualRefundProcessed.mockReset();
    mockIssue.mockReset();
    mockIssue.mockResolvedValue(undefined);
  });

  test('refuse l\'accès à un non-admin', async () => {
    mockUser = { id: 'u1', role: 'client' };

    const res = await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({});

    expect(res.status).toBe(403);
    expect(mockMarkManualRefundProcessed).not.toHaveBeenCalled();
  });

  test('marque la contribution comme remboursée et transmet refund_reference/note', async () => {
    mockMarkManualRefundProcessed.mockResolvedValueOnce({
      contribution: { id: 'contrib-1', status: 'refunded' },
      refundRowId: null,
    });

    const res = await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({ refund_reference: 'REF-001', note: 'Remboursé manuellement' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, contribution: { id: 'contrib-1', status: 'refunded' } });
    expect(mockMarkManualRefundProcessed).toHaveBeenCalledWith('contrib-1', 'admin-1', {
      refund_reference: 'REF-001',
      note: 'Remboursé manuellement',
    });
  });

  test('émet un reçu de remboursement si refundRowId est présent', async () => {
    mockMarkManualRefundProcessed.mockResolvedValueOnce({
      contribution: { id: 'contrib-1' },
      refundRowId: 'refund-99',
    });

    const res = await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({});

    expect(res.status).toBe(200);
    expect(mockIssue).toHaveBeenCalledWith('refund-99', { issuedBy: 'admin-1' });
  });

  test('n\'émet aucun reçu si refundRowId est absent (pas de ligne refunds créée)', async () => {
    mockMarkManualRefundProcessed.mockResolvedValueOnce({
      contribution: { id: 'contrib-1' },
      refundRowId: null,
    });

    await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({});

    expect(mockIssue).not.toHaveBeenCalled();
  });

  test('l\'échec d\'émission du reçu ne fait pas échouer la requête (non-bloquant)', async () => {
    mockMarkManualRefundProcessed.mockResolvedValueOnce({
      contribution: { id: 'contrib-1' },
      refundRowId: 'refund-99',
    });
    mockIssue.mockRejectedValueOnce(new Error('pdf generation failed'));

    const res = await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('renvoie err.statusCode si le service lève une erreur métier typée', async () => {
    const err = new Error('Contribution déjà remboursée');
    err.statusCode = 409;
    mockMarkManualRefundProcessed.mockRejectedValueOnce(err);

    const res = await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Contribution déjà remboursée');
  });

  test('transmet à next(err) une erreur sans statusCode (500)', async () => {
    mockMarkManualRefundProcessed.mockRejectedValueOnce(new Error('db down'));

    const res = await request(buildApp())
      .post('/api/admin/shared-carts/refund-queue/contrib-1/mark-refunded')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('db down');
  });
});
