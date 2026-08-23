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

  it('retire la capsule desktop autour des tabs et garde un trait actif', () => {
    const tabs = block('#k-cart-surface-switch.k-cart-tabs');
    expect(tabs).toMatch(/border\s*:\s*0/);
    expect(tabs).toMatch(/border-bottom\s*:\s*1px\s+solid\s+var\(--border\)/);
    expect(tabs).toMatch(/background\s*:\s*var\(--white\)/);
    expect(tabs).toMatch(/box-shadow\s*:\s*none/);
    expect(css).toMatch(/k-tab-personal\.k-cart-tab--active::after[\s\S]*width:\s*32px[\s\S]*height:\s*2px/);
  });

  it('place les lignes sable sur la coque blanche', () => {
    const item = block('.k-sc-item');
    expect(block('.k-sc-items')).toMatch(/background\s*:\s*var\(--white\)/);
    expect(block('.k-sc-items')).toMatch(/gap\s*:\s*8px/);
    expect(item).toMatch(/border\s*:\s*1px\s+solid\s+var\(--item-card-border\)/);
    expect(item).toMatch(/border-radius\s*:\s*13px/);
    expect(item).toMatch(/background\s*:\s*var\(--sand\)/);
  });

  it('ancre le side cart PDP en haut et neutralise le grossissement modal', () => {
    const slot = block('#k-modal .k-modal-cart-slot');
    expect(slot).toMatch(/justify-content\s*:\s*flex-start/);
    expect(slot).toMatch(/padding-block\s*:\s*0/);
    expect(block('.k-side-cart--in-modal .k-sc-item-img')).toMatch(/width\s*:\s*52px/);
    expect(block('.k-side-cart--in-modal .k-sc-item-name')).toMatch(/font-size\s*:\s*12px/);
  });

  it('rend les actions secondaires du footer discrètes', () => {
    expect(block('.k-sc-free-ship')).toMatch(/background\s*:\s*transparent/);
    expect(block('.k-sc-clear')).toMatch(/border\s*:\s*0/);
    expect(block('.k-sc-clear')).toMatch(/width\s*:\s*auto/);
  });
});
