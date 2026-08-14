'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/modal-topbar-mobile.test.js
 *
 * Oracle REF-2026-07e — topbar mobile canonique (remplace l'oracle §6.1
 * "full-bleed", superseded par la référence visuelle v2.1 —
 * docs/reference/reference-modale-4-etats.html, états 3 et 4).
 *
 * Vérifie statiquement que le CSS source respecte les invariants de la
 * topbar mobile canonique :
 *   1. la topbar mobile a un positionnement stable (plus de full-bleed absolu
 *      qui flotte sur le média — elle réserve sa propre place dans le flex)
 *   2. le média/scroll ne commence qu'après la topbar (espace structurel,
 *      pas une compensation de padding fragile)
 *   3. au repos, pas d'overlay-black, pas de backdrop-filter, pas de grosse
 *      box-shadow — seule une surface translucide légère est permise à
 *      l'état scrollé
 *   4. le bouton panier a un fond transparent, aucune bordure visible
 *   5. le bouton panier conserve une cible tactile correcte
 *   6. l'asset panier_tresse.png reste utilisé (HTML)
 *   7. le badge panier reste présent (CSS + HTML)
 *   8. #k-modal-nav existe comme groupe cohérent (capsule unique)
 *   9. l'override desktop ≥900px reste présent (non-régression)
 *   10. MIGRATION v3.0 (LOT 3) : plus de hack position:fixed sur les actions —
 *       une vraie ligne de grille .k-modal les réserve
 *   11. le safe-area inférieur reste pris en compte
 *
 * Lecture CSS/HTML statique — même pattern que modal-layout-invariant.test.js.
 * Ne dépend d'aucun mock DOM.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '../..');
const SHELL_CSS    = path.join(ROOT, 'css/modal-shell.css');
const MOBILE_CSS   = path.join(ROOT, 'css/modal-mobile-canonical.css');
const INDEX_HTML   = path.join(ROOT, 'index.html');

const shell  = fs.readFileSync(SHELL_CSS,  'utf8');
const mobile = fs.readFileSync(MOBILE_CSS, 'utf8');
const html   = fs.readFileSync(INDEX_HTML, 'utf8');

// Repère la vraie section desktop (§3 "DESKTOP ≥900px — TYPOGRAPHIE...") plutôt
// que la première occurrence de `@media (min-width: 900px)` : ce media query
// apparaît aussi plus tôt, imbriqué dans un @supports mobile (glass effect
// conditionnel de .k-modal-actions), ce qui couperait le fichier au mauvais
// endroit si on cherchait juste la chaîne du media query.
const desktopMarkerIdx = shell.indexOf('DESKTOP ≥900px');
const desktopSplitIdx  = shell.indexOf('@media (min-width: 900px)', desktopMarkerIdx);
const mobileMediaIdx   = shell.indexOf('@media (max-width: 899px)');
const baseBlock        = shell.slice(0, desktopSplitIdx);
const desktopSection   = shell.slice(desktopSplitIdx);
const mobileMediaBlock = shell.slice(mobileMediaIdx, desktopSplitIdx);

describe('topbar mobile canonique — oracle REF-2026-07e', () => {

  test('k-modal-topbar a un positionnement stable (plus de full-bleed absolu)', () => {
    const topbarRule = baseBlock.match(/\.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(topbarRule).toMatch(/position\s*:\s*relative/);
    expect(topbarRule).not.toMatch(/position\s*:\s*absolute/);
  });

  test('le média/scroll commence sous la topbar (espace structurel, pas un padding de compensation)', () => {
    // La topbar est un enfant flex normal de .k-modal (flex-shrink:0), placé
    // avant .k-modal-scroll dans le DOM (index.html) — le flex du shell
    // réserve alors l'espace automatiquement, sans padding-top magique sur
    // le scroll owner ni marge négative sur le média.
    const topbarRule = baseBlock.match(/\.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(topbarRule).toMatch(/flex-shrink\s*:\s*0/);
    const topbarIdx = html.indexOf('k-modal-topbar');
    const scrollIdx = html.indexOf('k-modal-scroll');
    expect(topbarIdx).toBeGreaterThan(-1);
    expect(scrollIdx).toBeGreaterThan(-1);
    expect(topbarIdx).toBeLessThan(scrollIdx);
  });

  test('respiration visible sous la topbar avant le média (propriété unique, un seul owner)', () => {
    expect(baseBlock).toMatch(/--k-modal-mobile-topbar-space\s*:/);
    // Une seule règle possède cette géométrie — pas de duplication ailleurs.
    const occurrencesShell  = (shell.match(/--k-modal-mobile-topbar-space/g)  || []).length;
    const occurrencesMobile = (mobile.match(/--k-modal-mobile-topbar-space/g) || []).length;
    expect(occurrencesShell).toBeGreaterThan(0);
    expect(occurrencesMobile).toBe(0);
  });

  test("k-modal-topbar au repos n'utilise pas overlay-black", () => {
    const topbarRule = baseBlock.match(/\.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(topbarRule).not.toMatch(/overlay-black/);
  });

  test("k-modal-topbar au repos n'utilise pas backdrop-filter", () => {
    const topbarRule = baseBlock.match(/\.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(topbarRule).toMatch(/backdrop-filter\s*:\s*none/);
  });

  test("k-modal-topbar au repos n'utilise pas de grande box-shadow", () => {
    const topbarRule = baseBlock.match(/\.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(topbarRule).toMatch(/box-shadow\s*:\s*none/);
  });

  test("l'état scrollé reçoit au plus une surface translucide légère, jamais gris/sombre/overlay", () => {
    const scrolledRule = baseBlock.match(/\.k-modal\.is-scrolled \.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scrolledRule).toMatch(/var\(--surface-sand-97\)/);
    expect(scrolledRule).not.toMatch(/overlay-black|backdrop-filter|box-shadow\s*:\s*(?!none)/);
  });

  test('le bouton panier possède un fond transparent sur mobile', () => {
    const mobileBlock = mobileMediaBlock;
    expect(mobileBlock).toMatch(/#k-modal \.k-modal-cart-btn\s*\{[^}]*background\s*:\s*transparent/);
  });

  test('le bouton panier ne possède aucune bordure visible sur mobile', () => {
    const mobileBlock = mobileMediaBlock;
    expect(mobileBlock).toMatch(/#k-modal \.k-modal-cart-btn\s*\{[^}]*border\s*:\s*0/);
  });

  test('le bouton panier conserve une cible tactile correcte sur mobile (>= 40px)', () => {
    const mobileBlock = mobileMediaBlock;
    const rule = mobileBlock.match(/#k-modal \.k-modal-cart-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/width\s*:\s*40px/);
    expect(rule).toMatch(/height\s*:\s*40px/);
  });

  test("l'asset panier_tresse_vert.png reste utilisé dans la topbar", () => {
    const topbarHtml = html.slice(html.indexOf('k-modal-topbar'), html.indexOf('k-modal-topbar-right') + 400);
    expect(topbarHtml).toMatch(/panier_tresse_vert\.png/);
  });

  test('le badge panier reste présent (CSS + HTML)', () => {
    expect(shell).toMatch(/\.k-modal-cart-badge\s*\{/);
    expect(html).toMatch(/id="k-modal-cart-badge"/);
  });

  test('le badge panier reprend le jaune transactionnel de la boutique', () => {
    const badgeRule = shell.match(/\.k-modal-cart-badge\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(badgeRule).toMatch(/var\(--commerce-yellow\)/);
    expect(badgeRule).toMatch(/color\s*:\s*var\(--text\)/);
    expect(badgeRule).not.toMatch(/var\(--cta-green\)|var\(--coral\)/);
  });

  test('#k-modal-nav existe comme groupe cohérent (capsule unique) sur mobile', () => {
    const mobileBlock = mobileMediaBlock;
    const navRule = mobileBlock.match(/#k-modal-nav\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(navRule).toMatch(/border-radius\s*:\s*999px/);
    expect(navRule).toMatch(/border\s*:\s*1px solid/);
  });

  test('desktop ≥900px conserve son propre override de topbar (non-régression)', () => {
    expect(desktopSection).toMatch(/k-modal-topbar[^}]*position\s*:\s*relative/);
  });

  test("MIGRATION v3.0 (LOT 3) : .k-modal-actions n'est plus en position:fixed (hack retiré)", () => {
    const actionsRule = baseBlock.match(/^\.k-modal-actions\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(actionsRule).not.toMatch(/position\s*:\s*fixed/);
    expect(actionsRule).not.toMatch(/bottom\s*:\s*0/);
    // La grille .k-modal réserve une vraie 3e ligne (topbar / scroll / actions)
    // au lieu de la compensation --k-modal-cta-h mesurée en JS.
    const modalShellRule = baseBlock.match(/^\.k-modal\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(modalShellRule).toMatch(/grid-template-rows\s*:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  });

  test('reparenting JS (#k-modal > .k-modal-actions) reste en flux normal, sans ancrage fixed résiduel', () => {
    const directChildRule = baseBlock.match(/#k-modal\s*>\s*\.k-modal-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(directChildRule).toMatch(/position\s*:\s*relative/);
    expect(directChildRule).not.toMatch(/position\s*:\s*fixed/);
    expect(directChildRule).not.toMatch(/bottom\s*:\s*0|left\s*:\s*0|right\s*:\s*0/);
  });

  test('le safe-area inférieur reste pris en compte pour les actions sticky', () => {
    expect(shell).toMatch(/\.k-modal-actions\s*\{[^}]*env\(safe-area-inset-bottom/);
  });

  test("le panier reste au centre et le titre respecte sa zone de clearance", () => {
    const polish = fs.readFileSync(
      path.join(ROOT, 'css/modal-product-polish.css'),
      'utf8'
    );

    const cartRule = polish.match(
      /#k-modal \.k-modal-cart-btn\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(cartRule).toMatch(/position\s*:\s*absolute/);
    expect(cartRule).toMatch(/top\s*:\s*50%/);
    expect(cartRule).toMatch(/left\s*:\s*50%/);
    expect(cartRule).toMatch(
      /transform\s*:\s*translate\(-50%,\s*-50%\)/
    );

    const iconRule = polish.match(
      /#k-modal \.k-modal-cart-icon\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(iconRule).toMatch(/position\s*:\s*absolute/);
    expect(iconRule).toMatch(/top\s*:\s*50%/);
    expect(iconRule).toMatch(/left\s*:\s*50%/);
    expect(iconRule).toMatch(
      /transform\s*:\s*translate\(-50%,\s*-50%\)/
    );

    const productRule = polish.match(
      /#k-modal\.is-scrolled \.k-modal-topbar-product\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(productRule).toMatch(
      /max-width\s*:\s*calc\(50%\s*-\s*34px\)/
    );

    expect(polish).not.toMatch(
      /#k-modal\.is-scrolled \.k-modal-cart-btn(?::active)?\s*\{/
    );
  });

  test('le bouton retour-haut reste au-dessus de la barre transactionnelle mobile', () => {
    const rule = shell.match(/\.k-modal-back-top\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/--k-modal-action-bar-h/);
    expect(rule).toMatch(/safe-area-inset-bottom/);
  });
});
