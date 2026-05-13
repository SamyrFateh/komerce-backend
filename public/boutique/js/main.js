/**
 * @module main
 * @brief Point d'entrée ES module de la boutique Komerce.
 *
 * Ordre de chargement (garanti par l'ordre des imports) :
 *   1. b-utils.js   → named exports + window.KUtils compat
 *   2. b-bus.js     → event bus partagé (window._kbus pour debug)
 *   3. b-store.js   → state + SUBCATS + dom + initDom()
 *   4. boutique.js  → logique applicative §3-§15 (Phase 2 — IIFE retiré)
 *
 * Architecture cible (après toutes les phases) :
 *   main.js importe tous les modules b-*.js
 *   boutique.js = §13 INIT uniquement (~150 lignes)
 *
 * Feuille de route :
 *   Phase 1 ✅  Fondations (b-bus, b-store, b-utils ES, main)
 *   Phase 2 ✅  boutique.js → IIFE retirée, imports ajoutés, initDom()
 *   Phase 3     b-cart-core.js extrait (§3)
 *   Phase 4     b-catalog.js extrait (§4+6+8)
 *   Phase 5     b-modal.js extrait (§9)
 *   Phase 6     b-cart.js + b-pager.js extraits (§7+10+14+15)
 *   Phase 7     boutique.js = §13 INIT seulement (~150 lignes)
 */

import './b-utils.js';        // helpers purs + window.KUtils compat
import { bus } from './b-bus.js';
import './b-store.js';        // state + SUBCATS + dom (initDom appelé par boutique.js §13)
import './boutique.js';       // Phase 2 : IIFE retiré — §3 à §15 + §13 INIT
// b-cart-pill.js désactivé — remplacé par b-mini-cart.js
import { setupDesktopUpgrade } from './b-desktop-upgrade.js'; // LOT 12 : refonte desktop Temu
import { isDesktop }          from './b-scroll-owner.js';
import { setupMiniCart }       from './b-mini-cart.js';       // Mini-cart flottant mobile
import { setupProductOpenContract } from './b-product-open-contract.js'; // Contrat panier → modal produit

// Expose bus globalement pour debug + devtools
if (typeof window !== 'undefined') {
  window._kbus = bus;
  // LOT 12 : init desktop upgrade après le boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setupDesktopUpgrade();
      setupMiniCart();   // Mini-cart flottant mobile
      setupProductOpenContract(); // Panier mobile/desktop → fiche produit
    });
  } else {
    setupDesktopUpgrade();
    setupMiniCart();     // Mini-cart flottant mobile
    setupProductOpenContract();   // Panier mobile/desktop → fiche produit
  }

  // Bug 11 fix : si chargement en mobile puis resize → desktop, initialiser setupDesktopUpgrade()
  // Une seule fois grâce au flag, sans impact sur le mobile.
  var _desktopUpgradeDone = isDesktop();
  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    if (_desktopUpgradeDone) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      if (isDesktop() && !_desktopUpgradeDone) {
        _desktopUpgradeDone = true;
        setupDesktopUpgrade();
      }
    }, 150);
  }, { passive: true });
}
