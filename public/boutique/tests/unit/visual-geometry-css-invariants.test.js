/**
 * @komerce-arch-lite
 * @role          visual-geometry-css-invariants
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/visual-geometry-css-invariants.test.js
 * @purpose       Verrouille les corrections CSS de la campagne QA visuelle
 *                2026-08 (LOT 1–4 : onglets side cart, recap check, card-name
 *                desktop, chips paiement autonomes) contre toute régression
 *                silencieuse dans les sources CSS.
 *                Équivalent Jest des invariants G6 du spec Playwright
 *                visual-geometry-audit.spec.js (projectable sans navigateur).
 * @impact-areas  shared-cart, checkout, catalogue, css
 * @version       2026-08-qa
 * @test-kind     unit
 * @test-runner   jest
 * @test-requires none
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const CSS = path.resolve(__dirname, '../../css');

function readCss(name) {
  return fs.readFileSync(path.join(CSS, name), 'utf8');
}

describe('QA visuelle — invariants CSS statiques (LOT 1–4, 2026-08)', () => {
  // ── LOT 1 — Onglets side cart ─────────────────────────────────────────────
  describe('LOT 1 — shared-list-side-cart.css : centrage onglets', () => {
    let css;
    beforeAll(() => { css = readCss('shared-list-side-cart.css'); });

    it('LOT1-a : .k-cart-tab possède text-align:center (centrage cross-browser)', () => {
      const block = css.match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/text-align\s*:\s*center/);
    });

    it('LOT1-b : .k-cart-tab possède line-height:1 (parité de hauteur avec .k-cart-tab-exit)', () => {
      const block = css.match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/line-height\s*:\s*1\b/);
    });

    it('LOT1-c : .k-cart-tab-group .k-tab-shared-list possède padding-left:26px (centrage optique vs ×)', () => {
      const block = css.match(/\.k-cart-tab-group\s+\.k-tab-shared-list\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/padding-left\s*:\s*26px/);
    });

    it('LOT1-d : .k-cart-tab-exit conserve line-height:1 (intacte)', () => {
      const block = css.match(/\.k-cart-tab-exit\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/line-height\s*:\s*1\b/);
    });

    it('LOT1-e : .k-cart-tab-exit conserve son width:26px (correspond au padding-left du label)', () => {
      const block = css.match(/\.k-cart-tab-exit\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/width\s*:\s*26px/);
    });

    it('LOT1-f : .k-list-indicator est masqué (rétrocompat preservée)', () => {
      const block = css.match(/\.k-list-indicator\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/display\s*:\s*none/);
    });
  });

  // ── LOT 2 — Récapitulatif checkout ───────────────────────────────────────
  describe('LOT 2 — checkout-vertical-rail.css : ✓ centré', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('LOT2-a : .ck-recap-check possède line-height:1 (✓ centré sans décalage typo)', () => {
      const block = css.match(/\.ck-recap-check\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/line-height\s*:\s*1\b/);
    });

    it('LOT2-b : .ck-recap-check conserve display:flex + align-items:center + justify-content:center', () => {
      const block = css.match(/\.ck-recap-check\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/display\s*:\s*flex/);
      expect(block).toMatch(/align-items\s*:\s*center/);
      expect(block).toMatch(/justify-content\s*:\s*center/);
    });
  });

  // ── LOT 3 — Badges paiement autonomes ────────────────────────────────────
  describe('LOT 3 — checkout-vertical-rail.css : em.ck-soon / em.ck-stripe-tag autonomes', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('LOT3-a : .ck-chip-lbl em.ck-soon — display:inline-block déclaré', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-soon\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/display\s*:\s*inline-block/);
    });

    it('LOT3-b : .ck-chip-lbl em.ck-soon — background déclaré (badge visible sans cascade cart.css)', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-soon\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/background\s*:/);
    });

    it('LOT3-c : .ck-chip-lbl em.ck-soon — color déclaré', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-soon\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/color\s*:/);
    });

    it('LOT3-d : .ck-chip-lbl em.ck-soon — font-style:normal (pas de texte incliné)', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-soon\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/font-style\s*:\s*normal/);
    });

    it('LOT3-e : .ck-chip-lbl em.ck-stripe-tag — display:inline-block déclaré', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/display\s*:\s*inline-block/);
    });

    it('LOT3-f : .ck-chip-lbl em.ck-stripe-tag — background déclaré', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/background\s*:/);
    });

    it('LOT3-g : .ck-chip-lbl em.ck-stripe-tag — font-style:normal', () => {
      const block = css.match(/\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/font-style\s*:\s*normal/);
    });
  });

  // ── LOT 4 — Cartes produit desktop ───────────────────────────────────────
  describe('LOT 4 — products.css : .k-card-name 2 lignes desktop', () => {
    let css;
    beforeAll(() => { css = readCss('products.css'); });

    it('LOT4-a : .k-card-name desktop surcharge -webkit-line-clamp à 2 (cohérence avec min-height:2.4em)', () => {
      // Le bloc @media ((min-width: 900px)) doit contenir .k-card-name avec clamp:2
      const mediaBlock = css.match(/@media\s*\(\(min-width:\s*900px\)\)[\s\S]*?\.k-card-name\s*\{([^}]+)\}/)?.[1] ?? '';
      expect(mediaBlock).toMatch(/-webkit-line-clamp\s*:\s*2\b/);
    });

    it('LOT4-b : .k-card-name mobile conserve -webkit-line-clamp:1 (non modifié)', () => {
      // Le bloc mobile (AVANT tout @media) contient le clamp d'origine
      const mobileBlock = css.match(/\.k-card-name\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(mobileBlock).toMatch(/-webkit-line-clamp\s*:\s*1\b/);
    });
  });

  // ── Intégrité bundle ─────────────────────────────────────────────────────
  describe('Bundle — components.css inclut les 4 feuilles modifiées', () => {
    it('LOT-bundle : shared-list-side-cart, checkout-vertical-rail et products dans components.css', () => {
      const { BUNDLES } = require('../../scripts/css-bundles');
      const comp = BUNDLES.find((b) => b.out === 'components.css');
      expect(comp).toBeDefined();

      ['shared-list-side-cart', 'checkout-vertical-rail', 'products'].forEach((f) => {
        expect(comp.files).toContain(f);
      });
    });
  });
});
