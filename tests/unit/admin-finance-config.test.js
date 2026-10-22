'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-finance-config.test.js
 *
 * Tests du router routes/admin-finance-config.js
 *
 * Couverture (invariants métier critiques) :
 *   ✓ GET / : crée la ligne id=1 si absente, puis renvoie la config formatée
 *   ✓ GET / : calculs dérivés (seuil_rentabilite, prix_vente_estime, marge_brute_article)
 *   ✓ GET / : expose FX CURRENT + compat PricingView sans inventer de taux USD persisté
 *   ✓ GET /schema : expose FIELD_SCHEMA tel quel
 *   ✓ PUT / : 400 si aucun champ autorisé fourni (allowlist ALLOWED_FIELDS)
 *   ✓ PUT / : champ hors allowlist ignoré silencieusement (pas dans le SET)
 *   ✓ PUT / : validation type bool / int (bornes min/max) / decimal (bornes min/max)
 *   ✓ PUT / : succès → UPDATE + invalidateConfigCache() + invalidation cache taux
 *   ✓ PUT / : insertion historique exchange_rates SEULEMENT si taux_change_eur_kmf modifié
 *   ✓ PUT / : pas d'historique exchange_rates si seul un autre champ change
 *   ✓ PUT / : échec insert exchange_rates est non-bloquant (best-effort)
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => { if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' }); next(); },
}));

jest.mock('../../utils/logger', () => ({ forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockInvalidateConfigCache = jest.fn();
jest.mock('../../services/loyalty-service', () => ({
  invalidateConfigCache: (...args) => mockInvalidateConfigCache(...args),
}));

const mockInvalidateRatesCache = jest.fn();
const mockFxObs = { enterObservation: jest.fn(), approveObservation: jest.fn(), listObservations: jest.fn() };
jest.mock('../../services/fx-observation-service', () => ({
  enterObservation: (...a) => mockFxObs.enterObservation(...a),
  approveObservation: (...a) => mockFxObs.approveObservation(...a),
  listObservations: (...a) => mockFxObs.listObservations(...a),
}));
jest.mock('../../utils/rates', () => ({
  invalidateCache: (...args) => mockInvalidateRatesCache(...args),
  getRates: jest.fn().mockResolvedValue({ eur_kmf: 491.96775, aed_kmf: 134, usd_kmf: 450, toJSON() { return { eur_kmf: 491.96775, aed_kmf: 134, usd_kmf: 450, usd_eur_ratio: 0.914 }; } }),
  resolveFxRates: (cfg = {}) => {
    const eur = Number(cfg.taux_change_eur_kmf) || 492;
    const aed = Number(cfg.taux_aed_kmf) || 138;
    return {
      eur_kmf: eur,
      aed_kmf: aed,
      usd_kmf: Number((eur * 0.92).toFixed(6)),
      usd_eur_ratio: 0.92,
    };
  },
  resolvePricingViewCurrentCompatRates: () => ({
    eur_kmf: 492,
    aed_kmf: 138,
    usd_kmf: 452.64,
    usd_eur_ratio: 0.92,
  }),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/admin-finance-config');
    app.use('/api/admin/finance-config', router);
  });
});

const baseCfg = {
  id: 1,
  cost_fixed_sourcing_kmf: 10000, cost_fixed_transit_kmf: 5000, cost_fixed_hub_kmf: 3000,
  cost_fixed_relais_kmf: 2000, cost_fixed_support_kmf: 1000,
  target_marge_brute_pct: 20,
  taux_change_eur_kmf: 500, taux_aed_kmf: 140, cout_achat_moyen_eur: 10, markup_cible_pct: 200,
  updated_at: '2026-06-01', updated_by: 'admin-1',
};

describe('admin-finance-config — GET /', () => {
  it('crée la config par défaut (id=1) si absente avant de la renvoyer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })            // SELECT initial (absent)
      .mockResolvedValueOnce({ rows: [] })             // INSERT ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rows: [baseCfg] });     // SELECT après insert

    const res = await request(app).get('/api/admin/finance-config');
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO finance_config/);
    expect(res.body.costs.total_kmf).toBe(21000);
  });

  it('calcule correctement les indicateurs dérivés et expose les projections FX 1A-2', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [baseCfg] });
    const res = await request(app).get('/api/admin/finance-config');
    expect(res.status).toBe(200);
    // total fixed cost = 10000+5000+3000+2000+1000 = 21000
    // seuil_rentabilite = 21000 / (20/100) = 105000
    expect(res.body.derived.total_fixed_cost_kmf).toBe(21000);
    expect(res.body.derived.seuil_rentabilite_kmf).toBe(105000);
    // Taux = parité fixe de l'autorité FX (491,96775), pas finance_config.taux_change_eur_kmf (500 stocké).
    // prix_vente_estime = round(10 * 491.96775 * (1 + 200/100)) = 14759
    expect(res.body.derived.prix_vente_estime_kmf).toBe(14759);
    expect(res.body.derived.cout_achat_kmf).toBe(4920);
    expect(res.body.derived.marge_brute_article_kmf).toBe(9839);

    expect(res.body.fx.current).toEqual({
      eur_kmf: 491.96775,
      aed_kmf: 134,
      usd_kmf: 450,
      usd_eur_ratio: 0.914,
    });
    expect(res.body.fx.pricing_view_current_compat).toBeNull();
    expect(res.body.fx.usd_nature).toBe('APPROVED_OBSERVATION');
  });

  it('seuil_rentabilite = 0 si marge cible est 0 (pas de division par zéro)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseCfg, target_marge_brute_pct: 0 }] });
    const res = await request(app).get('/api/admin/finance-config');
    expect(res.body.derived.seuil_rentabilite_kmf).toBe(0);
  });
});

describe('admin-finance-config — GET /schema', () => {
  it('expose les champs variabilisables avec leurs métadonnées', async () => {
    const res = await request(app).get('/api/admin/finance-config/schema');
    expect(res.status).toBe(200);
    expect(res.body.taux_change_eur_kmf).toBeUndefined(); // retiré : autorité FX unique
    expect(res.body.loyalty_active).toMatchObject({ type: 'bool' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('admin-finance-config — PUT / validation', () => {
  it('400 si aucun champ autorisé fourni', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ unknown_field: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Aucun champ autorisé/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignore silencieusement un champ hors allowlist mélangé à un champ valide', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseCfg, cost_fixed_sourcing_kmf: 9999 }] });

    const res = await request(app)
      .put('/api/admin/finance-config')
      .send({ cost_fixed_sourcing_kmf: 9999, drop_table: 'x', __proto__polluted: true });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/cost_fixed_sourcing_kmf/);
    expect(updateSql).not.toMatch(/drop_table/);
  });

  it('400 si un champ bool reçoit autre chose qu\'un booléen', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ loyalty_active: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/booléen/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('400 si un champ int est hors borne min', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ delai_transit_jours: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entier >= 0/);
  });

  it('400 si un champ int n\'est pas entier (flottant)', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ delai_transit_jours: 5.5 });
    expect(res.status).toBe(400);
  });

  it('400 si un champ decimal (ex-int, migration 217) est hors borne min', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ cost_fixed_sourcing_kmf: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nombre >= 0/);
  });

  it('accepte des centimes sur un champ ex-int passé en decimal (migration 217)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseCfg, cost_fixed_sourcing_kmf: 1000.25 }] });

    const res = await request(app)
      .put('/api/admin/finance-config')
      .send({ cost_fixed_sourcing_kmf: 1000.25 });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/cost_fixed_sourcing_kmf/);
  });

  it('400 si un champ decimal dépasse la borne max', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ target_marge_brute_pct: 150 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/<= 100/);
  });
});

describe('admin-finance-config — PUT / effets de bord', () => {
  it('succès : UPDATE + invalidation cache loyalty', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseCfg, cost_fixed_sourcing_kmf: 12000 }] });

    const res = await request(app).put('/api/admin/finance-config').send({ cost_fixed_sourcing_kmf: 12000 });

    expect(res.status).toBe(200);
    expect(mockInvalidateConfigCache).toHaveBeenCalledTimes(1);
  });

  it("l'édition du taux EUR/KMF est retirée : 410, aucune écriture", async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ taux_change_eur_kmf: 510 });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ error: 'fx_rate_editor_retired', retired_fields: ['taux_change_eur_kmf'] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('taux AED / USD retirés eux aussi, même mélangés à un champ valide', async () => {
    const res = await request(app).put('/api/admin/finance-config').send({ taux_aed_kmf: 140, cost_fixed_sourcing_kmf: 1 });
    expect(res.status).toBe(410);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('n\'insère PAS d\'historique exchange_rates si seul un autre champ change', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseCfg, cost_fixed_sourcing_kmf: 13000 }] });

    const res = await request(app).put('/api/admin/finance-config').send({ cost_fixed_sourcing_kmf: 13000 });

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1); // pas de 2e appel INSERT
  });

  it("aucune écriture exchange_rates depuis finance_config (journal en lecture seule)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...baseCfg, cost_fixed_sourcing_kmf: 14000 }] });
    const res = await request(app).put('/api/admin/finance-config').send({ cost_fixed_sourcing_kmf: 14000 });
    expect(res.status).toBe(200);
    expect(res.body.sourcing.taux_change_eur_kmf).toBe(491.96775); // autorité FX, la colonne stockée n'est plus lue
    expect(mockQuery.mock.calls.some(c => /exchange_rates/.test(c[0]))).toBe(false);
  });
});

describe('admin-finance-config — observation EUR/USD (deux personnes)', () => {
  beforeEach(() => Object.values(mockFxObs).forEach(f => f.mockReset()));

  it('POST saisit avec l\'identité de la session et renvoie 201', async () => {
    mockFxObs.enterObservation.mockResolvedValueOnce({ id: 'o1', rate: '1.0850', approved_by: null });
    const res = await request(app).post('/api/admin/finance-config/fx-observations')
      .send({ rate: 1.085, source_label: 'BCE taux de référence', source_ref: 'ecb:2026-10-21', as_of: '2026-10-21T14:15:00Z' });
    expect(res.status).toBe(201);
    expect(mockFxObs.enterObservation).toHaveBeenCalledWith(expect.objectContaining({ rate: 1.085, sourceLabel: 'BCE taux de référence', enteredBy: expect.anything() }));
  });

  it("POST /:id/approve : l'erreur métier est restituée avec son code", async () => {
    const err = Object.assign(new Error('deux personnes'), { name: 'FxObservationError', code: 'fx_observation_two_person_required', statusCode: 409 });
    mockFxObs.approveObservation.mockRejectedValueOnce(err);
    const res = await request(app).post('/api/admin/finance-config/fx-observations/o1/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('fx_observation_two_person_required');
  });

  it('GET liste les observations', async () => {
    mockFxObs.listObservations.mockResolvedValueOnce([{ id: 'o1' }]);
    const res = await request(app).get('/api/admin/finance-config/fx-observations');
    expect(res.status).toBe(200);
    expect(res.body.observations).toEqual([{ id: 'o1' }]);
  });
});
