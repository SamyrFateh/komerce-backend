'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
  return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../../services/market-delegation-team-service', () => ({ resolveAuthorization: jest.fn() }));
jest.mock('../../services/market-delegation-service', () => ({ audit: jest.fn() }));
jest.mock('../../services/local-stock-service', () => ({
  getLocalStock: jest.fn(), setLocalStock: jest.fn(), setLocalStockExposure: jest.fn(),
}));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = global.__user; next(); },
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const team = require('../../services/market-delegation-team-service');
const delegation = require('../../services/market-delegation-service');
const local = require('../../services/local-stock-service');
const router = require('../../routes/market-local-stock');

const MARKET = 'm-cm';
const authz = { market_id: MARKET, market_code: 'CM', assignment_id: 'a1', membership_id: 'ms1' };
let client; let auditRows;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/markets', router);
  return a;
}
const body = (o = {}) => ({ product_id: 'p1', relais_id: 'r1', qty_received: 10, proof_ref: 'BL-42', note: 'x', ...o });
const post = (o, key = 'k1') => request(app()).post('/api/markets/CM/local-stock/receipts').set(key ? { 'Idempotency-Key': key } : {}).send(body(o));

beforeEach(() => {
  jest.resetAllMocks();
  global.__user = { id: 'u-lead', role: 'user' };
  auditRows = [];
  client = { release: jest.fn(), query: jest.fn(async (sql, p) => {
    if (/FROM relais WHERE id/.test(sql)) return { rows: p[0] === 'r1' ? [{ id: 'r1', market_id: MARKET }] : p[0] === 'r-other' ? [{ id: 'r-other', market_id: 'm-cg' }] : [] };
    if (/FROM products WHERE id/.test(sql)) return { rows: p[0] === 'p-off' ? [{ id: 'p-off', is_active: false }] : [{ id: p[0], is_active: true }] };
    if (/FROM market_delegation_audit/.test(sql)) return { rows: auditRows.filter(r => r.key === p[1]).map(r => ({ payload_after: r.after })) };
    return { rows: [] };
  }) };
  db.getClient.mockResolvedValue(client);
  team.resolveAuthorization.mockResolvedValue(authz);
  local.getLocalStock.mockResolvedValue({ qty_physical: 5, commercial_exposure: 'DISABLED' });
  local.setLocalStock.mockImplementation(async ({ qtyPhysical }) => ({ qty_physical: qtyPhysical }));
  delegation.audit.mockImplementation(async (_c, a) => { auditRows.push({ key: a.correlationId, after: a.after }); });
});

describe('POST receipts — droits', () => {
  it('admin : 403 sans résolution ni écriture', async () => {
    global.__user = { id: 'adm', role: 'admin' };
    const res = await post();
    expect(res.status).toBe(403);
    expect(local.setLocalStock).not.toHaveBeenCalled();
  });
  it('autre rôle sans membership/capability : 403', async () => {
    global.__user = { id: 'u-x', role: 'relay_manager' };
    team.resolveAuthorization.mockRejectedValue(Object.assign(new Error('no'), { code: 'MARKET_MEMBERSHIP_REQUIRED', status: 403 }));
    expect((await post()).status).toBe(403);
    expect(local.setLocalStock).not.toHaveBeenCalled();
  });
  it('responsable d’un autre marché : 403', async () => {
    team.resolveAuthorization.mockRejectedValue(Object.assign(new Error('no'), { code: 'MARKET_MEMBERSHIP_REQUIRED', status: 403 }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(team.resolveAuthorization).toHaveBeenCalledWith(client, expect.objectContaining({ marketCode: 'CM', requiredCapability: 'local_offer.manage' }));
  });
});

describe('POST receipts — effet', () => {
  it('ajoute au pool KM_MAIN, trace relais/justificatif/quantité dans l’audit', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(local.setLocalStock).toHaveBeenCalledWith(expect.objectContaining({ location: 'KM_MAIN', qtyPhysical: 15, marketId: MARKET }));
    expect(delegation.audit).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'LOCAL_STOCK_RECEIPT', correlationId: 'k1',
      after: expect.objectContaining({ relais_id: 'r1', proof_ref: 'BL-42', qty_received: 10 }),
    }));
  });
  it('rejeu avec la même Idempotency-Key : pas de second ajout', async () => {
    await post();
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(local.setLocalStock).toHaveBeenCalledTimes(1);
  });
  it('relais d’un autre marché ou inconnu : refus 422', async () => {
    expect((await post({ relais_id: 'r-other' })).status).toBe(422);
    expect((await post({ relais_id: 'nope' })).status).toBe(422);
    expect(local.setLocalStock).not.toHaveBeenCalled();
  });
  it.each([0, -3, 1.5, '5', null])('quantité invalide %p : 400', async (q) => {
    expect((await post({ qty_received: q })).status).toBe(400);
    expect(local.setLocalStock).not.toHaveBeenCalled();
  });
  it('proof_ref manquant, Idempotency-Key manquante, market_id client : 400', async () => {
    expect((await post({ proof_ref: ' ' })).status).toBe(400);
    expect((await post({}, null)).status).toBe(400);
    expect((await post({ market_id: 'm-cg' })).status).toBe(400);
  });
  it('produit inactif : refus 422', async () => {
    expect((await post({ product_id: 'p-off' })).status).toBe(422);
    expect(local.setLocalStock).not.toHaveBeenCalled();
  });
});

describe('PUT exposure', () => {
  const put = (b) => request(app()).put('/api/markets/CM/local-stock/p1/exposure').send(b);
  beforeEach(() => local.setLocalStockExposure.mockResolvedValue({ commercial_exposure: 'ENABLED' }));
  it('ENABLED/DISABLED via setLocalStockExposure, audité', async () => {
    const res = await put({ commercial_exposure: 'ENABLED' });
    expect(res.status).toBe(200);
    expect(local.setLocalStockExposure).toHaveBeenCalledWith('p1', MARKET, 'ENABLED', 'KM_MAIN');
    expect(delegation.audit).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'LOCAL_STOCK_EXPOSED' }));
  });
  it('valeur invalide : 400 ; admin : 403 ; autre marché : 403', async () => {
    expect((await put({ commercial_exposure: 'HIDDEN' })).status).toBe(400);
    global.__user = { id: 'adm', role: 'admin' };
    expect((await put({ commercial_exposure: 'ENABLED' })).status).toBe(403);
    global.__user = { id: 'u-lead', role: 'user' };
    team.resolveAuthorization.mockRejectedValue(Object.assign(new Error('no'), { code: 'MARKET_MEMBERSHIP_REQUIRED', status: 403 }));
    expect((await put({ commercial_exposure: 'ENABLED' })).status).toBe(403);
    expect(local.setLocalStockExposure).not.toHaveBeenCalled();
  });
});
