/**
 * @komerce-arch
 * @role          mini-cart-summary
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        cart_state, cart_update_events
 * @outputs       compact_cart_summary, quick_cart_feedback
 * @depends       b-cart-core.js, b-store.js, b-utils.js
 * @used-by       boutique.js, cart-surfaces
 * @doctrine      side_cart_non_intrusif, panier_visible_sans_friction
 * @impact-areas  cart, side-cart, checkout-entry, responsive-layout
 * @version       2026-06
 */
'use strict';

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
import { bus }                from './b-bus.js';

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
      <span class="kmc__logo" aria-label="Komerce"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 220" role="img" aria-label="Komerce">
  <!-- Komerce — logo horizontal. Signe: K-réseau + branche du mini-centre vers le grand O. -->
  <g stroke="var(--cta-green, #2a7a3e)" stroke-width="15" stroke-linecap="round" fill="none">
    <path d="M72 65.5V96M72 124v30.5"/>
    <path d="M82.6 100.8 131.8 58.1M82.6 119.2l49.2 42.8M85.7 113 189.6 136.1"/>
  </g>
  <g fill="none" stroke="var(--cta-green, #2a7a3e)" stroke-width="13">
    <circle cx="72" cy="44" r="15"/><circle cx="72" cy="176" r="15"/>
    <circle cx="148" cy="44" r="15"/><circle cx="148" cy="176" r="15"/>
  </g>
  <circle cx="72" cy="110" r="10" fill="var(--coral, #C85C2D)"/>
  <circle cx="234" cy="146" r="38" fill="none" stroke="var(--cta-green, #2a7a3e)" stroke-width="15"/>
  <circle cx="234" cy="146" r="14" fill="var(--coral, #C85C2D)"/>
  <path fill="var(--ocean, #64AF5A)" d="M296.05 184.0V123.94H311.45V138.57L309.8 136.15Q311.12 129.22 316.18 125.92Q321.24 122.62 328.28 122.62Q335.76 122.62 341.425 126.415Q347.09000000000003 130.21 348.52 136.59L343.79 137.03Q346.76 129.66 352.26 126.14Q357.76 122.62 365.13 122.62Q371.62 122.62 376.625 125.48Q381.63 128.34 384.49 133.45499999999998Q387.35 138.57 387.35 145.39V184.0H370.85V148.91Q370.85 145.39 369.58500000000004 142.85999999999999Q368.32 140.32999999999998 366.01 138.89999999999998Q363.7 137.47 360.4 137.47Q357.21 137.47 354.845 138.89999999999998Q352.48 140.32999999999998 351.21500000000003 142.85999999999999Q349.95 145.39 349.95 148.91V184.0H333.45V148.91Q333.45 145.39 332.185 142.85999999999999Q330.92 140.32999999999998 328.61 138.89999999999998Q326.3 137.47 323.0 137.47Q319.81 137.47 317.445 138.89999999999998Q315.08 140.32999999999998 313.815 142.85999999999999Q312.55 145.39 312.55 148.91V184.0Z M423.17 185.32Q413.6 185.32 406.56 181.08499999999998Q399.52 176.85 395.66999999999996 169.7Q391.82 162.55 391.82 153.86Q391.82 144.84 395.83500000000004 137.8Q399.85 130.76 406.67 126.69Q413.49 122.62 422.07 122.62Q429.22 122.62 434.72 124.875Q440.22 127.13 444.015 131.2Q447.81 135.27 449.78999999999996 140.60500000000002Q451.77 145.94 451.77 152.21Q451.77 153.97 451.605 155.675Q451.44 157.38 451.0 158.59H406.01V146.49H441.65L433.84 152.21Q434.94 147.48 433.73 143.79500000000002Q432.52 140.11 429.495 137.965Q426.47 135.82 422.07 135.82Q417.78 135.82 414.7 137.91Q411.62 140.0 410.08000000000004 144.07Q408.54 148.14 408.87 153.97Q408.43 159.03 410.08000000000004 162.88Q411.73 166.73 415.14 168.875Q418.55 171.02 423.39 171.02Q427.79 171.02 430.925 169.26Q434.06 167.5 435.82 164.42L449.02 170.69Q447.26 175.09 443.46500000000003 178.39Q439.67 181.69 434.5 183.505Q429.33 185.32 423.17 185.32Z M457.45 184.0V123.94H472.84999999999997V138.35L471.75 136.26Q473.72999999999996 128.67000000000002 478.29499999999996 125.97500000000001Q482.85999999999996 123.28 489.13 123.28H492.65V137.57999999999998H487.47999999999996Q481.42999999999995 137.57999999999998 477.68999999999994 141.265Q473.95 144.95 473.95 151.66V184.0Z M525.39 185.32Q516.37 185.32 509.16499999999996 181.195Q501.96 177.07 497.72499999999997 169.92000000000002Q493.48999999999995 162.77 493.48999999999995 153.86Q493.48999999999995 144.95 497.66999999999996 137.855Q501.84999999999997 130.76 509.11 126.69Q516.37 122.62 525.39 122.62Q532.0999999999999 122.62 537.8199999999999 124.93Q543.54 127.24000000000001 547.6099999999999 131.365Q551.68 135.49 553.4399999999999 141.1L539.14 147.26Q537.5999999999999 142.75 533.915 140.11Q530.2299999999999 137.47 525.39 137.47Q521.0999999999999 137.47 517.7449999999999 139.56Q514.39 141.65 512.4649999999999 145.39Q510.53999999999996 149.13 510.53999999999996 153.97Q510.53999999999996 158.81 512.4649999999999 162.55Q514.39 166.29 517.7449999999999 168.38Q521.0999999999999 170.47 525.39 170.47Q530.3399999999999 170.47 533.9699999999999 167.82999999999998Q537.5999999999999 165.19 539.14 160.68L553.4399999999999 166.95Q551.79 172.23 547.72 176.41Q543.65 180.59 537.93 182.95499999999998Q532.2099999999999 185.32 525.39 185.32Z M588.05 185.32Q578.4799999999999 185.32 571.4399999999999 181.08499999999998Q564.4 176.85 560.55 169.7Q556.6999999999999 162.55 556.6999999999999 153.86Q556.6999999999999 144.84 560.7149999999999 137.8Q564.7299999999999 130.76 571.55 126.69Q578.3699999999999 122.62 586.9499999999999 122.62Q594.0999999999999 122.62 599.5999999999999 124.875Q605.0999999999999 127.13 608.895 131.2Q612.6899999999999 135.27 614.67 140.60500000000002Q616.65 145.94 616.65 152.21Q616.65 153.97 616.4849999999999 155.675Q616.3199999999999 157.38 615.8799999999999 158.59H570.89V146.49H606.53L598.7199999999999 152.21Q599.8199999999999 147.48 598.6099999999999 143.79500000000002Q597.4 140.11 594.375 137.965Q591.3499999999999 135.82 586.9499999999999 135.82Q582.66 135.82 579.5799999999999 137.91Q576.4999999999999 140.0 574.9599999999999 144.07Q573.42 148.14 573.7499999999999 153.97Q573.31 159.03 574.9599999999999 162.88Q576.6099999999999 166.73 580.02 168.875Q583.43 171.02 588.27 171.02Q592.67 171.02 595.805 169.26Q598.9399999999999 167.5 600.6999999999999 164.42L613.9 170.69Q612.14 175.09 608.345 178.39Q604.55 181.69 599.3799999999999 183.505Q594.2099999999999 185.32 588.05 185.32Z"/>
</svg></span>
      <div class="kmc__thumbs" aria-hidden="true"></div>
      <div class="kmc__summary">
        <span class="kmc__total">0 KMF</span>
        <span class="kmc__count">0 article</span>
      </div>
      <button class="kmc__cta" aria-label="Voir le panier" type="button">
        <img class="kmc__cta-img" src="/images/panier_tresse.png" alt="" aria-hidden="true">
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
