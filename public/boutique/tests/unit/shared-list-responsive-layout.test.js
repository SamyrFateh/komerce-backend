'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          shared-cart-snapshot-narrow-layout-css-tests
 * @domain        shared-cart
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/shared-list-responsive-layout.test.js
 * @purpose       Verrouille le CSS de la ligne de snapshot dans les
 *                conteneurs étroits (side cart desktop ~330px, drawer
 *                mobile) contre css/shared-list-side-cart-responsive.css.
 *                Lot D : réécrit contre .k-cart-snapshot-item* et l'ancrage
 *                container-query #k-side-cart (panneau .k-shared-list-panel
 *                démantelé en Lot A, plus de hack flex `order`).
 * @impact-areas  shared-cart, css, boutique
 * @version       2026-08-lotD
 */
const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles');

const cssPath = path.resolve(__dirname, '../../css/shared-list-side-cart-responsive.css');
const css = fs.readFileSync(cssPath, 'utf8');

function compact(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Lot D (refactor soustractif shared-cart, clôture) — ce fichier testait
 * .k-shared-list-panel / .k-shared-item-* et un hack flex `order` destiné
 * à repositionner un panneau propre à côté du switch [Panier]/[Liste].
 * Ce panneau a été démantelé en Lot A : les lignes s'écrivent désormais
 * directement dans les conteneurs canoniques (#k-sc-items, #k-cart-body),
 * et .k-cart-surface-switch est prepend()é devant eux à chaque rendu
 * (group-side-cart.js::renderCartSurfaceSwitch) — l'ordre visuel vient de
 * l'ordre DOM naturel, plus d'un hack `order` CSS séparé. Les tests
 * couplés à ce mécanisme retiré sont supprimés ; ceux qui couvrent un
 * invariant toujours vrai sont réécrits contre .k-cart-snapshot-item et
 * #k-side-cart (nouvel ancrage du container query, voir le fichier CSS).
 */
/**
 * Mandat cohérence post-LOT 13, §1 — les @container qui basculaient la
 * ligne en grille 2-3 rangées dès max-width: 420px/310px faisaient
 * systématiquement flancher #k-side-cart (toujours ~280-330px de large)
 * en dessous des deux seuils : la checkbox (§3) atterrissait sur sa propre
 * ligne, sous le produit, au lieu de rester ancrée à droite. Retirés :
 * plus de grid-stacking, quelle que soit la largeur du conteneur — le
 * snapshot reste un flex-row unique, comme .k-cart-item (panier
 * personnel, cart.css). Les tests ci-dessous verrouillent ce nouvel
 * invariant contre toute régression vers le grid-stacking.
 */
describe('liste partageable — layout étroit side cart / drawer', () => {
  it('charge les corrections après la feuille de base dans components.css', () => {
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    expect(components).toBeDefined();

    const baseIndex = components.files.indexOf('shared-list-side-cart');
    const responsiveIndex = components.files.indexOf('shared-list-side-cart-responsive');

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(responsiveIndex).toBe(baseIndex + 1);
  });

  it('conserve #k-side-cart comme ancrage container-query (même si plus aucun @container ne bascule en grille)', () => {
    expect(css).toMatch(/#k-side-cart\s*\{[^}]*container-name:\s*shared-list/s);
    expect(css).toMatch(/#k-side-cart\s*\{[^}]*container-type:\s*inline-size/s);
  });

  it('ne bascule jamais en grid-stacking, quelle que soit la largeur du conteneur (§1)', () => {
    expect(css).not.toMatch(/@container\s+shared-list/);
    expect(css).not.toMatch(/grid-template-areas:\s*"product product"/);
    expect(css).not.toMatch(/@supports not \(container-type: inline-size\)/);
  });

  it('tronque le nom en ellipsis plutôt que de passer en grille', () => {
    const normalized = compact(css);
    expect(normalized).toMatch(/\.k-cart-snapshot-item-open \.k-cart-item-name\s*\{[^}]*white-space:\s*nowrap[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/);
  });

  it('garde le prix/statut lisibles en flex-row (plus de grid-area)', () => {
    expect(css).toMatch(/\.k-cart-snapshot-item-meta\s*\{[^}]*display:\s*flex[^}]*font-weight:\s*700/s);
    expect(css).toMatch(/\.k-cart-snapshot-item-status\s*\{[^}]*font-size:\s*11\.5px/s);
    expect(css).not.toMatch(/\.k-cart-snapshot-item-meta\s*\{[^}]*grid-area/s);
    expect(css).not.toMatch(/\.k-cart-snapshot-item-controls\s*\{[^}]*grid-area/s);
  });

  it('stabilise le fallback image sur la ligne de snapshot', () => {
    expect(css).toMatch(/\.k-cart-snapshot-item \.k-cart-item-img-el\s*\{[^}]*object-fit:\s*cover/s);
    expect(css).toMatch(/\.k-cart-snapshot-item \.k-cart-item-img\.is-img-error \.k-cart-item-img-fallback/);
  });

  it('harmonise la géométrie desktop du snapshot avec les cartes du panier personnel', () => {
    expect(css).toMatch(/@media \(min-width: 900px\)[\s\S]*?#k-side-cart \.k-cart-snapshot-item\s*\{[^}]*align-items:\s*center[^}]*gap:\s*8px[^}]*padding:\s*8px/s);
    expect(css).toMatch(/#k-side-cart \.k-cart-snapshot-item \.k-cart-item-img\s*\{[^}]*width:\s*48px[^}]*height:\s*48px/s);
    expect(css).toMatch(/#k-side-cart \.k-cart-snapshot-item \.k-cart-item-name\s*\{[^}]*font-size:\s*11\.5px[^}]*font-weight:\s*600/s);
  });
});
