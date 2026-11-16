'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const order360 = require('../../public/dashboards/canonical/js/order-360');

describe('Order 360 — devise acheteur', () => {
  const base = {
    order: {
      reference: 'KCG123', status: 'ordered', market: { code: 'CG', currency: 'XAF' },
      payment: {
        status: 'paid', total_kmf: 4991, market_total: 12500,
        market_currency: 'XAF', market_total_available: true,
      },
    },
    summary: { items: 1, items_assigned: 0, parcels: 0, open_incidents: 0, documents: 0 },
  };
  test('CG : le total est en XAF et non pas le pivot KMF', () => {
    const metric = order360.metricItems(base).find(x => x.key === 'total');
    expect(metric.value).toContain('12');
    expect(metric.value).toContain('XAF');
    expect(metric.value).not.toContain('KMF');
    expect(metric.value).not.toContain('4 991');
  });
  test('snapshot XAF absent ou incohérent : pas de conversion fictive', () => {
    const order = { ...base.order, payment: { ...base.order.payment, market_total_available: false, market_total: null } };
    expect(order360.formatOrderMarketTotal(order)).toContain('non disponible');
    const mismatched = { ...base.order, payment: { ...base.order.payment, market_currency: 'KMF' } };
    expect(order360.formatOrderMarketTotal(mismatched)).toContain('non disponible');
  });
  test('KM : présentation KMF inchangée', () => {
    const order = {
      ...base.order,
      market: { code: 'KM', currency: 'KMF' },
      payment: { total_kmf: 7990 },
    };
    expect(order360.formatOrderMarketTotal(order)).toMatch(/7\s?990 KMF/);
  });
});
