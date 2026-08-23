'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const CSS = path.resolve(__dirname, '../../css/side-cart-desktop-polish.css');
const css = fs.readFileSync(CSS, 'utf8');

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 's'))?.[1] || '';
}

describe('side cart desktop polish', () => {
  it('aligne la typographie titre/prix sur la ligne canonique panier/liste', () => {
    expect(block('.k-sc-item-name')).toMatch(/font-size\s*:\s*12px/);
    expect(block('.k-sc-item-name')).toMatch(/font-weight\s*:\s*500/);
    expect(block('.k-sc-item-info')).toMatch(/gap\s*:\s*2px/);
    expect(block('.k-sc-item-meta')).toMatch(/margin-top\s*:\s*0/);
    expect(block('.k-sc-item-price')).toMatch(/font-size\s*:\s*12px/);
    expect(block('.k-sc-item-price')).toMatch(/font-weight\s*:\s*850/);
  });

  it('aligne la barre des tabs sur la hauteur responsive du header desktop', () => {
    const tabs = block('#k-cart-surface-switch.k-cart-tabs');
    expect(tabs).toMatch(/--k-side-cart-bar-h\s*:\s*68px/);
    expect(tabs).toMatch(/height\s*:\s*var\(--k-side-cart-bar-h\)/);
    expect(block('#k-cart-surface-switch .k-cart-tab')).toMatch(/height\s*:\s*var\(--k-side-cart-bar-h\)/);
    expect(block('#k-cart-surface-switch .k-cart-tab-group')).toMatch(/height\s*:\s*var\(--k-side-cart-bar-h\)/);
    expect(block('#k-cart-surface-switch .k-cart-tab-exit')).toMatch(/height\s*:\s*var\(--k-side-cart-bar-h\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1200px\)[\s\S]*--k-side-cart-bar-h\s*:\s*72px/);
  });

  it('ouvre la navigation sans barre de séparation et garde le seul trait actif', () => {
    const tabs = block('#k-cart-surface-switch.k-cart-tabs');
    expect(block('.k-side-cart')).toMatch(/border-left\s*:\s*0/);
    expect(block('.k-side-cart')).toMatch(/background\s*:\s*var\(--sand\)/);
    expect(tabs).toMatch(/border\s*:\s*0/);
    expect(tabs).not.toMatch(/border-bottom/);
    expect(tabs).toMatch(/background\s*:\s*var\(--sand\)/);
    expect(tabs).toMatch(/box-shadow\s*:\s*none/);
    expect(css).toMatch(/k-tab-personal\.k-cart-tab--active::after[\s\S]*width:\s*32px[\s\S]*height:\s*2px/);
  });

  it('présente les articles comme des lignes ouvertes sans cartes', () => {
    const item = block('.k-sc-item');
    const snapshot = block('.k-cart-snapshot-item,\n  .k-cart-snapshot-item.is-cart-item-claimed');
    expect(block('.k-sc-items')).toMatch(/background\s*:\s*var\(--sand\)/);
    expect(block('.k-sc-items')).toMatch(/gap\s*:\s*8px/);
    expect(item).toMatch(/padding\s*:\s*8px\s+0/);
    expect(item).toMatch(/border\s*:\s*0/);
    expect(item).toMatch(/border-radius\s*:\s*0/);
    expect(item).toMatch(/background\s*:\s*transparent/);
    expect(block('.k-sc-item-img')).toMatch(/border\s*:\s*0/);
    expect(snapshot).toMatch(/border\s*:\s*0/);
    expect(snapshot).toMatch(/box-shadow\s*:\s*none/);
  });

  it('porte la signature Komerce sans réintroduire de contours', () => {
    expect(css).toMatch(/k-cart-tab--active[\s\S]*color:\s*var\(--ocean-dark-deep\)/);
    expect(css).toMatch(/k-tab-personal\.k-cart-tab--active::after[\s\S]*background:\s*var\(--cta-green\)/);
    expect(block('.k-sc-item-price,\n  .k-cart-snapshot-item .k-cart-item-price')).toMatch(/color\s*:\s*var\(--coral\)/);
    expect(block('.k-cart-item-select.is-checked')).toMatch(/background\s*:\s*var\(--cta-green\)/);
    expect(block('.k-cart-item-select.is-checked::after')).toMatch(/border-color\s*:\s*var\(--white\)/);
  });

  it('ancre le side cart PDP en haut et neutralise le grossissement modal', () => {
    const slot = block('#k-modal .k-modal-cart-slot');
    expect(slot).toMatch(/justify-content\s*:\s*flex-start/);
    expect(slot).toMatch(/padding-block\s*:\s*0/);
    expect(block('.k-side-cart--in-modal .k-sc-item-img')).toMatch(/width\s*:\s*52px/);
    expect(block('.k-side-cart--in-modal .k-sc-item-name')).toMatch(/font-size\s*:\s*12px/);
  });

  it('rend le footer et ses actions secondaires discrets', () => {
    expect(block('.k-sc-header')).toMatch(/border-top\s*:\s*0/);
    expect(block('.k-sc-free-ship')).toMatch(/background\s*:\s*transparent/);
    expect(block('.k-sc-clear')).toMatch(/border\s*:\s*0/);
    expect(block('.k-sc-clear')).toMatch(/width\s*:\s*auto/);
  });
});
