'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles.js');

const ROOT = path.resolve(__dirname, '../..');
const legacy = fs.readFileSync(path.join(ROOT, 'css', 'boutique-desktop.css'), 'utf8');
const owner = fs.readFileSync(path.join(ROOT, 'css', 'side-cart-desktop-polish.css'), 'utf8');

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function propsFor(css, selector) {
  const re = new RegExp(`(?:^|\\n)\\s*${esc(selector)}\\s*\\{([\\s\\S]*?)\\}`, 'g');
  const props = new Set();
  let m;
  while ((m = re.exec(css))) {
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      if (/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(prop)) props.add(prop);
    }
  }
  return props;
}

const transferred = {
  '.k-side-cart--in-modal': ['max-height'],
  '.k-sc-header': ['padding', 'background', 'border-top', 'gap'],
  '.k-sc-clear': ['width', 'padding', 'border', 'border-radius', 'font-size'],
  '.k-sc-clear:hover': ['border-color', 'background'],
  '.k-sc-free-ship': ['color', 'background', 'border-radius', 'padding', 'margin-bottom'],
  '.k-sc-items': ['padding'],
  '.k-sc-item': ['gap', 'padding', 'background', 'border-radius', 'border'],
  '.k-sc-item-img': ['width', 'height', 'border-radius'],
  '.k-sc-item-info': ['min-height', 'justify-content', 'gap'],
  '.k-sc-item-name': ['font-size', 'font-weight'],
  '.k-sc-item-meta': ['margin-top'],
  '.k-sc-item-price': ['font-weight', 'letter-spacing'],
  '.k-side-cart--in-modal .k-sc-item': ['align-items', 'padding'],
  '.k-side-cart--in-modal .k-sc-item-img': ['width', 'height'],
  '.k-side-cart--in-modal .k-sc-item-info': ['min-height'],
  '.k-side-cart--in-modal .k-sc-item-name': ['font-size', '-webkit-line-clamp'],
};

describe('B2 side-cart desktop ownership', () => {
  test.each(Object.entries(transferred))('%s ne garde plus les propriétés visuelles transférées', (selector, properties) => {
    const legacyProps = propsFor(legacy, selector);
    const ownerProps = propsFor(owner, selector);
    for (const prop of properties) {
      expect(ownerProps.has(prop)).toBe(true);
      expect(legacyProps.has(prop)).toBe(false);
    }
  });

  test('le polish reste après boutique-desktop dans le bundle desktop', () => {
    const desktop = BUNDLES.find(b => b.out === 'desktop.css');
    expect(desktop).toBeDefined();
    expect(desktop.files.indexOf('boutique-desktop')).toBeGreaterThanOrEqual(0);
    expect(desktop.files.indexOf('side-cart-desktop-polish')).toBeGreaterThan(desktop.files.indexOf('boutique-desktop'));
  });
});
