'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Boutique Debt Zero — orphan shared-cart desktop selectors', () => {
  test('les sélecteurs shared-cart historiques ne reviennent pas dans boutique-desktop.css', () => {
    const css = read('css/boutique-desktop.css');
    const deadSelectors = [
      '.k-sc-shared-badge',
      '.k-sc-shared-badge-row',
      '.k-sc-shared-dot',
      '.k-sc-shared-label',
      '.k-sc-reshare-btn',
      '.k-sc-group-view-btn',
      '@keyframes kSharedPulse',
    ];

    for (const selector of deadSelectors) {
      expect(css).not.toContain(selector);
    }
  });

  test('le garde de compatibilité k-sc-btn-group reste assumé', () => {
    const css = read('css/boutique-desktop.css');
    const contract = read('js/b-product-open-contract.js');

    expect(css).toContain('.k-sc-btn-group { display: none; }');
    expect(contract).toContain("'.k-sc-btn-group'");
  });
});
