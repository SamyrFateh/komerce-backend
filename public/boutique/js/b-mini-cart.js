/**
 * @module b-mini-cart
 * @brief Floating mini-cart Komerce — pastille → pill expansible.
 *
 * Architecture :
 *   - Vanilla JS/CSS, aucune dépendance externe.
 *   - Lecture état panier → state.cart, cartQty(), cartTotal() (b-cart-core.js)
 *   - Ouverture tiroir → dom.cartBtn.click() (câblé par setupDrawer dans b-nav.js)
 *   - Hook sync → window.__kmrcCartPillSync (prévu dans updateCartBadge, b-cart-core.js)
 *   - Desktop (≥900px) : no-op total (side-cart actif)
 *   - Mobile : pastille fixe au-dessus de la bnav
 *
 * AUCUN module existant modifié sauf index.html (lien CSS + script).
 */

import { state }              from './b-store.js';
import { cartQty, cartTotal } from './b-cart-core.js';
import { optimizeImgUrl }     from './b-utils.js';

// ── Constantes ───────────────────────────────────────────────────────
const MAX_THUMBS     = 3;
const AUTO_COLLAPSE  = 2500;   // ms avant recompactage auto après ajout
const IMG_SIZE       = 80;     // px Cloudinary

// ── State interne ────────────────────────────────────────────────────
let _el          = null;   // racine .kmc
let _expanded    = false;
let _autoTimer   = null;
let _outsideRef  = null;   // référence listener outside-click

// ── Helpers ──────────────────────────────────────────────────────────

function _isDesktop() {
  return window.innerWidth >= 900;
}

/**
 * Construit un snapshot propre du panier depuis state.cart.
 * Isole le mini-cart de tout changement interne de structure.
 */
function _getCartSnapshot() {
  return state.cart.map(item => ({
    id:    item.id ?? item.product?.id,
    name:  item.name ?? item.product?.name ?? '',
    image: item.image ?? item.product?.image_url ?? item.product?.image ?? '',
    price: item.price ?? item.product?.price_kmf ?? 0,
    qty:   item.qty ?? 1,
  }));
}

function _fmt(kmf) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(kmf)) + ' KMF';
}

// ── DOM builders ─────────────────────────────────────────────────────

function _buildDOM() {
  const el = document.createElement('div');
  el.className = 'kmc is-collapsed';
  el.setAttribute('data-empty', 'true');
  el.setAttribute('aria-label', 'Mini-panier');

  el.innerHTML = `
    <!-- Pastille collapsed -->
    <button class="kmc__bubble" aria-label="Ouvrir le récapitulatif panier" type="button">
      <img class="kmc__bubble-img" src="/images/panier_tresse_vert.png" alt="" aria-hidden="true">
      <span class="kmc__badge" aria-live="polite">0</span>
    </button>

    <!-- Pill expanded -->
    <div class="kmc__panel" role="region" aria-label="Résumé panier" aria-hidden="true">
      <span class="kmc__logo">Komerce</span>
      <div class="kmc__thumbs" aria-hidden="true"></div>
      <div class="kmc__summary">
        <span class="kmc__total">0 KMF</span>
        <span class="kmc__count">0 article</span>
      </div>
      <button class="kmc__cta" aria-label="Voir le panier" type="button">
        <img class="kmc__cta-img" src="/images/panier_tresse_vert.png" alt="" aria-hidden="true">
        <span class="kmc__cta-badge" aria-hidden="true"></span>
      </button>
    </div>
  `;

  document.body.appendChild(el);
  return el;
}

// ── Rendu ─────────────────────────────────────────────────────────────

function _render() {
  if (!_el || _isDesktop()) return;

  const items  = _getCartSnapshot();
  const qty    = cartQty();
  const total  = cartTotal();
  const empty  = qty === 0;

  // data-empty pour CSS (masque le badge)
  _el.setAttribute('data-empty', String(empty));

  // Badge pastille
  const badge = _el.querySelector('.kmc__badge');
  if (badge) {
    badge.textContent = qty > 0 ? String(qty) : '';
    badge.setAttribute('data-count', String(qty));
  }

  // Thumbs
  const thumbsEl = _el.querySelector('.kmc__thumbs');
  if (thumbsEl) {
    const shown = items.slice(0, MAX_THUMBS);
    const extra = items.length - MAX_THUMBS;
    thumbsEl.innerHTML = shown.map(item => {
      const src = item.image ? optimizeImgUrl(item.image, IMG_SIZE) : '';
      return src
        ? `<div class="kmc__thumb"><img src="${src}" alt="" loading="lazy"></div>`
        : `<div class="kmc__thumb kmc__thumb--placeholder"></div>`;
    }).join('') + (extra > 0
      ? `<div class="kmc__thumb kmc__thumb--more">+${extra}</div>`
      : '');
  }

  // Total + count
  const totalEl = _el.querySelector('.kmc__total');
  const countEl = _el.querySelector('.kmc__count');
  if (totalEl) totalEl.textContent = _fmt(total);
  if (countEl) countEl.textContent = qty === 1 ? '1 article' : `${qty} articles`;

  // Badge CTA
  const ctaBadge = _el.querySelector('.kmc__cta-badge');
  if (ctaBadge) ctaBadge.textContent = qty > 0 ? String(qty) : '';
}

// ── Expansion / collapse ──────────────────────────────────────────────

function _expand() {
  if (_expanded || _isDesktop()) return;
  _expanded = true;
  _el.classList.remove('is-collapsed');
  _el.classList.add('is-expanded');
  _el.querySelector('.kmc__panel')?.removeAttribute('aria-hidden');
  _bindOutsideClick();
}

function _collapse() {
  if (!_expanded) return;
  _expanded = false;
  _el.classList.remove('is-expanded');
  _el.classList.add('is-collapsed');
  _el.querySelector('.kmc__panel')?.setAttribute('aria-hidden', 'true');
  _unbindOutsideClick();
  clearTimeout(_autoTimer);
}

function _toggle() {
  _expanded ? _collapse() : _expand();
}

// ── Outside click ─────────────────────────────────────────────────────

function _bindOutsideClick() {
  if (_outsideRef) return;
  _outsideRef = (e) => {
    if (!_el.contains(e.target)) _collapse();
  };
  // Délai court pour éviter que le click d'ouverture ne déclenche immédiatement
  setTimeout(() => document.addEventListener('click', _outsideRef, { passive: true }), 80);
}

function _unbindOutsideClick() {
  if (!_outsideRef) return;
  document.removeEventListener('click', _outsideRef);
  _outsideRef = null;
}

// ── Bump (ajout produit) ──────────────────────────────────────────────

function _bump() {
  if (!_el || _isDesktop()) return;
  _el.classList.remove('is-bump');
  // Force reflow pour relancer l'animation
  void _el.offsetWidth;
  _el.classList.add('is-bump');
  setTimeout(() => _el.classList.remove('is-bump'), 500);
}

// ── Hook public : appelé par updateCartBadge() (b-cart-core.js) ───────

function _onCartUpdate() {
  if (_isDesktop()) return;

  const prevQty = parseInt(_el?.querySelector('.kmc__badge')?.textContent || '0', 10);
  const newQty  = cartQty();

  _render();

  // Ajout détecté → expand + bump + auto-collapse
  if (newQty > prevQty) {
    _bump();
    _expand();
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(_collapse, AUTO_COLLAPSE);
  }
}

// ── Ouverture tiroir panier existant ─────────────────────────────────

function _openCartDrawer() {
  _collapse();
  // Délégue au bouton panier du header (câblé par setupDrawer dans b-nav.js)
  const btn = document.getElementById('k-cart-btn');
  if (btn) btn.click();
}

// ── Initialisation ────────────────────────────────────────────────────

export function setupMiniCart() {
  if (_isDesktop()) return;

  _el = _buildDOM();
  _render();
  _el.style.pointerEvents = 'auto';

  // Pastille : toggle expand/collapse
  _el.querySelector('.kmc__bubble')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _toggle();
  });

  // Bouton CTA pill : ouvre le tiroir panier
  _el.querySelector('.kmc__cta')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _openCartDrawer();
  });

  // Branchement sur le hook prévu dans updateCartBadge()
  window.__kmrcCartPillSync = _onCartUpdate;

  // Sync au resize (mobile → desktop)
  window.addEventListener('resize', () => {
    if (_isDesktop()) {
      _collapse();
      if (_el) _el.style.display = 'none';
    } else {
      if (_el) _el.style.display = '';
      _render();
    }
  }, { passive: true });
}
