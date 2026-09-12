'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const decision = require('../../public/dashboards/canonical/js/pricing-workspace-decision');
const pricingWorkspace = require('../../public/dashboards/canonical/js/pricing-workspace');

const ROOT = path.join(__dirname, '..', '..');

function fixture() {
  return {
    summary: {
      products: 3,
      active_products: 2,
      cost_components: 8,
      active_cost_components: 7,
      competitor_observations: 4,
    },
    products: [
      { product_ref: 'KPR-1', name: 'Sous plancher', price_kmf: 9000 },
      { product_ref: 'KPR-2', name: 'Dans la zone', price_kmf: 14000 },
    ],
    recommendations: [
      { product_ref: 'KPR-1', minimum_safe_price_kmf: 10000, recommended_price_kmf: 12000 },
      { product_ref: 'KPR-2', minimum_safe_price_kmf: 10000, recommended_price_kmf: 13000 },
    ],
    economic: {
      executive: {
        status: 'WATCH',
        status_label: 'Sous surveillance',
        generated_at: '2026-09-11T20:00:00Z',
        alerts: [
          { message: 'Pression structurelle', detail: 'Charges fixes élevées', severity: 'warning' },
        ],
        recommendation: { text: 'Surveiller la contribution.' },
      },
    },
    cost_components: [
      { key: 'freight', label: 'Transport', inherited: true, is_active: true },
      { key: 'relay', label: 'Relais', inherited: false, is_active: true, effective_value: 500, economic_nature: 'variable', allocation_perimeter: 'direct' },
    ],
    scope: { market_code: 'CM', market_name: 'Cameroun' },
    access: { read_only: false },
  };
}

describe('decision-first Atelier économique', () => {
  test('signale uniquement un prix réellement sous le plancher déjà calculé par le serveur', () => {
    const payload = fixture();
    const underFloor = decision.underFloorProducts(payload);
    expect(underFloor).toHaveLength(1);
    expect(underFloor[0].product.product_ref).toBe('KPR-1');

    const items = decision.globalDecisionItems(payload);
    expect(items[0]).toEqual(expect.objectContaining({
      key: 'price-below-safe-floor',
      label: 'Prix sous plancher serveur',
      value: '1',
      tone: 'critical',
    }));
    expect(items[1]).toEqual(expect.objectContaining({
      label: 'Pression structurelle',
      helper: 'Charges fixes élevées',
      tone: 'warning',
    }));
  });

  test('projection globale reprend résumé, frontières prix et recommandation du moteur sans créer un prix', () => {
    const payload = fixture();
    const metrics = decision.globalMetricItems(payload);
    expect(metrics.map(item => [item.label, item.value])).toEqual([
      ['État économique', 'Sous surveillance'],
      ['Produits actifs', '2'],
      ['Coûts actifs', '7'],
      ['Obs. concurrence', '4'],
      ['Sous plancher sûr', '1'],
    ]);

    const products = decision.globalProductItems(payload);
    expect(products[0]).toEqual(expect.objectContaining({
      title: 'Sous plancher',
      helper: 'Plancher 10 000 KMF · conseillé 12 000 KMF',
      value: 'Actuel 9 000 KMF',
      tone: 'critical',
    }));
    expect(decision.globalTrust(payload).qualityLabel).toBe('Recommandation serveur : Surveiller la contribution.');
  });

  test('projection marché reprend couverture, contribution, maturité et overrides sans refaire le calcul', () => {
    const payload = fixture();
    const marketDecision = {
      decision_status: 'UNCOVERED',
      reason: 'COVERAGE_THRESHOLD_NOT_MET',
      authorization: 'DENY_NEW_UNDER_CDR_POSITION',
      evaluated_at: '2026-09-11T20:05:00Z',
      coverage: {
        coverage_ratio: 0.82,
        numerator_contribution_kmf: 820000,
        denominator_n3_kmf: 1000000,
        maturity: { maturity_ratio: 0.91 },
      },
    };

    expect(decision.marketDecisionItems(marketDecision).map(item => item.label)).toEqual([
      'Couverture insuffisante',
      'Nouvelle position sous CDR bloquée',
    ]);
    expect(decision.marketMetricItems(payload, marketDecision, pricingWorkspace).map(item => [item.label, item.value])).toEqual([
      ['Couverture réelle', '0,82×'],
      ['Contribution reconnue', '820 000 KMF'],
      ['Structure à couvrir', '1 000 000 KMF'],
      ['Maturité', '91 %'],
      ['Overrides pays', '1'],
      ['Coûts actifs', '7'],
    ]);
    expect(decision.marketCostItems(payload)[0]).toEqual(expect.objectContaining({
      title: 'Relais',
      value: '500',
      tone: 'info',
    }));
  });

  test('runtime charge la projection après les enrichissements Pricing et n’ajoute aucune mutation métier', () => {
    const index = fs.readFileSync(path.join(ROOT, 'public', 'dashboards', 'canonical', 'index.html'), 'utf8');
    const source = fs.readFileSync(path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'pricing-workspace-decision.js'), 'utf8');
    const structureIndex = index.indexOf('/dashboards/canonical/js/pricing-structure-event-panel.js');
    const overviewIndex = index.indexOf('/dashboards/canonical/js/pricing-workspace-decision.js?v=1610');

    expect(structureIndex).toBeGreaterThanOrEqual(0);
    expect(overviewIndex).toBeGreaterThan(structureIndex);
    expect(source).toContain('`${endpoint}/decision`');
    expect(source).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
    expect(source).not.toContain('market_id');
    expect(source).not.toContain('product_id');
  });
});
