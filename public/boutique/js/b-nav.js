/**
 * @module b-nav
 * @brief Navigation — switchView, setupBnav, setupDrawer, setupSeeAll, setupInfiniteScroll, loadRelais
 *
 * Extrait de b-views.js — refacto v2
 */

import { bus }                           from './b-bus.js';
import { state, dom, $, $$ }            from './b-store.js';
import { apiGet }                        from './b-utils.js';
import { saveCart, showToast }           from './b-cart-core.js';
import { openCart, closeCart, renderCart, shareCartWhatsApp, loadSharedCart } from './b-cart.js';
import { checkoutCart, closeOrderModal } from './b-checkout.js';
import { renderGrid, appendNextPage }    from './b-catalog.js';
import { renderFavView }                 from './b-favs.js';
import { renderTrackView }               from './b-tracking.js';

'use strict';

/**
 * Branche tous les listeners du drawer panier + modal commande.
 */
export function setupDrawer() {
  dom.cartBtn.addEventListener('click', openCart);
  dom.cartClose.addEventListener('click', closeCart);
  dom.cartOverlay.addEventListener('click', closeCart);
  dom.cartContinue.addEventListener('click', closeCart);
  dom.cartClear.addEventListener('click', () => {
    if (state.cart.length === 0) return;
    state.cart = [];
    saveCart();
    renderCart();
    showToast('🗑 Panier vidé');
  });
  dom.cartWhatsapp.addEventListener('click', shareCartWhatsApp);
  loadSharedCart();
  dom.cartCheckout.addEventListener('click', checkoutCart);

  dom.orderClose.addEventListener('click', closeOrderModal);
  dom.orderModal.addEventListener('click', (e) => {
    if (e.target === dom.orderModal) closeOrderModal();
  });
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
  const catalog    = document.getElementById('k-catalog-section');
  const favView    = document.getElementById('k-fav-view');
  const trackView  = document.getElementById('k-track-view');
  const heroWrap   = document.getElementById('k-hero-fixed-wrap');
  const pageScroll = document.getElementById('k-page-scroll');
  const promoSec   = document.getElementById('k-promos-section');

  if (catalog)   catalog.classList.toggle('u-hidden', tab !== 'shop');
  if (favView)   favView.classList.toggle('show', tab === 'fav');
  if (trackView) trackView.classList.toggle('show', tab === 'track');
  if (promoSec)  promoSec.classList.toggle('u-hidden', tab !== 'shop');
  if (heroWrap)  heroWrap.classList.toggle('u-hidden', tab !== 'shop');

  if (pageScroll) {
    pageScroll.dataset.tab = tab;
    if (tab !== 'shop') pageScroll.style.top = '';
  }

  // Fermer le panier si ouvert
  const cartOverlay = document.getElementById('k-cart-overlay');
  const cartDrawer  = document.getElementById('k-cart-drawer');
  if (cartOverlay) cartOverlay.classList.remove('open');
  if (cartDrawer)  cartDrawer.classList.remove('open');
  document.body.classList.remove('cart-open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
 * Branche le bouton "Voir tout les promos".
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
      const s = document.getElementById('k-page-scroll');
      const g = document.querySelector('.k-grid');
      if (s && g) s.scrollTo({ top: g.offsetTop - 8, behavior: 'smooth' });
      else if (g) g.scrollIntoView({ behavior: 'smooth' });
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
