/**
 * @module b-mini-cart
 * @brief Floating mini-cart Komerce — pastille draggable → pill expansible.
 *
 * Architecture :
 *   - Vanilla JS/CSS, aucune dépendance externe.
 *   - Lecture état panier → state.cart, cartQty(), cartTotal() (b-cart-core.js)
 *   - Ouverture tiroir → dom.cartBtn.click() (câblé par setupDrawer dans b-nav.js)
 *   - Hook sync → bus.on('cart:update') émis par updateCartBadge (ARCH-1)
 *   - Desktop (≥900px) : no-op total (side-cart actif)
 *   - Mobile : pastille draggable, snap sur bord gauche/droit, position persistée
 */

import { state }              from './b-store.js';
import { cartQty, cartTotal } from './b-cart-core.js';
import { optimizeImgUrl }     from './b-utils.js';

// ── Constantes ───────────────────────────────────────────────────────
const MAX_THUMBS      = 3;
const AUTO_COLLAPSE   = 2500;   // ms avant recompactage auto après ajout
const IMG_SIZE        = 80;     // px Cloudinary
const DRAG_THRESHOLD  = 6;      // px de mouvement avant de déclencher le drag
const SNAP_MARGIN     = 14;     // px depuis le bord après snap
const STORAGE_KEY     = 'kmrc_minicart_pos';

// ── State interne ────────────────────────────────────────────────────
let _el          = null;   // racine .kmc
let _expanded    = false;
let _autoTimer   = null;
let _outsideRef  = null;

// ── État drag ────────────────────────────────────────────────────────
let _drag = {
  active:   false,
  startX:   0,
  startY:   0,
  origLeft: 0,
  origTop:  0,
  movedPx:  0,
};

// ── Helpers ──────────────────────────────────────────────────────────

function _isDesktop() {
  return window.innerWidth >= 900;
}

function _clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function _savePos(left, top) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top })); } catch (_) {}
}

function _loadPos() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
}

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

// ── Positionnement ────────────────────────────────────────────────────

function _bnavHeight() {
  return parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--bnav-h') || '56', 10);
}

/**
 * Position initiale : restaure la position sauvegardée, sinon défaut bas-droite.
 * Utilise left/top (pas right/bottom) pour que le drag fonctionne correctement.
 */
function _applyInitialPosition() {
  const saved = _loadPos();
  const vw    = window.innerWidth;
  const vh    = window.innerHeight;

  _el.style.right  = '';
  _el.style.bottom = '';

  if (saved) {
    _el.style.left = _clamp(saved.left, 0, vw - 80) + 'px';
    _el.style.top  = _clamp(saved.top,  80, vh - 80) + 'px';
  } else {
    // Défaut : bas-droite, au-dessus de la bnav
    _el.style.left = (vw - 70 - SNAP_MARGIN) + 'px';
    _el.style.top  = (vh - _bnavHeight() - 70 - 10) + 'px';
  }
}

/**
 * Snappe sur le bord gauche ou droit selon la position courante.
 * Garantit les bornes verticales (au-dessus de la bnav).
 */
function _snapToEdge() {
  if (!_el) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pw = _el.offsetWidth  || 60;
  const ph = _el.offsetHeight || 60;

  let left = parseFloat(_el.style.left) || 0;
  let top  = parseFloat(_el.style.top)  || 0;

  left = (left + pw / 2 < vw / 2)
    ? SNAP_MARGIN
    : vw - pw - SNAP_MARGIN;

  top = _clamp(top, 80, vh - _bnavHeight() - ph - 10);

  _el.style.transition = 'left .25s cubic-bezier(.22,1,.36,1), top .25s cubic-bezier(.22,1,.36,1)';
  _el.style.left = left + 'px';
  _el.style.top  = top  + 'px';

  setTimeout(() => { if (_el) _el.style.transition = ''; }, 260);
  _savePos(left, top);
}

// ── Drag (touch + mouse) ──────────────────────────────────────────────

function _onDragStart(e) {
  // Ne pas démarrer le drag depuis le bouton CTA (ouverture tiroir)
  if (e.target.closest('.kmc__cta')) return;

  const pt = e.touches ? e.touches[0] : e;

  _drag.startX   = pt.clientX;
  _drag.startY   = pt.clientY;
  _drag.origLeft = parseFloat(_el.style.left) || _el.getBoundingClientRect().left;
  _drag.origTop  = parseFloat(_el.style.top)  || _el.getBoundingClientRect().top;
  _drag.movedPx  = 0;
  _drag.active   = false;

  _el.style.transition = '';

  document.addEventListener('mousemove', _onDragMove, { passive: false });
  document.addEventListener('mouseup',   _onDragEnd);
  document.addEventListener('touchmove', _onDragMove, { passive: false });
  document.addEventListener('touchend',  _onDragEnd);
}

function _onDragMove(e) {
  const pt = e.touches ? e.touches[0] : e;
  const dx = pt.clientX - _drag.startX;
  const dy = pt.clientY - _drag.startY;
  _drag.movedPx = Math.sqrt(dx * dx + dy * dy);

  if (_drag.movedPx > DRAG_THRESHOLD) {
    _drag.active = true;
    e.preventDefault();

    // Fermer le panel si ouvert pendant le drag
    if (_expanded) _collapse();

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = _el.offsetWidth  || 60;
    const ph = _el.offsetHeight || 60;

    _el.style.left = _clamp(_drag.origLeft + dx, 0, vw - pw) + 'px';
    _el.style.top  = _clamp(_drag.origTop  + dy, 80, vh - _bnavHeight() - ph - 10) + 'px';
  }
}

function _onDragEnd() {
  document.removeEventListener('mousemove', _onDragMove);
  document.removeEventListener('mouseup',   _onDragEnd);
  document.removeEventListener('touchmove', _onDragMove);
  document.removeEventListener('touchend',  _onDragEnd);

  if (_drag.active) {
    _drag.active = false;
    _snapToEdge();
  } else {
    // Pas de drag → tap/click → toggle le panel
    _toggle();
  }
}

// ── DOM builder ───────────────────────────────────────────────────────

function _buildDOM() {
  const el = document.createElement('div');
  el.className = 'kmc is-collapsed';
  el.setAttribute('data-empty', 'true');
  el.setAttribute('aria-label', 'Mini-panier');

  el.innerHTML = `
    <!-- Pastille collapsed -->
    <button class="kmc__bubble" aria-label="Ouvrir le récapitulatif panier" type="button">
      <span class="kmc__bubble-icon" aria-hidden="true">🛒</span>
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

  const items = _getCartSnapshot();
  const qty   = cartQty();
  const total = cartTotal();
  const empty = qty === 0;

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
  // Ne pas ouvrir si le panier est vide
  if (!_expanded && cartQty() === 0) return;
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
  void _el.offsetWidth; // force reflow
  _el.classList.add('is-bump');
  setTimeout(() => _el.classList.remove('is-bump'), 500);
}

// ── Hook public : appelé par updateCartBadge() (b-cart-core.js) ───────

function _onCartUpdate() {
  if (_isDesktop()) return;

  const prevQty = parseInt(_el?.querySelector('.kmc__badge')?.textContent || '0', 10);
  const newQty  = cartQty();

  _render();

  if (newQty > prevQty) {
    // Ajout → expand + bump + auto-collapse
    _bump();
    _expand();
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(_collapse, AUTO_COLLAPSE);
  } else if (newQty === 0 && _expanded) {
    // Panier vidé → forcer collapse
    _collapse();
  }
}

// ── Ouverture tiroir panier existant ─────────────────────────────────

function _openCartDrawer() {
  _collapse();
  const btn = document.getElementById('k-cart-btn');
  if (btn) btn.click();
}

// ── Initialisation ────────────────────────────────────────────────────

export function setupMiniCart() {
  if (_isDesktop()) return;

  _el = _buildDOM();
  _applyInitialPosition();
  _render();

  // Drag sur tout le conteneur
  _el.addEventListener('mousedown',  _onDragStart);
  _el.addEventListener('touchstart', _onDragStart, { passive: true });

  // CTA → tiroir panier (stopPropagation pour ne pas déclencher le drag)
  _el.querySelector('.kmc__cta')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _openCartDrawer();
  });

  // ARCH-1 : remplace le tableau window.__kmrcCartPillSyncHandlers par bus.on.
  bus.on('cart:update', _onCartUpdate);

  // Sync au resize
  window.addEventListener('resize', () => {
    if (_isDesktop()) {
      _collapse();
      if (_el) _el.style.display = 'none';
    } else {
      if (_el) _el.style.display = '';
      _snapToEdge();
      _render();
    }
  }, { passive: true });
}
