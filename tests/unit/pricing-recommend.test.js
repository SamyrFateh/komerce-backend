'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockRecommend = jest.fn();
const mockLoadGlobalConfig = jest.fn();
jest.mock('../../services/pricing-engine', () => ({
  recommend: (...args) => mockRecommend(...args),
  loadGlobalConfig: (...args) => mockLoadGlobalConfig(...args),
}));

jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const {
  computeRecommend,
  computeRecommendBatch,
  _applies,
  _arrondiPsycho,
} = require('../../services/pricing-recommend');

describe('pricing-recommend — helpers purs', () => {
  describe('_applies', () => {
    const ctx = { category: 'phones', channel: 'cash_relais', isDiaspora: false };

    it("'all' (ou absent) s'applique toujours", () => {
      expect(_applies({}, ctx)).toBe(true);
      expect(_applies({ applies_to: 'all' }, ctx)).toBe(true);
    });

    it('filtre is_diaspora:true / false', () => {
      expect(_applies({ applies_to: 'is_diaspora:true' }, ctx)).toBe(false);
      expect(_applies({ applies_to: 'is_diaspora:false' }, ctx)).toBe(true);
      expect(_applies({ applies_to: 'is_diaspora:true' }, { ...ctx, isDiaspora: true })).toBe(true);
    });

    it('filtre channel:xxx', () => {
      expect(_applies({ applies_to: 'channel:cash_relais' }, ctx)).toBe(true);
      expect(_applies({ applies_to: 'channel:stripe_eur' }, ctx)).toBe(false);
    });

    it('filtre category:xxx', () => {
      expect(_applies({ applies_to: 'category:phones' }, ctx)).toBe(true);
      expect(_applies({ applies_to: 'category:laptops' }, ctx)).toBe(false);
    });
  });

  describe('_arrondiPsycho', () => {
    it('arrondit au multiple de 10 superieur sous 500', () => {
      expect(_arrondiPsycho(123)).toBe(130);
      expect(_arrondiPsycho(120)).toBe(120);
    });

    it('arrondit a la centaine -10 entre 500 et 1000', () => {
      expect(_arrondiPsycho(650)).toBe(690);
      expect(_arrondiPsycho(999)).toBe(990);
    });

    it('arrondit au millier -10 au-dela de 1000', () => {
      expect(_arrondiPsycho(13456)).toBe(13990);
      expect(_arrondiPsycho(1001)).toBe(1990);
    });
  });
});

function mockGlobalParams({ fc = {}, comps = [], provs = [], charges = [] } = {}) {
  // _loadGlobalParams fait 4 requetes en parallele : finance_config, pricing_components, risk_provisions, charges
  mockDbQuery.mockImplementation((sql) => {
    if (sql.includes('FROM finance_config')) return Promise.resolve({ rows: [fc] });
    if (sql.includes('FROM pricing_components')) return Promise.resolve({ rows: comps });
    if (sql.includes('FROM risk_provisions')) return Promise.resolve({ rows: provs });
    if (sql.includes('FROM charges')) return Promise.resolve({ rows: charges });
    if (sql.includes('FROM customs_categories')) return Promise.resolve({ rows: [] });
    if (sql.includes('FROM products')) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

describe('computeRecommend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('404 si product_id fourni mais introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // SELECT products
    await expect(computeRecommend({ product_id: 'p1' })).rejects.toMatchObject({
      status: 404,
      body: { error: 'Produit introuvable' },
    });
  });

  it('avertit si prix_aed est manquant et aucun produit fourni', async () => {
    mockGlobalParams();
    const result = await computeRecommend({});
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('prix_aed manquant')])
    );
  });

  it('calcule niveau1/niveau2/niveau3 et un prix recommande coherent (fallback legacy, doctrine indisponible)', async () => {
    mockGlobalParams({
      fc: { taux_aed_kmf: 138, taux_change_eur_kmf: 492, fret_eur_per_m3: 180, target_marge_brute_pct: 40, objectif_commandes_mois: 100 },
      comps: [],
      provs: [],
      charges: [{ recurrence_period: 'monthly', amount_kmf: 100000 }],
    });
    mockRecommend.mockRejectedValue(new Error('engine down'));

    const result = await computeRecommend({ prix_aed: 100, poids_kg: 1, volume_m3: 0.005 });

    expect(result.source_of_truth).toBe('legacy-fallback');
    expect(result.niveau1.total).toBeGreaterThan(0);
    expect(result.niveau2.total).toBe(1000); // 100000 / 100 commandes cible
    expect(result.prix_recommande_kmf).toBeGreaterThan(result.cout_total_kmf);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('pricing-engine indisponible')])
    );
  });

  it('utilise les chiffres du moteur doctrine quand il repond avec succes', async () => {
    mockGlobalParams({
      fc: { taux_aed_kmf: 138, taux_change_eur_kmf: 492, fret_eur_per_m3: 180, target_marge_brute_pct: 40, objectif_commandes_mois: 100 },
    });
    mockRecommend.mockResolvedValue({
      recommended_price_kmf: 99990,
      cdr_complete_kmf: 50000,
      warnings: ['doctrine-warning'],
    });

    const result = await computeRecommend({ prix_aed: 100 });

    expect(result.source_of_truth).toBe('pricing-engine');
    expect(result.prix_recommande_kmf).toBe(99990);
    expect(result.cout_total_kmf).toBe(50000);
    expect(result.warnings).toEqual(expect.arrayContaining(['doctrine-warning']));
  });

  it("applique uniquement les composants pricing qui correspondent au contexte (channel/category)", async () => {
    mockGlobalParams({
      fc: { taux_aed_kmf: 138, taux_change_eur_kmf: 492, fret_eur_per_m3: 180, target_marge_brute_pct: 40, objectif_commandes_mois: 100 },
      comps: [
        { key: 'comp_match', label: 'Match', category: 'x', unit: 'kmf', default_value: 1000, applies_to: 'channel:cash_relais' },
        { key: 'comp_nomatch', label: 'NoMatch', category: 'x', unit: 'kmf', default_value: 99999, applies_to: 'channel:stripe_eur' },
      ],
    });
    mockRecommend.mockRejectedValue(new Error('engine down'));

    const result = await computeRecommend({ prix_aed: 100, channel: 'cash_relais' });
    const keys = result.niveau1.items.map((i) => i.key);
    expect(keys).toContain('comp_match');
    expect(keys).not.toContain('comp_nomatch');
  });
});

describe('computeRecommendBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retourne un summary a zero si aucun produit actif', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // SELECT products
    const result = await computeRecommendBatch({});
    expect(result).toEqual({
      count: 0,
      items: [],
      summary: { aligned: 0, underpriced: 0, overpriced: 0, total_gap_kmf: 0 },
    });
  });

  it('clamp la limite a 500 maximum', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await computeRecommendBatch({ limit: 99999 });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params[params.length - 1]).toBe(500);
  });

  it('classifie un produit comme underpriced/overpriced/aligned selon le gap (>5%)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'p1', name: 'A', category: 'phones', price_kmf: 1000, cost_kmf: 500, weight_kg: 1 },
        ],
      }) // products
      .mockImplementation((sql) => {
        if (sql.includes('FROM finance_config')) return Promise.resolve({ rows: [{ taux_aed_kmf: 138, taux_change_eur_kmf: 492, fret_eur_per_m3: 180, target_marge_brute_pct: 40 }] });
        if (sql.includes('FROM pricing_components')) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM risk_provisions')) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM charges')) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM customs_categories')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });
    mockLoadGlobalConfig.mockRejectedValue(new Error('no doctrine config'));

    const result = await computeRecommendBatch({});
    expect(result.count).toBe(1);
    expect(['aligned', 'underpriced', 'overpriced', 'unset']).toContain(result.items[0].status);
    expect(result.summary.aligned + result.summary.underpriced + result.summary.overpriced).toBe(1);
  });

  it('classe un produit sans prix courant (price_kmf=0) comme underpriced (unset compte comme underpriced)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'A', category: 'phones', price_kmf: 0, cost_kmf: 500, weight_kg: 1 }],
      })
      .mockImplementation((sql) => {
        if (sql.includes('FROM finance_config')) return Promise.resolve({ rows: [{}] });
        return Promise.resolve({ rows: [] });
      });
    mockLoadGlobalConfig.mockRejectedValue(new Error('no doctrine'));

    const result = await computeRecommendBatch({});
    expect(result.items[0].status).toBe('unset');
    expect(result.summary.underpriced).toBe(1);
  });
});
