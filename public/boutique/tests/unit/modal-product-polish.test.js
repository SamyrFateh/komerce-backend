'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Oracle direct de public/boutique/css/modal-product-polish.css.
 * Le nom du test reste volontairement aligné sur le stem de la feuille CSS
 * pour satisfaire le gate touched-tests en mode strict.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CSS_PATH = path.join(ROOT, 'css/modal-product-polish.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

describe('modal-product-polish — invariants topbar mobile', () => {
  test('le panier garde un centre géométrique unique', () => {
    const cart = css.match(
      /#k-modal \.k-modal-cart-btn\s*\{([^}]+)\}/s
    )?.[1] ?? '';

    expect(cart).toMatch(/position\s*:\s*absolute/);
    expect(cart).toMatch(/top\s*:\s*50%/);
    expect(cart).toMatch(/left\s*:\s*50%/);
    expect(cart).toMatch(
      /transform\s*:\s*translate\(-50%,\s*-50%\)/
    );

    expect(css).not.toMatch(
      /#k-modal\.is-scrolled \.k-modal-cart-btn(?::active)?\s*\{/
    );
  });

  test('la cible tactile et l’asset gardent leur emprise mobile canonique', () => {
    const mobile = css.match(
      /@media \(max-width: 899px\) \{([\s\S]*?)\n\}\n\n\/\* ── Desktop/
    )?.[1] ?? '';

    const cart = mobile.match(
      /#k-modal \.k-modal-cart-btn\s*\{([^}]+)\}/s
    )?.[1] ?? '';
    const icon = mobile.match(
      /#k-modal \.k-modal-cart-icon\s*\{([^}]+)\}/s
    )?.[1] ?? '';

    expect(cart).toMatch(/width\s*:\s*42px/);
    expect(cart).toMatch(/height\s*:\s*42px/);
    expect(cart).toMatch(/left\s*:\s*calc\(50%\s*\+\s*18px\)/);
    expect(icon).toMatch(/width\s*:\s*31px/);
    expect(icon).toMatch(/height\s*:\s*31px/);
  });

  test("l'asset panier reste centré dans sa boîte avec ou sans badge", () => {
    const icon = css.match(
      /#k-modal \.k-modal-cart-icon\s*\{([^}]+)\}/s
    )?.[1] ?? '';

    expect(icon).toMatch(/position\s*:\s*absolute/);
    expect(icon).toMatch(/top\s*:\s*50%/);
    expect(icon).toMatch(/left\s*:\s*50%/);
    expect(icon).toMatch(
      /transform\s*:\s*translate\(-50%,\s*-50%\)/
    );
  });

  test('le titre rappelé au scroll respecte la zone de clearance', () => {
    const product = css.match(
      /#k-modal\.is-scrolled \.k-modal-topbar-product\s*\{([^}]+)\}/s
    )?.[1] ?? '';

    expect(product).toMatch(
      /max-width\s*:\s*calc\(50%\s*-\s*34px\)/
    );
    expect(product).toMatch(/margin-left\s*:\s*0/);
  });

  test('reason_label est masqué uniquement dans le scope mobile', () => {
    const mobile = css.match(
      /@media \(max-width: 899px\) \{([\s\S]*?)\n\}\n\n\/\* ── Desktop/
    )?.[1] ?? '';

    expect(mobile).toMatch(
      /#k-modal \.k-sug-card-reason\s*\{[^}]*display\s*:\s*none/s
    );

    const owners = [
      ...css.matchAll(/#k-modal \.k-sug-card-reason\s*\{/g),
    ];

    expect(owners).toHaveLength(1);
  });
});
