/**
 * @module b-views
 * @brief §12 VIEWS — Favoris, Suivi, Historique commandes, switchView
 *
 * Extrait de boutique.js — Option C Phase 9
 */

import { bus }                        from './b-bus.js';
import { state, dom, $, $$ }          from './b-store.js';
import { fmt, fmtPrice, sanitize, optimizeImgUrl } from './b-utils.js';
import { showToast, saveCart }        from './b-cart-core.js';
import { openCart, closeCart, renderCart } from './b-cart.js';
import { renderGrid, openModal }      from './b-catalog.js';
import { shareCartWhatsApp }          from './b-cart.js';

  // ║  §12 · VIEWS — Favoris, Suivi, Historique commandes, switchView  ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur modules: b-favs.js · b-tracking.js

  /**
   * Initialise le drawer de navigation latéral (open/close/swipe).
   * Gère le backdrop, les gestes tactiles et l'accessibilité.
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
      renderCartBody();
      showToast('🗑 Panier vidé');
    });
    dom.cartWhatsapp.addEventListener('click', shareCartWhatsApp);
    loadSharedCart();
    dom.cartCheckout.addEventListener('click', checkoutCart);

    // Order modal
    dom.orderClose.addEventListener('click', closeOrderModal);
    dom.orderModal.addEventListener('click', (e) => {
      if (e.target === dom.orderModal) closeOrderModal();
    });
  }

  /* ── INFINITE SCROLL ───────────────────────────────────── */
  /**
 * Active le scroll infini (IntersectionObserver sur sentinel).
 */
export function setupInfiniteScroll() {
    // Créer le sentinel + spinner
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
    // Observer
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        spinner.classList.add('show');
        setTimeout(() => { appendNextPage(); }, 300);
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }

  /* ── VUE FAVORIS ────────────────────────────────────────── */
  /**
 * Rend la vue Favoris.
 */
export function renderFavView() {
    let el = document.getElementById('k-fav-view');
    if (!el) {
      el = document.createElement('div');
      el.id = 'k-fav-view'; el.className = 'k-fav-view';
      document.getElementById('k-catalog-section').after(el);
    }
    const favProducts = state.products.filter(p => state.favs.includes(p.id));

    // FEATURE 1 : Détecter les produits en promo parmi les favoris
    const promoFavs = favProducts.filter(p => (p.promo_pct || 0) > 0);

    // FEATURE 2 : Mettre à jour le badge "🎉" sur l'icône Favoris de la bnav
    updateFavPromoBadge(promoFavs.length);

    if (!favProducts.length) {
      el.innerHTML = `<h2>❤️ Favoris</h2>
        <div class="k-fav-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <p>Aucun favori pour l'instant</p>
          <p class="k-fav-hint">Appuie sur 🤍 sur un produit pour l'ajouter ici</p>
        </div>`;
    } else {
      const cardsHTML = favProducts.map(p => {
        const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
        const qty = inCart ? inCart.qty : 0;
        return `<div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            ${renderProductCarousel(p, 400)}
            ${p.promo_pct ? `<span class="k-card-promo k-card-promo-fav">🎉 -${p.promo_pct}%</span>` : ''}
            <button class="k-card-fav liked" data-fav="${p.id}" aria-label="Retirer des favoris">❤️</button>
            <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
              ${qty > 0
                ? `<span class="k-add-minus" data-pid="${p.id}">−</span><span class="k-add-qty">${qty}</span><span class="k-add-plus-ic">+</span>`
                : '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="20" height="20">'}
            </button>
          </div>
          <div class="k-card-info">
            <div class="k-card-name">${sanitize(p.name)}</div>
            <div class="k-card-bottom k-card-prices-row">
              <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
              ${p.promo_pct ? `<span class="k-card-old-price">${fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100)))}</span>` : ''}
            </div>

          </div>
        </div>`;
      }).join('');

      // FEATURE 1 bis : Banner "X produits en promo !" si applicable
      const promoBanner = promoFavs.length > 0
        ? `<div class="k-fav-promo-banner">
             <span class="k-fav-promo-icon">🎉</span>
             <div class="k-fav-promo-text">
               <strong>${promoFavs.length} de vos favori${promoFavs.length > 1 ? 's sont' : ' est'} en promo !</strong>
               <span>Profitez des réductions avant qu'elles disparaissent</span>
             </div>
           </div>`
        : '';

      // FEATURE 3 : Bouton partager la wishlist
      const shareBtn = `<button class="k-fav-share-btn" id="k-fav-share-btn">
        <span class="k-fav-share-icon">📲</span>
        <span>Envoyer ma liste de souhaits</span>
      </button>`;

      el.innerHTML = `<h2>❤️ Favoris <span class="k-fav-count">${favProducts.length} produit${favProducts.length > 1 ? 's' : ''}</span></h2>
        ${promoBanner}
        ${shareBtn}
        <div class="k-grid" id="k-fav-grid">${cardsHTML}</div>`;

      const favGrid = document.getElementById('k-fav-grid');
      if (favGrid) {
        favGrid.querySelectorAll('.k-card').forEach(card => {
        bindCarouselDots(card);
          card.addEventListener('click', (e) => {
            if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab')) return;
            openModal(card.dataset.id);
          });
        });
        favGrid.querySelectorAll('.k-card-fav').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFav(btn.dataset.fav, btn);
            // Rafraîchir la vue après retrait
            setTimeout(() => renderFavView(), 100);
          });
        });
        favGrid.querySelectorAll('.k-card-add').forEach(btn => {
          btn.dataset.bound = '1';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
            else { quickAdd(btn.dataset.add, btn); }
          });
        });
      }

      // FEATURE 3 : Click sur "Envoyer ma liste de souhaits"
      const shareWishlistBtn = document.getElementById('k-fav-share-btn');
      if (shareWishlistBtn) {
        shareWishlistBtn.addEventListener('click', shareWishlistWhatsApp);
      }
    }
  }

  // FEATURE 2 : Badge "🎉" sur l'icône Favoris de la bnav quand promos actives
  /**
   * Met à jour le badge numérique sur l'onglet Favoris (nb de promos actives).
   * @param {number} promoCount - Nombre de produits favoris en promo
   */
export function updateFavPromoBadge(promoCount) {
    const favNavItem = document.querySelector('.k-bnav-item[data-tab="fav"]');
    if (!favNavItem) return;
    let badge = favNavItem.querySelector('.k-bnav-promo-badge');
    if (promoCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'k-bnav-promo-badge';
        favNavItem.appendChild(badge);
      }
      badge.textContent = '🎉';
      badge.title = promoCount + ' favori' + (promoCount > 1 ? 's' : '') + ' en promo !';
    } else if (badge) {
      badge.remove();
    }
  }

  // FEATURE 3 : Partage wishlist via WhatsApp
  /**
 * Partage la liste de souhaits (favoris) via WhatsApp.
 */
export async function shareWishlistWhatsApp() {
    const favProducts = state.products.filter(p => state.favs.includes(p.id));
    if (favProducts.length === 0) {
      showToast('Aucun favori à partager.', 'error');
      return;
    }

    showToast('⏳ Génération du lien…', 'info');

    // Utilise l'API /api/shares existante pour créer un lien court partageable
    // (comme le partage panier mais avec qty=1 pour chaque favori)
    let shareURL;
    try {
      const items = favProducts.map(p => ({ product_id: p.id, qty: 1 }));
      const res = await apiPost('/api/shares', { items: items });
      shareURL = (res && res.share_url) || (window.location.origin + '/Komerce_Boutique.html');
    } catch (e) {
      console.warn('[wishlist] share API error:', e);
      // Fallback : URL simple de la boutique
      shareURL = window.location.origin + '/Komerce_Boutique.html';
    }

    // Construire le message WhatsApp
    const lines = [];
    lines.push('💝 *Ma liste de souhaits Komerce*');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('');

    favProducts.slice(0, 10).forEach((p, idx) => {
      const priceStr = fmt(p.price_kmf || 0, 'KMF');
      let line = (idx + 1) + '. ' + (p.name || 'Produit') + ' — ' + priceStr;
      if (p.promo_pct > 0) {
        line += ' 🎉 (-' + p.promo_pct + '%)';
      }
      lines.push(line);
    });

    if (favProducts.length > 10) {
      lines.push('');
      lines.push('... et ' + (favProducts.length - 10) + ' autre' + (favProducts.length > 11 ? 's' : ''));
    }

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('Tu peux m\'offrir l\'un d\'eux ? 🥰');
    lines.push('👉 Voir la liste :');
    lines.push(shareURL);

    const msg = lines.join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  /* ── VUE SUIVI ───────────────────────────────────────────── */
  /* ── OTP helpers ────────────────────────────────────────────────────── */
  const TRACK_STEPS = [
    { key: 'pending',     label: 'Commande reçue',         icon: '✓',  sub: 'Enregistrée avec succès' },
    { key: 'preparing',   label: 'En préparation',          icon: '⚙️', sub: 'Nous préparons votre colis' },
    { key: 'in_transit',  label: 'En route vers le relais', icon: '🚚', sub: '' },
    { key: 'at_relay',    label: 'Disponible au relais',    icon: '🏪', sub: 'Prêt à être retiré' },
    { key: 'delivered',   label: 'Retiré',                  icon: '✅', sub: 'Commande clôturée' }
  ];

  /**
   * Génère le HTML de la timeline de statut commande (commandée → livrée).
   * @param {string} status - Statut courant (ex: "pending", "shipped", "delivered")
   * @returns {string} HTML de la timeline
   */
export function buildTimeline(status) {
    const idx = TRACK_STEPS.findIndex(s => s.key === status);
    return TRACK_STEPS.map((s, i) => {
      const done    = i < idx;
      const current = i === idx;
      const cls     = done ? 'done' : current ? 'current' : '';
      return `<div class="k-track-step">
        <div class="k-track-step-dot ${cls}">${done ? '✓' : s.icon}</div>
        <div class="k-track-step-info">
          <div class="k-track-step-label">${s.label}</div>
          <div class="k-track-step-sub">${s.sub}</div>
        </div>
      </div>`;
    }).join('');
  }

  /**
   * Injecte la liste des commandes passées dans le container de l'onglet Suivi.
   * @param {Array}       orders    - Tableau d'objets commande
   * @param {HTMLElement} container - Élément DOM cible
   */
export function renderOrdersHistory(orders, container) {
    if (!orders.length) {
      container.innerHTML = '<div class="k-search-empty">Aucune commande trouvée.</div>';
      return;
    }
    container.innerHTML = orders.map(o => `
      <div class="k-order-card">
        <div class="k-order-card-head">
          <span class="k-order-ref">${o.reference || o.id}</span>
          <span class="k-order-date">${o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : ''}</span>
        </div>
        <div class="k-order-card-total">${fmt(o.total_amount || 0, 'KMF')}</div>
        <div class="k-track-steps k-track-steps--compact">${buildTimeline(o.status || 'pending')}</div>
      </div>`).join('');
  }

  /**
   * Injecte le détail complet d'une commande (items, statut, timeline, infos relais).
   * @param {Object}      order     - Objet commande complet
   * @param {HTMLElement} container - Élément DOM cible
   */
export function renderOrderDetail(order, container) {
    container.innerHTML = `
      <div class="k-order-card">
        <div class="k-order-card-head">
          <span class="k-order-ref">${order.reference || order.id}</span>
          <span class="k-order-date">${order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : ''}</span>
        </div>
        <div class="k-order-card-total">${fmt(order.total_amount || 0, 'KMF')}</div>
        <div class="k-track-steps">${buildTimeline(order.status || 'pending')}</div>
      </div>`;
  }

  /**
   * Initialise la vue Suivi : formulaire tracking rapide + lien historique OTP.
   * Deux modes : tracking 4 chiffres (anonyme) et historique complet (OTP WhatsApp).
   */
export function renderTrackView() {
    let el = document.getElementById('k-track-view');
    if (!el) {
      el = document.createElement('div');
      el.id = 'k-track-view'; el.className = 'k-track-view';
      const favEl = document.getElementById('k-fav-view') || document.getElementById('k-catalog-section');
      favEl.after(el);
    }

    // ── NOUVEAU : Tentative auto-chargement via cookie JWT ──
    // Si le user a un cookie valide (= a déjà commandé), on affiche ses commandes directement
    el.innerHTML = '<div class="k-track-loading"><div class="k-track-loading-spin"></div><p>Chargement de vos commandes…</p></div>';

    (async () => {
      try {
        const data = await apiGet('/api/orders?limit=20');
        // L'API retourne un tableau direct [{...}, {...}] ou parfois {orders:[...]}
        const orders = Array.isArray(data) ? data : ((data && data.orders) || []);
        if (orders.length > 0) {
          renderMyOrdersList(el, orders);
          return;
        }
        // 0 commande → on reste en mode recherche classique
        renderTrackViewSearchMode(el);
      } catch (err) {
        // 401 / 403 / erreur → mode recherche classique
        console.log('[track] pas de session, mode recherche :', err && err.message);
        renderTrackViewSearchMode(el);
      }
    })();
  }

  /* ── NOUVEAU : Affichage liste "Mes commandes" ──
     Si le user est connu via cookie JWT, on lui montre ses commandes
     directement, triées par date (plus récentes en premier).
  */
  /**
 * Rend la liste des commandes dans l'onglet Suivi.
 * @param {Array} orders - Commandes
 */
export function renderMyOrdersList(el, orders) {
    const header = '<h2>📦 Mes commandes</h2>' +
      '<p class="k-track-sub-hint">' + orders.length + ' commande' + (orders.length > 1 ? 's' : '') + ' trouvée' + (orders.length > 1 ? 's' : '') + '</p>';

    const cards = orders.map(function(o) {
      const statusInfo = getStatusDisplay(o.status || 'pending', o.payment_status);
      const totalStr = fmt(o.total_kmf || 0, 'KMF');
      const dateStr = formatOrderDate(o.created_at);
      // L'API liste retourne : product_name, product_image_url, items_count
      const productName = o.product_name || 'Commande';
      const productImg = o.product_image_url || null;
      const itemsCount = parseInt(o.items_count, 10) || 1;
      const imgHtml = productImg
        ? '<img src="' + sanitize(optimizeImgUrl(productImg, 100)) + '" alt="" loading="lazy" decoding="async">'
        : '<div class="k-myorder-emoji">📦</div>';
      const itemsSummary = itemsCount > 1
        ? productName + ' + ' + (itemsCount - 1) + ' autre' + (itemsCount > 2 ? 's' : '')
        : productName;

      return '<button class="k-myorder-card" data-ref="' + sanitize(o.reference || '') + '">' +
        '<div class="k-myorder-img">' + imgHtml + '</div>' +
        '<div class="k-myorder-body">' +
          '<div class="k-myorder-ref">' + sanitize(o.reference || '—') + '</div>' +
          '<div class="k-myorder-items">' + sanitize(itemsSummary) + '</div>' +
          '<div class="k-myorder-bottom">' +
            '<span class="k-myorder-status k-myorder-status--' + statusInfo.cls + '">' + statusInfo.emoji + ' ' + statusInfo.label + '</span>' +
            '<span class="k-myorder-total">' + totalStr + '</span>' +
          '</div>' +
          '<div class="k-myorder-date">' + dateStr + '</div>' +
        '</div>' +
        '<span class="k-myorder-arrow">›</span>' +
      '</button>';
    }).join('');

    el.innerHTML = header +
      '<div class="k-myorders-list">' + cards + '</div>' +
      '<button class="k-track-btn k-track-btn--ghost k-myorders-new-search" id="k-myorders-search-other">🔍 Chercher une autre commande</button>';

    // Clic sur une carte → ouvrir le détail
    el.querySelectorAll('.k-myorder-card').forEach(function(card) {
      card.addEventListener('click', async function() {
        const ref = card.dataset.ref;
        if (!ref) return;
        card.classList.add('k-myorder-loading');
        try {
          const data = await apiGet('/api/orders/' + encodeURIComponent(ref));
          const order = (data && data.order) || data;
          // On affiche le détail dans le même conteneur
          el.innerHTML = '';
          const backBtn = document.createElement('button');
          backBtn.className = 'k-track-btn k-track-btn--ghost';
          backBtn.innerHTML = '← Retour à mes commandes';
          backBtn.classList.add('k-track-back-btn');
          backBtn.addEventListener('click', function() { renderTrackView(); });
          el.appendChild(backBtn);
          const box = document.createElement('div');
          el.appendChild(box);
          renderOrderDetail(order, box);
        } catch (e) {
          showToast('Impossible de charger cette commande.', 'error');
          card.classList.remove('k-myorder-loading');
        }
      });
    });

    // Bouton "chercher une autre" → mode recherche classique
    const searchBtn = el.querySelector('#k-myorders-search-other');
    if (searchBtn) {
      searchBtn.addEventListener('click', function() {
        renderTrackViewSearchMode(el);
      });
    }
  }

  /* ── Helpers pour affichage liste commandes ── */
  /**
 * Retourne libellé + emoji de statut commande.
 * @param {string} status
 * @returns {{label: string, emoji: string}}
 */
export function getStatusDisplay(status, paymentStatus) {
    // Map status → {emoji, label, cls}
    const map = {
      pending:     { emoji: '⏳', label: 'En attente',      cls: 'pending' },
      confirmed:   { emoji: '✅', label: 'Confirmée',       cls: 'confirmed' },
      paid:        { emoji: '💰', label: 'Payée',           cls: 'confirmed' },
      ordered:     { emoji: '🛒', label: 'En préparation',  cls: 'processing' },
      preparation: { emoji: '📦', label: 'En préparation',  cls: 'processing' },
      shipped:     { emoji: '🚢', label: 'Expédiée',        cls: 'shipped' },
      in_transit:  { emoji: '🚚', label: 'En transit',      cls: 'shipped' },
      available:   { emoji: '🏪', label: 'Au relais',       cls: 'available' },
      collected:   { emoji: '✅', label: 'Retirée',         cls: 'delivered' },
      delivered:   { emoji: '✅', label: 'Livrée',          cls: 'delivered' },
      cancelled:   { emoji: '❌', label: 'Annulée',         cls: 'cancelled' },
    };
    return map[status] || { emoji: '📦', label: status || 'Inconnu', cls: 'pending' };
  }

  /**
   * Formate une date ISO en affichage localisé lisible.
   * @param {string} isoDate - Date au format ISO 8601
   * @returns {string} Date formatée (ex: "lun. 27 avr. 2026")
   */
export function formatOrderDate(isoDate) {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return 'Hier';
      if (diffDays < 7) return 'Il y a ' + diffDays + ' jours';
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch(e) { return ''; }
  }

  /* ── Mode recherche classique (renommé de l'ancien renderTrackView) ── */
  /**
 * Rend le mode recherche rapide suivi (sans auth).
 */
export function renderTrackViewSearchMode(el) {
    const otpState = { phone: '', mode: 'quick' };

    el.innerHTML = `
      <h2>📦 Suivi de commande</h2>

      <!-- Mode 1 : Tracking rapide (4 derniers chiffres) -->
      <div id="k-track-quick">
        <p class="k-otp-hint">Entrez les 4 derniers chiffres de votre commande</p>
        <div class="k-track-form">
          <div class="k-track-ref-wrap">
            <span class="k-track-ref-prefix">KMR-2025-</span>
            <input class="k-track-input k-track-input--ref" id="k-track-digits" type="text" inputmode="numeric" placeholder="0042" maxlength="4" autocomplete="off">
          </div>
          <button class="k-track-btn" id="k-track-quick-btn">🔍 Suivre</button>
        </div>
        <div class="k-otp-divider"><span>ou</span></div>
        <button class="k-track-btn k-track-btn--ghost" id="k-track-history-toggle">📋 Voir tout mon historique</button>
      </div>

      <!-- Mode 2 : Historique complet (OTP WhatsApp) -->
      <div id="k-track-otp" class="u-hidden">
        <p class="k-otp-hint">Entrez votre numéro pour recevoir un code WhatsApp et voir toutes vos commandes.</p>
        <div class="k-track-form">
          <div class="k-track-phone-wrap">
            <select id="k-otp-country" class="k-track-country">
              <option value="+269">🇰🇲 +269</option>
              <option value="+33">🇫🇷 +33</option>
              <option value="+262">🇷🇪 +262</option>
              <option value="+32">🇧🇪 +32</option>
              <option value="+41">🇨🇭 +41</option>
              <option value="+44">🇬🇧 +44</option>
              <option value="+1">🇺🇸 +1</option>
              <option value="+971">🇦🇪 +971</option>
              <option value="+212">🇲🇦 +212</option>
            </select>
            <input class="k-track-input k-track-input--phone" id="k-otp-phone" type="tel" placeholder="321 12 34" autocomplete="tel" inputmode="tel">
          </div>
          <button class="k-track-btn" id="k-otp-request-btn">📲 Envoyer le code</button>
        </div>
        <button class="k-track-btn k-track-btn--ghost k-track-btn--mt" id="k-track-back-quick">← Suivi rapide</button>
      </div>

      <!-- OTP Step 2 : saisie code -->
      <div id="k-otp-step2" class="u-hidden">
        <div class="k-otp-sent-banner">
          📲 Code WhatsApp envoyé au <strong id="k-otp-phone-display"></strong><br>
          <small>Vérifiez vos messages WhatsApp. Code valable 10 min.</small>
        </div>
        <input class="k-otp-code-input" id="k-otp-code" type="text" inputmode="numeric" placeholder="_ _ _ _ _ _" maxlength="6" autocomplete="one-time-code">
        <button class="k-track-btn" id="k-otp-verify-btn">Vérifier</button>
        <button class="k-otp-resend-btn" id="k-otp-resend-btn">Renvoyer le code</button>
      </div>

      <!-- Résultats -->
      <div id="k-otp-step3" class="u-hidden">
        <div id="k-orders-list"></div>
        <button class="k-otp-resend-btn k-otp-back-btn" id="k-otp-back-btn">← Nouvelle recherche</button>
      </div>`;

    /* ── Tracking rapide : lookup par référence ── */
    const digitsInput = el.querySelector('#k-track-digits');

    // Auto-submit on 4 digits
    digitsInput.addEventListener('input', () => {
      digitsInput.value = digitsInput.value.replace(/\D/g, '').slice(0, 4);
      if (digitsInput.value.length === 4) {
        el.querySelector('#k-track-quick-btn').click();
      }
    });

    el.querySelector('#k-track-quick-btn').addEventListener('click', async () => {
      const digits = digitsInput.value.replace(/\D/g, '');
      if (digits.length !== 4) { showToast('Entrez 4 chiffres.', 'error'); return; }
      const ref = 'KMR-2025-' + digits.padStart(4, '0');
      const btn = el.querySelector('#k-track-quick-btn');
      btn.disabled = true; btn.textContent = '⏳ Recherche…';
      try {
        const data = await apiGet('/api/orders/' + encodeURIComponent(ref));
        el.querySelector('#k-track-quick').classList.add('u-hidden');
        el.querySelector('#k-otp-step3').classList.remove('u-hidden');
        renderOrderDetail(data.order || data, el.querySelector('#k-orders-list'));
      } catch(e) {
        showToast('Commande introuvable. Vérifiez les 4 chiffres.', 'error');
        btn.disabled = false; btn.textContent = '🔍 Suivre';
      }
    });

    /* ── Toggle entre tracking rapide et historique OTP ── */
    el.querySelector('#k-track-history-toggle').addEventListener('click', () => {
      el.querySelector('#k-track-quick').classList.add('u-hidden');
      el.querySelector('#k-track-otp').classList.remove('u-hidden');
    });

    el.querySelector('#k-track-back-quick').addEventListener('click', () => {
      el.querySelector('#k-track-otp').classList.add('u-hidden');
      el.querySelector('#k-track-quick').classList.remove('u-hidden');
    });

    /* ── OTP : request code ── */
    function getFullPhone() {
      const countryCode = el.querySelector('#k-otp-country').value;
      let digits = (el.querySelector('#k-otp-phone').value || '').replace(/\D/g, '');
      if (['+33','+262','+32','+41','+44','+971','+212'].includes(countryCode) && digits.startsWith('0')) {
        digits = digits.slice(1);
      }
      return countryCode + digits;
    }

    el.querySelector('#k-otp-request-btn').addEventListener('click', async () => {
      const phone = getFullPhone();
      const digits = phone.replace(/^\+\d+/, '');
      if (!digits || digits.length < 6) { showToast('Entrez un numéro de téléphone valide.', 'error'); return; }
      const btn = el.querySelector('#k-otp-request-btn');
      btn.disabled = true; btn.textContent = '⏳ Envoi…';
      try {
        await apiPost('/api/auth/otp/request', { phone });
        otpState.phone = phone;
        el.querySelector('#k-otp-phone-display').textContent = phone;
        el.querySelector('#k-track-otp').classList.add('u-hidden');
        el.querySelector('#k-otp-step2').classList.remove('u-hidden');
        showToast('📲 Code WhatsApp envoyé !', 'success');
      } catch(e) {
        const msg = e?.message || 'Erreur lors de l\'envoi.';
        showToast(msg, 'error');
        btn.disabled = false; btn.textContent = '📲 Envoyer le code';
      }
    });

    /* ── OTP : verify code ── */
    el.querySelector('#k-otp-verify-btn').addEventListener('click', async () => {
      const code = el.querySelector('#k-otp-code').value.replace(/\s/g, '');
      if (code.length < 4) { showToast('Entrez le code complet.', 'error'); return; }
      const btn = el.querySelector('#k-otp-verify-btn');
      btn.disabled = true; btn.textContent = '⏳ Vérification…';
      try {
        const verifyResult = await apiPost('/api/auth/otp/verify', { phone: otpState.phone, code });
        showToast('✅ Vérifié — chargement de vos commandes…', 'success');
        try {
          const trackingData = await apiGet('/api/client/tracking');
          el.querySelector('#k-otp-step2').classList.add('u-hidden');
          el.querySelector('#k-otp-step3').classList.remove('u-hidden');
          const orders = (trackingData.orders || []).map(o => ({
            ...o,
            total_amount: o.totalKmf || o.total_kmf || o.total_amount || 0,
            created_at: o.createdAt || o.created_at
          }));
          renderOrdersHistory(orders, el.querySelector('#k-orders-list'));
        } catch(trackErr) {
          el.querySelector('#k-otp-step2').classList.add('u-hidden');
          el.querySelector('#k-otp-step3').classList.remove('u-hidden');
          el.querySelector('#k-orders-list').innerHTML = `
            <div class="k-search-empty">
              <p>✅ Numéro vérifié ! Bienvenue <strong>${verifyResult.user?.name || ''}</strong></p>
              <p class="k-confirm-notice-item">Aucune commande trouvée pour ce numéro.</p>
            </div>`;
        }
      } catch(e) {
        const msg = e?.message || 'Code incorrect ou expiré.';
        showToast(msg, 'error');
        btn.disabled = false; btn.textContent = 'Vérifier';
      }
    });

    /* ── OTP : resend ── */
    let resendTimer = null;
    el.querySelector('#k-otp-resend-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#k-otp-resend-btn');
      if (resendTimer) return;
      btn.disabled = true; btn.textContent = '⏳ Renvoi…';
      try {
        await apiPost('/api/auth/otp/request', { phone: otpState.phone });
        showToast('📲 Nouveau code WhatsApp envoyé !', 'success');
        let countdown = 30;
        resendTimer = setInterval(() => {
          countdown--;
          btn.textContent = `Renvoyer (${countdown}s)`;
          if (countdown <= 0) { clearInterval(resendTimer); resendTimer = null; btn.disabled = false; btn.textContent = 'Renvoyer le code'; }
        }, 1000);
      } catch(e) {
        showToast('Erreur lors du renvoi.', 'error');
        btn.disabled = false; btn.textContent = 'Renvoyer le code';
      }
    });

    /* ── Back button ── */
    el.querySelector('#k-otp-back-btn').addEventListener('click', () => renderTrackView());
  }

  /* ── VUE SWITCHER ───────────────────────────────────────── */
  /**
 * Bascule entre les onglets de l'app.
 * @param {string} view - boutique|cart|favs|track
 */
export function switchView(tab) {
    const catalog = document.getElementById('k-catalog-section');
    const favView = document.getElementById('k-fav-view');
    const trackView = document.getElementById('k-track-view');
    const heroWrap = document.getElementById('k-hero-fixed-wrap');
    const pageScroll = document.getElementById('k-page-scroll');
    // Show catalog by default
    if (catalog) catalog.classList.toggle('u-hidden', tab !== 'shop');
    if (favView) favView.classList.toggle('show', tab === 'fav');
    if (trackView) trackView.classList.toggle('show', tab === 'track');
    // Also hide promo section when not on shop
    const promoSec = document.getElementById('k-promos-section');
    if (promoSec) promoSec.classList.toggle('u-hidden', tab !== 'shop');
    // Hide hero+categories on non-shop tabs
    if (heroWrap) heroWrap.classList.toggle('u-hidden', tab !== 'shop');
    // Adjust scroll container: on shop = below hero, on other tabs = below header only
    if (pageScroll) {
      pageScroll.dataset.tab = tab;
      // FIX : sur vues non-shop, effacer le top inline mis par _updateMobileScrollTop
      // pour que la règle CSS #k-page-scroll[data-tab="track"]{top:44px} prenne effet
      if (tab !== 'shop') {
        pageScroll.style.top = '';
      } else {
        // Retour sur shop : re-calculer le top selon la hauteur du hero
        if (typeof _updateMobileScrollTop === 'function') _updateMobileScrollTop();
      }
    }
    // Close cart drawer if open
    const cartOverlay = document.getElementById('k-cart-overlay');
    const cartDrawer = document.getElementById('k-cart-drawer');
    if (cartOverlay) cartOverlay.classList.remove('open');
    if (cartDrawer) cartDrawer.classList.remove('open');
    document.body.classList.remove('cart-open');
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── BOTTOM NAV ─────────────────────────────────────────── */
  /**
 * Initialise la bottom nav fixe (onglets + badges).
 */
export function setupBnav() {
    $$('.k-bnav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        $$('.k-bnav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        if (tab === 'cart') { openCart(); return; }
        if (tab === 'fav') { renderFavView(); switchView('fav'); return; }
        if (tab === 'track') { renderTrackView(); switchView('track'); return; }
        switchView('shop');
      });
    });
  }

  /* ── SEE ALL PROMOS ─────────────────────────────────────── */
  /**
 * Configure les boutons "Voir tout" par catégorie.
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
        (function(){ var s=document.getElementById('k-page-scroll'); var g=document.querySelector('.k-grid'); if(s&&g){ s.scrollTo({top:g.offsetTop-8,behavior:'smooth'}); } else if(g){ g.scrollIntoView({behavior:'smooth'}); } })();
      });
    }
  }

  /* ── LOAD RELAIS ────────────────────────────────────────── */
  /**
 * Charge la liste des points relais depuis l'API.
 * @returns {Promise<void>}
 */
export async function loadRelais() {
    try {
      const data = await apiGet('/api/relais/public');
      state.relais = data.relais || data || [];
    } catch (e) { state.relais = []; }
  }

  /* ── INIT ───────────────────────────────────────────────── */
  // Note: setupStickyBar est géré par le script inline dans le HTML
  // pour éviter le double IntersectionObserver (scintillement).


  // ╔══════════════════════════════════════════════════════════════════╗
