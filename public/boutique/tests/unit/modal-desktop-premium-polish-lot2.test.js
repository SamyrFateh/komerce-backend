'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const shell = source('css/modal-shell.css');
const hybrid = source('css/modal-product-lot4-hybrid.css');
const polish = source('css/modal-product-polish.css');
const desktopProduct = source('js/b-modal-desktop-product.js');

describe('PDP desktop premium polish — lot 2', () => {
  test('le hero desktop conserve le produit entier', () => {
    const slide = [...shell.matchAll(/#k-modal \.k-modal-slide\s*\{([^}]*)\}/gs)]
      .map((match) => match[1])
      .find((rule) => /object-fit\s*:/.test(rule)) ?? '';
    expect(slide).toMatch(/object-fit:\s*contain/);
    expect(slide).not.toMatch(/object-fit:\s*cover/);
  });

  test('la description transactionnelle est sobre et respirante', () => {
    const desc = hybrid.match(/#k-modal \.k-modal-desc\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(desc).toMatch(/font-style:\s*normal/);
    expect(desc).toMatch(/font-size:\s*13px/);
    expect(desc).toMatch(/margin-bottom:\s*8px/);
  });

  test('le panier est centre sur la modal desktop et garde son offset mobile', () => {
    const beforeMobile = polish.split('/* ── Mobile')[0];
    expect(beforeMobile).not.toMatch(/#k-modal \.k-modal-cart-btn\s*\{/);

    const mobile = polish.match(/@media \(max-width: 899px\) \{([\s\S]*?)\n\}\n\n\/\* ── Desktop/)?.[1] ?? '';
    expect(mobile).toMatch(/#k-modal \.k-modal-cart-btn\s*\{[^}]*position:\s*absolute/s);
    expect(mobile).toMatch(/left:\s*calc\(50%\s*\+\s*18px\)/);

    const desktop = polish.match(/@media \(min-width: 900px\) \{([\s\S]*)/)?.[1] ?? '';
    expect(desktop).toMatch(/#k-modal \.k-modal-cart-btn\s*\{[^}]*position:\s*absolute/s);
    expect(desktop).toMatch(/left:\s*50%/);
    expect(desktop).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
  });

  test('les CTA desktop restent compacts et utilisent des libellés courts', () => {
    const add = shell.match(/#k-modal \.k-modal-product-zone \.k-modal-actions \.k-add-cart-btn\s*\{([^}]*)\}/s)?.[1] ?? '';
    const buy = shell.match(/#k-modal \.k-modal-product-zone \.k-modal-actions \.k-buy-now-btn\s*\{([^}]*)\}/s)?.[1] ?? '';

    expect(add).toMatch(/height:\s*48px/);
    expect(add).toMatch(/font-size:\s*14px/);
    expect(add).toMatch(/flex:\s*0 0 112px/);
    expect(add).toMatch(/width:\s*112px/);
    expect(add).toMatch(/min-width:\s*112px/);
    expect(buy).toMatch(/height:\s*48px/);
    expect(buy).toMatch(/font-size:\s*14px/);
    expect(desktopProduct).toMatch(/textContent\s*=\s*'⚡ Acheter'/);
  });
});
