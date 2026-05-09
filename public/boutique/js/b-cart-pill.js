/**
 * @module b-cart-pill
 * @brief Pill flottante & déplaçable affichant le résumé du panier (catalogue uniquement).
 *
 * Comportement :
 *  - Apparaît dès qu'un article est dans le panier, disparaît si vide.
 *  - Draggable (touch + mouse) — se snappe sur le bord gauche ou droit à la fin du drag.
 *  - Au clic (sans drag) → ouvre un mini-popover avec la liste des articles + total.
 *  - Se met à jour automatiquement via window.__kmrcCartPillSync() appelé par updateCartBadge.
 *
 * Intégration :
 *   import './b-cart-pill.js';  // dans main.js, après boutique.js
 */

import { bus }                         from './b-bus.js';
import { state }                       from './b-store.js';
import { cartQty, cartTotal }          from './b-cart-core.js';
import { fmt }                         from './b-utils.js';

// ─── Constantes ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'kmrc_pill_pos';
const SNAP_MARGIN = 14;          // px depuis le bord après snap
const DRAG_THRESHOLD = 6;        // px avant de considérer un vrai drag

// ─── DOM ───────────────────────────────────────────────────────────────────
let pill = null;
let popover = null;
let _pillInited = false;

// ─── État drag ─────────────────────────────────────────────────────────────
let _dragging  = false;
let _startX    = 0;
let _startY    = 0;
let _origLeft  = 0;
let _origTop   = 0;
let _movedPx   = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────
function _clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function _savePos(left, top) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top })); } catch(_) {}
}

function _loadPos() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch(_) { return null; }
}

function _snapToEdge() {
  if (!pill) return;
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  const pw   = pill.offsetWidth;
  const ph   = pill.offsetHeight;
  let left   = parseFloat(pill.style.left) || 0;
  let top    = parseFloat(pill.style.top)  || 0;

  // Snap horizontal : coller au bord le plus proche
  left = (left + pw / 2 < vw / 2)
    ? SNAP_MARGIN
    : vw - pw - SNAP_MARGIN;

  // Bornes verticales
  top = _clamp(top, 80, vh - ph - 16);

  pill.style.left       = left + 'px';
  pill.style.top        = top  + 'px';
  pill.style.transition = 'left .25s var(--ease,ease), top .25s var(--ease,ease)';
  setTimeout(() => { if (pill) pill.style.transition = ''; }, 260);

  _savePos(left, top);
}

// ─── Popover ───────────────────────────────────────────────────────────────
function _buildPopover() {
  const items = state.cart;
  if (!items.length) { _closePopover(); return; }

  const total = cartTotal();
  const qty   = cartQty();

  const rows = items.map(({ product: p, qty: q }) => {
    const price = (p.price_kmf || 0) * q;
    const name  = p.name || p.title || 'Produit';
    const img   = (Array.isArray(p.images) ? p.images[0] : p.image) || '';
    return `
      <div class="kpill-pop-row">
        ${img ? `<img class="kpill-pop-img" src="${img}" alt="" loading="lazy">` : '<div class="kpill-pop-img kpill-pop-img--empty">📦</div>'}
        <div class="kpill-pop-info">
          <span class="kpill-pop-name">${name.length > 28 ? name.slice(0,27) + '…' : name}</span>
          <span class="kpill-pop-meta">×${q} · ${fmt(price, 'KMF')}</span>
        </div>
      </div>`;
  }).join('');

  popover.innerHTML = `
    <div class="kpill-pop-header">
      <span class="kpill-pop-title">🛒 Mon panier <span class="kpill-pop-qty">${qty}</span></span>
      <button class="kpill-pop-close" aria-label="Fermer">✕</button>
    </div>
    <div class="kpill-pop-list">${rows}</div>
    <div class="kpill-pop-footer">
      <span class="kpill-pop-label">Total</span>
      <span class="kpill-pop-total">${fmt(total, 'KMF')}</span>
    </div>`;

  popover.querySelector('.kpill-pop-close').onclick = _closePopover;
  _positionPopover();
  popover.classList.add('kpill-pop--open');
}

function _closePopover() {
  if (popover) popover.classList.remove('kpill-pop--open');
}

function _positionPopover() {
  if (!pill || !popover) return;
  const pr  = pill.getBoundingClientRect();
  const vw  = window.innerWidth;
  const pw  = popover.offsetWidth || 260;

  // Placer à gauche ou droite selon la position de la pill
  let left = pr.right + 10;
  if (left + pw > vw - 8) left = pr.left - pw - 10;
  if (left < 8) left = 8;

  const top = _clamp(pr.top, 80, window.innerHeight - 320);

  popover.style.left = left + 'px';
  popover.style.top  = top  + 'px';
}

// ─── Pill render ───────────────────────────────────────────────────────────
function _renderPill() {
  if (!pill) return;
  const qty   = cartQty();
  const total = cartTotal();
  const hasItems = qty > 0;

  pill.classList.toggle('kpill--visible', hasItems);
  if (!hasItems) { _closePopover(); return; }

  pill.innerHTML = `
    <span class="kpill-icon">🛒</span>
    <span class="kpill-badge">${qty}</span>
    <span class="kpill-total">${fmt(total, 'KMF')}</span>`;
}

// ─── Drag (mouse + touch) ──────────────────────────────────────────────────
function _onDragStart(e) {
  const pt = e.touches ? e.touches[0] : e;
  _startX  = pt.clientX;
  _startY  = pt.clientY;
  _origLeft= parseFloat(pill.style.left)  || pill.getBoundingClientRect().left;
  _origTop = parseFloat(pill.style.top)   || pill.getBoundingClientRect().top;
  _movedPx = 0;
  _dragging= false;
  pill.style.transition = '';

  // FIX clic mobile : on n'attache PAS les listeners souris quand l'événement
  // d'origine est un touch. Sinon le mouseup synthétique généré après touchend
  // re-déclenche _onDragEnd → toggle le popover qu'on vient d'ouvrir.
  if (e.type === 'touchstart') {
    document.addEventListener('touchmove', _onDragMove, { passive: false });
    document.addEventListener('touchend',  _onDragEnd);
    document.addEventListener('touchcancel', _onDragEnd);
  } else {
    document.addEventListener('mousemove', _onDragMove, { passive: false });
    document.addEventListener('mouseup',   _onDragEnd);
  }
}

function _onDragMove(e) {
  const pt = e.touches ? e.touches[0] : e;
  const dx = pt.clientX - _startX;
  const dy = pt.clientY - _startY;
  _movedPx = Math.sqrt(dx * dx + dy * dy);

  if (_movedPx > DRAG_THRESHOLD) {
    _dragging = true;
    e.preventDefault();
    _closePopover();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = pill.offsetWidth;
    const ph = pill.offsetHeight;
    pill.style.left = _clamp(_origLeft + dx, 0, vw - pw) + 'px';
    pill.style.top  = _clamp(_origTop  + dy, 80, vh - ph - 16) + 'px';
  }
}

function _onDragEnd(e) {
  document.removeEventListener('mousemove', _onDragMove);
  document.removeEventListener('mouseup',   _onDragEnd);
  document.removeEventListener('touchmove', _onDragMove);
  document.removeEventListener('touchend',  _onDragEnd);
  document.removeEventListener('touchcancel', _onDragEnd);

  if (_dragging) {
    _dragging = false;
    _snapToEdge();
  } else {
    // Tap (sans drag) → empêcher la synthèse de mouse/click sur mobile,
    // sinon le listener "fermer au clic ailleurs" referme aussitôt.
    if (e && e.type === 'touchend' && e.cancelable) {
      try { e.preventDefault(); } catch(_) {}
    }
    if (popover.classList.contains('kpill-pop--open')) {
      _closePopover();
    } else {
      _buildPopover();
    }
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────
function _init() {
  if (_pillInited) return;

  // Injecter CSS
  if (!document.getElementById('kpill-css')) {
    const style = document.createElement('style');
    style.id = 'kpill-css';
    style.textContent = `
/* ── Cart Pill ─────────────────────────────── */
.kpill {
  position: fixed;
  z-index: 1500;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: linear-gradient(135deg, var(--ocean-dark, #4A9040), #2e6b28);
  color: #fff;
  border-radius: 50px;
  box-shadow: 0 4px 18px rgba(42,122,62,.35), 0 1px 4px rgba(0,0,0,.15);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: grab;
  user-select: none;
  touch-action: none;
  opacity: 0;
  pointer-events: none;
  transform: scale(.75);
  transition: opacity .2s ease, transform .25s var(--ease, ease);
  will-change: transform;
}
.kpill--visible {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}
.kpill:active { cursor: grabbing; }

.kpill-icon { font-size: 16px; line-height: 1; }

.kpill-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #fff;
  color: var(--ocean-dark, #4A9040);
  border-radius: 50px;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kpill-total {
  font-size: 12px;
  font-weight: 700;
  opacity: .95;
  white-space: nowrap;
}

/* ── Popover ───────────────────────────────── */
.kpill-pop {
  position: fixed;
  z-index: 1501;
  width: 270px;
  background: var(--white, #fff);
  border: 1px solid var(--border, #E3D9C9);
  border-radius: var(--radius, 12px);
  box-shadow: var(--shadow-lg, 0 8px 30px rgba(31,48,36,.12));
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform: scale(.94) translateY(6px);
  transition: opacity .18s ease, transform .18s var(--ease, ease);
}
.kpill-pop--open {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1) translateY(0);
}

.kpill-pop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px 9px;
  background: var(--ocean-dark, #4A9040);
  color: #fff;
}
.kpill-pop-title {
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.kpill-pop-qty {
  background: rgba(255,255,255,.25);
  border-radius: 50px;
  padding: 1px 7px;
  font-size: 11px;
}
.kpill-pop-close {
  background: rgba(255,255,255,.2);
  border: none;
  color: #fff;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 11px;
  flex-shrink: 0;
}
.kpill-pop-close:hover { background: rgba(255,255,255,.35); }

.kpill-pop-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 6px 0;
}

.kpill-pop-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  transition: background .12s;
}
.kpill-pop-row:hover { background: #f7f4ee; }

.kpill-pop-img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: var(--radius-sm, 8px);
  flex-shrink: 0;
  border: 1px solid var(--border, #E3D9C9);
}
.kpill-pop-img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: #f5f0e8;
}

.kpill-pop-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.kpill-pop-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text, #1F3024);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpill-pop-meta {
  font-size: 11px;
  color: var(--text-muted, #6B7B63);
}

.kpill-pop-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid var(--border, #E3D9C9);
  background: #faf6ed;
}
.kpill-pop-label {
  font-size: 12px;
  color: var(--text-muted, #6B7B63);
  font-weight: 600;
}
.kpill-pop-total {
  font-size: 14px;
  font-weight: 800;
  color: var(--ocean-dark, #4A9040);
}
`;
    document.head.appendChild(style);
  }

  // Créer la pill
  pill = document.createElement('div');
  pill.className = 'kpill';
  pill.setAttribute('aria-label', 'Mon panier');
  pill.setAttribute('role', 'button');

  // Créer le popover
  popover = document.createElement('div');
  popover.className = 'kpill-pop';

  document.body.appendChild(pill);
  document.body.appendChild(popover);

  // Position initiale : droite, milieu — uniquement en pixels, jamais de valeur CSS relative
  const saved = _loadPos();
  if (saved) {
    pill.style.left = _clamp(saved.left, 0, window.innerWidth  - 120) + 'px';
    pill.style.top  = _clamp(saved.top,  80, window.innerHeight - 80)  + 'px';
  } else {
    // Calcul pixel direct — pas de '50vh' qui casse parseFloat au premier drag
    pill.style.left = (window.innerWidth - 140 - SNAP_MARGIN) + 'px';
    pill.style.top  = Math.round(window.innerHeight / 2) + 'px';
    // Pas de pill.style.right : un seul axe à la fois pour éviter le conflit CSS
  }

  // Drag
  pill.addEventListener('mousedown',  _onDragStart);
  pill.addEventListener('touchstart', _onDragStart, { passive: true });

  // Fermer popover au clic ailleurs
  document.addEventListener('click', function(e) {
    if (popover && !popover.contains(e.target) && !pill.contains(e.target)) {
      _closePopover();
    }
  });

  // Sync position popover au resize
  window.addEventListener('resize', function() {
    _snapToEdge();
    if (popover.classList.contains('kpill-pop--open')) _positionPopover();
  }, { passive: true });

  _renderPill();
  _pillInited = true;
}

// ─── Hook global ───────────────────────────────────────────────────────────
// Appelé par updateCartBadge() via window.__kmrcCartPillSync
window.__kmrcCartPillSync = function() {
  if (window.innerWidth >= 900) return;  // pill mobile uniquement
  if (!_pillInited) _init();
  _renderPill();
  // Mettre à jour le popover si ouvert
  if (popover && popover.classList.contains('kpill-pop--open')) {
    _buildPopover();
  }
};

// ─── Démarrage ─────────────────────────────────────────────────────────────
// Uniquement sur le catalogue (index.html / page principale) ET mobile
function _isCataloguePage() {
  // La page catalogue contient #k-grid
  return !!document.getElementById('k-grid') || !!document.getElementById('k-catalog-section');
}

function _shouldInit() {
  return _isCataloguePage() && window.innerWidth < 900;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    if (_shouldInit()) _init();
  });
} else {
  if (_shouldInit()) _init();
}

// Écouter les events bus pour se mettre à jour
bus.on('cart:update', function() {
  if (window.innerWidth >= 900) return;
  if (!_pillInited && _isCataloguePage()) _init();
  _renderPill();
});
