'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/transit-dashboard.test.js
 *
 * Tests du router routes/transit-dashboard.js
 *
 * Couverture :
 *   ✓ GET / : admin requis, liste les colis status='shipped'
 *   ✓ POST /:ref/transit : 404 si la commande référence est introuvable
 *   ✓ POST /:ref/transit : crée le scan in_transit puis route via safeSyncScanToParcels
 *     (seul chemin autorisé pour mettre à jour orders.status — invariant doctrine)
 *   ✓ POST /:ref/transit : si safeSyncScanToParcels échoue, l'erreur remonte (pas de succès silencieux)
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => { if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' }); next(); },
}));

jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockSafeSyncScanToParcels = jest.fn();
jest.mock('../../utils/parcelSync', () => ({
  safeSyncScanToParcels: (...args) => mockSafeSyncScanToParcels(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/transit-dashboard');
    app.use('/api/admin/transit-dashboard', router);
  });
});

describe('transit-dashboard — GET /', () => {
  it('refuse un non-admin', async () => {
    currentUser = { id: 'u1', role: 'agent_hub' };
    const res = await request(app).get('/api/admin/transit-dashboard');
    expect(res.status).toBe(403);
  });

  it('liste les colis en status shipped', async () => {
    const parcels = [{ reference: 'KOM-P-1', destination_island: 'grande_comore', relais_name: 'R1', weight_kg: 3, created_at: '2026-06-01' }];
    mockQuery.mockResolvedValueOnce({ rows: parcels });

    const res = await request(app).get('/api/admin/transit-dashboard');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parcels });
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE status = 'shipped'/);
  });
});

describe('transit-dashboard — POST /:ref/transit', () => {
  it('404 si la commande référence est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/transit-dashboard/CMD-404/transit');

    expect(res.status).toBe(404);
    expect(mockSafeSyncScanToParcels).not.toHaveBeenCalled();
  });

  it('crée le scan in_transit puis route via safeSyncScanToParcels', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ order_id: 'order-1' }] })   // SELECT orders
      .mockResolvedValueOnce({ rows: [{ id: 'scan-1' }] });          // INSERT scans
    mockSafeSyncScanToParcels.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/admin/transit-dashboard/CMD-1/transit');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO scans/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/'in_transit'/);
    expect(mockSafeSyncScanToParcels).toHaveBeenCalledWith(expect.objectContaining({
      order_id: 'order-1', step: 'in_transit', scan_id: 'scan-1', scanned_by: 'admin-1',
    }));
  });

  it('propage l\'erreur si safeSyncScanToParcels échoue (pas de succès silencieux)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ order_id: 'order-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'scan-1' }] });
    mockSafeSyncScanToParcels.mockRejectedValueOnce(new Error('sync failed'));

    const res = await request(app).post('/api/admin/transit-dashboard/CMD-1/transit');

    expect(res.status).toBe(500);
  });
});
