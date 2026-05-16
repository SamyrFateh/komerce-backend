/**
 * b-desktop-upgrade.js — Orchestrateur des enrichissements desktop ≥ 900px.
 *
 * Ce module ne fait que :
 *   1. Importer les deux modules d'enhancers thématiques :
 *        - b-catalog-desktop-enhancers : mega-menu, promo strip, homepage merch,
 *          card hover overlay, hero search bar, view:changed guard.
 *        - b-modal-desktop-enhancers   : zoom, breadcrumb, share, specs, trust,
 *          subtotal, recently-viewed.
 *   2. Installer deux glues locales :
 *        - setupScrollToTop          : bouton retour en haut.
 *        - setupSideCartFooterGuard  : masque le side-cart près du footer.
 *
 * Mobile (< 900px) : aucun effet — toutes les fonctions sortent sur !isDesktop().
 *
 * Point d'entrée unique : setupDesktopUpgrade(), appelé depuis main.js.
 */

import { isDesktop } from './b-scroll-owner.js';
import { setupCatalogDesktopEnhancers } from './b-catalog-desktop-enhancers.js';
import { setupModalDesktopEnhancers }   from './b-modal-desktop-enhancers.js';

'use strict';

// ═══════════════════════════════════════════════════════════════
//  SCROLL-TO-TOP BUTTON
// ═══════════════════════════════════════════════════════════════

function setupScrollToTop() {
  if (!isDesktop()) return;
  if (document.querySelector('.k-scroll-top')) return;

  var btn = document.createElement('button');
  btn.className = 'k-scroll-top';
  btn.setAttribute('aria-label', 'Retour en haut');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>';
  document.body.appendChild(btn);

  btn.addEventListener('click', function() {
    scrollPageToTop('smooth');
  });

  // Show/hide on scroll
  var _ticking = false;
  window.addEventListener('scroll', function() {
    if (_ticking) return;
    _ticking = true;
    requestAnimationFrame(function() {
      btn.classList.toggle('is-visible', getScrollY() > 600);
      _ticking = false;
    });
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════════
//  SIDE-CART FOOTER GUARD
// ═══════════════════════════════════════════════════════════════

/**
 * setupSideCartFooterGuard — masque le side-cart quand le footer entre dans le viewport.
 *
 * Pourquoi cette feature existe :
 *   position:sticky ne connaît pas les limites du footer. Sans guard, le side-cart
 *   chevauche visuellement le footer au bas de page.
 *
 * Implémentation : IntersectionObserver sur #k-footer → opacity 0 + pointerEvents none
 *   + transform translateY(8px) quand visible. Restoration au retour.
 *
 * NE PAS REMPLACER par une solution CSS-only (margin-bottom, padding) : a été testé,
 * ne fonctionne pas avec position:sticky dans un flex container.
 */
function setupSideCartFooterGuard() {
  var footer = document.getElementById('k-footer');
  var sc     = document.getElementById('k-side-cart');
  if (!footer || !sc || typeof IntersectionObserver === 'undefined') return;

  var observer = new IntersectionObserver(function(entries) {
    var footerVisible = entries[0].isIntersecting;
    sc.style.transition = 'opacity .2s ease, transform .2s ease';
    sc.style.opacity    = footerVisible ? '0'    : '';
    sc.style.pointerEvents = footerVisible ? 'none' : '';
    sc.style.transform  = footerVisible ? 'translateY(8px)' : '';
  }, {
    // Déclencher un peu avant que le footer soit complètement visible
    rootMargin: '0px 0px -20px 0px',
    threshold: 0,
  });

  observer.observe(footer);
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

export function setupDesktopUpgrade() {
  if (!isDesktop()) return;

  setupCatalogDesktopEnhancers();
  setupModalDesktopEnhancers();
  setupScrollToTop();
  setupSideCartFooterGuard();
}
