/**
 * @komerce-arch-lite
 * @role          boutique-b-desktop-upgrade
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * b-desktop-upgrade.js â€” Orchestrateur des enrichissements desktop â‰¥ 900px.
 *
 * Ce module ne fait que :
 *   1. Importer les deux modules d'enhancers thÃ©matiques :
 *        - b-catalog-desktop-enhancers : mega-menu, promo strip, homepage merch,
 *          card hover overlay, hero search bar, view:changed guard.
 *        - b-modal-desktop-enhancers   : zoom, breadcrumb, share, specs, trust,
 *          subtotal, recently-viewed.
 *   2. Installer deux glues locales :
 *        - setupScrollToTop          : bouton retour en haut.
 *        - setupSideCartFooterGuard  : masque le side-cart prÃ¨s du footer.
 *
 * Mobile (< 900px) : aucun effet â€” toutes les fonctions sortent sur !isDesktop().
 *
 * Point d'entrÃ©e unique : setupDesktopUpgrade(), appelÃ© depuis main.js.
 */

import { isDesktop, getScrollY, scrollPageToTop } from './b-scroll-owner.js';
import { setupCatalogDesktopEnhancers } from './b-catalog-desktop-enhancers.js';
import { setupModalDesktopEnhancers }   from './b-modal-desktop-enhancers.js';

'use strict';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCROLL-TO-TOP BUTTON
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function setupScrollToTop() {
  if (!isDesktop()) return;
  if (document.querySelector('.k-scroll-top')) return;

  let btn = document.createElement('button');
  btn.className = 'k-scroll-top';
  btn.setAttribute('aria-label', 'Retour en haut');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>';
  document.body.appendChild(btn);

  btn.addEventListener('click', function() {
    scrollPageToTop('smooth');
  });

  // Show/hide on scroll
  let _ticking = false;
  window.addEventListener('scroll', function() {
    if (_ticking) return;
    _ticking = true;
    requestAnimationFrame(function() {
      btn.classList.toggle('is-visible', getScrollY() > 600);
      _ticking = false;
    });
  }, { passive: true });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SIDE-CART FOOTER GUARD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * setupSideCartFooterGuard â€” masque le side-cart quand le footer entre dans le viewport.
 *
 * DÃ‰SACTIVÃ‰ depuis PR-SC2 v3.2 (passage en position:fixed) â€” voir docs/PR-SC2.
 *
 * Historique : posÃ©e Ã  l'Ã©poque oÃ¹ .k-side-cart Ã©tait en position:sticky.
 * Sans guard, le sticky chevauchait visuellement le footer au bas de page.
 *
 * Pourquoi dÃ©sactivÃ©e maintenant : le pattern actuel est position:fixed +
 * body { padding-right: 240px } sur body:has(.k-side-cart.has-items) /
 * body.sc-reserve. Le footer respecte donc dÃ©jÃ  les 240px en bordure
 * droite, le side-cart n'a plus Ã  se cacher pour libÃ©rer le footer.
 *
 * Pour rÃ©activer (en cas de retour Ã  sticky), supprimer le `return` en
 * tÃªte de fonction.
 */
function setupSideCartFooterGuard() {
  // No-op : voir docstring ci-dessus.
  return;

  // eslint-disable-next-line no-unreachable
  let footer = document.getElementById('k-footer');
  let sc     = document.getElementById('k-side-cart');
  if (!footer || !sc || typeof IntersectionObserver === 'undefined') return;

  let observer = new IntersectionObserver(function(entries) {
    let footerVisible = entries[0].isIntersecting;
    sc.style.transition = 'opacity .2s ease, transform .2s ease';
    sc.style.opacity    = footerVisible ? '0'    : '';
    sc.style.pointerEvents = footerVisible ? 'none' : '';
    sc.style.transform  = footerVisible ? 'translateY(8px)' : '';
  }, {
    // DÃ©clencher un peu avant que le footer soit complÃ¨tement visible
    rootMargin: '0px 0px -20px 0px',
    threshold: 0,
  });

  observer.observe(footer);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  ENTRY POINT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export function setupDesktopUpgrade() {
  if (!isDesktop()) return;

  setupCatalogDesktopEnhancers();
  setupModalDesktopEnhancers();
  setupScrollToTop();
  setupSideCartFooterGuard();
}
