'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn() }));

describe('L3 — Order 360 : date au fuseau métier du marché', () => {
  test('le service expose le fuseau du marché de la commande (UTC signalé si marché non mappé)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/order-360.js'), 'utf8');
    expect(src).toContain("require('./market-business-day')");
    expect(src).toContain('business_timezone: resolveBusinessTimezone({ code: order.market_code }).timezone');
  });

  test('le front formate avec le fuseau du serveur : 17/10 22:48Z = 18/10 01:48 aux Comores', () => {
    globalThis.KomerceBusinessDate = require('../../public/dashboards/canonical/js/business-date');
    try {
      const front = require('../../public/dashboards/canonical/js/order-360.js');
      expect(front.formatDate('2026-10-17T22:48:00Z', 'Indian/Comoro')).toBe('18/10/2026 01:48');
      expect(front.formatDate('2026-10-17T22:48:00Z', 'Africa/Douala')).toBe('17/10/2026 23:48');
    } finally {
      delete globalThis.KomerceBusinessDate;
    }
  });
});

describe('G6-CLEANUP D — Order 360 contrôle admin',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/order-360.js'),'utf8');
 test('bouton visible seulement admin G6 à statut avancé',()=>{
  expect(source).toContain("order.simulation_scope!=='G6-BUYER'");
  expect(source).toContain("options.user?.role!=='admin'");
  expect(source).toContain("['preparation','shipped','in_transit','available']");
  expect(source).toContain('Clôturer la recette (marchandise au Hub)');
 });
 test('ne clique que sur la route spécialisée avec motif et relecture',()=>{
  expect(source).toContain('/close-g6-hub-recipe');
  expect(source).toContain('reason:reason.trim()');
  expect(source).toContain("refreshed.payload.order.status!=='cancelled'");
 });
});
