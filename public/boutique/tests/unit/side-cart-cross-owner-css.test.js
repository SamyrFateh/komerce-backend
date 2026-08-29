'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const shared = fs.readFileSync(path.join(ROOT, 'css', 'shared-list-side-cart.css'), 'utf8');
const modal = fs.readFileSync(path.join(ROOT, 'css', 'modal-shell.css'), 'utf8');
const polish = fs.readFileSync(path.join(ROOT, 'css', 'side-cart-desktop-polish.css'), 'utf8');

function esc(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarations(css, selector) {
  const re = new RegExp(`(?:^|\\n)\\s*${esc(selector)}\\s*\\{([\\s\\S]*?)\\}`, 'g');
  const out = [];
  let match;
  while ((match = re.exec(css))) {
    const props = new Map();
    const clean = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const declaration of clean.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim();
      if (/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) props.set(property, value);
    }
    out.push(props);
  }
  return out;
}

function hasProperty(css, selector, property) {
  return declarations(css, selector).some(block => block.has(property));
}

describe('B2 side-cart cross-owner CSS', () => {
  test('le fond desktop du rail appartient au polish', () => {
    const selector = '#k-cart-surface-switch.k-cart-tabs';
    expect(hasProperty(shared, selector, 'background')).toBe(false);
    expect(hasProperty(polish, selector, 'background')).toBe(true);
  });

  test('la géométrie finale du slot panier modal appartient au polish', () => {
    const selector = '#k-modal .k-modal-cart-slot';
    expect(hasProperty(modal, selector, 'justify-content')).toBe(false);
    expect(hasProperty(modal, selector, 'padding-block')).toBe(false);
    expect(hasProperty(polish, selector, 'justify-content')).toBe(true);
    expect(hasProperty(polish, selector, 'padding-block')).toBe(true);
  });

  test('modal-shell conserve les responsabilités structurelles du slot', () => {
    const selector = '#k-modal .k-modal-cart-slot';
    expect(hasProperty(modal, selector, 'display')).toBe(true);
    expect(hasProperty(modal, selector, 'flex-direction')).toBe(true);
    expect(hasProperty(modal, selector, 'box-sizing')).toBe(true);
    expect(hasProperty(modal, selector, 'overflow')).toBe(true);
  });
});
