'use strict';

/**
 * Fixture DOM canonique minimale — side cart desktop (#k-side-cart) et
 * drawer mobile (#k-cart-drawer), tels que définis dans index.html
 * (public/boutique/index.html), pour permettre aux tests d'exercer le
 * chrome réel piloté par applySnapshotDrawerFooter/applySnapshotSideCartChrome
 * (b-cart.js) sans dépendre du reste de la page.
 *
 * ATTENTION (constat de ce lot, voir rapport de clôture Lot D) : dans
 * index.html tel que livré, le conteneur des boutons du footer drawer ne
 * porte que la classe `.k-cart-footer-btns`, PAS d'id. Or
 * applySnapshotDrawerFooter() (b-cart.js) cible
 * `document.getElementById('k-cart-footer-btns')`. Sans id, les boutons
 * d'action snapshot (Sauvegarder/Modifier/Partager/Fermer/Acheter) ne
 * sont jamais injectés en production. Cette fixture ajoute l'id pour
 * pouvoir tester le comportement de b-cart.js tel qu'il est écrit — ce
 * n'est PAS une confirmation que index.html est correct. Écart signalé
 * séparément, hors périmètre de ce lot de tests.
 */
function buildCartDom() {
  document.body.innerHTML = `
    <button id="k-cart-btn" type="button"></button>
    <button id="k-add-cart-btn" type="button"></button>
    <button id="k-modal-cart-btn" type="button"></button>
    <aside id="k-side-cart" class="k-side-cart">
      <div class="k-sc-title-bar"><span class="k-sc-title-label">Mon panier</span></div>
      <div id="k-sc-items" class="k-sc-items"></div>
      <div class="k-sc-header">
        <strong id="k-sc-total"></strong>
        <button id="k-sc-checkout" type="button">Commander (<span id="k-sc-count-inline">0</span>)</button>
        <button id="k-sc-cta" type="button">Voir le panier</button>
        <button id="k-sc-share" type="button">Partager</button>
        <button id="k-sc-clear" type="button">Vider</button>
      </div>
    </aside>

    <div id="k-cart-overlay" class="k-cart-overlay"></div>
    <div id="k-cart-drawer" class="k-cart-drawer">
      <div class="k-cart-header" id="k-cart-header">
        <span id="k-cart-header-title">Mon Panier</span>
        <button id="k-cart-close">✕</button>
      </div>
      <div id="k-cart-body" class="k-cart-body"></div>
      <div id="k-cart-footer" class="k-cart-footer u-hidden">
        <span id="k-cart-item-count">0</span>
        <span id="k-cart-item-plural"></span>
        <span id="k-cart-subtotal-val"></span>
        <span id="k-cart-total-val"></span>
        <span id="k-cart-total-conv"></span>
        <div id="k-cart-footer-btns" class="k-cart-footer-btns">
          <button id="k-cart-continue">← Continuer</button>
          <button id="k-cart-clear">🗑</button>
          <button id="k-cart-share">📤 Partager</button>
          <button id="k-cart-checkout">✅ Commander</button>
        </div>
      </div>
    </div>

    <div id="k-order-modal" class="k-order-overlay"></div>
  `;
}

module.exports = { buildCartDom };
