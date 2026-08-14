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
  describe('LOT 5 — surfaces transactionnelles accessibles', () => {
    it('retire le drawer fermé de l’arbre visuel et le révèle uniquement à l’ouverture', () => {
      const cart = readCss('cart.css');
      expect(cart).toMatch(/\.k-cart-drawer\s*\{[^}]*visibility:\s*hidden/s);
      expect(cart).toMatch(/\.k-cart-drawer\.open\s*\{[^}]*visibility:\s*visible/s);
    });
  });

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

    it('LOT1-h : rail distinct, panier neutre, liste contextualisée et lignes claimed lisibles', () => {
      const tabs = css.match(/\.k-cart-tabs\s*\{([^}]+)\}/s)?.[1] ?? '';
      const personal = css.match(
        /\.k-cart-tabs\[data-active="personal"\]\s+\.k-tab-personal\.k-cart-tab--active\s*\{([^}]+)\}/s
      )?.[1] ?? '';
      const sharedGroup = css.match(
        /\.k-cart-tab-group--active\s*\{([^}]+)\}/s
      )?.[1] ?? '';
      const claimed = css.match(
        /\.k-cart-snapshot-item\.is-cart-item-claimed\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(tabs).toMatch(/background\s*:\s*var\(--sand\)/);
      expect(tabs).toMatch(/border\s*:\s*1px\s+solid\s+var\(--border\)/);

      expect(personal).toMatch(/background\s*:\s*var\(--white\)/);
      expect(personal).toMatch(/border\s*:\s*1px\s+solid\s+var\(--stone-border\)/);

      expect(sharedGroup).toMatch(/background\s*:\s*var\(--sand-warm\)/);
      expect(sharedGroup).toMatch(/border\s*:\s*1px\s+solid\s+var\(--stone-border\)/);

      expect(claimed).toMatch(/opacity\s*:\s*1\b/);
      expect(claimed).toMatch(/background\s*:\s*var\(--sand\)/);

      const children = css.match(
        /\.k-cart-tab-group--active\s+\.k-tab-shared-list\.k-cart-tab--active,\s*\.k-cart-tab-group--active\s+\.k-cart-tab-exit\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(children).toMatch(/background\s*:\s*transparent/);
      expect(children).toMatch(/box-shadow\s*:\s*none/);
      expect(children).toMatch(/border\s*:\s*0/);
      expect(children).toMatch(/transform\s*:\s*none/);
    });
    it('LOT1-j : les tabs sont le titre unique du side cart desktop', () => {
      const desktop = readCss('boutique-desktop.css');

      const label = desktop.match(
        /#k-side-cart:has\(\.k-cart-tabs\)\s+\.k-sc-title-label\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(label).toMatch(/display\s*:\s*none/);

      expect(desktop).toMatch(
        /#k-side-cart:has\(\.k-cart-tabs\)\s+\.k-sc-title-bar:not\([\s\S]*?display:\s*none/
      );
    });

    it('LOT1-k : le sélecteur est un rail matérialisé, pas deux onglets blancs flottants', () => {
      const tabs = css.match(/\.k-cart-tabs\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(tabs).toMatch(/border\s*:\s*1px\s+solid\s+var\(--border\)/);
      expect(tabs).toMatch(/border-radius\s*:\s*14px/);
      expect(tabs).toMatch(/background\s*:\s*var\(--sand\)/);
    });

    it('LOT1-l : le drawer mobile possède un header-navigation unique', () => {
      const cart = readCss('cart.css');

      const drawer = cart.match(/\.k-cart-drawer\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(drawer).toMatch(/grid-template-rows\s*:\s*auto\s+1fr\s+auto/);

      const sharedHeader = cart.match(
        /\.k-cart-header:has\(#k-cart-surface-switch-drawer\)\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(sharedHeader).toMatch(/grid-template-columns\s*:\s*34px\s+minmax\(0,\s*1fr\)/);
      expect(sharedHeader).toMatch(/border-bottom\s*:\s*0/);

      expect(cart).toMatch(
        />\s*#k-cart-header-title\s*\{[^}]*display\s*:\s*none/s
      );
    });

    it('LOT1-i : la sélection liste reste compacte et centrée dans sa ligne', () => {
      const box = css.match(/\.k-cart-item-select\s*\{([^}]+)\}/s)?.[1] ?? '';
      const checked = css.match(/\.k-cart-item-select\.is-checked\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(box).toMatch(/width\s*:\s*22px/);
      expect(box).toMatch(/height\s*:\s*22px/);
      expect(box).toMatch(/border\s*:\s*1px\s+solid\s+var\(--stepper-border\)/);
      expect(checked).toMatch(/background\s*:\s*var\(--stone\)/);
      expect(checked).toMatch(/border-color\s*:\s*var\(--stone-border\)/);

      const tick = css.match(/\.k-cart-item-select\.is-checked::after\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(tick).toMatch(/border\s*:\s*solid\s+var\(--stone-text\)/);
      expect(css).not.toMatch(/\.k-cart-item-select\.is-checked\s*\{[^}]*--cta-green/s);
    });
  });

  // ── LOT 2 — Récapitulatif checkout ───────────────────────────────────
  describe('LOT 2 — checkout : récap = liste, checkout = calcul', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('LOT2-a : le récap possède une vraie sélection mais aucun total propre', () => {
      expect(css).toMatch(/\.ck-recap-item-select\s*\{/);
      expect(css).not.toMatch(/\.ck-recap-step\s+\.ck-recap-total\s*\{/);
      expect(css).not.toMatch(/\.ck-recap-item-remove\s*\{/);
    });

    it('LOT2-b : checkbox 18px distincte de la vignette produit 52px', () => {
      const row = css.match(/\.ck-recap-step\s+\.ck-recap-item\s*\{([^}]+)\}/s)?.[1] ?? '';
      const checkbox = css.match(/\.ck-recap-item-select\s*\{([^}]+)\}/s)?.[1] ?? '';
      const image = css.match(/\.ck-recap-item-img,\s*\.ck-recap-item-img--empty\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(row).toMatch(/grid-template-columns\s*:\s*18px\s+52px\s+minmax\(0,1fr\)\s+auto/);
      expect(checkbox).toMatch(/width\s*:\s*18px/);
      expect(checkbox).toMatch(/height\s*:\s*18px/);
      expect(image).toMatch(/width\s*:\s*52px/);
      expect(image).toMatch(/height\s*:\s*52px/);
      expect(image).toMatch(/object-fit\s*:\s*cover/);
    });

    it('LOT2-c : lignes plates séparées', () => {
      const block = css.match(/\.ck-recap-step\s+\.ck-recap-item\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/display\s*:\s*grid/);
      expect(block).toMatch(/border-bottom\s*:/);
    });
  });

  // ── LOT 3 — Badges paiement autonomes ────────────────────────────────────
  describe('LOT 2d — checkout : séparation récap / finalisation', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('le checkout mobile possède une vraie surface transactionnelle', () => {
      const aside = css.match(/\.ck-checkout-aside\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(aside).toMatch(/display\s*:\s*block/);
      expect(aside).toMatch(/background\s*:\s*var\(--white\)/);
      expect(aside).toMatch(/border-radius\s*:\s*18px/);
    });

    it('le récap mobile est repliable tandis que desktop reste déplié', () => {
      const content = css.match(/\.ck-recap-content\s*\{([^}]+)\}/s)?.[1] ?? '';
      const expanded = css.match(
        /\.ck-recap-step\.is-expanded\s+\.ck-recap-content\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(content).toMatch(/display\s*:\s*none/);
      expect(expanded).toMatch(/display\s*:\s*block/);

      const desktopMarker = css.indexOf('@media (min-width: 900px)');
      expect(desktopMarker).toBeGreaterThan(-1);

      const desktop = css.slice(desktopMarker);

      expect(desktop).toMatch(
        /\.ck-recap-toggle\s*\{[^}]*display\s*:\s*none/s
      );
      expect(desktop).toMatch(
        /\.ck-recap-content\s*\{[^}]*display\s*:\s*block/s
      );
    });
  });

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

    it('LOT5-a : le header reste clair et neutre, sans bandeau métier', () => {
      const block = css.match(/\.k-order-header\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/background\s*:\s*var\(--checkout-cream\)/);
      expect(block).toMatch(/color\s*:\s*var\(--text\)/);
      expect(block).toMatch(/box-shadow\s*:\s*none/);
      expect(block).not.toMatch(/gradient|checkout-accent|cta-green|checkout-neutral\s*;/);
    });

    it('LOT5-b : les moyens de paiement restent compacts en grille 2x2 desktop', () => {
      const chip = css.match(/\.ck-pay-chip\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(chip).toMatch(/min-height\s*:\s*52px/);
      expect(chip).toMatch(/border\s*:\s*1px\s+solid\s+rgba\(31,48,36,.11\)/);
      expect(chip).toMatch(/border-radius\s*:\s*11px/);

      const desktop = css.match(/@media\s*\(min-width:\s*900px\)[\s\S]*?\.ck-pay-grid\s*\{([^}]+)\}/)?.[1] ?? '';
      expect(desktop).toMatch(/grid-template-columns\s*:\s*repeat\(2,/);
    });

    it('LOT5-c : le CTA engageant reste commerce et compact', () => {
      const block = css.match(/\.k-order-overlay\.open\s+\.ck-confirm-btn\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/min-height\s*:\s*52px/);
      expect(block).toMatch(/border-radius\s*:\s*12px/);
      expect(block).toMatch(/background\s*:\s*var\(--action-commerce\)/);
      expect(block).toMatch(/color\s*:\s*var\(--action-commerce-text\)/);
      expect(block).not.toMatch(/checkout-accent|cta-green/);
    });

    it('LOT5-d : les cartes de contexte et le modal desktop gardent la géométrie finale', () => {
      const header = css.match(/\.ck-step-header\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(header).toMatch(/min-height\s*:\s*50px/);
      expect(header).toMatch(/border-radius\s*:\s*12px/);

      const modal = css.match(
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.k-order-overlay\.open\s+\.k-order-modal\s*\{([^}]+)\}/
      )?.[1] ?? '';
      expect(modal).toMatch(/width\s*:\s*100vw/);
      expect(modal).toMatch(/max-width\s*:\s*none/);
      expect(modal).toMatch(/height\s*:\s*100dvh/);
      expect(modal).toMatch(/max-height\s*:\s*none/);
      expect(modal).toMatch(/border-radius\s*:\s*0/);
    });
  });

  // ── LOT 6 — Drawers lisibles desktop et mobile ───────────────────────────
  describe('LOT 6 — drawers : largeur et respiration', () => {
    it('LOT6-a : le side cart desktop réserve sa largeur exacte sans recouvrir le shell', () => {
      const desktop = readCss('boutique-desktop.css');

      expect(desktop).toMatch(/:root\s*\{\s*--sc-reserve-w:\s*296px/);
      expect(desktop).toMatch(/body:where\(:has\(\.k-side-cart\.has-items\)\),\s*body\.sc-reserve\s*\{[^}]*padding-right:\s*var\(--sc-reserve-w\)/s);
      expect(desktop).toMatch(/\.k-side-cart\s*\{[^}]*width:\s*296px/s);
      expect(desktop).toMatch(/@media\s*\(min-width:\s*1200px\)[\s\S]*?\.k-side-cart\s*\{[^}]*width:\s*var\(--sc-reserve-w,\s*296px\)/);
      expect(desktop).toMatch(/body\.modal-open,\s*body\.cart-open\s*\{[^}]*padding-right:\s*0/s);
    });

    it('LOT6-a2 : la fiche produit réserve un side-cart stable et possède un état vide composé', () => {
      const shell = readCss('modal-shell.css');
      const desktop = readCss('boutique-desktop.css');

      expect(shell).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+296px/);
      expect(desktop).toMatch(/\.k-sc-empty\s*\{[^}]*min-height:\s*220px[^}]*justify-content:\s*center/s);
      expect(desktop).toMatch(/\.k-side-cart--in-modal \.k-sc-item-name\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    });

    it('LOT6-b : le drawer de liste mobile conserve marge et espacement entre les lignes', () => {
      const css = readCss('shared-list-side-cart.css');
      const block = css.match(/\.k-cart-drawer\[data-mode="shared-list"\]\s+#k-cart-body\s*\{([^}]+)\}/s)?.[1] ?? '';
      expect(block).toMatch(/gap\s*:\s*6px/);
      expect(block).toMatch(/padding\s*:\s*8px\s+10px/);
    });

    it('LOT6-c : le side cart desktop utilise une coque neutre sans contour métier', () => {
      const css = readCss('boutique-desktop.css');
      const block = css.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(block).toMatch(/border\s*:\s*none/);
      expect(block).toMatch(/box-shadow\s*:/);
      expect(block).not.toMatch(/commerce-yellow|cta-green/);
      expect(block).not.toMatch(/border-top-width\s*:/);
    });
    it('LOT6-d : le mode liste ne recolore plus la coque du side cart', () => {
      const css = readCss('shared-list-side-cart.css');

      expect(css).not.toMatch(
        /#k-side-cart\[data-mode="shared-list"\]\s*\{[^}]*border-color/
      );

      expect(css).not.toMatch(
        /\.k-cart-drawer\[data-mode="shared-list"\]\s*\{[^}]*border-top-color/
      );
    });
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
        cart.match(/\.k-cart-item\s*\{([^}]+)\}/s)?.[1] ?? '';
      const snapshot =
        shared.match(/\.k-cart-snapshot-item\s*\{([^}]+)\}/s)?.[1] ?? '';

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
      expect(tokens).toMatch(/--action-commerce\s*:\s*var\(--commerce-yellow\)/);
      expect(tokens).toMatch(/--action-confirm\s*:\s*var\(--text\)/);
      expect(tokens).toMatch(/--action-secondary\s*:\s*var\(--stone\)/);
      expect(tokens).toMatch(/--accent-editorial\s*:\s*var\(--coral\)/);
    });

    it('LOT8-b : promo = jaune + texte sombre', () => {
      const block =
        products.match(/\.k-card-promo\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(block).toMatch(
        /background\s*:\s*var\(--action-commerce\)/
      );
      expect(block).toMatch(/color\s*:\s*var\(--action-commerce-text\)/);
    });

    it('LOT8-c : ajouter = jaune et in-cart reste vert', () => {
      const add =
        products.match(/\.k-card-add\s*\{([^}]+)\}/s)?.[1] ?? '';
      const plus =
        products.match(/\.k-card-add-plus\s*\{([^}]+)\}/s)?.[1] ?? '';
      const inCart =
        products.match(/\.k-card-add\.in-cart\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(add).toMatch(
        /background\s*:\s*var\(--action-commerce\)/
      );
      expect(plus).toMatch(/font-size\s*:\s*18px/);
      expect(plus).toMatch(/color\s*:\s*var\(--text\)/);
      expect(inCart).toMatch(
        /background\s*:\s*var\(--state-positive\)/
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
        /\.k-logo\s*\{[^}]*width:\s*148px;[^}]*min-width:\s*148px;[^}]*justify-content:\s*center;[^}]*\}/
      );

      expect(layout).toMatch(
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.k-cart-btn\s*\{[^}]*margin-left:\s*0;[^}]*margin-right:\s*0;/
      );
    });
  });

  // ── LOT 6B — palette sémantique transverse ───────────────────────────
  describe('LOT 6B — harmonisation chromatique des actions', () => {
    it('les CTA commerce du panier et de la liste partagée partagent le même rôle', () => {
      const cart = readCss('cart.css');
      const desktop = readCss('boutique-desktop.css');
      const shared = readCss('shared-list-side-cart.css');

      const drawerCheckout = cart.match(/#k-cart-checkout\s*\{([^}]+)\}/s)?.[1] ?? '';
      const sideCheckout = desktop.match(/\.k-sc-btn-checkout\s*\{([^}]+)\}/s)?.[1] ?? '';
      const sharedCheckout = shared.match(/\.k-snap-btn-primary\s*\{([^}]+)\}/s)?.[1] ?? '';

      for (const block of [drawerCheckout, sideCheckout, sharedCheckout]) {
        expect(block).toMatch(/background\s*:\s*var\(--action-commerce\)/);
        expect(block).toMatch(/color\s*:\s*var\(--action-commerce-text\)/);
      }
    });

    it('Ajouter et Acheter maintenant portent l accent commerce dans la modal', () => {
      const modal = readCss('modal-shell.css');
      const add = [...modal.matchAll(/\.k-add-cart-btn\s*\{([^}]+)\}/gs)]
        .map(match => match[1])
        .find(block => /grid-column\s*:\s*1/.test(block)) ?? '';
      const buy = modal.match(/\.k-modal-actions\s+\.k-buy-now-btn\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(add).toMatch(/border\s*:\s*2px solid var\(--action-commerce-border\)/);
      expect(buy).toMatch(/background\s*:\s*var\(--action-commerce\)/);
      expect(buy).toMatch(/color\s*:\s*var\(--action-commerce-text\)/);
    });

    it('le checkout final garde son chrome neutre et réserve le jaune à la transaction', () => {
      const checkout = readCss('checkout-vertical-rail.css');
      const header = checkout.match(/\.k-order-header\s*\{([^}]+)\}/s)?.[1] ?? '';
      const finalCta = checkout.match(/\.k-order-overlay\.open\s+\.ck-confirm-btn\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(header).toMatch(/background\s*:\s*var\(--checkout-cream\)/);
      expect(finalCta).toMatch(/background\s*:\s*var\(--action-commerce\)/);
      expect(finalCta).toMatch(/color\s*:\s*var\(--action-commerce-text\)/);
    });

    it('confirmation, identité et éditorial restent distincts du commerce', () => {
      const cart = readCss('cart.css');
      const identity = readCss('identity.css');
      const products = readCss('products.css');

      const tracking = cart.match(/\.k-track-btn\s*\{([^}]+)\}/s)?.[1] ?? '';
      const identityCta = identity.match(/\.k-id-btn\s*\{([^}]+)\}/s)?.[1] ?? '';
      const liked = products.match(/\.k-card-fav\.liked\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(tracking).toMatch(/background\s*:\s*var\(--action-confirm\)/);
      expect(identityCta).toMatch(/background\s*:\s*var\(--action-confirm\)/);
      expect(liked).toMatch(/color\s*:\s*var\(--accent-editorial\)/);
      expect(liked).toMatch(/background\s*:\s*var\(--accent-editorial-soft\)/);
    });

    it('une promotion favoris n usurpe plus le rouge danger et WhatsApp reste une exception de marque', () => {
      const interactions = readCss('interactions.css');
      const shared = readCss('shared-list-side-cart.css');
      const promo = interactions.match(/\.k-card-promo-fav\s*\{([^}]+)\}/s)?.[1] ?? '';
      const whatsapp = interactions.match(/\.k-fav-promo-active\s+\.k-fav-share-btn\s*\{([^}]+)\}/s)?.[1] ?? '';
      const danger = shared.match(/\.k-confirm-dialog-btn-danger\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(promo).toMatch(/background\s*:\s*var\(--action-commerce\)/);
      expect(promo).not.toMatch(/red|danger/);
      expect(whatsapp).toMatch(/var\(--whatsapp\)/);
      expect(danger).toMatch(/background\s*:\s*var\(--state-danger\)/);
    });
  });

  // ── LOT 10 — bandeau desktop neutre et compact ─────────────────────
  describe('LOT 10 — bandeau desktop premium', () => {
    let layout;

    beforeAll(() => {
      layout = readCss('layout.css');
    });

    it('LOT10-a : les actions desktop utilisent un matériau neutre', () => {
      const blocks = [...layout.matchAll(/\.k-header-nav-btn\s*\{([^}]+)\}/gs)]
        .map(m => m[1]);

      const desktop =
        blocks.find(b => /height\s*:\s*36px/.test(b)) || '';

      expect(desktop).toMatch(
        /background\s*:\s*rgba\(255,255,255,\.72\)/
      );
      expect(desktop).toMatch(
        /border\s*:\s*1px solid rgba\(42,33,23,\.08\)/
      );
      expect(desktop).not.toMatch(/cta-green|100,175,90/);
    });

    it('LOT10-b : Mon Komerce actif reste neutre', () => {
      const block =
        layout.match(/\.k-header-nav-btn--group\.has-active\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(block).toMatch(/color\s*:\s*var\(--text\)/);
      expect(block).toMatch(/box-shadow\s*:/);
      expect(block).not.toMatch(/green-bg|cta-green|green-text/);
    });

    it('LOT10-c : le shell desktop est blanc avec profondeur neutre', () => {
      const blocks = [...layout.matchAll(/\.k-header\s*\{([^}]+)\}/gs)]
        .map(m => m[1]);

      const desktop =
        blocks.find(b => /z-index\s*:\s*220/.test(b)) || '';

      expect(desktop).toMatch(
        /background\s*:\s*rgba\(255,255,255,\.94\)/
      );
      expect(desktop).toMatch(
        /border-bottom\s*:\s*1px solid rgba\(42,33,23,\.08\)/
      );
      expect(desktop).toMatch(
        /box-shadow\s*:\s*0 4px 16px rgba\(42,33,23,\.06\)/
      );
      expect(desktop).not.toMatch(/100,175,90/);
    });

    it('LOT10-d : le premium ne regonfle plus la recherche à 54px', () => {
      const premium =
        layout.match(/html\.k-home-premium-v1 \.k-search\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(premium).not.toMatch(/min-height\s*:\s*54px/);
      expect(premium).not.toMatch(/14px 36px/);

      expect(layout).toMatch(/max-width\s*:\s*680px/);
      expect(layout).toMatch(/max-width\s*:\s*760px/);
    });

    it('LOT10-e : le groupe actions et avatar sont resserrés', () => {
      const actions = [...layout.matchAll(/\.k-header-actions\s*\{([^}]+)\}/gs)]
        .map(m => m[1])
        .find(b => /gap\s*:\s*6px/.test(b)) || '';

      const carts = [...layout.matchAll(/\.k-cart-btn\.k-header-action\s*\{([^}]+)\}/gs)]
        .map(m => m[1]);

      const desktopCart =
        carts.find(b =>
          /width\s*:\s*36px/.test(b) &&
          /height\s*:\s*40px/.test(b)
        ) || '';

      expect(actions).toMatch(/gap\s*:\s*6px/);
      expect(desktopCart).toMatch(/width\s*:\s*36px/);
      expect(desktopCart).toMatch(/height\s*:\s*40px/);
    });

    it('LOT10-f : une seule règle porte la géométrie compacte du badge desktop', () => {
      const badgeBlocks = [...layout.matchAll(
        /\.k-header \.k-cart-btn\.k-header-action \.k-cart-badge\s*\{([^}]+)\}/gs
      )].map(m => m[1]);

      const compact = badgeBlocks.filter(block =>
        /bottom\s*:\s*calc\(50% - 20px\)/.test(block) &&
        /left\s*:\s*calc\(50% \+ 6px\)/.test(block) &&
        /min-width\s*:\s*14px/.test(block) &&
        /height\s*:\s*14px/.test(block) &&
        /font-size\s*:\s*8px/.test(block)
      );

      expect(compact).toHaveLength(1);
    });
  });

  // ── LOT 9 — vérité visuelle side-cart / mobile ──────────────────────
  describe('LOT 9 — vérité visuelle side-cart / mobile', () => {
    it('LOT9-a : la coque panier/liste est strictement neutre', () => {
      const desktop = readCss('boutique-desktop.css');
      const shared = readCss('shared-list-side-cart.css');
      const cart = readCss('cart.css');

      const sideCart =
        desktop.match(/\.k-side-cart\s*\{([^}]+)\}/s)?.[1] ?? '';

      const drawer =
        cart.match(/\.k-cart-drawer\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(sideCart).toMatch(/border\s*:\s*none/);
      expect(sideCart).not.toMatch(/commerce-yellow|cta-green/);

      expect(drawer).toMatch(/border\s*:\s*0/);
      expect(drawer).not.toMatch(/commerce-yellow|cta-green/);

      expect(shared).not.toMatch(
        /#k-side-cart\[data-mode="shared-list"\][^{]*\{[^}]*border-color/
      );

      expect(shared).not.toMatch(
        /\.k-cart-drawer\[data-mode="shared-list"\]\s*\{[^}]*border-top-color/
      );
    });
    it('LOT9-b : snapshot et panier partagent géométrie et départ vertical du texte', () => {
      const cart = readCss('cart.css');
      const shared = readCss('shared-list-side-cart.css');
      const responsive = readCss('shared-list-side-cart-responsive.css');

      const personal =
        cart.match(/\.k-cart-item\s*\{([^}]+)\}/s)?.[1] ?? '';

      const info =
        cart.match(/\.k-cart-item-info\s*\{([^}]+)\}/s)?.[1] ?? '';

      const snapshot =
        shared.match(/\.k-cart-snapshot-item\s*\{([^}]+)\}/s)?.[1] ?? '';

      const open =
        shared.match(/\.k-cart-snapshot-item-open\s*\{([^}]+)\}/s)?.[1] ?? '';

      const meta =
        responsive.match(/\.k-cart-snapshot-item-meta\s*\{([^}]+)\}/s)?.[1] ?? '';

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

      expect(info).toMatch(/align-self\s*:\s*stretch/);
      expect(info).toMatch(/justify-content\s*:\s*flex-start/);

      expect(meta).toMatch(/margin-top\s*:\s*0/);
      expect(meta).toMatch(/line-height\s*:\s*1\.3/);
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

    it('LOT9-d : le stepper suggestion mobile impose réellement son bounding 76x30', () => {
      const polish = readCss('modal-product-polish.css');

      expect(polish).toMatch(
        /@media\s*\(max-width:\s*899px\)[\s\S]*?--k-sug-action-width:\s*76px;[\s\S]*?--k-sug-action-height:\s*30px;/
      );
      expect(polish).toMatch(
        /#k-modal\s+\.k-sug-card-actions\s*\{[^}]*height:\s*var\(--k-sug-action-height\)[^}]*max-height:\s*var\(--k-sug-action-height\)[^}]*aspect-ratio:\s*auto/s
      );
      expect(polish).toMatch(
        /#k-modal\s+\.k-sug-card-actions\.is-filled\s*\{[^}]*height:\s*var\(--k-sug-action-height\)[^}]*max-height:\s*var\(--k-sug-action-height\)/s
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

  // ── LOT 7 — Checkout desktop pleine page ────────────────────────────────
  describe('LOT 7 — projection responsive checkout', () => {
    let css;
    beforeAll(() => { css = readCss('checkout-vertical-rail.css'); });

    it('LOT7-a : mobile separe le recap de la surface transactionnelle', () => {
      const layout =
        css.match(/\.ck-checkout-layout\s*\{([^}]+)\}/s)?.[1] ?? '';

      const primary =
        css.match(/\.ck-checkout-primary\s*\{([^}]+)\}/s)?.[1] ?? '';

      const aside =
        css.match(/\.ck-checkout-aside\s*\{([^}]+)\}/s)?.[1] ?? '';

      expect(layout).toMatch(/display\s*:\s*block/);
      expect(primary).toMatch(/display\s*:\s*block/);

      // Mobile : la zone de finalisation possede sa propre surface,
      // distincte du recapitulatif de commande.
      expect(aside).toMatch(/display\s*:\s*block/);
      expect(aside).toMatch(/background\s*:\s*var\(--white\)/);
      expect(aside).toMatch(/border-radius\s*:\s*18px/);
    });

    it('LOT7-b : desktop projette le checkout comme une page pleine', () => {
      expect(css).toMatch(
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.k-order-overlay\.open \.k-order-modal\s*\{[\s\S]*?width\s*:\s*100vw/
      );

      expect(css).toMatch(/height\s*:\s*100dvh/);
      expect(css).toMatch(/max-width\s*:\s*none/);
      expect(css).toMatch(/border-radius\s*:\s*0/);
    });

    it('LOT7-c : desktop possède deux colonnes et un aside sticky', () => {
      const layoutBlocks = [
        ...css.matchAll(/\.ck-checkout-layout\s*\{([^}]+)\}/g),
      ];

      const layout = layoutBlocks.at(-1)?.[1] ?? '';

      expect(layout).toMatch(/display\s*:\s*grid/);
      expect(layout).toMatch(/grid-template-columns\s*:/);

      const asideBlocks = [
        ...css.matchAll(/\.ck-checkout-aside\s*\{([^}]+)\}/g),
      ];

      const aside = asideBlocks.at(-1)?.[1] ?? '';

      expect(aside).toMatch(/position\s*:\s*sticky/);
      expect(aside).toMatch(/overflow-y\s*:\s*auto/);
    });

    it('LOT7-d : CTA final suit le total dans la colonne droite', () => {
      const matches = [
        ...css.matchAll(
          /\.k-order-overlay\.open \.ck-confirm-btn\s*\{([^}]+)\}/g
        ),
      ];

      const desktopCta =
        matches
          .map((m) => m[1])
          .find((block) => /position\s*:\s*static/.test(block))
        ?? '';

      expect(desktopCta).toMatch(/position\s*:\s*static/);
      expect(desktopCta).toMatch(/width\s*:\s*100%/);
      expect(desktopCta).toMatch(/margin\s*:\s*14px 0 0/);
    });
  });


  describe('HOTFIX mobile — vérité modale', () => {
    let polish;
    let checkout;

    beforeAll(() => {
      polish = readCss('modal-product-polish.css');
      checkout = readCss('checkout-vertical-rail.css');
    });

    it('MOB-H1 : le bouton panier garde son offset validé et son icône reste centrée', () => {
      const cart = polish.match(
        /#k-modal \.k-modal-cart-btn\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(cart).toMatch(/position\s*:\s*absolute/);
      expect(cart).toMatch(/top\s*:\s*50%/);
      expect(cart).toMatch(/left\s*:\s*calc\(50%\s*\+\s*18px\)/);
      expect(cart).toMatch(
        /transform\s*:\s*translate\(-50%,\s*-50%\)/
      );

      const icon = polish.match(
        /#k-modal \.k-modal-cart-icon\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(icon).toMatch(/position\s*:\s*absolute/);
      expect(icon).toMatch(/top\s*:\s*50%/);
      expect(icon).toMatch(/left\s*:\s*50%/);
      expect(icon).toMatch(
        /transform\s*:\s*translate\(-50%,\s*-50%\)/
      );

      expect(polish).not.toMatch(
        /#k-modal\.is-scrolled \.k-modal-cart-btn(?::active)?\s*\{/
      );
    });

    it('MOB-H2 : le titre scrollé ne traverse pas la zone du panier', () => {
      const product = polish.match(
        /#k-modal\.is-scrolled \.k-modal-topbar-product\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(product).toMatch(
        /max-width\s*:\s*calc\(50%\s*-\s*34px\)/
      );
      expect(product).toMatch(/margin-left\s*:\s*0/);
    });

    it('MOB-H3 : reason_label est masqué une seule fois et dans le media mobile', () => {
      const mobile = polish.match(
        /@media \(max-width: 899px\) \{([\s\S]*?)\n\}\n\n\/\* ── Desktop/
      )?.[1] ?? '';

      expect(mobile).toMatch(
        /#k-modal \.k-sug-card-reason\s*\{[^}]*display\s*:\s*none/s
      );

      const owners = [
        ...polish.matchAll(
          /#k-modal \.k-sug-card-reason\s*\{/g
        ),
      ];

      expect(owners).toHaveLength(1);
    });

    it('MOB-H4 : le check confirmation utilise un escape Unicode stable', () => {
      const pseudo = checkout.match(
        /\.k-confirm-emoji::before\s*\{([^}]+)\}/s
      )?.[1] ?? '';

      expect(pseudo).toContain('content: "\\2713";');
      expect(pseudo).not.toContain('âœ“');
    });
  });

});
