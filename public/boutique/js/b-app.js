/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-app.js
   Main init, bottom nav, view switcher, relais
   Depends on: ALL other b-*.js modules
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── VIEW SWITCHER ─────────────────────────────────────────
  K.switchView = function (tab) {
    K.state.currentTab = tab;
    const catalog  = document.getElementById('k-catalog-section');
    const promo    = document.getElementById('k-promos-section');
    const sortBar  = document.getElementById('k-sort-bar-section');
    const catNav   = document.getElementById('k-cats');
    const favView  = document.getElementById('k-fav-view');
    const trackView = document.getElementById('k-track-view');

    const isShop  = tab === 'shop';
    const isFav   = tab === 'fav';
    const isTrack = tab === 'track';

    if (catalog)  catalog.style.display  = isShop ? '' : 'none';
    if (promo)    promo.style.display    = isShop ? '' : 'none';
    if (sortBar)  sortBar.style.display  = isShop ? '' : 'none';
    if (catNav)   catNav.style.display   = isShop ? '' : 'none';
    if (favView)  favView.style.display  = isFav  ? '' : 'none';
    if (trackView) trackView.style.display = isTrack ? '' : 'none';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── BOTTOM NAV ────────────────────────────────────────────
  K.setupBnav = function () {
    K.$$('.k-bnav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        K.$$('.k-bnav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        if (tab === 'cart')  { K.openCart(); return; }
        if (tab === 'fav')   { K.renderFavView(); K.switchView('fav');   return; }
        if (tab === 'track') { K.renderTrackView(); K.switchView('track'); return; }
        K.switchView('shop');
      });
    });
  };

  // ── LOAD RELAIS ───────────────────────────────────────────
  K.loadRelais = async function () {
    try {
      const data   = await K.apiGet('/api/relais/public');
      K.state.relais = data.relais || data || [];
    } catch (e) { K.state.relais = []; }
  };

  // ── INIT ──────────────────────────────────────────────────
  K.init = function () {
    K._initDom();

    // Cart badge
    K.updateCartBadge();

    // Setup all modules
    K.setupCats();
    K.setupSearch();
    K.setupSortBar();
    K.setupDrawer();
    K.setupModal();
    K.setupBnav();
    K.setupSeeAll();
    K.setupInfiniteScroll();
    K.setupScrollToTop();

    // Load data
    K.loadProducts();
    K.loadRelais();
    K.loadSharedCart();

    // Hero alignment: scroll hero into view on load
    const hero = document.getElementById('k-hero');
    if (hero) hero.scrollIntoView({ behavior: 'auto', block: 'start' });
  };

  // ── BOOT ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', K.init);
  } else {
    K.init();
  }

})(window.K = window.K || {});
