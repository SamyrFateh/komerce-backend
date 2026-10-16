'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * routes/purchasing.js — règlements fournisseur : garde admin, codes d'erreur
 * du service, marché jamais lu du body, 201 création / 200 rejeu idempotent.
 */

const express = require('express');
const request = require('supertest');

const mockRecord = jest.fn();
const mockList = jest.fn();
let mockRole = 'admin';

jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: mockRole }; next(); },
  requireRole: (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' })),
}));
jest.mock('../../services/supplier-payment-settlement-service', () => ({
  recordSettlement: (...a) => mockRecord(...a),
  listSettlements: (...a) => mockList(...a),
}));

const router = require('../../routes/purchasing');

const app = express();
app.use(express.json());
app.use('/api/purchasing', router);
app.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars

const PAY = '11111111-1111-4111-8111-111111111111';
const URL = `/api/purchasing/supplier-payments/${PAY}/settlements`;

beforeEach(() => { mockRecord.mockReset(); mockList.mockReset(); mockRole = 'admin'; });

describe('POST/GET settlements', () => {
  it('refuse un non-admin (403) sans appeler le service', async () => {
    mockRole = 'customer';
    expect((await request(app).post(URL).send({})).status).toBe(403);
    expect((await request(app).get(URL)).status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('201 à la création, 200 au rejeu idempotent ; l\'acteur est req.user.id', async () => {
    mockRecord.mockResolvedValueOnce({ settlement: { id: 's1' }, idempotent_replay: false });
    const body = { kind: 'payment', market_id: 'IGNORE', amount_currency: '1' };
    const r1 = await request(app).post(URL).send(body);
    expect(r1.status).toBe(201);
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), PAY, body, 'admin-1');
    mockRecord.mockResolvedValueOnce({ settlement: { id: 's1' }, idempotent_replay: true });
    expect((await request(app).post(URL).send(body)).status).toBe(200);
  });

  it('propage les codes explicites du service (409 / 400 / 404)', async () => {
    const err = (status, code) => Object.assign(new Error(code), { status, code });
    mockRecord.mockRejectedValueOnce(err(409, 'SETTLEMENT_IDEMPOTENCY_CONFLICT'));
    const r = await request(app).post(URL).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SETTLEMENT_IDEMPOTENCY_CONFLICT');
    mockRecord.mockRejectedValueOnce(err(400, 'SETTLEMENT_KIND_INVALID'));
    expect((await request(app).post(URL).send({})).status).toBe(400);
    mockList.mockRejectedValueOnce(err(404, 'SUPPLIER_PAYMENT_NOT_FOUND'));
    expect((await request(app).get(URL)).status).toBe(404);
  });

  it('GET liste les règlements du paiement', async () => {
    mockList.mockResolvedValueOnce({ payment_id: PAY, settlements: [] });
    const r = await request(app).get(URL);
    expect(r.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.anything(), PAY);
  });
});
