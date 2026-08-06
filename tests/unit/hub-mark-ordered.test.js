'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = req.headers['x-test-user']
      ? JSON.parse(req.headers['x-test-user'])
      : { id: 'hub-user-1', role: 'agent_hub' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const router = require('../../routes/hub-mark-ordered');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hub', router);
  // error handler minimal, comme bootstrap/api-routes en prod
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe('POST /api/hub/orders/mark-ordered', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejette une requete sans reference (400)', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/hub/orders/mark-ordered').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reference requis');
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('retourne 404 si la commande est introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const app = buildApp();
    const res = await request(app).post('/api/hub/orders/mark-ordered').send({ reference: 'K000000' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Commande introuvable');
  });

  it("refuse la transition si la commande n'est pas au statut confirmed", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', status: 'pending', reference: 'K000001' }],
    });
    const app = buildApp();
    const res = await request(app).post('/api/hub/orders/mark-ordered').send({ reference: 'K000001' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('statut actuel: pending');
    expect(mockTransitionOrderStatus).not.toHaveBeenCalled();
  });

  it('transitionne confirmed -> ordered et journalise un commentaire (non bloquant)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'confirmed', reference: 'K000002' }] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }); // INSERT order_comments
    mockTransitionOrderStatus.mockResolvedValue({ success: true });

    const app = buildApp();
    const res = await request(app).post('/api/hub/orders/mark-ordered').send({ reference: 'K000002' });

    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', newStatus: 'ordered', source: 'hub_mark_ordered' })
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Commande K000002 envoyée au sourcing',
      status: 'ordered',
      reference: 'K000002',
    });
  });

  it("renvoie l'erreur de la machine a etats si la transition echoue", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'confirmed', reference: 'K000003' }] });
    mockTransitionOrderStatus.mockResolvedValue({ success: false, error: 'transition_interdite' });

    const app = buildApp();
    const res = await request(app).post('/api/hub/orders/mark-ordered').send({ reference: 'K000003' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('transition_interdite');
  });

  it("ne fait pas echouer la requete si l'insertion du commentaire echoue (non-critical)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'confirmed', reference: 'K000004' }] })
      .mockRejectedValueOnce(new Error('insert failed'));
    mockTransitionOrderStatus.mockResolvedValue({ success: true });

    const app = buildApp();
    const res = await request(app).post('/api/hub/orders/mark-ordered').send({ reference: 'K000004' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ordered');
  });
});
