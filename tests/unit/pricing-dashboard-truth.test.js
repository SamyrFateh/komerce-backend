/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — pricing-dashboard relaie le moteur (vérité unique).
 * DB et moteur mockés : on vérifie que les KPI/distributions dérivent de recommend().
 *
 * Mise à jour 2026-06-16 : aligne sur la séparation doctrine §7
 *   destructif (prix < variable) vs sous-couvert (variable ≤ prix < CDR).
 */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn(), recommend: jest.fn() }));

const db     = require('../../db');
const engine = require('../../services/pricing-engine');
const { computeDashboard, listBenchmarks, computeBenchmarksGap } = require('../../services/pricing-dashboard');

// Fixtures
const CDR = 14007, RECO = 23990, N3 = 5250, VAR = 9000;

// Produit A : prix 8000 < VAR 9000          → destructif (à perte réel)
// Produit B : prix 11000, VAR 9000 ≤ prix < CDR 14007 → contributif sous-couvert
// Produit C : prix 23990 ≥ CDR              → couvert
// Produit D : prix 0                         → non fixé
const products = [
  { id: 'A', name: 'Produit destructif',    category: 'phones', price_kmf: 8000,  cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'B', name: 'Produit sous-couvert',  category: 'phones', price_kmf: 11000, cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'C', name: 'Produit aligné',        category: 'phones', price_kmf: 23990, cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'D', name: 'Produit sans prix',     category: 'phones', price_kmf: 0,     cost_kmf: 6000, weight_kg: 0.3 },
];

describe('Dashboard — vérité unique (relaie le moteur)', () => {
  let out;
  beforeAll(async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40, objectif_commandes_mois: 80 }] };
      if (/FROM products/.test(sql))       return { rows: products };
      if (/GREATEST/.test(sql))            return { rows: [{ last_change: '2026-06-10T00:00:00Z' }] };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({ finance: {}, categories: {}, components: [], provisions: [], charges: [] });
    engine.recommend.mockImplementation(async (input) => {
      const price  = Number(input.current_price_kmf) || 0;
      const margin = price > 0 ? Math.round((1 - CDR / price) * 1000) / 10 : null;
      return {
        cdr_complete_kmf:           CDR,
        recommended_price_kmf:      RECO,
        current_price_kmf:          price,
        variable_cost_complete_kmf: VAR,
        n3_fixed_overhead_allocation_kmf: N3,
        estimated_margin_pct:       margin,
        health_status:    price > 0 && price < CDR ? 'loss' : (margin >= 40 ? 'healthy' : 'fragile'),
        sourcing_decision: price > 0 && price < CDR ? 'LOSS' : 'TEST',
        market_confidence: 'unknown',
      };
    });
    out = await computeDashboard();
  });

  // ── Source de vérité ──────────────────────────────────────────────
  it('source_of_truth = pricing-engine', () => expect(out.kpis.source_of_truth).toBe('pricing-engine'));
  it('niveau2_kmf = N3 du moteur',       () => expect(out.kpis.niveau2_kmf).toBe(N3));
  it('alias n3_fixed_overhead présent',  () => expect(out.kpis.n3_fixed_overhead_allocation_kmf).toBe(N3));

  // ── Frontières catalogue ─────────────────────────────────────────
  it('prix 8000 < coût variable 9000 → destructif', () => expect(out.frontiers.destructive).toBe(1));
  it('prix 11000 : variable ≤ prix < CDR → undercovered', () => expect(out.frontiers.undercovered).toBe(1));
  it('prix 23990 ≥ CDR → couvert',      () => expect(out.frontiers.covered).toBe(1));
  it('prix 0 → unpriced',               () => expect(out.frontiers.unpriced).toBe(1));

  // ── KPIs séparés doctrine §7 ─────────────────────────────────────
  it('nb_destructive = 1 (prix < variable)', () => expect(out.kpis.nb_destructive).toBe(1));
  it('nb_undercovered = 1 (variable ≤ prix < CDR)', () => expect(out.kpis.nb_undercovered).toBe(1));
  it('ancien champ nb_at_loss absent (supprimé)', () => expect(out.kpis.nb_at_loss).toBeUndefined());

  // ── Alertes correctement séparées ────────────────────────────────
  it('alerte sale_destructive présente', () =>
    expect(out.alerts.some(a => a.code === 'sale_destructive')).toBe(true));
  it('alerte sale_undercovered présente', () =>
    expect(out.alerts.some(a => a.code === 'sale_undercovered')).toBe(true));
  it('ancien code sale_at_loss absent', () =>
    expect(out.alerts.some(a => a.code === 'sale_at_loss')).toBe(false));
  it('sale_destructive est severity critical', () =>
    expect(out.alerts.find(a => a.code === 'sale_destructive')?.severity).toBe('critical'));
  it('sale_undercovered est severity warning', () =>
    expect(out.alerts.find(a => a.code === 'sale_undercovered')?.severity).toBe('warning'));

  // ── Comptages alignement ─────────────────────────────────────────
  it('1 produit aligné (≥ CDR, écart ≤ 5%)', () => expect(out.kpis.nb_aligned).toBe(1));
  it('1 produit sans prix',                   () => expect(out.kpis.nb_unset).toBe(1));

  // ── Distributions santé ──────────────────────────────────────────
  it('distributions alimentées (sample 4)', () => expect(out.doctrine.sample_size).toBe(4));
  it('2 verdicts LOSS (A et B sous CDR)', () => expect(out.doctrine.by_sourcing.LOSS).toBe(2));
  it('frontières exposées dans la réponse', () => expect(out.frontiers).toBeTruthy());
});

// ── Branches complémentaires de computeDashboard ──────────────────────────

describe('computeDashboard — branches complémentaires', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recommend() qui échoue pour un produit → nbRecoFailed + alerte reco_failed', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return {
        rows: [{ id: 'X', name: 'Casse-moteur', category: 'phones', price_kmf: 10000, cost_kmf: 5000, weight_kg: 0.2 }],
      };
      if (/GREATEST/.test(sql)) return { rows: [{ last_change: '2026-06-10T00:00:00Z' }] };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockRejectedValue(new Error('config manquante'));

    const out = await computeDashboard();

    expect(out.kpis.nb_total).toBe(1);
    expect(out.doctrine.sample_size).toBe(0);
    expect(out.alerts.find(a => a.code === 'reco_failed')).toMatchObject({ count: 1 });
  });

  it('prix actuel > prix calculé (écart positif) → nb_overpriced', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return {
        rows: [{ id: 'O', name: 'Surpricé', category: 'phones', price_kmf: 30000, cost_kmf: 6000, weight_kg: 0.3 }],
      };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockResolvedValue({
      cdr_complete_kmf: 14007, recommended_price_kmf: 20000, current_price_kmf: 30000,
      variable_cost_complete_kmf: 9000, n3_fixed_overhead_allocation_kmf: 5250,
      estimated_margin_pct: 53, health_status: 'strong', sourcing_decision: 'INCREASE_PRICE', market_confidence: 'validated',
    });

    const out = await computeDashboard();
    expect(out.kpis.nb_overpriced).toBe(1);
  });

  it('couvert mais marge effective < 10% → productsCritical + alerte low_margin', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return {
        rows: [{ id: 'M', name: 'Marge fragile', category: 'phones', price_kmf: 15000, cost_kmf: 6000, weight_kg: 0.3 }],
      };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockResolvedValue({
      cdr_complete_kmf: 14007, recommended_price_kmf: 15500, current_price_kmf: 15000,
      variable_cost_complete_kmf: 9000, n3_fixed_overhead_allocation_kmf: 5250,
      estimated_margin_pct: 6.7, health_status: 'fragile', sourcing_decision: 'TEST', market_confidence: 'testing',
    });

    const out = await computeDashboard();
    expect(out.alerts.find(a => a.code === 'low_margin')).toMatchObject({ count: 1 });
  });

  it('catégorie sous-rentable → alerte category_low_margin', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return {
        rows: [
          { id: 'M1', name: 'M1', category: 'accessoires', price_kmf: 15000, cost_kmf: 6000, weight_kg: 0.1 },
          { id: 'M2', name: 'M2', category: 'accessoires', price_kmf: 15500, cost_kmf: 6000, weight_kg: 0.1 },
        ],
      };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockResolvedValue({
      cdr_complete_kmf: 14007, recommended_price_kmf: 15500, current_price_kmf: 15000,
      variable_cost_complete_kmf: 9000, n3_fixed_overhead_allocation_kmf: 5250,
      estimated_margin_pct: 6.7, health_status: 'fragile', sourcing_decision: 'TEST', market_confidence: 'testing',
    });

    const out = await computeDashboard();
    expect(out.alerts.find(a => a.code === 'category_low_margin')).toMatchObject({ count: 1 });
  });

  it('marge globale sous la cible → alerte global_margin_below_target', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return {
        rows: [{ id: 'G', name: 'G', category: 'phones', price_kmf: 15000, cost_kmf: 6000, weight_kg: 0.3 }],
      };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockResolvedValue({
      cdr_complete_kmf: 14007, recommended_price_kmf: 15500, current_price_kmf: 15000,
      variable_cost_complete_kmf: 9000, n3_fixed_overhead_allocation_kmf: 5250,
      estimated_margin_pct: 6.7, health_status: 'fragile', sourcing_decision: 'TEST', market_confidence: 'testing',
    });

    const out = await computeDashboard();
    expect(out.alerts.find(a => a.code === 'global_margin_below_target')).toBeTruthy();
  });

  it('couverture coûts < 80% avec > 5 produits → alerte cost_coverage_low', async () => {
    const products6 = Array.from({ length: 6 }, (_, i) => ({
      id: `P${i}`, name: `P${i}`, category: 'phones', price_kmf: 20000,
      cost_kmf: i === 0 ? 6000 : 0, weight_kg: 0.3,
    }));
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return { rows: products6 };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockResolvedValue({
      cdr_complete_kmf: 14007, recommended_price_kmf: 20000, current_price_kmf: 20000,
      variable_cost_complete_kmf: 9000, n3_fixed_overhead_allocation_kmf: 5250,
      estimated_margin_pct: 30, health_status: 'healthy', sourcing_decision: 'TEST', market_confidence: 'validated',
    });

    const out = await computeDashboard();
    expect(out.alerts.find(a => a.code === 'cost_coverage_low')).toMatchObject({ count: 5 });
  });

  it('requête last_change en échec → last_config_change_at reste null (catch silencieux)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40 }] };
      if (/FROM products/.test(sql)) return { rows: [] };
      if (/GREATEST/.test(sql)) throw new Error('db down');
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({});
    engine.recommend.mockResolvedValue({});

    const out = await computeDashboard();
    expect(out.kpis.last_config_change_at).toBeNull();
  });
});

// ── listBenchmarks ──────────────────────────────────────────────────────────

describe('listBenchmarks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sans filtre : where = is_active TRUE uniquement', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, key: 'k1' }] });

    const out = await listBenchmarks();

    expect(out.count).toBe(1);
    expect(out.benchmarks).toEqual([{ id: 1, key: 'k1' }]);
    expect(db.query.mock.calls[0][0]).toContain('is_active = TRUE');
    expect(db.query.mock.calls[0][0]).not.toContain('category =');
    expect(db.query.mock.calls[0][1]).toEqual([]);
  });

  it('avec filtre category : ajoute la clause et le paramètre', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await listBenchmarks({ category: 'douane' });

    expect(db.query.mock.calls[0][0]).toContain('category = $1');
    expect(db.query.mock.calls[0][1]).toEqual(['douane']);
  });

  it('avec filtres category + importance : deux clauses, deux paramètres', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await listBenchmarks({ category: 'hub', importance: 'critical' });

    expect(db.query.mock.calls[0][0]).toContain('category = $1');
    expect(db.query.mock.calls[0][0]).toContain('importance = $2');
    expect(db.query.mock.calls[0][1]).toEqual(['hub', 'critical']);
  });
});

// ── computeBenchmarksGap ────────────────────────────────────────────────────

describe('computeBenchmarksGap', () => {
  beforeEach(() => jest.clearAllMocks());

  it('benchmark présent (composant) → present[] avec déviation calculée', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM pricing_benchmarks/.test(sql)) return {
        rows: [{ key: 'fret_air', label: 'Fret aérien', category: 'transit', benchmark_median: 100, importance: 'critical' }],
      };
      if (/FROM pricing_components/.test(sql)) return {
        rows: [{ key: 'fret_air', label: 'Fret aérien', category: 'transit', default_value: 120, unit: 'kmf', is_active: true }],
      };
      if (/FROM risk_provisions/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const out = await computeBenchmarksGap();

    expect(out.summary.present_count).toBe(1);
    expect(out.summary.critical_missing).toBe(0);
    const present = out.by_category.transit.present[0];
    expect(present.current_value).toBe(120);
    expect(present.deviation_pct).toBe(20);
  });

  it('benchmark manquant (importance critical) → missing[] + summary.critical_missing', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM pricing_benchmarks/.test(sql)) return {
        rows: [{ key: 'douane_taxe', label: 'Taxe douane', category: 'douane', benchmark_median: 50, importance: 'critical', emoji: '📋' }],
      };
      if (/FROM pricing_components/.test(sql)) return { rows: [] };
      if (/FROM risk_provisions/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const out = await computeBenchmarksGap();

    expect(out.summary.critical_missing).toBe(1);
    expect(out.by_category.douane.missing).toHaveLength(1);
    expect(out.by_category.douane.missing[0].key).toBe('douane_taxe');
  });

  it('benchmark manquant recommended puis optional → compteurs séparés', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM pricing_benchmarks/.test(sql)) return {
        rows: [
          { key: 'r1', label: 'R1', category: 'hub', benchmark_median: 10, importance: 'recommended' },
          { key: 'o1', label: 'O1', category: 'hub', benchmark_median: 5, importance: 'optional' },
        ],
      };
      if (/FROM pricing_components/.test(sql)) return { rows: [] };
      if (/FROM risk_provisions/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const out = await computeBenchmarksGap({ include_optional: true });

    expect(out.summary.recommended_missing).toBe(1);
    expect(out.summary.optional_missing).toBe(1);
  });

  it('present via provision (risk_provisions) → catégorie forcée à distribution', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM pricing_benchmarks/.test(sql)) return {
        rows: [{ key: 'risque_impaye', label: 'Risque impayé', category: 'distribution', benchmark_median: 2, importance: 'recommended' }],
      };
      if (/FROM pricing_components/.test(sql)) return { rows: [] };
      if (/FROM risk_provisions/.test(sql)) return {
        rows: [{ key: 'risque_impaye', label: 'Risque impayé', rate_pct: 3, is_active: true }],
      };
      return { rows: [] };
    });

    const out = await computeBenchmarksGap();

    expect(out.by_category.distribution.present[0]).toMatchObject({ current_value: 3, unit: 'pct' });
  });

  it('catégorie de benchmark inconnue → repli sur sourcing', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM pricing_benchmarks/.test(sql)) return {
        rows: [{ key: 'x1', label: 'X1', category: 'inexistant', benchmark_median: 1, importance: 'optional' }],
      };
      if (/FROM pricing_components/.test(sql)) return { rows: [] };
      if (/FROM risk_provisions/.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const out = await computeBenchmarksGap({ include_optional: true });

    expect(out.by_category.sourcing.missing).toHaveLength(1);
  });

  it('filtres importance/category transmis aux clauses SQL et à filters', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const out = await computeBenchmarksGap({ importance: 'critical', category: 'transit' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('importance = $1');
    expect(sql).toContain('category   = $2');
    expect(params).toEqual(['critical', 'transit']);
    expect(out.filters).toEqual({ importance: 'critical', category: 'transit', include_optional: false });
  });

  it("sans filtre importance et include_optional=false → exclut l'importance optional", async () => {
    db.query.mockResolvedValue({ rows: [] });

    await computeBenchmarksGap();

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("importance != 'optional'");
  });
});
