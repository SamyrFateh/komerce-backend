'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-rules.test.js
 * Couvre routes/admin-rules.js
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
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé admin' });
    }
    next();
  },
}));

jest.mock('../../utils/rules', () => ({
  getAllRules: jest.fn(),
  getRuleByKey: jest.fn(),
  getRuleHistory: jest.fn(),
  updateRule: jest.fn(),
  resetRule: jest.fn(),
}));

const rulesEngine = require('../../utils/rules');
const adminRulesRouter = require('../../routes/admin-rules');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/rules', adminRulesRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/admin/rules — liste groupée', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/rules');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/rules');
    expect(res.status).toBe(403);
  });

  it('admin → 200 + categories', async () => {
    rulesEngine.getAllRules.mockResolvedValue({ sla: [{ key: 'SLA_LATE_DAYS' }] });
    const res = await request(buildApp()).get('/api/admin/rules');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ categories: { sla: [{ key: 'SLA_LATE_DAYS' }] } });
  });

  it('erreur service → 500', async () => {
    rulesEngine.getAllRules.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/rules');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/rules/audit', () => {
  it('admin → 200 + historique global', async () => {
    const rows = [{ id: 'h1', rule_key: 'SLA_LATE_DAYS', old_value: '42', new_value: '45' }];
    mockDbQuery.mockResolvedValueOnce({ rows });
    const res = await request(buildApp()).get('/api/admin/rules/audit');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ history: rows });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT 100'));
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/rules/audit');
    expect(res.status).toBe(403);
  });

  it("n'est pas intercepté par la route GET /:key", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/rules/audit');
    expect(rulesEngine.getRuleByKey).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/rules/:key', () => {
  it('clé au format invalide → 400, pas d\'appel au service', async () => {
    const res = await request(buildApp()).get('/api/admin/rules/x');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Format de clé invalide' });
    expect(rulesEngine.getRuleByKey).not.toHaveBeenCalled();
  });

  it('clé minuscule valide → normalisée en majuscules', async () => {
    rulesEngine.getRuleByKey.mockResolvedValue({ key: 'SLA_LATE_DAYS', value: 42 });
    rulesEngine.getRuleHistory.mockResolvedValue([]);
    await request(buildApp()).get('/api/admin/rules/sla_late_days');
    expect(rulesEngine.getRuleByKey).toHaveBeenCalledWith('SLA_LATE_DAYS');
  });

  it('règle introuvable → 404', async () => {
    rulesEngine.getRuleByKey.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/admin/rules/SLA_LATE_DAYS');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Règle introuvable' });
  });

  it('nominal → 200 + rule et history', async () => {
    rulesEngine.getRuleByKey.mockResolvedValue({ key: 'SLA_LATE_DAYS', value: 42 });
    rulesEngine.getRuleHistory.mockResolvedValue([{ id: 'h1' }]);
    const res = await request(buildApp()).get('/api/admin/rules/SLA_LATE_DAYS');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rule: { key: 'SLA_LATE_DAYS', value: 42 }, history: [{ id: 'h1' }] });
  });
});

describe('PATCH /api/admin/rules/:key', () => {
  it('clé invalide → 400', async () => {
    const res = await request(buildApp()).patch('/api/admin/rules/x').send({ value: 10, reason: 'justification suffisante' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Format de clé invalide' });
  });

  it('reason absente → 400', async () => {
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/justification est obligatoire/);
  });

  it('reason trop courte (< 10 caractères) → 400', async () => {
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 10, reason: 'trop court' .slice(0, 9) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/justification est obligatoire/);
  });

  it('reason non-string → 400', async () => {
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 10, reason: 12345678901 });
    expect(res.status).toBe(400);
  });

  it('value manquante (undefined) → 400', async () => {
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ reason: 'justification suffisante' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Valeur manquante.' });
  });

  it('value null → 400', async () => {
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: null, reason: 'justification suffisante' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Valeur manquante.' });
  });

  it('value 0 (falsy mais valide) → ne déclenche pas "Valeur manquante"', async () => {
    rulesEngine.updateRule.mockResolvedValue({ key: 'SLA_LATE_DAYS', value: 0 });
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 0, reason: 'remise a zero motivee' });
    expect(res.status).toBe(200);
  });

  it('nominal → 200, appelle updateRule avec reason tronquée et trim, message de succès', async () => {
    rulesEngine.updateRule.mockResolvedValue({ key: 'SLA_LATE_DAYS', value: 45 });
    const longReason = '  ' + 'x'.repeat(600) + '  ';
    const res = await request(buildApp())
      .patch('/api/admin/rules/SLA_LATE_DAYS')
      .send({ value: 45, reason: longReason });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      rule: { key: 'SLA_LATE_DAYS', value: 45 },
      message: 'Règle "SLA_LATE_DAYS" mise à jour. Cache invalidé.',
    });
    const [, , , reasonArg] = rulesEngine.updateRule.mock.calls[0];
    expect(reasonArg.length).toBe(500);
    expect(reasonArg.startsWith(' ')).toBe(false); // trim appliqué avant slice
    expect(rulesEngine.updateRule).toHaveBeenCalledWith('SLA_LATE_DAYS', 45, 'admin-1', expect.any(String));
  });

  it('erreur métier "Type attendu" → 400 avec message original', async () => {
    rulesEngine.updateRule.mockRejectedValue(new Error('Type attendu : number'));
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 'pas-un-nombre', reason: 'justification suffisante' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Type attendu : number' });
  });

  it('erreur métier "Valeur min" → 400', async () => {
    rulesEngine.updateRule.mockRejectedValue(new Error('Valeur min non respectée'));
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: -1, reason: 'justification suffisante' });
    expect(res.status).toBe(400);
  });

  it('erreur métier "Valeur max" → 400', async () => {
    rulesEngine.updateRule.mockRejectedValue(new Error('Valeur max dépassée'));
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 99999, reason: 'justification suffisante' });
    expect(res.status).toBe(400);
  });

  it('erreur métier "introuvable" → 400', async () => {
    rulesEngine.updateRule.mockRejectedValue(new Error('Règle introuvable'));
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 10, reason: 'justification suffisante' });
    expect(res.status).toBe(400);
  });

  it('erreur technique inattendue → 500 via next', async () => {
    rulesEngine.updateRule.mockRejectedValue(new Error('connexion DB perdue'));
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 10, reason: 'justification suffisante' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).patch('/api/admin/rules/SLA_LATE_DAYS').send({ value: 10, reason: 'justification suffisante' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/rules/:key/reset', () => {
  it('clé invalide → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/rules/x/reset');
    expect(res.status).toBe(400);
  });

  it('nominal → 200 + règle réinitialisée', async () => {
    rulesEngine.resetRule.mockResolvedValue({ key: 'SLA_LATE_DAYS', value: 42 });
    const res = await request(buildApp()).post('/api/admin/rules/SLA_LATE_DAYS/reset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      rule: { key: 'SLA_LATE_DAYS', value: 42 },
      message: 'Règle "SLA_LATE_DAYS" remise à sa valeur d\'origine.',
    });
    expect(rulesEngine.resetRule).toHaveBeenCalledWith('SLA_LATE_DAYS', 'admin-1');
  });

  it('règle introuvable → 404', async () => {
    rulesEngine.resetRule.mockRejectedValue(new Error('Règle introuvable'));
    const res = await request(buildApp()).post('/api/admin/rules/SLA_LATE_DAYS/reset');
    expect(res.status).toBe(404);
  });

  it('erreur technique inattendue → 500', async () => {
    rulesEngine.resetRule.mockRejectedValue(new Error('db cassee'));
    const res = await request(buildApp()).post('/api/admin/rules/SLA_LATE_DAYS/reset');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/rules/SLA_LATE_DAYS/reset');
    expect(res.status).toBe(403);
  });
});
