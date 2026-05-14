/**
 * @module b-nav
 * @brief Navigation â€” switchView, setupBnav, setupDrawer, setupSeeAll, setupInfiniteScroll, loadRelais
 *
 * Extrait de b-views.js â€” refacto v2
 */

import { bus }                           from './b-bus.js';
import { state, dom, $, $$ }            from './b-store.js';
import { apiGet }                        from './b-utils.js';
import { showToast }           from './b-cart-core.js';
import { openCart, closeCart, renderCart, clearCart, shareCartWhatsApp, loadSharedCart } from './b-cart.js';
import { checkoutCart, closeOrderModal } from './b-checkout.js';
import { renderGrid, appendNextPage }    from './b-catalog.js';
import { renderFavView }                 from './b-favs.js';
import { renderTrackView }               from './b-tracking.js';

'use strict';

/**
 * Branche tous les listeners du drawer panier + modal commande.
 */
export function setupDrawer() {
  // Le bouton panier du header est critique : il doit rester cliquable
  // même si un élément secondaire du drawer manque.
  if (!dom.cartBtn) {
    console.error('[b-nav] setupDrawer : cartBtn manquant');
    return;
  }

  // Anti double-binding si setupDrawer est rappelé après hot reload / re-init.
  if (dom.cartBtn.dataset.drawerBound !== '1') {
    dom.cartBtn.addEventListener('click', openCart);
    dom.cartBtn.dataset.drawerBound = '1';
  }

  if (dom.cartClose && dom.cartClose.dataset.drawerBound !== '1') {
    dom.cartClose.addEventListener('click', closeCart);
    dom.cartClose.dataset.drawerBound = '1';
  }

  if (dom.cartOverlay && dom.cartOverlay.dataset.drawerBound !== '1') {
    dom.cartOverlay.addEventListener('click', closeCart);
    dom.cartOverlay.dataset.drawerBound = '1';
  }

  if (dom.cartContinue && dom.cartContinue.dataset.drawerBound !== '1') {
    dom.cartContinue.addEventListener('click', closeCart);
    dom.cartContinue.dataset.drawerBound = '1';
  }

  if (dom.cartClear && dom.cartClear.dataset.drawerBound !== '1') {
    dom.cartClear.addEventListener('click', () => {
      if (state.cart.length === 0) return;
      clearCart();
      showToast('🗑 Panier vidé');
    });
    dom.cartClear.dataset.drawerBound = '1';
  }

  if (dom.cartWhatsapp && dom.cartWhatsapp.dataset.drawerBound !== '1') {
    dom.cartWhatsapp.addEventListener('click', shareCartWhatsApp);
    dom.cartWhatsapp.dataset.drawerBound = '1';
  }

  if (dom.cartCheckout && dom.cartCheckout.dataset.drawerBound !== '1') {
    dom.cartCheckout.addEventListener('click', checkoutCart);
    dom.cartCheckout.dataset.drawerBound = '1';
  }

  loadSharedCart();

  if (dom.orderClose && dom.orderClose.dataset.drawerBound !== '1') {
    dom.orderClose.addEventListener('click', closeOrderModal);
    dom.orderClose.dataset.drawerBound = '1';
  }

  if (dom.orderModal && dom.orderModal.dataset.drawerBound !== '1') {
    dom.orderModal.addEventListener('click', (e) => {
      if (e.target === dom.orderModal) closeOrderModal();
    });
    dom.orderModal.dataset.drawerBound = '1';
  }

  const optionalMissing = [
    ['cartClose', dom.cartClose],
    ['cartOverlay', dom.cartOverlay],
    ['cartContinue', dom.cartContinue],
    ['cartClear', dom.cartClear],
    ['cartWhatsapp', dom.cartWhatsapp],
    ['cartCheckout', dom.cartCheckout],
    ['orderClose', dom.orderClose],
    ['orderModal', dom.orderModal],
  ].filter(([, el]) => !el).map(([name]) => name);

  if (optionalMissing.length) {
    console.warn('[b-nav] setupDrawer : éléments optionnels manquants :', optionalMissing.join(', '));
  }
}

/**
 * Active le scroll infini (IntersectionObserver sur sentinel).
 */
export function setupInfiniteScroll() {
  const sentinel = document.createElement('div');
  sentinel.id = 'k-scroll-sentinel';
  const spinner = document.createElement('div');
  spinner.id = 'k-load-more-spinner';
  spinner.className = 'k-load-more-spinner';
  spinner.innerHTML = '<div class="k-spinner k-spinner--sm"></div>';
  const catalogSec = document.getElementById('k-catalog-section');
  if (catalogSec) {
    catalogSec.appendChild(spinner);
    catalogSec.appendChild(sentinel);
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      spinner.classList.add('show');
      setTimeout(() => { appendNextPage(); }, 300);
    }
  }, { rootMargin: '200px' });
  observer.observe(sentinel);
}

/**
 * Bascule entre les vues shop / fav / track.
 * @param {string} tab - 'shop' | 'fav' | 'track'
 */
export function switchView(tab) {
  document.body.classList.remove('k-view-shop', 'k-view-fav', 'k-view-track');
  document.body.classList.add('k-view-' + tab);
  const catalog    = document.getElementById('k-catalog-section');
  const favView    = document.getElementById('k-fav-view');
  const trackView  = document.getElementById('k-track-view');
  const heroWrap   = document.getElementById('k-hero-fixed-wrap');
  const pageScroll = dom.pageScroll;
  const promoSec   = document.getElementById('k-promos-section');
  if (catalog)   catalog.classList.toggle('u-hidden', tab !== 'shop');
  if (favView)   favView.classList.toggle('show', tab === 'fav');
  if (trackView) trackView.classList.toggle('show', tab === 'track');
  if (promoSec)  promoSec.classList.toggle('u-hidden', tab !== 'shop');
  if (heroWrap)  heroWrap.classList.toggle('u-hidden', tab !== 'shop');

  // Notifier les modules desktop (sidebar, merch cards, promo strip)
  bus.emit('view:changed', tab);

  if (pageScroll) {
    pageScroll.dataset.tab = tab;
    if (tab !== 'shop') {
      // DÃ©sactiver le pager cage quand on quitte la boutique
      pageScroll.style.top = '';
      pageScroll.classList.remove('k-pager-active');
    }
  }

  // Fermer le panier si ouvert
  const cartOverlay = document.getElementById('k-cart-overlay');
  const cartDrawer  = document.getElementById('k-cart-drawer');
  if (cartOverlay) cartOverlay.classList.remove('open');
  if (cartDrawer)  cartDrawer.classList.remove('open');
  document.body.classList.remove('cart-open');
  scrollPageToTop('smooth');
}

/**
 * Branche la bottom nav mobile + les boutons nav desktop.
 */
export function setupBnav() {
  const allNavBtns = document.querySelectorAll('.k-bnav-item, .k-header-nav-btn');
  allNavBtns.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      allNavBtns.forEach(i => i.classList.remove('active'));
      allNavBtns.forEach(i => { if (i.dataset.tab === tab) i.classList.add('active'); });
      if (tab === 'cart')  { openCart(); return; }
      if (tab === 'fav')   { renderFavView(); switchView('fav'); return; }
      if (tab === 'track') { renderTrackView(); switchView('track'); return; }
      switchView('shop');
    });
  });
}

/**
 * @deprecated MORT — #k-see-all-promos est absent de index.html.
 * Le guard `if (btn)` rend cette fonction no-op silencieuse.
 * À supprimer avec l'import correspondant dans boutique.js lors du prochain nettoyage.
 */
export function setupSeeAll() {
  const btn = $('#k-see-all-promos');
  if (btn) {
    btn.addEventListener('click', () => {
      state.filtered = state.products.filter(p => p.promo_pct > 0);
      state.activeCat = 'all';
      $$('.k-chip').forEach(c => c.classList.remove('active'));
      $$('.k-chip')[0].classList.add('active');
      renderGrid();
      const g = document.querySelector('.k-grid');
      if (g) scrollPageToElement(g, -8, 'smooth');
    });
  }
}

/**
 * Charge la liste des relais depuis l'API et la stocke dans state.
 */
export async function loadRelais() {
  try {
    const data = await apiGet('/api/relais/public');
    state.relais = data.relais || data || [];
  } catch (e) {
    state.relais = [];
  }
}




