/**
 * @komerce-arch-lite
 * @role          visual-geometry-css-invariants
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/visual-geometry-css-invariants.test.js
 * @purpose       Verrouille les corrections CSS de la campagne QA visuelle
 *                2026-08 (LOT 1–6 : onglets side cart, recap check, card-name
 *                desktop, chips paiement autonomes, checkout neutre, drawers) contre toute régression
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

describe('QA visuelle — invariants CSS statiques (LOT 1–6, 2026-08)', () => {
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

    it('LOT1-g : les deux onglets occupent deux colonnes égales et leur contenu est centré', () => {
      const tabs = css.match(/\.k-cart-tabs\s*\{([^}]+)\}/s)?.[1] ?? '';
      const tab = css.match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(tabs).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
      expect(tab).toMatch(/display\s*:\s*flex/);
      expect(tab).toMatch(/align-items\s*:\s*center/);
      expect(tab).toMatch(/justify-content\s*:\s*center/);
    });

    it('LOT1-h : Ma liste + sortie portent un unique trait continu dessiné par le groupe', () => {
      const indicator = css.match(
        /\.k-cart-tab-group--active::after\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(indicator).toMatch(/left\s*:\s*0/);
      expect(indicator).toMatch(/right\s*:\s*0/);
      expect(indicator).toMatch(/height\s*:\s*3px/);
      expect(indicator).toMatch(/background\s*:\s*var\(--cta-green\)/);

      const children = css.match(
        /\.k-cart-tab-group--active\s+\.k-tab-shared-list\.k-cart-tab--active,\s*\.k-cart-tab-group--active\s+\.k-cart-tab-exit\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(children).toMatch(/box-shadow\s*:\s*none/);
      expect(children).toMatch(/border-bottom\s*:\s*0/);
    });
    it('LOT1-i : la sélection liste garde la même hauteur optique que le stepper panier', () => {
      const box = css.match(/\.k-cart-item-select\s*\{([^}]+)\}/s)?.[1] ?? '';
      const checked = css.match(/\.k-cart-item-select\.is-checked\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(box).toMatch(/width\s*:\s*28px/);
      expect(box).toMatch(/height\s*:\s*28px/);
      expect(box).toMatch(/border\s*:\s*1px\s+solid\s+var\(--stepper-border\)/);
      expect(checked).toMatch(/background\s*:\s*var\(--green-soft\)/);
      expect(checked).toMatch(/border-color\s*:\s*var\(--cta-green\)/);
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
  describe('LOT 3 — checkout-vertical-rail.css : em.ck-soon / em.ck-stripe-tag surcharges géométriques', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('LOT3 : sélecteur combiné present — border-radius:999px, padding, margin-top surchargés', () => {
      // La règle combinée (.ck-soon, .ck-stripe-tag { border-radius:999px; padding:2px 6px; margin-top:4px })
      // est dans la baseline css-guard (conflits légitimes avec cart.css déjà figés).
      // background et color restent dans cart.css — les redéclarer ici avec des valeurs différentes
      // crée de nouveaux conflits hors baseline (vérifié empiriquement par css-guard --strict).
      const combined = css.match(
        /\.ck-chip-lbl\s+em\.ck-soon[\s\S]{0,200}\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/
      );
      const block = combined ? combined[1] : '';
      expect(block).toBeTruthy(); // Règle combinée .ck-soon/.ck-stripe-tag introuvable
      expect(block).toMatch(/border-radius\s*:\s*999px/);
      expect(block).toMatch(/padding\s*:/);
      expect(block).toMatch(/margin-top\s*:/);
      // Invariant css-guard : background et color ne doivent PAS être dans cette règle
      expect(block).not.toMatch(/background\s*:/);
      expect(block).not.toMatch(/\bcolor\s*:/);
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

  // ── LOT 5 — Checkout final neutre et compact ─────────────────────────────
  describe('LOT 5 — checkout-vertical-rail.css : hiérarchie neutre', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('LOT5-a : le header reprend le graphite neutre du mock, jamais un bandeau vert', () => {
      const block = css.match(/\.k-order-header\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/background\s*:\s*var\(--checkout-neutral\)/);
      expect(block).toMatch(/color\s*:\s*var\(--white\)/);
      expect(block).not.toMatch(/gradient|checkout-accent|cta-green/);
    });

    it('LOT5-b : les moyens de paiement restent compacts en grille 2x2 desktop', () => {
      const chip = css.match(/\.ck-pay-chip\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(chip).toMatch(/min-height\s*:\s*52px/);
      expect(chip).toMatch(/border\s*:\s*1px\s+solid\s+rgba\(31,48,36,.11\)/);
      expect(chip).toMatch(/border-radius\s*:\s*11px/);

      const desktop = css.match(/@media\s*\(min-width:\s*900px\)[\s\S]*?\.ck-pay-grid\s*\{([^}]+)\}/)?.[1] ?? '';
      expect(desktop).toMatch(/grid-template-columns\s*:\s*repeat\(2,/);
    });

    it('LOT5-c : le CTA engageant reste graphite et compact', () => {
      const block = css.match(/\.k-order-overlay\.open\s+\.ck-confirm-btn\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/min-height\s*:\s*52px/);
      expect(block).toMatch(/border-radius\s*:\s*12px/);
      expect(block).toMatch(/background\s*:\s*linear-gradient\(90deg,\s*var\(--checkout-neutral-deep\),\s*var\(--checkout-neutral-mid\)\)/);
      expect(block).not.toMatch(/checkout-accent|cta-green/);
    });

    it('LOT5-d : les cartes de contexte et le modal desktop gardent la géométrie finale', () => {
      const header = css.match(/\.ck-step-header\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(header).toMatch(/min-height\s*:\s*50px/);
      expect(header).toMatch(/border-radius\s*:\s*12px/);

      const modal = css.match(
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.k-order-overlay\.open\s+\.k-order-modal\s*\{([^}]+)\}/
      )?.[1] ?? '';
      expect(modal).toMatch(/width\s*:\s*min\(540px,\s*calc\(100vw - 48px\)\)/);
      expect(modal).toMatch(/max-width\s*:\s*540px/);
    });
  });

  // ── LOT 6 — Drawers lisibles desktop et mobile ───────────────────────────
  describe('LOT 6 — drawers : largeur et respiration', () => {
    it('LOT6-a : le side cart desktop réserve 296px puis 320px', () => {
      const css = readCss('layout.css');
      expect(css).toMatch(/--sc-reserve-w\s*:\s*296px/);
      expect(css).toMatch(/--sc-reserve-w\s*:\s*320px/);
    });

    it('LOT6-b : le drawer de liste mobile conserve marge et espacement entre les lignes', () => {
      const css = readCss('shared-list-side-cart.css');
      const block = css.match(/\.k-cart-drawer\[data-mode="shared-list"\]\s+#k-cart-body\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/gap\s*:\s*6px/);
      expect(block).toMatch(/padding\s*:\s*8px\s+10px/);
    });

    it('LOT6-c : le side cart personnel possède un contour jaune commerce complet', () => {
      const css = readCss('boutique-desktop.css');
      const block = css.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/border\s*:\s*1px\s+solid\s+var\(--commerce-yellow\)/);
      expect(block).toMatch(/border-top-width\s*:\s*3px/);
    });

    it('LOT6-d : la liste recolore le contour entier en vert', () => {
      const css = readCss('shared-list-side-cart.css');
      const block = css.match(/#k-side-cart\[data-mode="shared-list"\]\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/border-color\s*:\s*var\(--cta-green\)/);
    });
  });

  // ── Intégrité bundle ─────────────────────────────────────────────────────
  describe('Bundle — components.css inclut les feuilles visuelles concernées', () => {
    it('LOT-bundle : shared-list-side-cart, checkout-vertical-rail et products dans components.css', () => {
      const { BUNDLES } = require('../../scripts/css-bundles');
      const comp = BUNDLES.find((b) => b.out === 'components.css');
      expect(comp).toBeDefined();

      ['shared-list-side-cart', 'checkout-vertical-rail', 'products'].forEach((f) => {
        expect(comp.files).toContain(f);
      });
    });
  });

  // ── LOT 7 — Parité ligne produit panier / liste ──────────────────────────
  describe('LOT 7 — panier et liste : géométrie de ligne canonique', () => {
    let cart;
    let shared;
    let responsive;

    beforeAll(() => {
      cart = readCss('cart.css');
      shared = readCss('shared-list-side-cart.css');
      responsive = readCss('shared-list-side-cart-responsive.css');
    });

    function prop(block, name) {
      return block.match(
        new RegExp(name + '\\s*:\\s*([^;]+)')
      )?.[1]?.trim();
    }

    it('LOT7-a : la carte snapshot reprend gap, hauteur, padding et radius du panier', () => {
      const personal =
        cart.match(/\\.k-cart-item\\s*\\{([^}]+)\\}/s)?.[1] ?? '';
      const snapshot =
        shared.match(/\\.k-cart-snapshot-item\\s*\\{([^}]+)\\}/s)?.[1] ?? '';

      expect(prop(snapshot, 'gap')).toBe(prop(personal, 'gap'));
      expect(prop(snapshot, 'min-height')).toBe(prop(personal, 'min-height'));
      expect(prop(snapshot, 'padding')).toBe(prop(personal, 'padding'));
      expect(prop(snapshot, 'border-radius')).toBe(prop(personal, 'border-radius'));
    });

    it('LOT7-b : le gap image → texte reste le gap canonique de 10px', () => {
      const personal =
        cart.match(/\\.k-cart-item\\s*\\{([^}]+)\\}/s)?.[1] ?? '';
      const open =
        shared.match(/\\.k-cart-snapshot-item-open\\s*\\{([^}]+)\\}/s)?.[1] ?? '';

      expect(prop(open, 'gap')).toBe(prop(personal, 'gap'));
    });

    it('LOT7-c : aucune surcharge desktop ne redimensionne image/info/nom snapshot', () => {
      expect(responsive).not.toMatch(
        /#k-side-cart\\s+\\.k-cart-snapshot-item\\s+\\.k-cart-item-img/
      );
      expect(responsive).not.toMatch(
        /#k-side-cart\\s+\\.k-cart-snapshot-item\\s+\\.k-cart-item-info/
      );
      expect(responsive).not.toMatch(
        /#k-side-cart\\s+\\.k-cart-snapshot-item\\s+\\.k-cart-item-name/
      );
    });
  });


  // ── LOT 8 — accent commerce jaune ─────────────────────────────
  describe('LOT 8 — accent commerce jaune', () => {
    let tokens;
    let products;
    let cart;
    let layout;

    beforeAll(() => {
      tokens = readCss('tokens.css');
      products = readCss('products.css');
      cart = readCss('cart.css');
      layout = readCss('layout.css');
    });

    it('LOT8-a : le jaune commerce est tokenisé', () => {
      expect(tokens).toMatch(/--commerce-yellow\s*:\s*#FFD400/);
    });

    it('LOT8-b : promo = jaune + texte sombre', () => {
      const block =
        products.match(/\.k-card-promo\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(block).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );
      expect(block).toMatch(/color\s*:\s*var\(--text\)/);
    });

    it('LOT8-c : ajouter = jaune et in-cart reste vert', () => {
      const add =
        products.match(/\.k-card-add\s*\{([^}]+)\}/s)?.[1] ?? '';
      const plus =
        products.match(/\.k-card-add-plus\s*\{([^}]+)\}/s)?.[1] ?? '';
      const inCart =
        products.match(/\.k-card-add\.in-cart\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(add).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );
      expect(plus).toMatch(/font-size\s*:\s*18px/);
      expect(plus).toMatch(/color\s*:\s*var\(--text\)/);
      expect(inCart).toMatch(
        /background\s*:\s*var\(--cta-green\)/
      );
    });

    it('LOT8-d : cercle ajouter desktop = 34x34', () => {
      expect(cart).toMatch(
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.k-card-add\s*\{[^}]*width:\s*34px[^}]*height:\s*34px/
      );
    });

    it('LOT8-e : badge panier header = jaune commerce', () => {
      const badge =
        layout.match(/\.k-cart-badge\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(badge).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );
      expect(badge).toMatch(/color\s*:\s*var\(--text\)/);
    });

    it('LOT8-f : logo et avatar desktop sans marge parasite', () => {
      expect(layout).toMatch(
        /\.k-logo\s*\{\s*min-width:\s*148px;\s*justify-content:\s*center;\s*\}/
      );

      expect(layout).toMatch(
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.k-cart-btn\s*\{[^}]*margin-left:\s*0;[^}]*margin-right:\s*0;/
      );
    });
  });

  // ── LOT 9 — vérité visuelle side-cart / mobile ──────────────────────
  describe('LOT 9 — vérité visuelle side-cart / mobile', () => {
    it('LOT9-a : Mon panier est jaune commerce, Ma liste reste verte', () => {
      const desktop = readCss('boutique-desktop.css');
      const shared = readCss('shared-list-side-cart.css');
      const cart = readCss('cart.css');

      const sideCart =
        desktop.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] ?? '';

      const personalTab =
        shared.match(
          /\.k-cart-tabs\[data-active="personal"\]\s+\.k-tab-personal\.k-cart-tab--active\s*\{([^}]+)\}/s
        )?.[1] ?? '';

      const drawer =
        cart.match(/\.k-cart-drawer\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(sideCart).toMatch(
        /border\s*:\s*1px\s+solid\s+var\(--commerce-yellow\)/
      );

      expect(personalTab).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );

      expect(shared).toMatch(
        /#k-side-cart\[data-mode="shared-list"\][^{]*\{[^}]*border-color\s*:\s*var\(--cta-green\)/
      );

      expect(drawer).toMatch(
        /border-top\s*:\s*4px\s+solid\s+var\(--commerce-yellow\)/
      );
    });

    it('LOT9-b : snapshot et panier partagent la géométrie canonique image / texte', () => {
      const cart = readCss('cart.css');
      const shared = readCss('shared-list-side-cart.css');

      const personal =
        cart.match(/\.k-cart-item\s*\{([^}]+)\}/s)?.[1] ?? '';

      const snapshot =
        shared.match(/\.k-cart-snapshot-item\s*\{([^}]+)\}/s)?.[1] ?? '';

      const open =
        shared.match(/\.k-cart-snapshot-item-open\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(personal).toMatch(/display\s*:\s*grid/);
      expect(personal).toMatch(
        /grid-template-columns\s*:\s*52px\s+minmax\(0,1fr\)\s+auto/
      );

      expect(snapshot).toMatch(/display\s*:\s*grid/);
      expect(snapshot).toMatch(
        /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto/
      );

      expect(open).toMatch(/display\s*:\s*grid/);
      expect(open).toMatch(
        /grid-template-columns\s*:\s*52px\s+minmax\(0,\s*1fr\)/
      );
      expect(open).toMatch(/gap\s*:\s*10px/);
    });

    it('LOT9-c : layout.css ne possède plus de géométrie panier concurrente', () => {
      const layout = readCss('layout.css');

      expect(layout).not.toMatch(
        /\.k-cart-item\s*\{[^}]*padding:\s*10px\s+0[^}]*gap:\s*12px/
      );

      expect(layout).not.toMatch(
        /\.k-cart-item-img\s*\{[^}]*width:\s*60px[^}]*height:\s*60px/
      );
    });

    it('LOT9-d : le stepper suggestion mobile reste compact à 76x30', () => {
      const polish = readCss('modal-product-polish.css');

      expect(polish).toMatch(
        /@media\s*\(max-width:\s*899px\)[\s\S]*?--k-sug-action-width:\s*76px;[\s\S]*?--k-sug-action-height:\s*30px;/
      );
    });

    it('LOT9-e : badges et + de la modale utilisent le jaune commerce avec un owner unique', () => {
      const modal = readCss('modal-product.css');
      const polish = readCss('modal-product-polish.css');
      const interactions = readCss('interactions.css');

      const promo =
        modal.match(/\.k-modal-promo-badge\s*\{([^}]+)\}/s)?.[1] ?? '';

      const sugPromo =
        interactions.match(/\.k-sug-promo-badge\s*\{([^}]+)\}/s)?.[1] ?? '';

      const modalSugPromo =
        modal.match(/\.k-sug-promo-badge\s*\{([^}]+)\}/s)?.[1] ?? '';

      const add =
        polish.match(/#k-modal\s+\.k-sug-add\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(promo).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );

      expect(sugPromo).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );

      expect(sugPromo).toMatch(
        /color\s*:\s*var\(--text\)/
      );

      expect(modalSugPromo).not.toMatch(/\bbackground\s*:/);
      expect(modalSugPromo).not.toMatch(/\bcolor\s*:/);

      expect(add).toMatch(
        /background\s*:\s*var\(--commerce-yellow\)/
      );
    });
    it('LOT9-f : le carousel catalogue ne peut plus afficher le nom produit comme alt', () => {
      const utils = fs.readFileSync(
        path.resolve(__dirname, '../../js/b-utils.js'),
        'utf8'
      );

      expect(utils).toMatch(
        /class="k-card-slide-img"[^>]*alt=""/
      );

      expect(utils).not.toMatch(
        /class="k-card-slide-img"[^>]*alt="\$\{sanitize\(p\.name/
      );
    });
  });
});
