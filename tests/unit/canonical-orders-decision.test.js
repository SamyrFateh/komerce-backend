'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const orders = require('../../public/dashboards/canonical/js/orders-decision');

const base = {
  formatNumber(value, digits = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(numeric);
  },
};

function payloadFixture() {
  return {
    period: 30,
    funnel: {
      steps: [
        { id: 'created', label: 'Commandes créées', count: 12, pct: 100 },
        { id: 'paid', label: 'Payées', count: 10, pct: 83.3 },
        { id: 'shipped', label: 'Expédiées', count: 8, pct: 66.7 },
        { id: 'available', label: 'Disponibles relais', count: 6, pct: 50 },
        { id: 'collected', label: 'Retirées', count: 5, pct: 41.7 },
      ],
      lost: 2,
    },
    kpis: [],
    data_quality: { scope_enforced: true, warnings: [] },
  };
}

describe('Commandes — decision-first visual', () => {
  test('reconnaît uniquement le mode explicite view=orders', () => {
    expect(orders.isOrdersLocation({ search: '?view=orders' })).toBe(true);
    expect(orders.isOrdersLocation({ search: '?market=CM&view=orders' })).toBe(true);
    expect(orders.isOrdersLocation({ search: '?view=commerce' })).toBe(false);
    expect(orders.isOrdersLocation({ search: '' })).toBe(false);
  });

  test('projette exactement les 5 étapes lifecycle fournies par le backend', () => {
    const metrics = orders.lifecycleMetrics(payloadFixture(), base);
    expect(metrics.map(item => [item.key, item.value])).toEqual([
      ['created', '12'],
      ['paid', '10'],
      ['shipped', '8'],
      ['available', '6'],
      ['collected', '5'],
    ]);
    expect(metrics[1].helper).toBe('83,3 % des commandes créées');
  });

  test('le funnel conserve comptes et pourcentages serveur sans recalcul', () => {
    expect(orders.lifecycleStages(payloadFixture(), base)).toEqual([
      { label: 'Commandes créées', value: '12', rate: '100 %' },
      { label: 'Payées', value: '10', rate: '83,3 %' },
      { label: 'Expédiées', value: '8', rate: '66,7 %' },
      { label: 'Disponibles relais', value: '6', rate: '50 %' },
      { label: 'Retirées', value: '5', rate: '41,7 %' },
    ]);
  });

  test('seules les commandes perdues et warnings réellement fournis deviennent décisions', () => {
    const payload = payloadFixture();
    payload.data_quality.warnings = ['Périmètre partiel'];
    const projected = orders.decisionItems(payload, base);

    expect(projected.map(item => item.label)).toEqual(['Commandes perdues', 'Qualité des données']);
    expect(projected[0]).toEqual(expect.objectContaining({ value: '2', tone: 'critical' }));
    expect(projected[1]).toEqual(expect.objectContaining({ value: '1', tone: 'warning' }));
  });

  test('paiements en attente, blocages, retards, litiges et SLA ne sont jamais déduits du funnel', () => {
    const labels = orders.decisionItems(payloadFixture(), base)
      .map(item => `${item.label} ${item.helper}`)
      .join(' ');

    expect(labels).not.toMatch(/paiements en attente/i);
    expect(labels).not.toMatch(/bloqu/i);
    expect(labels).not.toMatch(/retard/i);
    expect(labels).not.toMatch(/litige/i);
    expect(labels).not.toMatch(/72h|sla/i);
  });

  test('sans pertes ni warning, le bandeau de décision reste vide', () => {
    const payload = payloadFixture();
    payload.funnel.lost = 0;
    expect(orders.decisionItems(payload, base)).toEqual([]);
  });
});
