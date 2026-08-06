'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/signals.test.js
 * Couvre routes/signals.js
 *
 * ⚠️ BUG SOURCE CONNU : aucun handler de ce fichier ne déclare `next` en
 * paramètre (`async function(req, res) {...}`), pourtant chaque catch
 * appelle `next(err)`. Résultat : en cas de rejet de db.query(), le catch
 * lève une ReferenceError ("next is not defined") sous forme de promesse
 * rejetée non gérée — la requête HTTP ne reçoit JAMAIS de réponse (elle
 * reste en attente indéfiniment). Vérifié expérimentalement hors-suite.
 * Conséquence pour ce fichier de tests : AUCUN test "erreur DB → 500"
 * n'est écrit ici (ferait timeout toute la suite) ; seuls les chemins
 * nominaux/validations/404, qui ne traversent jamais le catch, sont testés.
 * À corriger côté source (ajouter `next` aux signatures) avant d'activer
 * une couverture d'erreur complète.
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

const mockGenerateSignals = jest.fn();
jest.mock('../../services/signal-service', () => ({
  generateSignals: (...args) => mockGenerateSignals(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const signalsRouter = require('../../routes/signals');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/signals', signalsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('toutes les routes — gate auth + admin (router.use global)', () => {
  it('sans auth → 401 sur GET /', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/signals');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403 sur GET /', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/signals');
    expect(res.status).toBe(403);
  });

  it('non-admin → 403 sur DELETE /:id', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete('/api/admin/signals/s1');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/signals — liste avec filtres', () => {
  it('sans filtre → status par défaut IN (open, acknowledged)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const res = await request(buildApp()).get('/api/admin/signals');
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("s.status IN ('open','acknowledged')");
    expect(params).toEqual([]);
  });

  it('?status=resolved → filtre explicite remplace le défaut', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(buildApp()).get('/api/admin/signals?status=resolved');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('s.status = $1');
    expect(params).toEqual(['resolved']);
  });

  it('filtres combinés (severity, signal_type, owner_role) → tous appliqués, params dans l\'ordre', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(buildApp()).get('/api/admin/signals?severity=urgent&signal_type=sla_breach&owner_role=hub');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('s.severity = $1');
    expect(sql).toContain('s.signal_type = $2');
    expect(sql).toContain('s.owner_role = $3');
    expect(params).toEqual(['urgent', 'sla_breach', 'hub']);
  });

  it('?family=ops → mappe vers les signal_type connus (ANY)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(buildApp()).get('/api/admin/signals?family=ops');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('s.signal_type = ANY($1)');
    expect(params[0]).toEqual(['parcel_blocked', 'cash_expiring', 'sla_breach', 'hub_tension', 'relay_tension', 'loyalty_pending']);
  });

  it('?family=inconnu → ignoré (pas de condition ajoutée)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(buildApp()).get('/api/admin/signals?family=inexistant');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([]);
  });

  it('limit/offset par défaut = 50/0', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/admin/signals');
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it('limit > 200 → plafonné à 200', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/admin/signals?limit=9999');
    expect(res.body.limit).toBe(200);
  });

  it('offset fourni → respecté', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/admin/signals?offset=20');
    expect(res.body.offset).toBe(20);
  });

  it('tri par sévérité (urgent > critical > warning > autre) puis created_at DESC', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(buildApp()).get('/api/admin/signals');
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("WHEN 'urgent' THEN 1");
    expect(sql).toContain("WHEN 'critical' THEN 2");
    expect(sql).toContain("WHEN 'warning' THEN 3");
    expect(sql).toContain('s.created_at DESC');
  });

  it('total = COUNT(*) parsé en entier, même filtre que la liste', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] }).mockResolvedValueOnce({ rows: [{ count: '42' }] });
    const res = await request(buildApp()).get('/api/admin/signals');
    expect(res.body.total).toBe(42);
    expect(res.body.signals).toEqual([{ id: 's1' }]);
  });
});

describe('GET /api/admin/signals/stats', () => {
  it('nominal → agrège bySeverity/byType/byFamily et calcule total', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ severity: 'urgent', count: '3' }, { severity: 'warning', count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ signal_type: 'sla_breach', count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ family: 'ops', count: '5' }] });

    const res = await request(buildApp()).get('/api/admin/signals/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total: 5,
      bySeverity: [{ severity: 'urgent', count: '3' }, { severity: 'warning', count: '2' }],
      byType: [{ signal_type: 'sla_breach', count: '3' }],
      byFamily: [{ family: 'ops', count: '5' }],
    });
  });

  it('aucun signal → total 0, tableaux vides', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/signals/stats');
    expect(res.body).toEqual({ total: 0, bySeverity: [], byType: [], byFamily: [] });
  });

  it('filtre status IN (open, acknowledged) sur les 3 requêtes', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/signals/stats');
    mockDbQuery.mock.calls.forEach(([sql]) => {
      expect(sql).toContain("status IN ('open','acknowledged')");
    });
  });
});

describe('POST /api/admin/signals/generate', () => {
  it('sans types → appelle generateSignals(null)', async () => {
    mockGenerateSignals.mockResolvedValue({ created: 3 });
    const res = await request(buildApp()).post('/api/admin/signals/generate').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, result: { created: 3 } });
    expect(mockGenerateSignals).toHaveBeenCalledWith(null);
  });

  it('types fournis → transmis tels quels', async () => {
    mockGenerateSignals.mockResolvedValue({ created: 1 });
    await request(buildApp()).post('/api/admin/signals/generate').send({ types: ['sla_breach'] });
    expect(mockGenerateSignals).toHaveBeenCalledWith(['sla_breach']);
  });
});

describe('POST /api/admin/signals/:id/acknowledge', () => {
  it('signal introuvable ou non-open → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(buildApp()).post('/api/admin/signals/s1/acknowledge');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Signal not found or not open' });
  });

  it('nominal → 200, ne touche que les signaux status=open', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1', status: 'acknowledged' }] });
    const res = await request(buildApp()).post('/api/admin/signals/s1/acknowledge');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, signal: { id: 's1', status: 'acknowledged' } });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("WHERE id = $1 AND status = 'open'");
    expect(params).toEqual(['s1']);
  });
});

describe('POST /api/admin/signals/:id/snooze', () => {
  it('signal introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(buildApp()).post('/api/admin/signals/s1/snooze').send({ hours: 12 });
    expect(res.status).toBe(404);
  });

  it('hours fourni → transmis en string pour l\'intervalle SQL', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1', status: 'snoozed' }] });
    await request(buildApp()).post('/api/admin/signals/s1/snooze').send({ hours: 12 });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(['s1', '12']);
  });

  it('hours absent → défaut 24', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1' }] });
    await request(buildApp()).post('/api/admin/signals/s1/snooze').send({});
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(['s1', '24']);
  });

  it('hours invalide (non-numérique) → fallback 24', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1' }] });
    await request(buildApp()).post('/api/admin/signals/s1/snooze').send({ hours: 'abc' });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(['s1', '24']);
  });

  it('ne s\'applique qu\'aux signaux open/acknowledged', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1' }] });
    await request(buildApp()).post('/api/admin/signals/s1/snooze').send({});
    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("status IN ('open','acknowledged')");
  });
});

describe('POST /api/admin/signals/:id/resolve', () => {
  it('signal introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(buildApp()).post('/api/admin/signals/s1/resolve').send({});
    expect(res.status).toBe(404);
  });

  it('nominal → 200, resolved_by = req.user.id', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1', status: 'resolved' }] });
    const res = await request(buildApp()).post('/api/admin/signals/s1/resolve').send({ notes: 'Traité' });
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain("status IN ('open','acknowledged','snoozed')");
    expect(params).toEqual(['s1', 'admin-1']);
  });
});

describe('DELETE /api/admin/signals/:id', () => {
  it('signal introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(buildApp()).delete('/api/admin/signals/s1');
    expect(res.status).toBe(404);
  });

  it('nominal → 200, deleted: id', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's1' }] });
    const res = await request(buildApp()).delete('/api/admin/signals/s1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: 's1' });
    expect(mockDbQuery).toHaveBeenCalledWith('DELETE FROM signals WHERE id = $1 RETURNING id', ['s1']);
  });
});
