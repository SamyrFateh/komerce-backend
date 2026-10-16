'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/** routes/admin-customs-shipments.js — composition du groupage : garde admin, acteur = req.user.id, reason transmise. */

const express = require('express');
const request = require('supertest');

const mockAdd = jest.fn();
const mockRemove = jest.fn();
let mockRole = 'admin';

jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: mockRole }; next(); },
  requireRole: (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' })),
}));
jest.mock('../../services/customs-shipment-fee-service', () => ({}));
jest.mock('../../services/customs-shipment-service', () => ({
  addParcelsToShipment: (...a) => mockAdd(...a),
  removeParcelsFromShipment: (...a) => mockRemove(...a),
}));
jest.mock('../../services/customs-analytics', () => ({}), { virtual: false });

const router = require('../../routes/admin-customs-shipments');

const app = express();
app.use(express.json());
app.use('/api/admin/customs-shipments', router);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message, code: err.code })); // eslint-disable-line no-unused-vars

const SHIP = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { mockAdd.mockReset(); mockRemove.mockReset(); mockRole = 'admin'; });

describe('POST /:id/parcels et /:id/parcels/remove', () => {
  it('refuse un non-admin', async () => {
    mockRole = 'client';
    expect((await request(app).post(`/api/admin/customs-shipments/${SHIP}/parcels`).send({ parcel_ids: [P1], reason: 'x' })).status).toBe(403);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('ajout : transmet parcel_ids, acteur serveur et reason', async () => {
    mockAdd.mockResolvedValue({ shipment_id: SHIP, added: [P1] });
    const res = await request(app).post(`/api/admin/customs-shipments/${SHIP}/parcels`).send({ parcel_ids: [P1], reason: 'arrivé', market_id: 'ignored' });
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(expect.anything(), SHIP, [P1], { id: 'admin-1', reason: 'arrivé', parcel_shares: undefined });
  });

  it('retrait : transmet parcel_ids, acteur serveur et reason ; propage l\'erreur métier', async () => {
    mockRemove.mockRejectedValue(Object.assign(new Error('clos'), { status: 409, code: 'CUSTOMS_SHIPMENT_CLOSED' }));
    const res = await request(app).post(`/api/admin/customs-shipments/${SHIP}/parcels/remove`).send({ parcel_ids: [P1], reason: 'erreur' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CUSTOMS_SHIPMENT_CLOSED');
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), SHIP, [P1], { id: 'admin-1', reason: 'erreur', parcel_shares: undefined });
  });
});
