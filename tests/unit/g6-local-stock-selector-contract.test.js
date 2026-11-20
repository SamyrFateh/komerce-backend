'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * G6 M02/W3: the UI and Chromium runner share an ID-based selector contract.
 * This guards against regressions to ambiguous product name/text selectors.
 */
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

describe('W3 local stock exposure selectors (G6 M02)', () => {
  test('one stock row is identified by its canonical product_id, not its name', () => {
    const src = read('public/dashboards/canonical/js/market-local-offer.js');
    expect(src).toMatch(/\(data\.stock \|\| \[\]\)\.forEach\(\(row\) => \{/);
    expect(src).toContain('card.dataset.localStockCard = String(row.product_id)');
    expect(src).toContain("btn.dataset.localStockExpose = ''");
  });

  test('Chromium selects the exact product ID and the exposed action, without text matching', () => {
    const runner = read('scripts/recette/g6-local-stock-declare-chromium.js');
    expect(runner).toContain("'[data-local-stock-card=\"'+prod.id+'\"]'");
    expect(runner).toContain("card.locator('[data-local-stock-expose]')");
    expect(runner).toContain("check(await card.count()===1,'G6_LOCAL_STOCK_CARD_NOT_UNIQUE')");
    expect(runner).not.toContain('hasText:prod.name');
  });
});
