/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const fs = require('fs');
const path = require('path');
jest.mock('../../db', () => ({ getClient: jest.fn() }));
const service = require('../../services/market-commercial-price-service');
const db = require('../../db');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('market commercial price decision boundary', () => {
  test.each([
    [{ local_price: 12500 }, 'market_price_activation_snapshot_stale'],
    [{ currency: 'KMF' }, 'market_price_activation_snapshot_stale'],
    [{ market_code: 'CG' }, 'market_price_activation_snapshot_stale'],
    [{ product_ref: 'OTHER' }, 'market_price_activation_snapshot_stale'],
    [{ activation_allowed: false }, 'market_price_activation_not_allowed'],
  ])('rejects a mismatched economic proof under the draft lock (%j)', async (patch, code) => {
    const query = jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'product-id', product_ref: 'SKU', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ amount: '15000.0000', currency: 'XAF', status: service.PRICE_STATUSES.DRAFT }] })
      .mockResolvedValueOnce({});
    const release = jest.fn();
    const getClient = jest.spyOn(db, 'getClient').mockResolvedValue({ query, release });

    try {
      await expect(service.authorizeMarketPriceDraft({
        market: { id: 'market-id', code: 'CM', currency: 'XAF' },
        productRef: 'SKU',
        reason: 'Autorisation économique de recette',
        actorId: 'actor-id',
        authorizationSnapshot: {
          product_ref: 'SKU', market_code: 'CM', local_price: 15000,
          currency: 'XAF', activation_allowed: true, ...patch,
        },
      })).rejects.toMatchObject({ status: 409, code });
      expect(query.mock.calls[2][0]).toMatch(/FOR UPDATE/);
      expect(query.mock.calls.slice(3)).toEqual([['ROLLBACK']]);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      getClient.mockRestore();
    }
  });

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

  // Exception Admin centrale explicitement bornée au Catalogue pays :
  // le pricing global seul n'ouvre pas les observations ni les stratégies.
  test('Catalogue pays : Admin vérifié ou capability locale, sans bypass des observations', () => {
    const route = read('routes/admin-pricing-workspace.js');
    expect(route).toMatch(/function requireLocalStrategyCapability/);
    const local = route.match(/function requireLocalStrategyCapability\([^)]*\)\s*{[\s\S]*?\n}/)[0];
    expect(local).not.toMatch(/pricingGlobalAuthority/);
    expect(route).toMatch(/function requireCatalogPriceCapability/);
    expect(route).toMatch(/SELECT role FROM users WHERE id=\$1::uuid/);
    expect(route).toMatch(/products\/:productRef\/local-price', requireCatalogPriceCapability\('pricing\.decide'\)/);
    expect(route).toMatch(/products\/:productRef\/local-price\/activate', requireCatalogPriceCapability\('pricing\.activate'\)/);
    expect(route).toMatch(/price-observations', requireLocalStrategyCapability\('market\.observation\.record'\)/);
    expect(route).toMatch(/local_price_buyer_activation: true/);
    // La projection Pricing globale reste indépendante de l'exception Catalogue pays.
    expect(route).toMatch(/can_activate_local_prices: false/);
  });

  test('viewer can inspect the gate but cannot activate; UI names LOCAL_ACTIVE explicitly', () => {
    const route = read('routes/admin-pricing-workspace.js');
    const ui = read('public/dashboards/canonical/js/market-autonomy.js');
    expect(route).toMatch(/local-price\/activation-preview/);
    expect(route).toMatch(/local-price\/activate', requireCatalogPriceCapability\('pricing\.activate'\)/);
    expect(ui).toMatch(/Vérifier le prix/);
    expect(ui).toMatch(/LOCAL_ACTIVE/);
    expect(ui).toMatch(/Viewer · lecture seule/);
  });
});
