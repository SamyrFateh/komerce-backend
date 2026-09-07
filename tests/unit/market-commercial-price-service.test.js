'use strict';

const fs = require('fs');
const path = require('path');
const service = require('../../services/market-commercial-price-service');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('market commercial price decision boundary', () => {
  test('normalizes a strictly positive local amount', () => {
    expect(service.normalizeAmount('12500')).toBe(12500);
    expect(service.normalizeAmount('12.34567')).toBe(12.3457);
    expect(() => service.normalizeAmount(0)).toThrow(/strictement positif/i);
    expect(() => service.normalizeAmount('x')).toThrow(/strictement positif/i);
  });

  test('requires an auditable reason', () => {
    expect(service.normalizeReason('Test lancement pays')).toBe('Test lancement pays');
    expect(() => service.normalizeReason('x')).toThrow(/motif/i);
  });

  test('migration keeps local price distinct from global products.price_kmf', () => {
    const migration = read('migrations/170_market_commercial_price_drafts.sql');
    expect(migration).toMatch(/product_market_price_drafts/);
    expect(migration).toMatch(/UNIQUE \(market_id, product_id\)/);
    expect(migration).toMatch(/DRAFT_PENDING_GATE/);
    expect(migration).toMatch(/LOCAL_AUTHORIZED_PENDING_CUTOVER/);
    expect(migration).toMatch(/LOCAL_ACTIVE/);
    expect(migration).toMatch(/product_market_price_draft_events/);
    expect(migration).toMatch(/'ACTIVATE'/);
    expect(migration).not.toMatch(/UPDATE\s+products\s+SET\s+price_kmf/i);
  });

  test('country price mutation and activation are manager-owned, not global-admin-owned', () => {
    const route = read('routes/admin-pricing-workspace.js');
    expect(route).toMatch(/function requireCountryStrategyManager/);
    expect(route).toMatch(/req\.user\.role !== 'market_operator'/);
    expect(route).toMatch(/requireMarketScopeRole\('manager'\)/);
    expect(route).toMatch(/products\/:productRef\/local-price\/activate/);
    expect(route).toMatch(/local_price_buyer_activation: true/);
    expect(route).toMatch(/can_activate_local_prices: false/);
  });

  test('viewer can inspect the gate but cannot activate; UI names LOCAL_ACTIVE explicitly', () => {
    const route = read('routes/admin-pricing-workspace.js');
    const ui = read('public/dashboards/canonical/js/market-autonomy.js');
    expect(route).toMatch(/local-price\/activation-preview/);
    expect(route).toMatch(/local-price\/activate', requireCountryStrategyManager/);
    expect(ui).toMatch(/Voir l’impact/);
    expect(ui).toMatch(/LOCAL_ACTIVE/);
    expect(ui).toMatch(/Viewer · lecture seule/);
  });
});
