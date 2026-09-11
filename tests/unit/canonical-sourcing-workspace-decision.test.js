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

    expect(projected).toEqual([
      expect.objectContaining({ key: 'scanned', label: 'Candidats scannés à arbitrer', value: '6', tone: 'warning' }),
      expect.objectContaining({ key: 'watchlist', label: 'Candidats en watchlist', value: '3', tone: 'warning' }),
    ]);
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
      'Pipeline candidats',
      'Passage catalogue',
      'Réseau fournisseurs',
    ]);
    expect(cards[0].metrics.map(metric => metric.value)).toEqual(['24', '6', '3']);
    expect(cards[1].metrics.map(metric => metric.value)).toEqual(['9']);
    expect(cards[2].metrics.map(metric => metric.value)).toEqual(['4']);
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

  test('enhance conserve le mount global sourcing et décore uniquement MetricStrip', async () => {
    const payload = { scope: { mode: 'global_sourcing' }, summary: summaryFixture() };
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

    const enhanced = decision.enhance(base, decisionUi);
    const result = await enhanced.mount({ ui, document: {} });

    expect(baseMount).toHaveBeenCalledTimes(1);
    expect(baseMount.mock.calls[0][0].ui.MetricStrip.render).not.toBe(ui.MetricStrip.render);
    expect(result).toBe(payload);
  });
});
