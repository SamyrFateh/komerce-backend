'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/modules.test.js
 * Couvre routes/modules.js
 *
 * Route volumineuse (registre de modules + calcul de prix multi-sous-types).
 * On teste les endpoints principaux (liste, détail, fabrics, models, price)
 * + la garde admin sur les routes de mutation (POST /fabrics, POST /models).
 */

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../validators', () => ({
  modules: { calculatePrice: {}, createFabric: {}, createModel: {} },
}));

const mockGetRates = jest.fn();
jest.mock('../../utils/rates', () => ({ getRates: (...args) => mockGetRates(...args) }));

const mockPricingRecommend = jest.fn();
jest.mock('../../services/pricing-engine', () => ({ recommend: (...args) => mockPricingRecommend(...args) }));

const modulesRouter = require('../../routes/modules');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/modules', modulesRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

const RATES = { eur_kmf: 500, aed_kmf: 130 };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
  mockGetRates.mockResolvedValue(RATES);
});

describe('GET /api/modules — liste', () => {
  it("pas d'auth requise → 200", async () => {
    const res = await request(buildApp()).get('/api/modules');
    expect(res.status).toBe(200);
  });

  it('renvoie les 4 modules du registre avec leurs champs publics', async () => {
    const res = await request(buildApp()).get('/api/modules');
    expect(res.body.total).toBe(4);
    const types = res.body.modules.map(m => m.type);
    expect(types).toEqual(expect.arrayContaining(['couture', 'lunettes', 'construction', 'cosmetiques']));
    const couture = res.body.modules.find(m => m.type === 'couture');
    expect(couture).toMatchObject({ label: expect.any(String), disponible: true, phase: 1 });
  });
});

describe('GET /api/modules/:type — détail', () => {
  it('module existant → 200 + détail complet', async () => {
    const res = await request(buildApp()).get('/api/modules/couture');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('couture');
    expect(res.body.disponible).toBe(true);
  });

  it('module inconnu → 404 + liste des modules disponibles', async () => {
    const res = await request(buildApp()).get('/api/modules/teleportation');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/teleportation/);
    expect(res.body.modules_disponibles).toEqual(expect.arrayContaining(['couture', 'lunettes']));
  });
});

describe('GET /api/modules/fabrics', () => {
  it('sans filtre → 200 + tableau, where minimal', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Wax Hollandais' }] });
    const res = await request(buildApp()).get('/api/modules/fabrics');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'f1', name: 'Wax Hollandais' }]);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('fabric_type = $2');
    expect(params).toEqual([]);
  });

  it('avec ?fabric_type → ajoute la condition et le paramètre', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/modules/fabrics?fabric_type=Wax');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('f.fabric_type = $1');
    expect(params).toEqual(['Wax']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/modules/fabrics');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/modules/models', () => {
  it('200 + tableau de modèles actifs', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Robe Wax' }] });
    const res = await request(buildApp()).get('/api/modules/models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'm1', name: 'Robe Wax' }]);
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('FROM garment_models'));
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/modules/models');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/modules/price — validation générale', () => {
  it('module_type absent → 400', async () => {
    const res = await request(buildApp()).post('/api/modules/price').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/module_type requis/);
  });

  it('module_type invalide (hors registre) → 400', async () => {
    const res = await request(buildApp()).post('/api/modules/price').send({ module_type: 'teleportation' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/module_type invalide/);
  });
});

describe('POST /api/modules/price — couture / ready_made', () => {
  it('product_id manquant → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'ready_made' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/product_id requis/);
  });

  it('produit introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'ready_made', product_id: 'p1' });
    expect(res.status).toBe(404);
  });

  it('nominal → total = price_kmf * qty, conversion EUR', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Boubou', price_kmf: 10000 }] });
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'ready_made', product_id: 'p1', qty: 2 });
    expect(res.status).toBe(200);
    expect(res.body.total_kmf).toBe(20000);
    expect(res.body.total_eur).toBe(40); // 20000/500
    expect(res.body.detail).toEqual({ product_name: 'Boubou' });
  });
});

describe('POST /api/modules/price — couture / fabric_only', () => {
  it('fabric_id manquant → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'fabric_only', qty_meters: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fabric_id requis/);
  });

  it('qty_meters manquant → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'fabric_only', fabric_id: 'f1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/qty_meters requis/);
  });

  it('tissu introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'fabric_only', fabric_id: 'f1', qty_meters: 2 });
    expect(res.status).toBe(404);
  });

  it('nominal avec price_per_meter_kmf direct → calcule tissu + accessoires', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'f1', name: 'Wax', fabric_type: 'Wax', price_per_meter_kmf: 5000, price_per_meter_aed: null }],
    });
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'fabric_only', fabric_id: 'f1', qty_meters: 3, accessories: ['boutons'] });
    expect(res.status).toBe(200);
    // tissu = 5000 * 3 = 15000, acc = 1 * 15000 * 0.10 = 1500, total = 16500
    expect(res.body.tissu_kmf).toBe(15000);
    expect(res.body.accessories_kmf).toBe(1500);
    expect(res.body.total_kmf).toBe(16500);
    expect(res.body.detail).toEqual({ fabric_name: 'Wax', fabric_type: 'Wax' });
  });

  it('sans price_per_meter_kmf → derive depuis price_per_meter_aed * taux', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'f1', name: 'Bazin', fabric_type: 'Bazin', price_per_meter_kmf: null, price_per_meter_aed: '40' }],
    });
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'fabric_only', fabric_id: 'f1', qty_meters: 2, accessories: [] });
    expect(res.status).toBe(200);
    // price_per_meter_kmf = round(40 * 130) = 5200, tissu = 5200*2=10400, acc=0
    expect(res.body.price_per_meter_kmf).toBe(5200);
    expect(res.body.tissu_kmf).toBe(10400);
    expect(res.body.accessories_kmf).toBe(0);
  });
});

describe('POST /api/modules/price — couture / custom_from_fabric', () => {
  it('fabric_id manquant → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'custom_from_fabric', model_id: 'm1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fabric_id requis/);
  });

  it('model_id manquant → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'custom_from_fabric', fabric_id: 'f1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model_id requis/);
  });

  it('tissu introuvable → 404', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // fabric
      .mockResolvedValueOnce({ rows: [{ id: 'm1' }] }); // model
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'custom_from_fabric', fabric_id: 'f1', model_id: 'm1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Tissu introuvable/);
  });

  it('modèle introuvable → 404', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'f1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'custom_from_fabric', fabric_id: 'f1', model_id: 'm1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Modèle introuvable/);
  });

  it('nominal → délègue à pricingEngine.recommend avec le bon canal et bon prix d\'achat', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Wax', fabric_type: 'Wax', price_per_meter_aed: '40' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Robe', fabric_meters: '2', making_cost_aed: '50' }] });
    mockPricingRecommend.mockResolvedValue({ survival_price_kmf: 9000, recommended_price_kmf: 12000 });

    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'custom_from_fabric', fabric_id: 'f1', model_id: 'm1', qty: 1, is_diaspora: false });

    expect(res.status).toBe(200);
    expect(mockPricingRecommend).toHaveBeenCalledWith(expect.objectContaining({
      virtual: true,
      price_aed: 40 * 2 + 50, // 130
      category: 'couture',
      channel: 'cash_relais',
    }));
    expect(res.body.recommended_price_kmf).toBe(12000);
    expect(res.body.detail).toMatchObject({ fabric_name: 'Wax', model_name: 'Robe' });
  });

  it('is_diaspora:true → canal "diaspora"', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Wax', fabric_type: 'Wax', price_per_meter_aed: '40' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Robe', fabric_meters: '2', making_cost_aed: '50' }] });
    mockPricingRecommend.mockResolvedValue({});

    await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'custom_from_fabric', fabric_id: 'f1', model_id: 'm1', is_diaspora: true });

    expect(mockPricingRecommend).toHaveBeenCalledWith(expect.objectContaining({ channel: 'diaspora' }));
  });

  it('module_order_type invalide pour couture → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture', module_order_type: 'on_demand_magique' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/module_order_type invalide/);
  });

  it('module_order_type absent pour couture → 400', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'couture' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/module_order_type requis/);
  });
});

describe('POST /api/modules/price — lunettes / construction / cosmetiques', () => {
  it('lunettes → fourchette indicative en KMF et EUR', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'lunettes', module_instructions: 'monture ronde' });
    expect(res.status).toBe(200);
    expect(res.body.fourchette_min_kmf).toBe(Math.round(80 * 130));
    expect(res.body.fourchette_max_kmf).toBe(Math.round(250 * 130));
    expect(res.body.instructions).toBe('monture ronde');
  });

  it('construction → note devis, instructions nullable', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'construction' });
    expect(res.status).toBe(200);
    expect(res.body.note).toMatch(/devis/);
    expect(res.body.instructions).toBeNull();
  });

  it('cosmetiques → note catalogue en construction', async () => {
    const res = await request(buildApp())
      .post('/api/modules/price')
      .send({ module_type: 'cosmetiques' });
    expect(res.status).toBe(200);
    expect(res.body.note).toMatch(/Catalogue/);
  });
});

describe('POST /api/modules/fabrics (admin)', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).post('/api/modules/fabrics').send({ name: 'Wax', price_per_meter_aed: 40 });
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/modules/fabrics').send({ name: 'Wax', price_per_meter_aed: 40 });
    expect(res.status).toBe(403);
  });

  it('name manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/modules/fabrics').send({ price_per_meter_aed: 40 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name requis/);
  });

  it('price_per_meter_aed manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/modules/fabrics').send({ name: 'Wax' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price_per_meter_aed requis/);
  });

  it('price_per_meter_aed non numérique ou négatif → 400', async () => {
    const r1 = await request(buildApp()).post('/api/modules/fabrics').send({ name: 'Wax', price_per_meter_aed: 'gratuit' });
    expect(r1.status).toBe(400);
    const r2 = await request(buildApp()).post('/api/modules/fabrics').send({ name: 'Wax', price_per_meter_aed: -10 });
    expect(r2.status).toBe(400);
  });

  it('nominal → 201, calcule price_per_meter_kmf et price_per_yard_kmf', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Wax', price_per_meter_kmf: 5200 }] });
    const res = await request(buildApp())
      .post('/api/modules/fabrics')
      .send({ name: 'Wax', price_per_meter_aed: 40 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'f1', name: 'Wax', price_per_meter_kmf: 5200 });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params[2]).toBe(40); // parsedPrice
    expect(params[4]).toBe(5200); // price_per_meter_kmf = round(40*130)
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(buildApp())
      .post('/api/modules/fabrics')
      .send({ name: 'Wax', price_per_meter_aed: 40 });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/modules/models (admin)', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/modules/models').send({ name: 'Robe', making_cost_aed: 50, fabric_meters: 2 });
    expect(res.status).toBe(403);
  });

  it('champs requis manquants → 400', async () => {
    const res = await request(buildApp()).post('/api/modules/models').send({ name: 'Robe' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requis/);
  });

  it('nominal → 201, modèle créé avec defaults sizes_available', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Robe' }] });
    const res = await request(buildApp())
      .post('/api/modules/models')
      .send({ name: 'Robe', making_cost_aed: 50, fabric_meters: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'm1', name: 'Robe' });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(['Robe', 50, 2, [], ['S', 'M', 'L', 'XL', 'XXL'], null]);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(buildApp())
      .post('/api/modules/models')
      .send({ name: 'Robe', making_cost_aed: 50, fabric_meters: 2 });
    expect(res.status).toBe(500);
  });
});
