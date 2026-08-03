/**
 * @komerce-arch
 * @role          boutique-nav
 * @domain        boutique
 * @layer         ui-component
 * @criticality   high
 * @inputs        view_requests, bus_events, drawer_state, scroll_state, relais_data
 * @outputs       active_view, drawer_state, infinite_scroll, relais_list
 * @depends       b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js, b-checkout.js, b-catalog.js, b-favs.js, b-tracking.js, b-komerce.js, group/group-render-list.js, b-pager.js, b-scroll-owner.js
 * @used-by       boutique.js
 * @doctrine      navigation_sans_friction, mobile_desktop_coherence
 * @impact-areas  boutique-navigation, view-switching, drawer, infinite-scroll
 * @version       2026-06
 */
'use strict';

/**
 * @module b-nav
 * @brief Navigation — switchView, setupBnav, setupDrawer, setupInfiniteScroll, loadRelais
 *
 * Extrait de b-views.js — refacto v2
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
import { openMonKomerce }                  from './b-komerce.js';
import { renderGroupView, detectParticipantToken, stopPolling } from './group/group-render-list.js';
import { destroyMobilePager }            from './b-pager.js';
import { scrollPageToTop }               from './b-scroll-owner.js';

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
  const wasShop = document.body.classList.contains('k-view-shop');

  // Si on quitte la boutique, détruire le pager mobile AVANT de masquer le DOM.
  // Sinon #k-grid / .k-cat-section / ghost pages / listeners / scrollLeft restent
  // partiellement vivants et perturbent le retour Boutique.
  if (wasShop && tab !== 'shop') {
    destroyMobilePager();
  }

  // BUG-05 — arrêter le polling groupe dès qu'on quitte l'onglet group.
  // Le setInterval de 30s peut se déclencher 1-2 fois après le changement de vue
  // et tenter d'écrire dans un DOM qui n'existe plus (#k-group-progress-card).
  // renderGroupView() appellera stopPolling() puis startPolling() au retour.
  if (tab !== 'group') {
    stopPolling();
  }

  document.body.classList.remove('k-view-shop', 'k-view-fav', 'k-view-track', 'k-view-group', 'k-view-komerce');
  document.body.classList.add('k-view-' + tab);
  const catalog     = document.getElementById('k-catalog-section');
  const favView     = document.getElementById('k-fav-view');
  const trackView   = document.getElementById('k-track-view');
  const groupView   = document.getElementById('k-group-view');
  const komerceView = document.getElementById('k-komerce-view');
  const heroWrap    = document.getElementById('k-hero-fixed-wrap');
  const pageScroll  = dom.pageScroll;
  const promoSec    = document.getElementById('k-promos-section');
  if (catalog)     catalog.classList.toggle('u-hidden', tab !== 'shop');
  if (favView)     favView.classList.toggle('show', tab === 'fav');
  if (trackView)   trackView.classList.toggle('show', tab === 'track');
  if (groupView)   groupView.classList.toggle('show', tab === 'group');
  if (komerceView) komerceView.classList.toggle('show', tab === 'komerce');
  if (promoSec)    promoSec.classList.toggle('u-hidden', tab !== 'shop');
  if (heroWrap)    heroWrap.classList.toggle('u-hidden', tab !== 'shop');

  // Notifier les modules desktop (sidebar, merch cards, promo strip)
  bus.emit('view:changed', tab);

  if (pageScroll) {
    pageScroll.dataset.tab = tab;
    if (tab !== 'shop') {
      // Le vrai nettoyage a déjà été fait par destroyMobilePager().
      // On garde ce garde-fou pour le cas où la vue initiale n'était pas shop.
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

  if (tab === 'shop') {
    // Recréer le DOM catalogue une fois la vue Boutique redevenue visible.
    // renderGrid() remontera ensuite le pager mobile via b-catalog.js :
    // _recalcPagerVars → _setupInfiniteLoop → _setupMobilePager → _setupSectionAutoAdvance.
    requestAnimationFrame(function() {
      renderGrid();
      requestAnimationFrame(function() {
        scrollPageToTop('auto');
      });
    });
  } else {
    scrollPageToTop('smooth');
  }
}

// FIX 2026-07-11 : point d'entrée unique vers l'onglet Suivi, exposé via le
// bus plutôt qu'un import direct — b-checkout.js émettait déjà des appels
// bruts à renderTrackView()/switchView() sans les importer (donc no-op
// silencieux, cf. REX F04p). Un import direct depuis b-checkout.js créerait
// un cycle (b-nav.js importe déjà checkoutCart/closeOrderModal depuis
// b-checkout.js) ; le bus découple proprement les deux sens, dans le même
// esprit qu'ARCH-1 (pill/mini-cart via bus.on('cart:update')).
bus.on('nav:goto-track', () => { renderTrackView(); switchView('track'); });

// Lot 4 — lien discret checkout → Mon Komerce > Mon wallet (§5 : le checkout
// ne devient jamais l'écran de gestion du wallet, il ne fait que pointer).
bus.on('nav:goto-komerce-wallet', () => { openMonKomerce({ focus: 'wallet' }); });
bus.on('komerce:show', () => { switchView('komerce'); });

// §2.1 mandat correction liste partageable — l'onglet Groupe de niveau 1 a
// disparu ; « Mes listes » (b-komerce.js) est le nouveau point d'entrée et
// mène au même écran group-render-list.js, sans dupliquer sa logique.
bus.on('nav:goto-group', () => {
  document.querySelectorAll('.k-bnav-item, .k-header-nav-btn').forEach(i => {
    i.classList.toggle('active', i.dataset.tab === 'komerce');
  });
  renderGroupView();
  switchView('group');
});

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
      if (tab === 'komerce') { openMonKomerce(); return; }
      switchView('shop');
    });
  });
}

/**
 * Détecte un token participant dans l'URL au boot et bascule sur l'onglet Groupe.
 * Appelée depuis boutique.js après setupBnav().
 */
export function handleParticipantUrl() {
  const token = detectParticipantToken();
  if (!token) {
    // ── Deep-link ?tab= (hors participant) ──────────────────────────
    // Permet d'ouvrir directement un onglet via l'URL, ex: /boutique/?tab=group
    handleTabDeepLink();
    return;
  }
  // Nettoyer l'URL sans recharger la page
  try {
    const clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, '', clean);
  } catch (_) {}
  // Lien reçu : écran d'entrée dédié, hors du jeu d'onglets de niveau 1.
  document.querySelectorAll('.k-bnav-item, .k-header-nav-btn').forEach(i => {
    i.classList.remove('active');
  });
  renderGroupView({ participantToken: token });
  switchView('group');
}

/**
 * Deep-link ?tab= : ouvre un onglet depuis l'URL au chargement initial.
 * Ex: /boutique/?tab=group, /boutique/?tab=track, /boutique/?tab=fav
 * Nettoie le paramètre après traitement pour éviter les re-triggers
 * sur back/forward.
 */
function handleTabDeepLink() {
  try {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (!tab || tab === 'shop') return;

    // 'wallet' : redirection temporaire (Lot 4 §6) — l'ancien onglet wallet
    // autonome a disparu, tout lien ?tab=wallet encore actif ouvre désormais
    // Mon Komerce > Mon wallet. À retirer si aucun consommateur réel ne
    // justifie plus cette redirection.
    const validTabs = ['track', 'group', 'fav', 'komerce', 'wallet'];
    if (!validTabs.includes(tab)) return;
    const resolvedTab = tab === 'wallet' ? 'komerce' : tab;

    // Nettoyer ?tab= de l'URL
    params.delete('tab');
    const qs = params.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState({}, '', clean);

    // Activer l'onglet
    document.querySelectorAll('.k-bnav-item, .k-header-nav-btn').forEach(i => {
      i.classList.toggle('active', i.dataset.tab === (resolvedTab === 'group' ? 'komerce' : resolvedTab));
    });

    if (resolvedTab === 'fav')     { renderFavView(); switchView('fav'); }
    if (resolvedTab === 'track')   { renderTrackView(); switchView('track'); }
    if (resolvedTab === 'group')   { renderGroupView(); switchView('group'); }
    if (resolvedTab === 'komerce') { openMonKomerce(tab === 'wallet' ? { focus: 'wallet' } : {}); }
  } catch (_) {}
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




