'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/commerce-decision.js'), 'utf8');

test('Vue commerce : plus de carte « Dernières commandes » (dashboard de performance pure)', () => {
  expect(src).not.toContain('Dernières commandes');
  expect(src).not.toContain('commerce-recent-orders');
  expect(src).not.toContain('recentSection');
});

test('Vue commerce : la définition du chiffre d’affaires est explicite', () => {
  expect(src).toContain('Chiffre d’affaires = commandes payées');
});

test('Vue commerce : sous-total monétaire documenté du journal, distinct des ventes et sans substitution du CA', () => {
  expect(src).toContain('Sous-total des flux monétaires clients documentés');
  expect(src).toContain('non disponibles pour cette période — jamais remplacés par les ventes payées');
  expect(src).toContain('Couverture intégrale non certifiée ; distinct des ventes payées');
  expect(src).toContain('EUR non disponible');
  expect(src).toContain('remboursements monétaires confirmés');
  expect(src).toContain('% des lignes produit');
  expect(src).toContain('pas du CA');
});

test('drill acheteurs : période figée, marché, simulation et cardinalité réconciliés',()=>{
  const view=require('../../public/dashboards/canonical/js/commerce-decision');
  const period={from:'2026-10-13T23:00:00.000Z',to:'2026-10-20T12:00:00.000Z',timezone:'Africa/Douala'};
  const model={period:7,period_definition:period,scope:{mode:'market',market:{code:'CM'}},simulation:{scope:'RCT1'},buyer_cohort:{paid_buyers:26,repeat_paid_buyers:1}};
  const url=view.buyerDrillUrl(model,'paid_buyers',2,'/api/admin/dashboard/commerce/market/CM');
  expect(url).toContain('buyer_drill=paid_buyers');
  expect(new URL(url,'https://test.local').searchParams.get('as_of')).toBe(period.to);
  expect(url).toContain('simulation_scope=RCT1');
  expect(view.buyerDrillUrl({...model,buyer_cohort:{paid_buyers:null}},'paid_buyers',1,'/api')).toBeNull();
  const result={kind:'paid_buyers',period:7,period_definition:period,scope:model.scope,simulation:model.simulation,
    pagination:{page:2,page_size:25,total:26,total_pages:2},accounts:[{paid_orders:1,latest_order_reference:'K-ABCDEF'}]};
  expect(view.matchesBuyerDrill(model,'paid_buyers',2,result)).toBe(true);
  expect(view.matchesBuyerDrill(model,'paid_buyers',2,{...result,pagination:{...result.pagination,total:27}})).toBe(false);
  expect(view.matchesBuyerDrill(model,'paid_buyers',2,{...result,scope:{mode:'market',market:{code:'CG'}}})).toBe(false);
  expect(view.matchesBuyerDrill(model,'paid_buyers',2,{...result,simulation:null})).toBe(false);
  expect(view.matchesBuyerDrill(model,'paid_buyers',2,{...result,period_definition:{...period,to:'other'}})).toBe(false);
  expect(view.matchesBuyerDrill(model,'paid_buyers',2,{...result,accounts:[]})).toBe(false);
});
