/**
 * @komerce-arch
 * @role          favorites-view
 * @domain        catalog
 * @layer         ui-page
 * @criticality   medium
 * @inputs        favorites_state, product_store
 * @outputs       favorites_grid, favorite_actions
 * @depends       b-store.js, b-cart-core.js, b-catalog.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      favoris_locaux_simples, boutique_canal_decouverte
 * @impact-areas  favorites, product-discovery, cart-entry, navigation
 * @version       2026-06
 */
'use strict';

/**
 * @module b-favs
 * @brief Favoris — renderFavView, updateFavPromoBadge, shareWishlistWhatsApp
 *
 * Extrait de b-views.js — refacto v2
 */

import { state } from './b-store.js';
import { fmt, bindCarouselDots, apiPost } from './b-utils.js';
import { showToast } from './b-cart-core.js';
import { bus } from './b-bus.js';
import { renderProductCard } from './render/render-product-card.js';

'use strict';

/**
 * Rend la vue Favoris complète (grille + bannière promo + partage).
 */
export function renderFavView() {
  let el = document.getElementById('k-fav-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-fav-view';
    el.className = 'k-fav-view';
    document.getElementById('k-catalog-section').after(el);
  }

  const favProducts = state.products.filter(p => state.favs.includes(p.id));
  const promoFavs   = favProducts.filter(p => (p.promo_pct || 0) > 0);
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
    return;
  }

  // Réutilise le renderer canonique : même DOM, même synthèse multi-lignes,
  // même fail-closed variantes et aucun template Favoris divergent.
  const cardsHTML = favProducts.map((product) => renderProductCard(product)).join('');

  const promoBanner = promoFavs.length > 0
    ? `<div class="k-fav-promo-banner">
         <span class="k-fav-promo-icon">🎉</span>
         <div class="k-fav-promo-text">
           <strong>${promoFavs.length} de vos favori${promoFavs.length > 1 ? 's sont' : ' est'} en promo !</strong>
           <span>Profitez des réductions avant qu'elles disparaissent</span>
         </div>
       </div>`
    : '';

  const shareBtn = `<button class="k-fav-share-btn" id="k-fav-share-btn">
    <span class="k-fav-share-icon">📲</span>
    <span>Envoyer ma liste de souhaits</span>
  </button>`;

  el.innerHTML = `<h2>❤️ Favoris <span class="k-fav-count">${favProducts.length} produit${favProducts.length > 1 ? 's' : ''}</span></h2>
    ${promoBanner}${shareBtn}
    <div class="k-grid" id="k-fav-grid">${cardsHTML}</div>`;

  // Active le style WA vert sur .k-fav-share-btn uniquement si des favoris sont en promo.
  // Sans cette classe → style ghost (neutre, défini dans interactions.css ~L38).
  el.classList.toggle('k-fav-promo-active', promoFavs.length > 0);

  const favGrid = document.getElementById('k-fav-grid');
  if (favGrid) {
    // Les clics favori/ajout/ouverture sont possédés par la délégation unique
    // de b-catalog.js, qui couvre explicitement #k-fav-grid.
    favGrid.querySelectorAll('.k-card').forEach((card) => bindCarouselDots(card));
  }

  const shareWishlistBtn = document.getElementById('k-fav-share-btn');
  if (shareWishlistBtn) {
    shareWishlistBtn.addEventListener('click', shareWishlistWhatsApp);
  }
}

let _favRefreshTimer = null;
bus.on('favorites:view-refresh', function() {
  clearTimeout(_favRefreshTimer);
  _favRefreshTimer = setTimeout(renderFavView, 0);
});

/**
 * Met à jour le badge 🎉 sur l'onglet Favoris de la bnav.
 * @param {number} promoCount
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

/**
 * Partage la liste de souhaits via WhatsApp.
 */
export async function shareWishlistWhatsApp() {
  const favProducts = state.products.filter(p => state.favs.includes(p.id));
  if (!favProducts.length) { showToast('Aucun favori à partager.', 'error'); return; }

  showToast('⏳ Génération du lien…', 'info');

  let shareURL;
  try {
    const items = favProducts.map(p => ({ product_id: p.id, qty: 1 }));
    const res = await apiPost('/api/shares', { items });
    shareURL = (res && res.share_url) || (window.location.origin + '/Komerce_Boutique.html');
  } catch (e) {
    shareURL = window.location.origin + '/Komerce_Boutique.html';
  }

  const lines = ['💝 *Ma liste de souhaits Komerce*', '━━━━━━━━━━━━━━━━', ''];
  favProducts.slice(0, 10).forEach((p, idx) => {
    let line = (idx + 1) + '. ' + (p.name || 'Produit') + ' — ' + fmt(p.price_kmf || 0, 'KMF');
    if (p.promo_pct > 0) line += ' 🎉 (-' + p.promo_pct + '%)';
    lines.push(line);
  });
  if (favProducts.length > 10) {
    lines.push('');
    lines.push('... et ' + (favProducts.length - 10) + ' autre' + (favProducts.length > 11 ? 's' : ''));
  }
  lines.push('', '━━━━━━━━━━━━━━━━', 'Tu peux m\'offrir l\'un d\'eux ? 🥰', '👉 Voir la liste :', shareURL);

  window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
}
