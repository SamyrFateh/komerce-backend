'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const workspace = require('../../public/dashboards/canonical/js/shipping-customs-workspace');
const decision = require('../../public/dashboards/canonical/js/shipping-customs-workspace-decision');

function summaryFixture() {
  return {
    transit_ready: 2,
    transit_active: 7,
    customs_candidates: 3,
    customs_pending: 4,
    customs_declared: 5,
  };
}

describe('Expéditions & Douane — decision-first visual', () => {
  test('la decision strip ne projette que les files réellement actionnables', () => {
    const projected = decision.decisionItems(workspace.metricItems(summaryFixture()));

    expect(projected).toEqual([
      expect.objectContaining({ key: 'transit-ready', label: 'Colis à mettre en transit', value: '2', tone: 'warning' }),
      expect.objectContaining({ key: 'customs-candidates', label: 'Colis à rattacher douane', value: '3', tone: 'warning' }),
      expect.objectContaining({ key: 'customs-pending', label: 'Douane à déclarer', value: '4', tone: 'warning' }),
    ]);
  });

  test('aucun blocage, dépassement de seuil ou document expirant n’est inventé', () => {
    const labels = decision.decisionItems(workspace.metricItems(summaryFixture()))
      .map(item => `${item.label} ${item.helper}`)
      .join(' ');

    expect(labels).not.toMatch(/bloqu/i);
    expect(labels).not.toMatch(/seuil/i);
    expect(labels).not.toMatch(/expir/i);
    expect(labels).not.toMatch(/retard/i);
  });

  test('les cartes Transit et Douane gardent les compteurs serveur sans recompute', () => {
    const cards = decision.summaryCards(workspace.metricItems(summaryFixture()));

    expect(cards.map(card => card.title)).toEqual(['Transit international', 'Douane']);
    expect(cards[0].metrics.map(metric => metric.value)).toEqual(['2', '7']);
    expect(cards[1].metrics.map(metric => metric.value)).toEqual(['3', '4', '5']);
  });

  test('les états actifs ou déclarés ne deviennent pas des alertes par eux-mêmes', () => {
    const items = workspace.metricItems({
      transit_ready: 0,
      transit_active: 9,
      customs_candidates: 0,
      customs_pending: 0,
      customs_declared: 6,
    });

    expect(decision.decisionItems(items)).toEqual([]);
    expect(decision.summaryCards(items).every(card => card.tone === 'neutral')).toBe(true);
  });

  test('enhance conserve le mount métier et remplace seulement la projection MetricStrip', async () => {
    const payload = { scope: { code: 'CM' }, summary: summaryFixture() };
    const baseMount = jest.fn(options => Promise.resolve(payload));
    const base = {
      metricItems: workspace.metricItems,
      mount: baseMount,
    };
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
    expect(baseMount.mock.calls[0][0].ui).not.toBe(ui);
    expect(baseMount.mock.calls[0][0].ui.MetricStrip.render).not.toBe(ui.MetricStrip.render);
    expect(result).toBe(payload);
  });
});
