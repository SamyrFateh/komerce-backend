'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const workspace = require('../../public/dashboards/canonical/js/sourcing-workspace');
const decision = require('../../public/dashboards/canonical/js/sourcing-workspace-decision');

function summaryFixture() {
  return {
    sourcing_sources: 3,
    imports: 5,
    candidates_total: 24,
    candidates_scanned: 6,
    candidates_watchlist: 3,
    candidates_promoted: 9,
    sourcing_suppliers: 4,
  };
}

describe('Sourcing — decision-first visual', () => {
  test('les décisions reflètent seulement les états candidats déjà exposés', () => {
    const projected = decision.decisionItems(workspace.metricItems(summaryFixture()));

    // Scanned and WATCH aggregate volumes do not establish a fixable Sourcing incident.
    expect(projected).toEqual([]);
  });

  test('aucune urgence, rupture, commande d’achat ou retard fournisseur n’est inventé', () => {
    const labels = decision.decisionItems(workspace.metricItems(summaryFixture()))
      .map(item => `${item.label} ${item.helper}`)
      .join(' ');

    expect(labels).not.toMatch(/urgent/i);
    expect(labels).not.toMatch(/rupture/i);
    expect(labels).not.toMatch(/restock/i);
    expect(labels).not.toMatch(/retard fournisseur/i);
  });

  test('les cartes conservent exactement les compteurs du résumé sourcing', () => {
    const cards = decision.summaryCards(workspace.metricItems(summaryFixture()));

    expect(cards.map(card => card.title)).toEqual([
      'Acquisition fournisseur',
      'Flux vers Catalogue',
    ]);
    expect(cards[0].metrics.map(metric => metric.value)).toEqual(['3', '5']);
    expect(cards[1].metrics.map(metric => metric.value)).toEqual(['24', '9']);
  });

  test('sans scanned ni watchlist, aucune décision artificielle n’est affichée', () => {
    const items = workspace.metricItems({
      candidates_total: 10,
      candidates_scanned: 0,
      candidates_watchlist: 0,
      candidates_promoted: 5,
      sourcing_suppliers: 2,
    });

    expect(decision.decisionItems(items)).toEqual([]);
    expect(decision.summaryCards(items).every(card => card.tone === 'neutral')).toBe(true);
  });

  test('healthMetrics affiche le verdict backend sans le reclasser', () => {
    expect(decision.healthMetrics({
      state: {
        global: 'BROKEN', integrity: 'BROKEN', performance: 'ATTENTION', blockers: 2,
        trend: { status: 'UNKNOWN' },
      },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'health', value: 'BROKEN', tone: 'critical' }),
      expect.objectContaining({ key: 'integrity', value: 'BROKEN', tone: 'critical' }),
      expect.objectContaining({ key: 'performance', value: 'ATTENTION', tone: 'warning' }),
      expect.objectContaining({ key: 'blockers', value: '2', tone: 'critical' }),
      expect.objectContaining({ key: 'trend', value: 'UNKNOWN', tone: 'neutral' }),
    ]));
  });

  test('enhance conserve le mount global et lit la santé déjà projetée par le backend', async () => {
    const payload = {
      scope: { mode: 'global_sourcing' },
      summary: summaryFixture(),
      health: { schema_version: 'sourcing-health-dashboard-v1', state: { global: 'HEALTHY' } },
    };
    const baseMount = jest.fn(options => Promise.resolve(payload));
    const base = { metricItems: workspace.metricItems, mount: baseMount };
    const ui = {
      MetricStrip: { render: jest.fn() },
      UIState: {},
      Section: {},
      DataTable: {},
    };
    const decisionUi = {
      DecisionStrip: { render: jest.fn() },
      SummaryCards: { render: jest.fn() },
    };
    const fetchFn = jest.fn();

    const enhanced = decision.enhance(base, decisionUi);
    const result = await enhanced.mount({ ui, document: {}, fetch: fetchFn });

    expect(baseMount).toHaveBeenCalledTimes(1);
    // A normal metric strip is preserved; no fake arbitration layer takes it over.
    expect(baseMount.mock.calls[0][0].ui.MetricStrip.render).toBe(ui.MetricStrip.render);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toBe(payload);
  });
});
