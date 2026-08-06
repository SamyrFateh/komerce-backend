'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-catalog-approval-route.test.js
 *
 * Tests dédiés du ROUTER routes/admin/catalog-approval.js (K-4).
 *
 * Contexte (AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md, Lot B) :
 *   routes/admin/catalog-approval.js était à 35.71 % stmts / 0 % branch —
 *   « route K-4 livré ce jour — testé seulement indirectement, aucun test
 *   dédié ». tests/unit/catalog-approval.test.js existant n'appelle QUE
 *   services/catalog-approval.js directement (jamais le router HTTP) : ce
 *   fichier ferme ce trou en testant la couche route elle-même (guards
 *   auth/rôle, parsing des query params, délégation au service, mapping
 *   status/body, next(err) → 500).
 *
 * La logique métier (approve/reject/override) est déjà verrouillée par
 * tests/unit/catalog-approval.test.js — ici le service est mocké : on ne
 * teste que ce que le router fait par lui-même.
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`, your_role: req.user.role });
    }
    next();
  },
}));

jest.mock('../../services/catalog-approval', () => ({
  getApprovalQueue: jest.fn(),
  approveProduct: jest.fn(),
  rejectProduct: jest.fn(),
  overrideAndApprove: jest.fn(),
}));

const catalogApproval = require('../../services/catalog-approval');

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
    const router = require('../../routes/admin/catalog-approval');
    app.use('/api/admin', router);
  });
});

describe('admin-catalog-approval — accès', () => {
  it('401 si pas authentifié (req.user absent)', async () => {
    currentUser = undefined;
    const res = await request(app).get('/api/admin/catalog/approval-queue');
    expect(res.status).toBe(401);
  });

  it('403 si rôle non-admin', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/admin/catalog/approval-queue');
    expect(res.status).toBe(403);
    expect(catalogApproval.getApprovalQueue).not.toHaveBeenCalled();
  });
});

describe('admin-catalog-approval — GET /catalog/approval-queue', () => {
  it('valeurs par défaut : limit=50, offset=0 si aucun query param', async () => {
    catalogApproval.getApprovalQueue.mockResolvedValueOnce({ items: [], total: 0, limit: 50, offset: 0 });
    const res = await request(app).get('/api/admin/catalog/approval-queue');
    expect(res.status).toBe(200);
    expect(catalogApproval.getApprovalQueue).toHaveBeenCalledWith(undefined, { limit: 50, offset: 0 });
  });

  it('respecte limit/offset fournis en query', async () => {
    catalogApproval.getApprovalQueue.mockResolvedValueOnce({ items: [], total: 0, limit: 20, offset: 40 });
    const res = await request(app).get('/api/admin/catalog/approval-queue?limit=20&offset=40');
    expect(res.status).toBe(200);
    expect(catalogApproval.getApprovalQueue).toHaveBeenCalledWith(undefined, { limit: 20, offset: 40 });
  });

  it('plafonne limit à 200 même si une valeur plus grande est demandée', async () => {
    catalogApproval.getApprovalQueue.mockResolvedValueOnce({ items: [], total: 0, limit: 200, offset: 0 });
    const res = await request(app).get('/api/admin/catalog/approval-queue?limit=9999');
    expect(res.status).toBe(200);
    expect(catalogApproval.getApprovalQueue).toHaveBeenCalledWith(undefined, { limit: 200, offset: 0 });
  });

  it('limit/offset non-numériques → fallback sur les valeurs par défaut', async () => {
    catalogApproval.getApprovalQueue.mockResolvedValueOnce({ items: [], total: 0, limit: 50, offset: 0 });
    const res = await request(app).get('/api/admin/catalog/approval-queue?limit=abc&offset=xyz');
    expect(res.status).toBe(200);
    expect(catalogApproval.getApprovalQueue).toHaveBeenCalledWith(undefined, { limit: 50, offset: 0 });
  });

  it('renvoie tel quel le résultat du service', async () => {
    const payload = { items: [{ id: 'p1' }], total: 1, limit: 50, offset: 0 };
    catalogApproval.getApprovalQueue.mockResolvedValueOnce(payload);
    const res = await request(app).get('/api/admin/catalog/approval-queue');
    expect(res.body).toEqual(payload);
  });

  it('erreur service → next(err) → 500', async () => {
    catalogApproval.getApprovalQueue.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/catalog/approval-queue');
    expect(res.status).toBe(500);
  });
});

describe('admin-catalog-approval — POST /catalog/approval-queue/:id/approve', () => {
  it('délègue à approveProduct avec id + req.user, et reflète status/body', async () => {
    catalogApproval.approveProduct.mockResolvedValueOnce({ status: 200, body: { id: 'p1', is_active: true } });
    const res = await request(app).post('/api/admin/catalog/approval-queue/p1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'p1', is_active: true });
    expect(catalogApproval.approveProduct).toHaveBeenCalledWith(undefined, 'p1', currentUser);
  });

  it('404 si le produit est introuvable (relayé depuis le service)', async () => {
    catalogApproval.approveProduct.mockResolvedValueOnce({ status: 404, body: { error: 'Produit introuvable' } });
    const res = await request(app).post('/api/admin/catalog/approval-queue/p404/approve');
    expect(res.status).toBe(404);
  });

  it('409 si déjà décidé (relayé depuis le service)', async () => {
    catalogApproval.approveProduct.mockResolvedValueOnce({ status: 409, body: { error: 'Candidat déjà décidé', code: 'not_pending' } });
    const res = await request(app).post('/api/admin/catalog/approval-queue/p1/approve');
    expect(res.status).toBe(409);
  });

  it('erreur service → next(err) → 500', async () => {
    catalogApproval.approveProduct.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/catalog/approval-queue/p1/approve');
    expect(res.status).toBe(500);
  });
});

describe('admin-catalog-approval — POST /catalog/approval-queue/:id/reject', () => {
  it('transmet req.body.reason au service', async () => {
    catalogApproval.rejectProduct.mockResolvedValueOnce({ status: 200, body: { id: 'p1', lifecycle_status: 'rejected' } });
    const res = await request(app)
      .post('/api/admin/catalog/approval-queue/p1/reject')
      .send({ reason: 'Photo floue' });
    expect(res.status).toBe(200);
    expect(catalogApproval.rejectProduct).toHaveBeenCalledWith(undefined, 'p1', { reason: 'Photo floue' }, currentUser);
  });

  it('reason absent du body → transmis comme undefined (validation déléguée au service)', async () => {
    catalogApproval.rejectProduct.mockResolvedValueOnce({ status: 400, body: { error: 'Raison de rejet obligatoire' } });
    const res = await request(app).post('/api/admin/catalog/approval-queue/p1/reject').send({});
    expect(res.status).toBe(400);
    expect(catalogApproval.rejectProduct).toHaveBeenCalledWith(undefined, 'p1', { reason: undefined }, currentUser);
  });

  it('erreur service → next(err) → 500', async () => {
    catalogApproval.rejectProduct.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/catalog/approval-queue/p1/reject').send({ reason: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('admin-catalog-approval — POST /catalog/approval-queue/:id/override', () => {
  it('transmet req.body.fields et req.body.reason au service', async () => {
    catalogApproval.overrideAndApprove.mockResolvedValueOnce({
      status: 200,
      body: { id: 'p1', is_active: true, overridden: ['price_kmf'] },
    });
    const res = await request(app)
      .post('/api/admin/catalog/approval-queue/p1/override')
      .send({ fields: { price_kmf: 12000 }, reason: 'Prix corrigé' });
    expect(res.status).toBe(200);
    expect(res.body.overridden).toEqual(['price_kmf']);
    expect(catalogApproval.overrideAndApprove).toHaveBeenCalledWith(
      undefined, 'p1', { fields: { price_kmf: 12000 }, reason: 'Prix corrigé' }, currentUser
    );
  });

  it('422 si champ hors whitelist (relayé depuis le service)', async () => {
    catalogApproval.overrideAndApprove.mockResolvedValueOnce({
      status: 422,
      body: { error: 'Champ non autorisé', code: 'OVERRIDE_FIELD_NOT_ALLOWED' },
    });
    const res = await request(app)
      .post('/api/admin/catalog/approval-queue/p1/override')
      .send({ fields: { forbidden_field: 'x' } });
    expect(res.status).toBe(422);
  });

  it('400 si fields absent → transmis tel quel (validation déléguée au service)', async () => {
    catalogApproval.overrideAndApprove.mockResolvedValueOnce({ status: 400, body: { error: 'Aucun champ à corriger fourni' } });
    const res = await request(app).post('/api/admin/catalog/approval-queue/p1/override').send({});
    expect(res.status).toBe(400);
    expect(catalogApproval.overrideAndApprove).toHaveBeenCalledWith(
      undefined, 'p1', { fields: undefined, reason: undefined }, currentUser
    );
  });

  it('erreur service → next(err) → 500', async () => {
    catalogApproval.overrideAndApprove.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .post('/api/admin/catalog/approval-queue/p1/override')
      .send({ fields: { price_kmf: 1 } });
    expect(res.status).toBe(500);
  });
});
