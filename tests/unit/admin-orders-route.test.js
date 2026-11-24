'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-orders-route.test.js
 *
 * Tests du router routes/admin/orders.js.
 *
 * Couverture :
 *   ✓ Garde d'accès : authenticate + requireRole(['admin'])
 *   ✓ GET /orders    : construction dynamique du WHERE (status, payment_mode,
 *                       confection_type, from_date, to_date, margin_alert, search),
 *                       pagination limit/offset, réponse { orders, total },
 *                       erreur DB → next(err)
 *   ✓ DELETE /orders/:id : 404 si introuvable, succès → deleteOrderCascade,
 *                       erreur DB → next(err)
 *   ✓ POST /orders/:id/refund : délègue à refundCancelledOrder avec les bons
 *                       défauts (dryRun=true sauf si dry_run===false explicite,
 *                       reason=null, cashMode='manual'), erreur → next(err)
 */

const mockState = { user: { id: 'admin-1', role: 'admin', email: 'admin@komerce.test' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockDeleteOrderCascade = jest.fn();
jest.mock('../../routes/admin/delete-order-cascade', () => ({
  deleteOrderCascade: (...args) => mockDeleteOrderCascade(...args),
}));

const mockRefundCancelledOrder = jest.fn();
jest.mock('../../services/admin-order-refund', () => ({
  refundCancelledOrder: (...args) => mockRefundCancelledOrder(...args),
}));

const mockReadVerifiedShortageCandidates = jest.fn();
jest.mock('../../services/item-refund-reservation-service', () => ({
  readVerifiedShortageCandidates: (...args) => mockReadVerifiedShortageCandidates(...args),
  reserveVerifiedShortage: jest.fn(),
}));
const mockReadN27RemnantContext = jest.fn();
const mockReserveN27Remnant = jest.fn();
jest.mock('../../services/n27-remnant-cancellation-service', () => ({
  readN27RemnantContext: (...args) => mockReadN27RemnantContext(...args),
  reserveN27Remnant: (...args) => mockReserveN27Remnant(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
const savedN27Env={environment:process.env.KOMERCE_ENV,enabled:process.env.N27_REMNANT_RESERVATIONS_ENABLED};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KOMERCE_ENV='staging';
  process.env.N27_REMNANT_RESERVATIONS_ENABLED='0';
  mockState.user = { id: 'admin-1', role: 'admin', email: 'admin@komerce.test' };

  app = express();
  app.use(express.json());

  jest.isolateModules(() => {
    const router = require('../../routes/admin/orders');
    app.use('/api/admin', router);
  });

  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});
afterAll(()=>{
  if(savedN27Env.environment===undefined)delete process.env.KOMERCE_ENV;else process.env.KOMERCE_ENV=savedN27Env.environment;
  if(savedN27Env.enabled===undefined)delete process.env.N27_REMNANT_RESERVATIONS_ENABLED;else process.env.N27_REMNANT_RESERVATIONS_ENABLED=savedN27Env.enabled;
});
describe('admin/orders — garde d\'accès', () => {
  it('403 si non-admin', async () => {
    mockState.user = { id: 'u2', role: 'agent_hub' };
    const res = await request(app).get('/api/admin/orders');
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('admin/orders — GET /orders', () => {
  it('sans filtre : WHERE 1=1, pagination par défaut (limit 50, offset 0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/orders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: [{ id: 'o1' }], total: 1 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE 1=1');
    expect(params).toEqual([50, 0]);
  });

  it('applique tous les filtres et construit le WHERE/params attendus', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app).get('/api/admin/orders').query({
      status: 'shipped',
      payment_mode: 'wallet',
      confection_type: 'custom',
      from_date: '2026-01-01',
      to_date: '2026-06-01',
      margin_alert: 'true',
      search: 'Ali',
      limit: 10,
      offset: 20,
    });

    expect(res.status).toBe(200);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('o.status = $1');
    expect(sql).toContain('o.payment_mode = $2');
    expect(sql).toContain('o.confection_type = $3');
    expect(sql).toContain('o.created_at >= $4');
    expect(sql).toContain('o.created_at <= $5');
    expect(sql).toContain('o.margin_alert = TRUE');
    expect(sql).toContain('o.reference ILIKE $6');
    expect(params).toEqual(['shipped', 'wallet', 'custom', '2026-01-01', '2026-06-01', '%Ali%', 10, 20]);

    // Le 2e appel (COUNT) réutilise les mêmes params (sans limit/offset)
    const [countSql, countParams] = mockQuery.mock.calls[1];
    expect(countSql).toContain('COUNT(*)');
    expect(countParams).toEqual(['shipped', 'wallet', 'custom', '2026-01-01', '2026-06-01', '%Ali%']);
  });

  it('margin_alert différent de "true" est ignoré', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await request(app).get('/api/admin/orders').query({ margin_alert: 'false' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('margin_alert = TRUE');
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connexion DB perdue'));
    const res = await request(app).get('/api/admin/orders');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'connexion DB perdue' });
  });
});

describe('admin/orders — DELETE /orders/:id', () => {
  it('404 si la commande est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/admin/orders/missing-id');
    expect(res.status).toBe(404);
    expect(mockDeleteOrderCascade).not.toHaveBeenCalled();
  });

  it('succès : delete cascade + réponse formatée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-001', status: 'pending' }] });
    mockDeleteOrderCascade.mockResolvedValueOnce(undefined);

    const res = await request(app).delete('/api/admin/orders/o1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Commande CMD-001 supprimée',
      deleted: { id: 'o1', reference: 'CMD-001', status: 'pending' },
    });
    expect(mockDeleteOrderCascade).toHaveBeenCalledWith(expect.anything(), 'o1');
  });

  it('erreur DB (lookup) → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('uuid invalide'));
    const res = await request(app).delete('/api/admin/orders/bad-id');
    expect(res.status).toBe(500);
  });

  it('erreur pendant la cascade → next(err) → 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-001', status: 'pending' }] });
    mockDeleteOrderCascade.mockRejectedValueOnce(new Error('cascade échouée'));
    const res = await request(app).delete('/api/admin/orders/o1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'cascade échouée' });
  });
});

describe('admin/orders — POST /orders/:id/refund', () => {
  it('défauts : dryRun=true, reason=null, cashMode=manual', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    const res = await request(app).post('/api/admin/orders/o1/refund').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRefundCancelledOrder).toHaveBeenCalledWith({
      orderId: 'o1',
      user: mockState.user,
      dryRun: true,
      reason: null,
      cashMode: 'manual',
    });
  });

  it('dry_run: false → dryRun=false explicite', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    await request(app).post('/api/admin/orders/o1/refund').send({
      dry_run: false, reason: 'erreur client', cash_mode: 'relais',
    });

    expect(mockRefundCancelledOrder).toHaveBeenCalledWith({
      orderId: 'o1',
      user: mockState.user,
      dryRun: false,
      reason: 'erreur client',
      cashMode: 'relais',
    });
  });

  it('dry_run: true explicite reste dryRun=true', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    await request(app).post('/api/admin/orders/o1/refund').send({ dry_run: true });
    expect(mockRefundCancelledOrder).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('propage le status/body renvoyés par le service (ex: 409 conflit)', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 409, body: { error: 'déjà remboursée' } });
    const res = await request(app).post('/api/admin/orders/o1/refund').send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'déjà remboursée' });
  });

  it('erreur → next(err) → 500', async () => {
    mockRefundCancelledOrder.mockRejectedValueOnce(new Error('service refund indisponible'));
    const res = await request(app).post('/api/admin/orders/o1/refund').send({});
    expect(res.status).toBe(500);
  });
});

describe('admin/orders — N27 remainder liability',()=>{
  it('readiness remains off unless the explicit staging flag is on',async()=>{
    let res=await request(app).get('/api/admin/orders/n27-remnant-readiness');
    expect(res.body).toEqual({enabled:false});
    process.env.N27_REMNANT_RESERVATIONS_ENABLED='1';
    res=await request(app).get('/api/admin/orders/n27-remnant-readiness');
    expect(res.body).toEqual({enabled:true});
  });
  it('context is admin-only and read-only behind explicit staging flag',async()=>{
    process.env.N27_REMNANT_RESERVATIONS_ENABLED='1';
    mockReadN27RemnantContext.mockResolvedValueOnce({order:{reference:'K0N27A'},items:[],candidates:[]});
    const res=await request(app).get('/api/admin/orders/K0N27A/n27-remnant-context');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockReadN27RemnantContext).toHaveBeenCalledWith({orderReference:'K0N27A',actor:mockState.user});
  });
  it('reservation passes only validated body fields to the owner service and stays pending',async()=>{
    process.env.N27_REMNANT_RESERVATIONS_ENABLED='1';
    mockReserveN27Remnant.mockResolvedValueOnce({reservationId:'r27',status:'reserved',paid:false});
    const payload={incident_id:'incident-1',quantity:1,operation_key:'key-1',reason:'Missing at relay'};
    const res=await request(app).post('/api/admin/orders/order-1/items/item-1/n27-remnant-reservations').send(payload);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({reservationId:'r27',status:'reserved',paid:false});
    expect(mockReserveN27Remnant).toHaveBeenCalledWith({orderId:'order-1',orderItemId:'item-1',
      incidentId:'incident-1',quantity:1,operationKey:'key-1',reason:'Missing at relay',actor:mockState.user});
  });
  it('disabled endpoint refuses mutation before calling the financial service',async()=>{
    const res=await request(app).post('/api/admin/orders/order-1/items/item-1/n27-remnant-reservations').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('N27_RESERVATIONS_NOT_CERTIFIED');
    expect(mockReserveN27Remnant).not.toHaveBeenCalled();
  });
  it('does not enable the N27 writer outside staging even if the flag is set',async()=>{
    process.env.KOMERCE_ENV='production';
    process.env.N27_REMNANT_RESERVATIONS_ENABLED='1';
    const res=await request(app).post('/api/admin/orders/order-1/items/item-1/n27-remnant-reservations').send({});
    expect(res.status).toBe(409);
    expect(mockReserveN27Remnant).not.toHaveBeenCalled();
  });
});

describe('admin/orders — N26a item refund candidate context',()=>{
  const saveFlags=()=>Object.fromEntries(['KOMERCE_ENV','E7_ITEM_RESERVATIONS_ENABLED',
    'E7_SANDBOX_REFUND_EXECUTION_ENABLED','STRIPE_SECRET_KEY','PAYPAL_ENV',
    'PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET'].map(k=>[k,process.env[k]]));
  const restoreFlags=previous=>Object.entries(previous).forEach(([k,v])=>{
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  });
  it('serves the admin candidate projection only with both staging sandbox gates enabled',async()=>{
    const previous=saveFlags();process.env.KOMERCE_ENV='staging';
    process.env.E7_ITEM_RESERVATIONS_ENABLED='1';process.env.E7_SANDBOX_REFUND_EXECUTION_ENABLED='1';
    process.env.STRIPE_SECRET_KEY='sk_test_unit';
    mockReadVerifiedShortageCandidates.mockResolvedValue({order:{id:'o1',reference:'K1FOWL5',payment_mode:'stripe_eur'},items:[],candidates:[],blocked:false});
    try{
      const ready=await request(app).get('/api/admin/orders/item-refund-readiness');
      expect(ready.body).toEqual({enabled:true});
      const res=await request(app).get('/api/admin/orders/K1FOWL5/item-refund-context');
      expect(res.status).toBe(200);expect(res.headers['cache-control']).toContain('no-store');
      expect(mockReadVerifiedShortageCandidates).toHaveBeenCalledWith({orderReference:'K1FOWL5',actor:mockState.user});
    }finally{restoreFlags(previous);}
  });
  it('fails closed before reading when sandbox execution is disabled',async()=>{
    const previous=saveFlags();process.env.KOMERCE_ENV='staging';
    process.env.E7_ITEM_RESERVATIONS_ENABLED='1';delete process.env.E7_SANDBOX_REFUND_EXECUTION_ENABLED;
    try{
      const ready=await request(app).get('/api/admin/orders/item-refund-readiness');
      expect(ready.body).toEqual({enabled:false});
      const res=await request(app).get('/api/admin/orders/K1FOWL5/item-refund-context');
      expect(res.status).toBe(409);expect(res.body.code).toBe('E7_SANDBOX_PSP_DISABLED');
      expect(mockReadVerifiedShortageCandidates).not.toHaveBeenCalled();
    }finally{restoreFlags(previous);}
  });
});
