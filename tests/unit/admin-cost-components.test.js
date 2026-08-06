'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-cost-components.test.js
 *
 * Tests du router routes/admin-cost-components.js
 *
 * Couverture (invariants métier critiques) :
 *   ✓ accès admin requis (403 si role !== 'admin')
 *   ✓ GET /_meta renvoie les enums (families/categories/units/...)
 *   ✓ POST : champs requis manquants → 400
 *   ✓ POST : cohérence famille/catégorie via META → 400 si catégorie hors famille
 *   ✓ POST : succès → insert + audit 'created'
 *   ✓ POST : clé dupliquée (23505) → 409
 *   ✓ PUT : composant introuvable → 404
 *   ✓ PUT : incohérence famille/catégorie → 400
 *   ✓ PUT : aucun champ à modifier → 400
 *   ✓ PUT : succès → update + audit avec le bon event_type (value_changed/activated/deactivated/scope_changed/updated)
 *   ✓ POST /:id/toggle : bascule is_active + audit
 *   ✓ DELETE soft : is_active=FALSE + audit 'deactivated'
 *   ✓ DELETE hard : refuse si !is_deletable (403), sinon delete + audit 'deleted'
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
}));

const dbQueries = [];
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  dbQueries.length = 0;
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/admin-cost-components');
    app.use('/api/admin/cost-components', router);
  });
});

const validBody = () => ({
  key: 'freight_air', label: 'Fret aérien', family: 'landed_relay',
  category: 'freight', default_value: 1200, unit: 'kmf_per_kg',
});

describe('admin-cost-components — accès', () => {
  it('refuse un non-admin (403)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/admin/cost-components/_meta');
    expect(res.status).toBe(403);
  });
});

describe('admin-cost-components — GET /_meta', () => {
  it('renvoie les enums autorisés', async () => {
    const res = await request(app).get('/api/admin/cost-components/_meta');
    expect(res.status).toBe(200);
    expect(res.body.families).toEqual(['landed_relay', 'business', 'exceptional']);
    expect(res.body.categories.landed_relay).toContain('freight');
  });
});

describe('admin-cost-components — POST /', () => {
  it('400 si un champ requis manque', async () => {
    const res = await request(app).post('/api/admin/cost-components').send({ key: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Champ requis manquant/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('400 si la catégorie est invalide pour la famille', async () => {
    const res = await request(app)
      .post('/api/admin/cost-components')
      .send({ ...validBody(), family: 'business', category: 'freight' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide pour la famille/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('crée le composant puis écrit un événement audit "created"', async () => {
    const created = { id: 'cc-1', key: 'freight_air' };
    mockQuery
      .mockResolvedValueOnce({ rows: [created] }) // INSERT cost_components
      .mockResolvedValueOnce({ rows: [] });        // INSERT cost_component_events

    const res = await request(app).post('/api/admin/cost-components').send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.component).toEqual(created);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const auditCall = mockQuery.mock.calls[1];
    expect(auditCall[0]).toMatch(/INSERT INTO cost_component_events/);
    expect(auditCall[0]).toMatch(/'created'/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(['cc-1', 'freight_air']));
  });

  it('409 sur clé dupliquée (contrainte unique 23505)', async () => {
    const err = new Error('duplicate'); err.code = '23505';
    mockQuery.mockRejectedValueOnce(err);

    const res = await request(app).post('/api/admin/cost-components').send(validBody());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/clé identique/);
  });
});

describe('admin-cost-components — PUT /:id', () => {
  it('404 si le composant est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT old
    const res = await request(app).put('/api/admin/cost-components/cc-404').send({ label: 'x' });
    expect(res.status).toBe(404);
  });

  it('400 si incohérence famille/catégorie', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cc-1', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' }] });
    const res = await request(app)
      .put('/api/admin/cost-components/cc-1')
      .send({ family: 'business', category: 'freight' });
    expect(res.status).toBe(400);
  });

  it('400 si aucun champ à modifier', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cc-1', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' }] });
    const res = await request(app).put('/api/admin/cost-components/cc-1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Aucun champ/);
  });

  it('audit "value_changed" quand default_value change', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, default_value: 200 };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })  // SELECT old
      .mockResolvedValueOnce({ rows: [newComp] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] });        // INSERT audit

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ default_value: 200 });
    expect(res.status).toBe(200);
    const auditCall = mockQuery.mock.calls[2];
    expect(auditCall[1]).toEqual(expect.arrayContaining(['value_changed']));
  });

  it('audit "activated" quand is_active passe false→true', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: false, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, is_active: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [newComp] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ is_active: true });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['activated']));
  });
});

describe('admin-cost-components — POST /:id/toggle', () => {
  it('404 si introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/admin/cost-components/cc-404/toggle');
    expect(res.status).toBe(404);
  });

  it('bascule is_active et écrit un audit', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_active: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [{ ...oldComp, is_active: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/cost-components/cc-1/toggle');
    expect(res.status).toBe(200);
    expect(res.body.component.is_active).toBe(false);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['deactivated']));
  });
});

describe('admin-cost-components — GET /', () => {
  it('liste tous les composants sans filtre et les groupe par family/category', async () => {
    const rows = [
      { id: 'c1', family: 'landed_relay', category: 'freight' },
      { id: 'c2', family: 'landed_relay', category: 'freight' },
      { id: 'c3', family: 'business', category: 'payment' },
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app).get('/api/admin/cost-components');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.components).toEqual(rows);
    expect(res.body.grouped.landed_relay.freight).toHaveLength(2);
    expect(res.body.grouped.business.payment).toHaveLength(1);
    // Aucun filtre fourni → pas de clause WHERE
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/WHERE/);
    expect(mockQuery.mock.calls[0][1]).toEqual([]);
  });

  it('applique tous les filtres de query fournis (family/category/channel/island/scope)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).get(
      '/api/admin/cost-components?family=landed_relay&category=freight&channel=diaspora&island=mayotte&scope=global'
    );

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/family = \$1/);
    expect(sql).toMatch(/category = \$2/);
    expect(sql).toMatch(/channel = \$3/);
    expect(sql).toMatch(/island = \$4/);
    expect(sql).toMatch(/scope = \$5/);
    expect(params).toEqual(['landed_relay', 'freight', 'diaspora', 'mayotte', 'global']);
  });

  it.each([
    ['true', 'is_active = TRUE'],
    ['1', 'is_active = TRUE'],
    ['false', 'is_active = FALSE'],
    ['0', 'is_active = FALSE'],
  ])('is_active=%s → clause %s', async (value, expectedClause) => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get(`/api/admin/cost-components?is_active=${value}`);
    expect(mockQuery.mock.calls[0][0]).toContain(expectedClause);
  });

  it.each([
    ['true', 'is_exceptional = TRUE'],
    ['1', 'is_exceptional = TRUE'],
    ['false', 'is_exceptional = FALSE'],
    ['0', 'is_exceptional = FALSE'],
  ])('is_exceptional=%s → clause %s', async (value, expectedClause) => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get(`/api/admin/cost-components?is_exceptional=${value}`);
    expect(mockQuery.mock.calls[0][0]).toContain(expectedClause);
  });

  it('regroupe même une famille absente des clés initiales de `grouped` (garde défensive)', async () => {
    // 'exceptional' est déjà pré-initialisé dans grouped, on vérifie ici le cas
    // où une catégorie n'existe pas encore sous cette famille.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', family: 'exceptional', category: 'incident' }],
    });
    const res = await request(app).get('/api/admin/cost-components');
    expect(res.body.grouped.exceptional.incident).toHaveLength(1);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/cost-components');
    expect(res.status).toBe(500);
  });
});

describe('admin-cost-components — GET /:id', () => {
  it('404 si le composant est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/cost-components/cc-404');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/);
  });

  it("200 : renvoie le composant et son historique d'audit (events)", async () => {
    const component = { id: 'cc-1', key: 'freight_air' };
    const events = [
      { id: 'ev-1', event_type: 'created', old_value: null, new_value: '{}', notes: null, created_at: '2026-06-01' },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [component] })
      .mockResolvedValueOnce({ rows: events });

    const res = await request(app).get('/api/admin/cost-components/cc-1');

    expect(res.status).toBe(200);
    expect(res.body.component).toEqual(component);
    expect(res.body.events).toEqual(events);
    expect(mockQuery.mock.calls[1][0]).toMatch(/FROM cost_component_events/);
    expect(mockQuery.mock.calls[1][1]).toEqual(['cc-1']);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/cost-components/cc-1');
    expect(res.status).toBe(500);
  });
});

describe('admin-cost-components — POST / erreurs inattendues', () => {
  it("erreur DB non-23505 → next(err) → 500 (pas de 409)", async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection reset'));
    const res = await request(app).post('/api/admin/cost-components').send(validBody());
    expect(res.status).toBe(500);
  });
});

describe('admin-cost-components — PUT /:id (branches audit restantes)', () => {
  it('audit "deactivated" quand is_active passe true→false', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, is_active: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [newComp] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['deactivated']));
  });

  it('audit "scope_changed" quand scope change (sans changement de valeur/is_active)', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, scope: 'category' };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [newComp] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ scope: 'category' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['scope_changed']));
  });

  it('audit "updated" (fallback) quand aucune des conditions spécifiques ne matche', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, label: 'Nouveau libellé' };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [newComp] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ label: 'Nouveau libellé' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['updated']));
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ label: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('admin-cost-components — POST /:id/toggle (erreurs)', () => {
  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/cost-components/cc-1/toggle');
    expect(res.status).toBe(500);
  });
});

describe('admin-cost-components — DELETE /:id (erreurs)', () => {
  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).delete('/api/admin/cost-components/cc-1');
    expect(res.status).toBe(500);
  });
});

describe('admin-cost-components — branches restantes (Lot B)', () => {
  it('GET / : regroupe une famille absente des clés initiales de `grouped` (famille inconnue)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', family: 'unknown_fam', category: 'misc' }],
    });
    const res = await request(app).get('/api/admin/cost-components');
    expect(res.status).toBe(200);
    expect(res.body.grouped.unknown_fam.misc).toHaveLength(1);
  });

  it('POST / : famille inconnue (hors META) → 400 avec allowedCats vide', async () => {
    const res = await request(app)
      .post('/api/admin/cost-components')
      .send({ ...validBody(), family: 'unknown_fam', category: 'freight' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide pour la famille/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('POST / : req.user sans id → created_by/triggered_by = null', async () => {
    currentUser = { role: 'admin' }; // pas d'id
    const created = { id: 'cc-1', key: 'freight_air' };
    mockQuery
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/cost-components').send(validBody());
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining([null]));
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining([null]));
  });

  it('PUT /:id : famille ET catégorie fournies, famille inconnue (hors META) → 400', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cc-1', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' }],
    });
    const res = await request(app)
      .put('/api/admin/cost-components/cc-1')
      .send({ family: 'unknown_fam', category: 'freight' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide pour la famille/);
  });

  it('PUT /:id : famille ET catégorie fournies et cohérentes → pas de 400, update effectué', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, family: 'landed_relay', category: 'customs' };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })  // SELECT old
      .mockResolvedValueOnce({ rows: [newComp] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] });        // INSERT audit

    const res = await request(app)
      .put('/api/admin/cost-components/cc-1')
      .send({ family: 'landed_relay', category: 'customs' });
    expect(res.status).toBe(200);
    expect(res.body.component).toEqual(newComp);
  });

  it('PUT /:id : req.user sans id → updated_by/triggered_by = null', async () => {
    currentUser = { role: 'admin' }; // pas d'id
    const oldComp = { id: 'cc-1', key: 'freight_air', family: 'landed_relay', category: 'freight', is_active: true, default_value: 100, scope: 'global' };
    const newComp = { ...oldComp, label: 'x' };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [newComp] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/cost-components/cc-1').send({ label: 'x' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining([null]));
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining([null]));
  });

  it('POST /:id/toggle : false→true donne "activated", et req.user sans id → null', async () => {
    currentUser = { role: 'admin' }; // pas d'id
    const oldComp = { id: 'cc-1', key: 'freight_air', is_active: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({ rows: [{ ...oldComp, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/cost-components/cc-1/toggle');
    expect(res.status).toBe(200);
    expect(res.body.component.is_active).toBe(true);
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining([null]));
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['activated', null]));
  });

  it('DELETE /:id : composant introuvable → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/admin/cost-components/cc-404');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/);
  });

  it('DELETE /:id (soft) : req.user sans id → updated_by/triggered_by = null', async () => {
    currentUser = { role: 'admin' }; // pas d'id
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app).delete('/api/admin/cost-components/cc-1');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining([null]));
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining([null]));
  });

  it('DELETE /:id?hard=true : req.user sans id → triggered_by = null', async () => {
    currentUser = { role: 'admin' }; // pas d'id
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app).delete('/api/admin/cost-components/cc-1?hard=true');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining([null]));
  });
});

describe('admin-cost-components — DELETE /:id', () => {
  it('soft delete : is_active=FALSE + audit "deactivated"', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] }) // SELECT old
      .mockResolvedValueOnce({})                  // UPDATE is_active=FALSE
      .mockResolvedValueOnce({});                 // INSERT audit

    const res = await request(app).delete('/api/admin/cost-components/cc-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, soft: true });
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE cost_components SET is_active = FALSE/);
  });

  it('hard delete refusé si !is_deletable (403)', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: false };
    mockQuery.mockResolvedValueOnce({ rows: [oldComp] });

    const res = await request(app).delete('/api/admin/cost-components/cc-1?hard=true');
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('hard delete autorisé si is_deletable → DELETE + audit "deleted"', async () => {
    const oldComp = { id: 'cc-1', key: 'freight_air', is_deletable: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [oldComp] }) // SELECT old
      .mockResolvedValueOnce({})                  // DELETE
      .mockResolvedValueOnce({});                 // INSERT audit

    const res = await request(app).delete('/api/admin/cost-components/cc-1?hard=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, hard: true });
    expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM cost_components/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/'deleted'/);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['freight_air']));
  });
});
