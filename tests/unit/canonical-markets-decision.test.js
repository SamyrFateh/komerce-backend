'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const marketsDecision = require('../../public/dashboards/canonical/js/markets-decision');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('decision-first Marchés', () => {
  test('projection admin distingue couverture manager, viewer et opérateur sans scope', () => {
    const markets = [
      { code: 'CM', name: 'Cameroun' },
      { code: 'CG', name: 'Congo' },
      { code: 'KM', name: 'Comores' },
    ];
    const users = [
      {
        id: 'op-1', role: 'market_operator', full_name: 'Manager CM',
        market_scopes: [
          { market_code: 'CM', scope_role: 'manager' },
          { market_code: 'CG', scope_role: 'viewer' },
        ],
      },
      { id: 'op-2', role: 'market_operator', full_name: 'Sans scope', market_scopes: [] },
      { id: 'admin-1', role: 'admin', market_scopes: [] },
    ];

    const projection = marketsDecision.adminProjection(markets, users);
    expect(projection.operators).toHaveLength(2);
    expect(projection.scopes).toHaveLength(2);
    expect(projection.managerScopes).toHaveLength(1);
    expect(projection.viewerScopes).toHaveLength(1);
    expect(projection.uncoveredMarkets).toEqual(['CG', 'KM']);
    expect(projection.unscopedOperators.map(user => user.id)).toEqual(['op-2']);

    expect(marketsDecision.adminDecisionItems(markets, users).map(item => item.label)).toEqual([
      'Marchés sans manager',
      'Responsables sans scope',
    ]);
    expect(marketsDecision.adminMetricItems(markets, users).map(item => [item.label, item.value])).toEqual([
      ['Marchés visibles', '3'],
      ['Responsables pays', '2'],
      ['Scopes actifs', '2'],
      ['Scopes manager', '1'],
      ['Scopes viewer', '1'],
    ]);
  });

  test('projection pays reprend uniquement les décisions locales canoniques', () => {
    const workspace = {
      scope: { market_code: 'CM', market_name: 'Cameroun', market_currency: 'XAF' },
      access: { read_only: false },
      capabilities: { local_price_buyer_activation: false },
    };
    const prices = {
      market: { currency: 'XAF' },
      products: [
        { product_ref: 'KPR-1', name: 'A', local_price: 12000, decision_status: 'DRAFT' },
        { product_ref: 'KPR-2', name: 'B', local_price: 15000, decision_status: 'LOCAL_ACTIVE' },
        { product_ref: 'KPR-3', name: 'C', local_price: null, decision_status: null },
      ],
    };

    const projection = marketsDecision.countryProjection(workspace, prices);
    expect(projection.products).toHaveLength(3);
    expect(projection.local).toHaveLength(2);
    expect(projection.active.map(row => row.product_ref)).toEqual(['KPR-2']);
    expect(projection.pending.map(row => row.product_ref)).toEqual(['KPR-1']);

    expect(marketsDecision.countryDecisionItems(workspace, prices).map(item => item.label)).toEqual([
      'Prix locaux à finaliser',
      'Activation acheteur indisponible',
    ]);
    expect(marketsDecision.countryMetricItems(workspace, prices).map(item => [item.label, item.value])).toEqual([
      ['Références observées', '3'],
      ['Décisions locales', '2'],
      ['LOCAL_ACTIVE', '1'],
      ['À finaliser', '1'],
      ['Devise pays', 'XAF'],
    ]);
  });

  test('la projection visuelle reste lecture seule et les deux surfaces chargent le langage decision-first', () => {
    const access = read('public/dashboards/canonical/access.html');
    const autonomy = read('public/dashboards/canonical/market-autonomy.html');
    const projection = read('public/dashboards/canonical/js/markets-decision.js');
    const bootstrap = read('public/dashboards/canonical/js/markets-decision-bootstrap.js');

    for (const html of [access, autonomy]) {
      expect(html).toContain('/dashboards/canonical/css/decision-visual.css');
      expect(html).toContain('/dashboards/canonical/js/primitives.js');
      expect(html).toContain('/dashboards/canonical/js/decision-primitives.js');
      expect(html).toContain('/dashboards/canonical/js/markets-decision.js');
      expect(html).toContain('/dashboards/canonical/js/markets-decision-bootstrap.js');
    }

    expect(projection).not.toContain('/api/');
    expect(bootstrap).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
    expect(bootstrap).toContain('/api/admin/dashboard/context');
    expect(bootstrap).toContain('/api/admin/users?role=market_operator&limit=100');
    expect(bootstrap).toContain('/commercial-prices');
  });
});
