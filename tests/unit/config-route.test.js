'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/config-route.test.js
 *
 * Tests du router routes/config.js (admin — règles métier configurables)
 *
 * Couverture :
 *   ✓ auth : authenticate + requireRole(['admin']) montés sur tout le router
 *   ✓ GET /rules → getAllRules()
 *   ✓ GET /rules/:key → 404 si règle introuvable, sinon détail + historique tronqué à 10
 *   ✓ PUT /rules/:key → 400 si value manquant
 *   ✓ PUT /rules/:key → succès → updateRule() + réponse formatée
 *   ✓ PUT /rules/:key → erreurs métier (min/max/type/introuvable) → 422
 *   ✓ PUT /rules/:key → autre erreur → next(err) → 500 générique
 *   ✓ POST /rules/:key/reset → succès, et 404 si "introuvable"
 *   ✓ GET /rules/:key/history → 404 si règle introuvable, sinon historique formaté
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../validators', () => ({
  config: { updateRule: {} },
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockGetAllRules = jest.fn();
const mockGetRuleByKey = jest.fn();
const mockUpdateRule = jest.fn();
const mockResetRule = jest.fn();
const mockGetRuleHistory = jest.fn();

jest.mock('../../utils/rules', () => ({
  getAllRules: (...a) => mockGetAllRules(...a),
  getRuleByKey: (...a) => mockGetRuleByKey(...a),
  updateRule: (...a) => mockUpdateRule(...a),
  resetRule: (...a) => mockResetRule(...a),
  getRuleHistory: (...a) => mockGetRuleHistory(...a),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/config');
    app.use('/api/config', router);
  });
  // error handler minimal pour capter next(err)
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
});

describe('routes/config — GET /rules', () => {
  it('renvoie les catégories via getAllRules()', async () => {
    mockGetAllRules.mockResolvedValueOnce([{ category: 'shipping', rules: [] }]);

    const res = await request(app).get('/api/config/rules');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ categories: [{ category: 'shipping', rules: [] }] });
  });

  it('propage une erreur inattendue vers le error handler (500)', async () => {
    mockGetAllRules.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/api/config/rules');

    expect(res.status).toBe(500);
  });
});

describe('routes/config — GET /rules/:key', () => {
  it('404 si la règle est introuvable', async () => {
    mockGetRuleByKey.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/config/rules/unknown_key');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Règle introuvable');
  });

  it('renvoie le détail formaté avec historique tronqué à 10 entrées', async () => {
    mockGetRuleByKey.mockResolvedValueOnce({
      key: 'sla_days', category: 'ops', label_fr: 'SLA', description: 'desc',
      value: { value: 21 }, value_type: 'int', min_value: '1', max_value: '90',
      is_active: true, updated_at: '2026-01-01', created_at: '2025-01-01',
    });
    const history = Array.from({ length: 15 }, (_, i) => ({ id: i }));
    mockGetRuleHistory.mockResolvedValueOnce(history);

    const res = await request(app).get('/api/config/rules/sla_days');

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('sla_days');
    expect(res.body.value).toBe(21);
    expect(res.body.min_value).toBe(1);
    expect(res.body.max_value).toBe(90);
    expect(res.body.history).toHaveLength(10);
  });

  it('min_value/max_value sont null si absents', async () => {
    mockGetRuleByKey.mockResolvedValueOnce({
      key: 'k', category: 'c', label_fr: 'L', description: 'd',
      value: { value: 1 }, value_type: 'int', min_value: null, max_value: null,
      is_active: true, updated_at: null, created_at: null,
    });
    mockGetRuleHistory.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/config/rules/k');

    expect(res.body.min_value).toBeNull();
    expect(res.body.max_value).toBeNull();
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockGetRuleByKey.mockResolvedValueOnce({
      key: 'k', category: 'c', label_fr: 'L', description: 'd',
      value: { value: 1 }, value_type: 'int', min_value: null, max_value: null,
      is_active: true, updated_at: null, created_at: null,
    });
    mockGetRuleHistory.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/api/config/rules/k');

    expect(res.status).toBe(500);
  });
});

describe('routes/config — PUT /rules/:key', () => {
  it('400 si le champ value est absent', async () => {
    const res = await request(app).put('/api/config/rules/sla_days').send({ reason: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value.*obligatoire/);
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });

  it('succès : appelle updateRule et renvoie un message formaté', async () => {
    mockUpdateRule.mockResolvedValueOnce({ key: 'sla_days', label_fr: 'SLA' });

    const res = await request(app)
      .put('/api/config/rules/sla_days')
      .send({ value: 30, reason: 'Retour terrain' });

    expect(res.status).toBe(200);
    expect(mockUpdateRule).toHaveBeenCalledWith('sla_days', 30, 'admin-1', 'Retour terrain');
    expect(res.body).toEqual({
      success: true, key: 'sla_days', value: 30, message: 'Règle "SLA" mise à jour',
    });
  });

  it('accepte value=0 ou value=false (falsy mais défini)', async () => {
    mockUpdateRule.mockResolvedValueOnce({ key: 'k', label_fr: 'L' });

    const res = await request(app).put('/api/config/rules/k').send({ value: 0 });

    expect(res.status).toBe(200);
    expect(mockUpdateRule).toHaveBeenCalledWith('k', 0, 'admin-1', undefined);
  });

  it.each([
    'Valeur minimum non respectée',
    'Valeur maximum dépassée',
    'Type attendu: number',
    'Règle introuvable',
  ])('422 pour une erreur métier connue: "%s"', async (message) => {
    mockUpdateRule.mockRejectedValueOnce(new Error(message));

    const res = await request(app).put('/api/config/rules/k').send({ value: 1 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(message);
  });

  it('erreur inconnue → next(err) → error handler générique (500)', async () => {
    mockUpdateRule.mockRejectedValueOnce(new Error('boom inattendu'));

    const res = await request(app).put('/api/config/rules/k').send({ value: 1 });

    expect(res.status).toBe(500);
  });
});

describe('routes/config — POST /rules/:key/reset', () => {
  it('succès : réinitialise et renvoie la valeur par défaut', async () => {
    mockResetRule.mockResolvedValueOnce({ key: 'sla_days', label_fr: 'SLA', value: { value: 21 } });

    const res = await request(app).post('/api/config/rules/sla_days/reset');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true, key: 'sla_days', value: 21,
      message: 'Règle "SLA" remise à la valeur par défaut',
    });
  });

  it('404 si la règle est introuvable', async () => {
    mockResetRule.mockRejectedValueOnce(new Error('Règle introuvable'));

    const res = await request(app).post('/api/config/rules/unknown/reset');

    expect(res.status).toBe(404);
  });

  it('autre erreur → next(err)', async () => {
    mockResetRule.mockRejectedValueOnce(new Error('db crash'));

    const res = await request(app).post('/api/config/rules/k/reset');

    expect(res.status).toBe(500);
  });
});

describe('routes/config — GET /rules/:key/history', () => {
  it('404 si la règle est introuvable', async () => {
    mockGetRuleByKey.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/config/rules/unknown/history');

    expect(res.status).toBe(404);
  });

  it('renvoie un historique formaté avec fallback "Système"', async () => {
    mockGetRuleByKey.mockResolvedValueOnce({ key: 'k', label_fr: 'Label' });
    mockGetRuleHistory.mockResolvedValueOnce([
      { old_value: { value: 1 }, new_value: { value: 2 }, change_reason: 'r', changed_by_name: 'Jean', created_at: 't1' },
      { old_value: { value: 2 }, new_value: { value: 3 }, change_reason: null, changed_by_name: null, created_at: 't2' },
    ]);

    const res = await request(app).get('/api/config/rules/k/history');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.history[0]).toEqual({
      old_value: 1, new_value: 2, reason: 'r', changed_by: 'Jean', changed_at: 't1',
    });
    expect(res.body.history[1].changed_by).toBe('Système');
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockGetRuleByKey.mockResolvedValueOnce({ key: 'k', label_fr: 'Label' });
    mockGetRuleHistory.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/api/config/rules/k/history');

    expect(res.status).toBe(500);
  });
});
