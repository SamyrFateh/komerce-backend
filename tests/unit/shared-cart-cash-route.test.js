/**
 * KOMERCE — Tests Unitaires : routes/shared-cart-cash (P0 shared-cart)
 *
 * Couvre POST /public/:token/contributions/cash (public) et
 * POST /contributions/:id/confirm-cash (garde agent_relais/admin), incluant
 * la gestion des erreurs métier typées (err.status) vs next(err).
 *
 * Run : npx jest tests/unit/shared-cart-cash-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'agent-1', role: 'agent_relais' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

const mockCreatePendingCashContribution = jest.fn();
const mockConfirmCashContribution = jest.fn();
jest.mock('../../services/shared-cart-cash-service', () => ({
  createPendingCashContribution: (...args) => mockCreatePendingCashContribution(...args),
  confirmCashContribution: (...args) => mockConfirmCashContribution(...args),
}));

const { router } = require('../../routes/shared-cart-cash');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shared-carts', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/shared-cart-cash', () => {
  beforeEach(() => {
    mockUser = { id: 'agent-1', role: 'agent_relais' };
    mockCreatePendingCashContribution.mockReset();
    mockConfirmCashContribution.mockReset();
  });

  describe('POST /public/:token/contributions/cash', () => {
    test('crée une contribution cash en attente (accès public, pas d\'auth)', async () => {
      mockCreatePendingCashContribution.mockResolvedValueOnce({
        contribution: {
          id: 'contrib-1',
          cash_reference: 'CASH-001',
          status: 'pending',
          payment_method: 'cash',
          amount_kmf: 50000,
        },
      });

      const res = await request(buildApp())
        .post('/api/shared-carts/public/tok-abc/contributions/cash')
        .send({ amount_kmf: 50000 });

      expect(res.status).toBe(201);
      expect(res.body.contribution_id).toBe('contrib-1');
      expect(res.body.status).toBe('pending');
      expect(mockCreatePendingCashContribution).toHaveBeenCalledWith('tok-abc', { amount_kmf: 50000 });
    });

    test('renvoie err.status si le service lève une erreur métier typée', async () => {
      const err = new Error('Montant invalide');
      err.status = 400;
      err.code = 'invalid_amount';
      mockCreatePendingCashContribution.mockRejectedValueOnce(err);

      const res = await request(buildApp())
        .post('/api/shared-carts/public/tok-abc/contributions/cash')
        .send({ amount_kmf: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Montant invalide');
      expect(res.body.code).toBe('invalid_amount');
    });

    test('transmet à next(err) une erreur sans status (500)', async () => {
      mockCreatePendingCashContribution.mockRejectedValueOnce(new Error('db down'));

      const res = await request(buildApp())
        .post('/api/shared-carts/public/tok-abc/contributions/cash')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('db down');
    });
  });

  describe('POST /contributions/:id/confirm-cash', () => {
    test('refuse un rôle non autorisé (client)', async () => {
      mockUser = { id: 'u1', role: 'client' };

      const res = await request(buildApp())
        .post('/api/shared-carts/contributions/contrib-1/confirm-cash')
        .send({});

      expect(res.status).toBe(403);
      expect(mockConfirmCashContribution).not.toHaveBeenCalled();
    });

    test('confirme avec succès pour un agent_relais', async () => {
      mockConfirmCashContribution.mockResolvedValueOnce({
        contribution: { id: 'contrib-1', status: 'confirmed' },
        cart: { id: 'cart-1' },
      });

      const res = await request(buildApp())
        .post('/api/shared-carts/contributions/contrib-1/confirm-cash')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        already_confirmed: false,
        contribution: { id: 'contrib-1', status: 'confirmed' },
        cart: { id: 'cart-1' },
      });
      expect(mockConfirmCashContribution).toHaveBeenCalledWith('contrib-1', mockUser, {});
    });

    test('confirme pour un admin également', async () => {
      mockUser = { id: 'admin-1', role: 'admin' };
      mockConfirmCashContribution.mockResolvedValueOnce({ contribution: { id: 'c1' } });

      const res = await request(buildApp())
        .post('/api/shared-carts/contributions/c1/confirm-cash')
        .send({});

      expect(res.status).toBe(200);
    });

    test('retourne already_confirmed=true si déjà confirmée (idempotence)', async () => {
      mockConfirmCashContribution.mockResolvedValueOnce({
        already_confirmed: true,
        contribution: { id: 'contrib-1', status: 'confirmed' },
      });

      const res = await request(buildApp())
        .post('/api/shared-carts/contributions/contrib-1/confirm-cash')
        .send({});

      expect(res.body.already_confirmed).toBe(true);
      expect(res.body.cart).toBeNull();
    });

    test('renvoie 409 si la confirmation est rejetée', async () => {
      mockConfirmCashContribution.mockResolvedValueOnce({
        rejected: true,
        error: 'Référence déjà utilisée',
        code: 'duplicate_reference',
        contribution: { id: 'contrib-1', status: 'rejected' },
      });

      const res = await request(buildApp())
        .post('/api/shared-carts/contributions/contrib-1/confirm-cash')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('duplicate_reference');
    });

    test('renvoie err.status si le service lève une erreur typée', async () => {
      const err = new Error('Contribution introuvable');
      err.status = 404;
      mockConfirmCashContribution.mockRejectedValueOnce(err);

      const res = await request(buildApp())
        .post('/api/shared-carts/contributions/missing/confirm-cash')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Contribution introuvable');
    });
  });
});
