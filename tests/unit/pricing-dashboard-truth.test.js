/**
 * Tests unitaires — pricing-dashboard relaie le moteur (vérité unique).
 * DB et moteur mockés : on vérifie que les KPI/distributions dérivent de recommend().
 */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn(), recommend: jest.fn() }));

const db = require('../../db');
const engine = require('../../services/pricing-engine');
const { computeDashboard } = require('../../services/pricing-dashboard');

const CDR = 14007, RECO = 23990, N3 = 5250, VAR = 9000;
const products = [
  { id: 'A', name: 'Produit perte',    category: 'phones', price_kmf: 8000,  cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'B', name: 'Produit aligné',   category: 'phones', price_kmf: 23990, cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'C', name: 'Produit sans prix', category: 'phones', price_kmf: 0,    cost_kmf: 6000, weight_kg: 0.3 },
];

describe('Dashboard — vérité unique (relaie le moteur)', () => {
  let out;
  beforeAll(async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40, objectif_commandes_mois: 80 }] };
      if (/FROM products/.test(sql)) return { rows: products };
      if (/GREATEST/.test(sql)) return { rows: [{ last_change: '2026-06-10T00:00:00Z' }] };
      return { rows: [] };
    });
    engine.loadGlobalConfig.mockResolvedValue({ finance: {}, categories: {}, components: [], provisions: [], charges: [] });
    engine.recommend.mockImplementation(async (input) => {
      const price = Number(input.current_price_kmf) || 0;
      const margin = price > 0 ? Math.round((1 - CDR / price) * 1000) / 10 : null;
      return {
        cdr_complete_kmf: CDR, recommended_price_kmf: RECO, current_price_kmf: price,
        variable_cost_complete_kmf: VAR, n3_fixed_overhead_allocation_kmf: N3, estimated_margin_pct: margin,
        health_status: price > 0 && price < CDR ? 'loss' : (margin >= 40 ? 'healthy' : 'fragile'),
        sourcing_decision: price > 0 && price < CDR ? 'LOSS' : 'TEST', market_confidence: 'unknown',
      };
    });
    out = await computeDashboard();
  });

  it('source_of_truth = pricing-engine', () => expect(out.kpis.source_of_truth).toBe('pricing-engine'));
  it('niveau2_kmf = N3 du moteur', () => expect(out.kpis.niveau2_kmf).toBe(N3));
  it('alias n3_fixed_overhead_allocation_kmf présent', () => expect(out.kpis.n3_fixed_overhead_allocation_kmf).toBe(N3));
  it('1 produit à perte (8000 < CDR)', () => expect(out.kpis.nb_at_loss).toBe(1));
  it('alerte sale_at_loss présente', () => expect(out.alerts.some(a => a.code === 'sale_at_loss')).toBe(true));
  it('1 produit aligné', () => expect(out.kpis.nb_aligned).toBe(1));
  it('1 produit sans prix', () => expect(out.kpis.nb_unset).toBe(1));
  it('distributions alimentées (sample 3)', () => expect(out.doctrine.sample_size).toBe(3));
  it('1 verdict LOSS', () => expect(out.doctrine.by_sourcing.LOSS).toBe(1));
  it('frontières catalogue exposées', () => expect(out.frontiers).toBeTruthy());
  it('prix 8000 < coût variable 9000 → destructif', () => expect(out.frontiers.destructive).toBe(1));
  it('prix 23990 ≥ CDR → couvert', () => expect(out.frontiers.covered).toBe(1));
  it('produit sans prix → unpriced', () => expect(out.frontiers.unpriced).toBe(1));
});
