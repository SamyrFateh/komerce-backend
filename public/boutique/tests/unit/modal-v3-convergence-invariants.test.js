'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/modal-v3-convergence-invariants.test.js
 *
 * MIGRATION v3.0 (LOT 4) — convergence des quatre états (desktop/mobile ×
 * simple/enrichi). LOT 1-3 sont déjà posés (sticky retiré, configurateur
 * transversal, coque mobile) ; ce fichier ajoute le garde-fou anti-régression
 * listé dans l'arbitrage "TESTS À REMPLACER" qui manquait encore : l'ordre
 * canonique de composition (ProductConfigurator → ProductDetails →
 * ProductRecommendations) et l'indépendance du panier latéral desktop.
 *
 * Lecture DOM statique sur index.html, dans le même esprit que les oracles
 * RÉF-2026-07f/h (pas de rendu réel, juste la structure de référence).
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function idx(marker) {
  const i = html.indexOf(marker);
  if (i === -1) throw new Error(`Marqueur introuvable dans index.html : ${marker}`);
  return i;
}

describe('convergence v3.0 des quatre états — oracle LOT 4', () => {

  test('ordre canonique : configurateur → détails longs → suggestions', () => {
    const iConf = idx('id="k-modal-configurator"');
    const iDet  = idx('id="k-modal-long-details"');
    const iSug  = idx('id="k-modal-suggestions"');
    expect(iConf).toBeLessThan(iDet);
    expect(iDet).toBeLessThan(iSug);
  });

  test('le configurateur et les détails longs sont dans le même conteneur scrollable que le hero', () => {
    const iScroll = idx('k-modal-scroll k-modal-main');
    const iConf   = idx('id="k-modal-configurator"');
    const iSug    = idx('id="k-modal-suggestions"');
    expect(iConf).toBeGreaterThan(iScroll);
    expect(iSug).toBeGreaterThan(iScroll);
  });

  test('le panier latéral desktop (#k-modal-cart-slot) reste un frère indépendant, hors du scroll produit', () => {
    // Slot vide au chargement (reparentage JS uniquement) — cf. b-modal-core.js.
    const cartSlotTag = html.match(/<div id="k-modal-cart-slot"[^>]*>\s*<\/div>/);
    expect(cartSlotTag).not.toBeNull();
    const iSug      = idx('id="k-modal-suggestions"');
    const iZoneEnd  = html.indexOf('<!-- end .k-modal-product-zone -->', iSug);
    const iCartSlot = idx('id="k-modal-cart-slot"');
    expect(iCartSlot).toBeGreaterThan(iZoneEnd);
  });

  test('la safe-area mobile reste gérée en CSS (env(safe-area-inset-bottom)), pas en JS', () => {
    const shell = fs.readFileSync(path.join(ROOT, 'css/modal-shell.css'), 'utf8');
    expect(shell).toMatch(/env\(safe-area-inset-bottom/);
  });
});
