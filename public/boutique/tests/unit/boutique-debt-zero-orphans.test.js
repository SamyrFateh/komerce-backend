'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC_ROOT = path.resolve(ROOT, '..');

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

  test('le logo-glow hero mort et les !important inline ne reviennent pas', () => {
    const html = read('index.html');
    const hero = read('css/hero.css');

    expect(html).not.toContain('k-hero-logo-glow');
    expect(html).not.toContain('klg-');
    expect(html).not.toMatch(/style=["'][^"']*!important[^"']*["']/i);
    expect(hero).not.toContain('.k-hero-logo-glow');
    expect(hero).not.toContain('klg-');
  });

  test('la carte Open Graph utilise un asset local réel et la dette asset reste à zéro', () => {
    const html = read('index.html');
    const match = html.match(/<meta\s+property="og:image"\s+content="(\/images\/[^"]+)"\s*>/i);
    const baseline = JSON.parse(read('scripts/.assets-baseline.json'));

    expect(match).not.toBeNull();
    expect(match[1]).toBe('/images/komerce_hero_catalog_canonical_v4.webp');
    expect(fs.existsSync(path.join(PUBLIC_ROOT, match[1].replace(/^\//, '')))).toBe(true);
    expect(baseline).toEqual([]);
    expect(html).not.toContain('/images/og-cover.jpg');
  });
});
