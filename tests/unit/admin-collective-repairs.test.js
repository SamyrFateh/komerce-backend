/**
 * KOMERCE — Tests Unitaires : routes/admin-collective-repairs (P0 shared-cart)
 *
 * Couvre POST /repair-ready-to-capture et POST /repair-stock-reservations :
 * garde de rôle admin, normalisation toBool de dry_run, et délégation aux
 * services repairCollectiveReadyToCapture / repairCollectiveStockReservations.
 *
 * Run : npx jest tests/unit/admin-collective-repairs.test.js
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
  requireRole: (roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé — rôle requis : ${roles.join(' ou ')}` });
    }
    next();
  },
}));

const mockRepairCollectiveReadyToCapture = jest.fn();
jest.mock('../../services/repair-collective-ready-to-capture', () => ({
  repairCollectiveReadyToCapture: (...args) => mockRepairCollectiveReadyToCapture(...args),
}));

const mockRepairCollectiveStockReservations = jest.fn();
jest.mock('../../services/repair-collective-stock-reservations', () => ({
  repairCollectiveStockReservations: (...args) => mockRepairCollectiveStockReservations(...args),
}));

const router = require('../../routes/admin-collective-repairs');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/collective-repairs', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/admin-collective-repairs', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
    mockRepairCollectiveReadyToCapture.mockReset();
    mockRepairCollectiveStockReservations.mockReset();
  });

  describe('POST /repair-ready-to-capture', () => {
    test('refuse un non-admin', async () => {
      mockUser = { id: 'u1', role: 'client' };
      const res = await request(buildApp()).post('/api/admin/collective-repairs/repair-ready-to-capture').send({});
      expect(res.status).toBe(403);
      expect(mockRepairCollectiveReadyToCapture).not.toHaveBeenCalled();
    });

    test('défaut dry_run=true quand non fourni', async () => {
      mockRepairCollectiveReadyToCapture.mockResolvedValueOnce({ status: 200, body: { dry_run: true } });

      await request(buildApp()).post('/api/admin/collective-repairs/repair-ready-to-capture').send({});

      expect(mockRepairCollectiveReadyToCapture).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true, user: mockUser })
      );
    });

    test('dry_run=false explicite désactive le mode dry-run', async () => {
      mockRepairCollectiveReadyToCapture.mockResolvedValueOnce({ status: 200, body: {} });

      await request(buildApp())
        .post('/api/admin/collective-repairs/repair-ready-to-capture')
        .send({ dry_run: false });

      expect(mockRepairCollectiveReadyToCapture).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: false })
      );
    });

    test('dry_run="false" (string) est interprété comme false', async () => {
      mockRepairCollectiveReadyToCapture.mockResolvedValueOnce({ status: 200, body: {} });

      await request(buildApp())
        .post('/api/admin/collective-repairs/repair-ready-to-capture')
        .send({ dry_run: 'false' });

      expect(mockRepairCollectiveReadyToCapture).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: false })
      );
    });

    test('transmet limit et min_age_minutes, et renvoie le status/body du service', async () => {
      mockRepairCollectiveReadyToCapture.mockResolvedValueOnce({
        status: 207,
        body: { failed_count: 1 },
      });

      const res = await request(buildApp())
        .post('/api/admin/collective-repairs/repair-ready-to-capture')
        .send({ limit: 10, min_age_minutes: 30 });

      expect(res.status).toBe(207);
      expect(res.body).toEqual({ failed_count: 1 });
      expect(mockRepairCollectiveReadyToCapture).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, minAgeMinutes: 30 })
      );
    });

    test('accepte minAgeMinutes (camelCase) en repli si min_age_minutes absent', async () => {
      mockRepairCollectiveReadyToCapture.mockResolvedValueOnce({ status: 200, body: {} });

      await request(buildApp())
        .post('/api/admin/collective-repairs/repair-ready-to-capture')
        .send({ minAgeMinutes: 15 });

      expect(mockRepairCollectiveReadyToCapture).toHaveBeenCalledWith(
        expect.objectContaining({ minAgeMinutes: 15 })
      );
    });

    test('transmet l\'erreur via next(err) si le service lève', async () => {
      mockRepairCollectiveReadyToCapture.mockRejectedValueOnce(new Error('boom'));

      const res = await request(buildApp())
        .post('/api/admin/collective-repairs/repair-ready-to-capture')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('boom');
    });
  });

  describe('POST /repair-stock-reservations', () => {
    test('refuse un non-admin', async () => {
      mockUser = { id: 'u1', role: 'client' };
      const res = await request(buildApp()).post('/api/admin/collective-repairs/repair-stock-reservations').send({});
      expect(res.status).toBe(403);
      expect(mockRepairCollectiveStockReservations).not.toHaveBeenCalled();
    });

    test('défaut dry_run=true et transmet limit', async () => {
      mockRepairCollectiveStockReservations.mockResolvedValueOnce({ status: 200, body: { consume_count: 0 } });

      const res = await request(buildApp())
        .post('/api/admin/collective-repairs/repair-stock-reservations')
        .send({ limit: 25 });

      expect(res.status).toBe(200);
      expect(mockRepairCollectiveStockReservations).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true, limit: 25, user: mockUser })
      );
    });

    test('propage le status 207 et le body en cas d\'échecs partiels', async () => {
      mockRepairCollectiveStockReservations.mockResolvedValueOnce({
        status: 207,
        body: { failed_count: 2 },
      });

      const res = await request(buildApp())
        .post('/api/admin/collective-repairs/repair-stock-reservations')
        .send({ dry_run: false });

      expect(res.status).toBe(207);
      expect(res.body).toEqual({ failed_count: 2 });
    });

    test('transmet l\'erreur via next(err) si le service lève', async () => {
      mockRepairCollectiveStockReservations.mockRejectedValueOnce(new Error('db crash'));

      const res = await request(buildApp())
        .post('/api/admin/collective-repairs/repair-stock-reservations')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('db crash');
    });
  });
});
