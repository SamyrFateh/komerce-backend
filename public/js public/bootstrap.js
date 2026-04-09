/* ============================================================
   KOMERCE — Bootstrap
   Initialisation au chargement de la page
   ============================================================ */

document.addEventListener('DOMContentLoaded', function() {

  /* ── Initialisation navigation ── */
  initTabs();
  initCatCircles();
  initFilters();
  initViewToggle();
  initPromoBar();
  initHeroSearch();
  updateFavBadge();

  /* ── Chargement données ── */
  loadProducts();
  loadRelais();
  refreshCartBadge();

  /* ── Wiring boutons modales et panier ── */
  var omClose = document.getElementById('order-modal-close');
  if (omClose) omClose.addEventListener('click', closeOrderModal);

  var pmClose = document.getElementById('product-modal-close');
  if (pmClose) pmClose.addEventListener('click', closeProductModal);

  var lmClose = document.getElementById('look-modal-close');
  if (lmClose) lmClose.addEventListener('click', closeLookModal);

  var lookModal = document.getElementById('look-modal');
  if (lookModal) lookModal.addEventListener('click', function(e) {
    if (e.target === lookModal) closeLookModal();
  });

  var cartCloseBtn = document.getElementById('cart-close-btn');
  if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCart);

  var cartOverlay = document.getElementById('cart-overlay');
  if (cartOverlay) cartOverlay.addEventListener('click', closeCart);

  var navCartBtn = document.getElementById('nav-cart-btn');
  if (navCartBtn) navCartBtn.addEventListener('click', openCart);

  var trackBtn = document.getElementById('tracking-search-btn');
  if (trackBtn) trackBtn.addEventListener('click', searchTracking);

  var fcBtn = document.getElementById('footer-continue-btn');
  if (fcBtn) fcBtn.addEventListener('click', closeCart);

  var fclBtn = document.getElementById('footer-clear-btn');
  if (fclBtn) fclBtn.addEventListener('click', clearCart);

  var fcoBtn = document.getElementById('footer-checkout-btn');
  if (fcoBtn) fcoBtn.addEventListener('click', checkoutCart);

  var fwaBtn = document.getElementById('footer-whatsapp-btn');
  if (fwaBtn) fwaBtn.addEventListener('click', shareCartWhatsApp);

  /* ── Fermeture modales au clic overlay ── */
  var productModal = document.getElementById('product-modal');
  if (productModal) productModal.addEventListener('click', function(e) {
    if (e.target === productModal) closeProductModal();
  });

  var orderModal = document.getElementById('order-modal');
  if (orderModal) orderModal.addEventListener('click', function(e) {
    if (e.target === orderModal) closeOrderModal();
  });

  /* ── Clavier ── */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeProductModal();
      closeOrderModal();
      closeLookModal();
      closeCart();
    }
  });

  var trackInput = document.getElementById('tracking-input');
  if (trackInput) trackInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') searchTracking();
  });

  /* ── Service Worker ── */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(function(reg) { console.log('[App] SW registered, scope:', reg.scope); })
      .catch(function(err) { console.warn('[App] SW error:', err); });
  }

});
