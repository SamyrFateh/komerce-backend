'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const ui = require('../../public/dashboards/canonical/js/market-ready-to-sell');

const ROOT = path.join(__dirname, '..', '..');

test('formate le corridor dans la devise du marché', () => {
  expect(ui.formatAmount(18500, 'KMF')).toContain('18');
  expect(ui.formatAmount(null, 'KMF')).toBe('—');
});

test('la mise en vente compose les writers canoniques sans market_id navigateur', async () => {
  const calls = [];
  await ui.approveOne({
    row: {
      product_id: 'p1',
      product_ref: 'KPR-1',
      catalog_state: 'candidate',
      local_price_active: false,
      exposure_enabled: false,
    },
    amount: 18500,
    marketCode: 'KM',
    request: async (url, options) => { calls.push({ url, options }); return {}; },
    feedback: () => {},
  });

  expect(calls.map(call => call.url)).toEqual([
    '/api/market-delegation/markets/KM/catalog/review/p1/validate',
    '/api/admin/workspaces/pricing/market/KM/products/KPR-1/local-price',
    '/api/admin/workspaces/pricing/market/KM/products/KPR-1/local-price/activate',
  ]);
  expect(JSON.stringify(calls)).not.toMatch(/market_id|marketId/);
});

test('un produit déjà publié reçoit le prix avant l’exposition', async () => {
  const calls = [];
  await ui.approveOne({
    row: {
      product_id: 'p2',
      product_ref: 'KPR-2',
      catalog_state: 'published',
      local_price_active: false,
      exposure_enabled: false,
    },
    amount: 19000,
    marketCode: 'KM',
    request: async (url, options) => { calls.push({ url, options }); return {}; },
    feedback: () => {},
  });
  expect(calls.map(call => call.url)).toEqual([
    '/api/admin/workspaces/pricing/market/KM/products/KPR-2/local-price',
    '/api/admin/workspaces/pricing/market/KM/products/KPR-2/local-price/activate',
    '/api/market-delegation/markets/KM/catalog/exposure/p2',
  ]);
});

test('la surface exprime la certification amont et le bulk vert uniquement', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'market-ready-to-sell.js'), 'utf8');
  expect(source).toContain('Fiches déjà certifiées et préparées');
  expect(source).toContain('Le bulk ne sélectionne que les lignes 100 % vertes');
  expect(source).toContain('Mettre en vente');
});


test('le handoff Catalogue conserve product_ref jusqu’à la ligne ready-to-sell', () => {
  const ready = fs.readFileSync(path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'market-ready-to-sell.js'), 'utf8');
  const market = fs.readFileSync(path.join(ROOT, 'public', 'dashboards', 'canonical', 'js', 'market-catalog.js'), 'utf8');
  expect(market).toContain("searchParams.get('product_ref')");
  expect(market).toContain('focusedProductRef');
  expect(ready).toContain("tr.setAttribute('data-product-ref'");
  expect(ready).toContain("classList.add('is-context-target')");
  expect(ready).toContain('suite commerciale retrouvée');
});
