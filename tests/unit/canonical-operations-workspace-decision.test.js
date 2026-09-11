'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const workspace = require('../../public/dashboards/canonical/js/operations-workspace');
const decision = require('../../public/dashboards/canonical/js/operations-workspace-decision');

function summaryFixture() {
  return {
    hub_to_order: 2,
    hub_unassigned: 3,
    hub_to_ship: 4,
    relay_cash_pending: 5,
    relay_to_receive: 6,
    relay_to_collect: 7,
    inventory_to_assign: 8,
  };
}

describe('Hub / Relais — decision-first visual', () => {
  test('les décisions sont uniquement une projection des files serveur existantes', () => {
    const items = workspace.metricItems(summaryFixture());
    const projected = decision.decisionItems(items);

    expect(projected).toEqual([
      expect.objectContaining({ key: 'hub-order', label: 'Commandes à lancer', value: '2', tone: 'warning' }),
      expect.objectContaining({ key: 'distribution', label: 'Commandes à répartir', value: '3', tone: 'warning' }),
      expect.objectContaining({ key: 'ship', label: 'Colis à expédier', value: '4', tone: 'warning' }),
      expect.objectContaining({ key: 'cash', label: 'Cash à encaisser', value: '5', tone: 'warning' }),
    ]);
  });

  test('aucun signal de retard, tension ou réapprovisionnement n’est inventé', () => {
    const labels = decision.decisionItems(workspace.metricItems(summaryFixture()))
      .map(item => item.label)
      .join(' ');

    expect(labels).not.toMatch(/retard/i);
    expect(labels).not.toMatch(/tension/i);
    expect(labels).not.toMatch(/approvision/i);
    expect(labels).not.toMatch(/sécuriser/i);
  });

  test('les cartes Hub, Relais et Inventaire conservent les valeurs exactes du résumé', () => {
    const cards = decision.summaryCards(workspace.metricItems(summaryFixture()));

    expect(cards.map(card => card.title)).toEqual(['Hub', 'Relais', 'Inventaire']);
    expect(cards[0].metrics.map(metric => metric.value)).toEqual(['2', '3', '4']);
    expect(cards[1].metrics.map(metric => metric.value)).toEqual(['5', '6', '7']);
    expect(cards[2].metrics.map(metric => metric.value)).toEqual(['8']);
  });

  test('une file vide reste neutre et ne devient pas une décision artificielle', () => {
    const items = workspace.metricItems({
      hub_to_order: 0,
      hub_unassigned: 0,
      hub_to_ship: 0,
      relay_cash_pending: 0,
      relay_to_receive: 0,
      relay_to_collect: 0,
      inventory_to_assign: 0,
    });

    expect(decision.decisionItems(items)).toEqual([]);
    expect(decision.summaryCards(items).every(card => card.tone === 'neutral')).toBe(true);
  });

  test('enhance conserve le mount métier et ne remplace que la projection MetricStrip', async () => {
    const baseMount = jest.fn(options => Promise.resolve({
      marketCode: 'CM',
      endpoint: '/api/admin/workspaces/operations/market/CM',
      payload: { summary: summaryFixture() },
    }));
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
    expect(result.decisionFirst).toBe(true);
    expect(result.marketCode).toBe('CM');
  });
});
