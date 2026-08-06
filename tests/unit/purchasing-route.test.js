'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/purchasing-route.test.js
 *
 * Tests dédiés du ROUTER routes/purchasing.js (Lot C, AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md).
 *
 * Contexte : routes/purchasing.js était à 0 % — aucun test dédié.
 * tests/unit/purchasing.test.js existant ne couvre que les SERVICES
 * (purchasing-trigger-service, purchasing-receive-service), jamais la
 * couche HTTP du router. Ce fichier ferme ce trou : guards auth/rôle,
 * parsing query/body, construction SQL conditionnelle (WHERE dynamique),
 * délégation aux services admin (delete/confirm/cancel), et relais
 * status/body incluant les erreurs avec `err.status`.
 *
 * db.query est mocké directement (pas de DB réelle) ; les services
 * purchasing-admin-service / purchasing-receive-service / purchasing-trigger-service
 * sont mockés — leur logique métier est déjà testée ailleurs.
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé — rôle requis : ${roles.join(' ou ')}` });
    }
    next();
  },
}));

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../services/purchasing-trigger-service', () => ({
  triggerPurchasing: jest.fn(),
}));

jest.mock('../../services/purchasing-receive-service', () => ({
  processReceive: jest.fn(),
}));

jest.mock('../../services/purchasing-admin-service', () => ({
  deleteSupplier: jest.fn(),
  confirmPurchaseOrder: jest.fn(),
  cancelPurchaseOrder: jest.fn(),
}));

const db = require('../../db');
const { processReceive } = require('../../services/purchasing-receive-service');
const {
  deleteSupplier,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
} = require('../../services/purchasing-admin-service');

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
    const router = require('../../routes/purchasing');
    app.use('/api/purchasing', router);
  });
});

describe('purchasing route — accès', () => {
  it('401 si pas authentifié', async () => {
    currentUser = undefined;
    const res = await request(app).get('/api/purchasing');
    expect(res.status).toBe(401);
  });

  it('403 si rôle non-admin', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/purchasing');
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/purchasing — pipeline sourcing', () => {
  it('sans filtre status : WHERE 1=1, params vides', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/purchasing');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ purchase_orders: [], total: 0 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/po\.status = \$/);
    expect(params).toEqual([]);
  });

  it('avec filtre status : condition + param ajoutés', async () => {
    const rows = [{ id: 'po1', status: 'pending' }];
    db.query.mockResolvedValueOnce({ rows });
    const res = await request(app).get('/api/purchasing?status=pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ purchase_orders: rows, total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/po\.status = \$1/);
    expect(params).toEqual(['pending']);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/purchasing');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/purchasing/suppliers', () => {
  it('sans filtre : masque api_key_enc/api_secret_enc, ajoute has_api_key', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 's1', name: 'Fournisseur A', api_key_enc: 'secret-key', api_secret_enc: 'secret-val' },
        { id: 's2', name: 'Fournisseur B', api_key_enc: null, api_secret_enc: null },
      ],
    });
    const res = await request(app).get('/api/purchasing/suppliers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 's1', name: 'Fournisseur A', has_api_key: true },
      { id: 's2', name: 'Fournisseur B', has_api_key: false },
    ]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/platform = \$/);
    expect(sql).not.toMatch(/is_active = \$/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual([]);
  });

  it('filtre platform : condition + param ajoutés', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/purchasing/suppliers?platform=alibaba');
    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/platform = \$1/);
    expect(params).toEqual(['alibaba']);
  });

  it('filtre active=true : converti en booléen', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/purchasing/suppliers?active=true');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/is_active = \$1/);
    expect(params).toEqual([true]);
  });

  it('filtre active=false : converti en booléen', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/purchasing/suppliers?active=false');
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([false]);
  });

  it('platform + active combinés : deux conditions, deux params dans l\'ordre', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/purchasing/suppliers?platform=alibaba&active=true');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/platform = \$1/);
    expect(sql).toMatch(/is_active = \$2/);
    expect(params).toEqual(['alibaba', true]);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/purchasing/suppliers');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/purchasing/suppliers — créer un fournisseur', () => {
  it('400 si name manquant', async () => {
    const res = await request(app).post('/api/purchasing/suppliers').send({ platform: 'alibaba' });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('400 si platform manquant', async () => {
    const res = await request(app).post('/api/purchasing/suppliers').send({ name: 'Fournisseur A' });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('201 + valeurs par défaut (auto_order=false, lead_time_days=2) si non fournies', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 's1', name: 'Fournisseur A', platform: 'alibaba' }] });
    const res = await request(app)
      .post('/api/purchasing/suppliers')
      .send({ name: 'Fournisseur A', platform: 'alibaba' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 's1', name: 'Fournisseur A', platform: 'alibaba' });
    const [, params] = db.query.mock.calls[0];
    // name, platform, contact_name, contact_phone, contact_email, api_key_enc, api_secret_enc, account_id, auto_order, lead_time_days, notes
    expect(params[8]).toBe(false);
    expect(params[9]).toBe(2);
  });

  it('respecte auto_order/lead_time_days fournis explicitement', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 's1' }] });
    await request(app)
      .post('/api/purchasing/suppliers')
      .send({ name: 'A', platform: 'x', auto_order: true, lead_time_days: 5 });
    const [, params] = db.query.mock.calls[0];
    expect(params[8]).toBe(true);
    expect(params[9]).toBe(5);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/purchasing/suppliers').send({ name: 'A', platform: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/purchasing/suppliers/:id/map — mapper produit → fournisseur', () => {
  it('400 si product_id manquant', async () => {
    const res = await request(app)
      .post('/api/purchasing/suppliers/s1/map')
      .send({ supplier_sku: 'SKU1', supplier_price_aed: 10 });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('400 si supplier_sku manquant', async () => {
    const res = await request(app)
      .post('/api/purchasing/suppliers/s1/map')
      .send({ product_id: 'p1', supplier_price_aed: 10 });
    expect(res.status).toBe(400);
  });

  it('400 si supplier_price_aed manquant', async () => {
    const res = await request(app)
      .post('/api/purchasing/suppliers/s1/map')
      .send({ product_id: 'p1', supplier_sku: 'SKU1' });
    expect(res.status).toBe(400);
  });

  it('201 + valeurs par défaut (min_order_qty=1, priority=1) si non fournies', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'map1' }] });
    const res = await request(app)
      .post('/api/purchasing/suppliers/s1/map')
      .send({ product_id: 'p1', supplier_sku: 'SKU1', supplier_price_aed: 10 });
    expect(res.status).toBe(201);
    const [, params] = db.query.mock.calls[0];
    // product_id, supplier.id(params), supplier_sku, supplier_url, supplier_price_aed, min_order_qty, priority, notes
    expect(params[0]).toBe('p1');
    expect(params[1]).toBe('s1');
    expect(params[5]).toBe(1); // min_order_qty
    expect(params[6]).toBe(1); // priority
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .post('/api/purchasing/suppliers/s1/map')
      .send({ product_id: 'p1', supplier_sku: 'SKU1', supplier_price_aed: 10 });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/purchasing/suppliers/:id', () => {
  it('délègue à deleteSupplier(id, forceDelete=false) par défaut', async () => {
    deleteSupplier.mockResolvedValueOnce({ deleted: true, id: 's1' });
    const res = await request(app).delete('/api/purchasing/suppliers/s1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, id: 's1' });
    expect(deleteSupplier).toHaveBeenCalledWith('s1', false);
  });

  it('x-force-delete: true → forceDelete=true', async () => {
    deleteSupplier.mockResolvedValueOnce({ deleted: true, id: 's1', forced: true });
    await request(app).delete('/api/purchasing/suppliers/s1').set('x-force-delete', 'true');
    expect(deleteSupplier).toHaveBeenCalledWith('s1', true);
  });

  it('erreur avec err.status → relayée telle quelle', async () => {
    const err = new Error('Fournisseur encore référencé');
    err.status = 409;
    deleteSupplier.mockRejectedValueOnce(err);
    const res = await request(app).delete('/api/purchasing/suppliers/s1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Fournisseur encore référencé' });
  });

  it('erreur sans err.status → next(err) → 500', async () => {
    deleteSupplier.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).delete('/api/purchasing/suppliers/s1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/purchasing/order/:order_id/completeness', () => {
  it('404 si aucune PO pour la commande', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/purchasing/order/o1/completeness');
    expect(res.status).toBe(404);
  });

  it('complete=true si toutes les PO sont hub_received ou cancelled', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'po1', status: 'hub_received', ordered: 10, received: 10 },
        { id: 'po2', status: 'cancelled', ordered: 5, received: 0 },
      ],
    });
    const res = await request(app).get('/api/purchasing/order/o1/completeness');
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.any_pending).toBe(false);
    expect(res.body.total_ordered).toBe(15);
    expect(res.body.total_received).toBe(10);
    expect(res.body.total_remaining).toBe(5);
  });

  it('any_pending=true si au moins une PO en pending/notified/confirmed/shipped', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'po1', status: 'shipped', ordered: 10, received: 0 },
      ],
    });
    const res = await request(app).get('/api/purchasing/order/o1/completeness');
    expect(res.body.complete).toBe(false);
    expect(res.body.any_pending).toBe(true);
  });

  it('ordered/received manquants → traités comme 0 (COALESCE)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'po1', status: 'hub_received', ordered: undefined, received: undefined }],
    });
    const res = await request(app).get('/api/purchasing/order/o1/completeness');
    expect(res.body.total_ordered).toBe(0);
    expect(res.body.total_received).toBe(0);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/purchasing/order/o1/completeness');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/purchasing/:order_id', () => {
  it('retourne les achats liés à la commande', async () => {
    const rows = [{ id: 'po1', supplier_name: 'Fournisseur A' }];
    db.query.mockResolvedValueOnce({ rows });
    const res = await request(app).get('/api/purchasing/o1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(db.query.mock.calls[0][1]).toEqual(['o1']);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/purchasing/o1');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/purchasing/:order_id/confirm', () => {
  it('400 si purchase_order_id manquant', async () => {
    const res = await request(app).post('/api/purchasing/o1/confirm').send({});
    expect(res.status).toBe(400);
    expect(confirmPurchaseOrder).not.toHaveBeenCalled();
  });

  it('délègue à confirmPurchaseOrder avec les bons arguments', async () => {
    confirmPurchaseOrder.mockResolvedValueOnce({ confirmed: true, po_id: 'po1' });
    const res = await request(app)
      .post('/api/purchasing/o1/confirm')
      .send({ purchase_order_id: 'po1', tracking_number: 'TRK1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ confirmed: true, po_id: 'po1' });
    expect(confirmPurchaseOrder).toHaveBeenCalledWith('po1', 'o1', { purchase_order_id: 'po1', tracking_number: 'TRK1' });
  });

  it('erreur avec err.status → relayée avec current_status', async () => {
    const err = new Error('PO déjà confirmée');
    err.status = 409;
    err.current_status = 'confirmed';
    confirmPurchaseOrder.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/api/purchasing/o1/confirm')
      .send({ purchase_order_id: 'po1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'PO déjà confirmée', current_status: 'confirmed' });
  });

  it('erreur sans err.status → next(err) → 500', async () => {
    confirmPurchaseOrder.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .post('/api/purchasing/o1/confirm')
      .send({ purchase_order_id: 'po1' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/purchasing/:id/receive', () => {
  it('qty_recue absent → null transmis, délégation à processReceive', async () => {
    processReceive.mockResolvedValueOnce({ received: true });
    const res = await request(app).post('/api/purchasing/po1/receive').send({});
    expect(res.status).toBe(200);
    expect(processReceive).toHaveBeenCalledWith({ id: 'po1', qty_recue: null, actor: currentUser });
  });

  it('qty_recue vide/null → null transmis', async () => {
    processReceive.mockResolvedValueOnce({ received: true });
    await request(app).post('/api/purchasing/po1/receive').send({ qty_recue: '' });
    expect(processReceive).toHaveBeenCalledWith({ id: 'po1', qty_recue: null, actor: currentUser });
  });

  it('qty_recue valide → parseInt transmis', async () => {
    processReceive.mockResolvedValueOnce({ received: true });
    await request(app).post('/api/purchasing/po1/receive').send({ qty_recue: '7' });
    expect(processReceive).toHaveBeenCalledWith({ id: 'po1', qty_recue: 7, actor: currentUser });
  });

  it('qty_recue non-numérique → 400, processReceive jamais appelé', async () => {
    const res = await request(app).post('/api/purchasing/po1/receive').send({ qty_recue: 'abc' });
    expect(res.status).toBe(400);
    expect(processReceive).not.toHaveBeenCalled();
  });

  it('qty_recue négatif → 400', async () => {
    const res = await request(app).post('/api/purchasing/po1/receive').send({ qty_recue: -1 });
    expect(res.status).toBe(400);
    expect(processReceive).not.toHaveBeenCalled();
  });

  it('result.httpError → status/error relayés', async () => {
    processReceive.mockResolvedValueOnce({ httpError: { status: 400, error: 'PO déjà entièrement reçue' } });
    const res = await request(app).post('/api/purchasing/po1/receive').send({ qty_recue: '3' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'PO déjà entièrement reçue' });
  });

  it('erreur (throw) → next(err) → 500', async () => {
    processReceive.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/purchasing/po1/receive').send({});
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/purchasing/po/:po_id', () => {
  it('délègue à cancelPurchaseOrder(po_id, forceDelete=false) par défaut', async () => {
    cancelPurchaseOrder.mockResolvedValueOnce({ cancelled: true, po_id: 'po1' });
    const res = await request(app).delete('/api/purchasing/po/po1');
    expect(res.status).toBe(200);
    expect(cancelPurchaseOrder).toHaveBeenCalledWith('po1', false);
  });

  it('x-force-delete: true → forceDelete=true', async () => {
    cancelPurchaseOrder.mockResolvedValueOnce({ cancelled: true, po_id: 'po1' });
    await request(app).delete('/api/purchasing/po/po1').set('x-force-delete', 'true');
    expect(cancelPurchaseOrder).toHaveBeenCalledWith('po1', true);
  });

  it('erreur avec err.status → relayée avec current_status', async () => {
    const err = new Error('PO déjà reçue, annulation impossible');
    err.status = 409;
    err.current_status = 'hub_received';
    cancelPurchaseOrder.mockRejectedValueOnce(err);
    const res = await request(app).delete('/api/purchasing/po/po1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'PO déjà reçue, annulation impossible', current_status: 'hub_received' });
  });

  it('erreur sans err.status → next(err) → 500', async () => {
    cancelPurchaseOrder.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).delete('/api/purchasing/po/po1');
    expect(res.status).toBe(500);
  });
});
