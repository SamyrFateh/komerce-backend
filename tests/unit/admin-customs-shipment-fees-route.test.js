'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/** routes/admin-customs-shipments.js — frais typés : garde admin, 201/200, acteur = req.user.id, marché jamais lu du body. */

const express = require('express');
const request = require('supertest');

const mockRecord = jest.fn();
const mockList = jest.fn();
let mockRole = 'admin';

jest.mock('../../db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: mockRole }; next(); },
  requireRole: (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' })),
}));
jest.mock('../../services/customs-shipment-fee-service', () => ({
  recordFee: (...a) => mockRecord(...a),
  listFees: (...a) => mockList(...a),
}));
jest.mock('../../services/customs-shipment-service', () => ({}));
jest.mock('../../services/customs-analytics', () => ({}), { virtual: false });

const router = require('../../routes/admin-customs-shipments');

const app = express();
app.use(express.json());
app.use('/api/admin/customs-shipments', router);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message, code: err.code })); // eslint-disable-line no-unused-vars

const SHIP = '11111111-1111-4111-8111-111111111111';
const URL = `/api/admin/customs-shipments/${SHIP}/fees`;

beforeEach(() => { mockRecord.mockReset(); mockList.mockReset(); mockRole = 'admin'; });

describe('POST/GET /:id/fees', () => {
  it('refuse un non-admin (403) sans appeler le service', async () => {
    mockRole = 'customer';
    expect((await request(app).post(URL).send({})).status).toBe(403);
    expect((await request(app).get(URL)).status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('201 à la création, 200 au rejeu ; le body est transmis tel quel, acteur = req.user.id', async () => {
    const body = { fee_type: 'handling', amount_kmf: '10', market_id: 'IGNORED' };
    mockRecord.mockResolvedValueOnce({ fee: { id: 'f1' }, idempotent_replay: false });
    expect((await request(app).post(URL).send(body)).status).toBe(201);
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), SHIP, body, 'admin-1');
    mockRecord.mockResolvedValueOnce({ fee: { id: 'f1' }, idempotent_replay: true });
    expect((await request(app).post(URL).send(body)).status).toBe(200);
  });

  it('propage le code et le statut d\'erreur du service', async () => {
    mockRecord.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409, code: 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS' }));
    const r = await request(app).post(URL).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CUSTOMS_SHIPMENT_WITHOUT_PARCELS');
  });

  it('GET renvoie le journal et le résumé', async () => {
    mockList.mockResolvedValueOnce({ shipment_id: SHIP, fees: [], summary: { by_type: {} } });
    const r = await request(app).get(URL);
    expect(r.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.anything(), SHIP);
  });
});
