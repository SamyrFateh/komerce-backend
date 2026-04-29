/**
 * b-pager.js — Module ES · §15 PAGER TEMU
 *
 * Architecture : JS pur translateX — aucune dépendance au CSS scroll-snap.
 * Fonctionne même avec overflow:clip sur html/body.
 *
 * - Scroll horizontal entre catégories : swipe JS + translateX
 * - Scroll vertical dans chaque section : natif (chaque section est overflow-y:scroll)
 * - Chip sync : se met à jour au fur et à mesure du glissement
 * - Auto-advance : bas de section → catégorie suivante
 * - Ghost loop : dernière → clone Tout → téléportation silencieuse
 */

import { bus }    from './b-bus.js';
import { scroll } from './b-store.js';

'use strict';

// ── State interne du pager ──
var _state = {
  currentIdx: 0,       // index de la section visible
  sections:   [],      // NodeList des sections
  isAnimating: false,  // animation en cours
  touchStartX: 0,
  touchStartY: 0,
  touchStartTime: 0,
  trackX: 0,           // translateX courant (px)
  isDragging: false,
};

// ── Wrapper de translation ──
function _setX(grid, x, animate) {
  grid.style.transition = animate ? 'transform .32s cubic-bezier(.22,1,.36,1)' : 'none';
  grid.style.transform  = 'translateX(' + x + 'px)';
  _state.trackX = x;
}

// ── Aller à un index ──
function _goToIdx(grid, idx, animate) {
  var n = _state.sections.length;
  if (idx < 0 || idx >= n) return;
  if (_state.isAnimating && animate) return;
  _state.isAnimating = !!animate;
  _state.currentIdx  = idx;
  var targetX = -idx * window.innerWidth;
  _setX(grid, targetX, animate);
  if (animate) {
    setTimeout(function() { _state.isAnimating = false; }, 350);
  }
  _syncChip(idx);
  _updateDots();
  // Reset scroll vertical de la section cible
  var sec = _state.sections[idx];
  if (sec && sec.scrollTop > 0) sec.scrollTop = 0;
}

// ── Chip sync ──
function _syncChip(idx) {
  var sec = _state.sections[idx];
  if (!sec) return;
  var cat = sec.getAttribute('data-ghost') ? 'all' : (sec.dataset.cat || 'all');
  var prevActive = document.querySelector('.k-chip.active');
  var prevCat = prevActive ? prevActive.dataset.cat : null;
  document.querySelectorAll('.k-chip').forEach(function(c) {
    c.classList.toggle('active', c.dataset.cat === cat);
    c.classList.remove('transitioning');
  });
  var activeChip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
  if (activeChip && prevCat !== cat) {
    activeChip.classList.add('transitioning');
    setTimeout(function() { activeChip.classList.remove('transitioning'); }, 450);
  }
  if (activeChip) bus.emit('chip:center', activeChip);
}

// ── Dots de navigation ──
function _updateDots() {
  var idx = _state.currentIdx;
  document.querySelectorAll('.k-pager-dots').forEach(function(dotsEl) {
    dotsEl.querySelectorAll('.k-pager-dot').forEach(function(d, i) {
      d.classList.toggle('active', i === idx);
    });
  });
}

function _setupPagerDots(grid) {
  grid.querySelectorAll('.k-pager-dots').forEach(function(d) { d.remove(); });
  var sections = _state.sections;
  var n = sections.length;
  if (n < 2) return;
  sections.forEach(function(sec, idx) {
    var dots = document.createElement('div');
    dots.className = 'k-pager-dots';
    for (var i = 0; i < n; i++) {
      var dot = document.createElement('div');
      dot.className = 'k-pager-dot' + (i === idx ? ' active' : '');
      dots.appendChild(dot);
    }
    sec.appendChild(dots);
  });
}

// ── Hint "catégorie suivante" ──
function _showNextHint(idx) {
  var sections = _state.sections;
  var nextSec  = sections[(idx + 1) % sections.length];
  if (!nextSec) return;
  var cat = nextSec.getAttribute('data-ghost') ? 'Tout' : (nextSec.dataset.cat || '');
  if (!cat) return;
  var curSec = sections[idx];
  var existing = curSec.querySelector('.k-pager-next-hint');
  if (existing) existing.remove();
  var hint = document.createElement('div');
  hint.className = 'k-pager-next-hint';
  hint.textContent = cat;
  curSec.appendChild(hint);
  setTimeout(function() { if (hint.parentNode) hint.remove(); }, 900);
}

// ── Auto-advance bas → suivante ──
function _setupSectionAutoAdvance() {
  _state.sections.forEach(function(sec, idx) {
    if (sec.getAttribute('data-ghost')) return;
    // Cleanup
    if (sec._advH) sec.removeEventListener('scroll', sec._advH);

    var _lastST = 0, _wasDown = false, _timer = null;

    function _atBottom() {
      if (sec.scrollHeight <= sec.clientHeight + 8) return true;
      return sec.scrollTop + sec.clientHeight >= sec.scrollHeight - 32;
    }

    sec._advH = function() {
      var st = sec.scrollTop;
      if (st > _lastST + 2)      _wasDown = true;
      else if (st < _lastST - 8) _wasDown = false;
      _lastST = st;
      if (_wasDown && _atBottom()) {
        clearTimeout(_timer);
        _timer = setTimeout(function() {
          if (!_wasDown || !_atBottom()) return;
          _showNextHint(idx);
          var grid = document.getElementById('k-grid');
          var nextIdx = idx + 1;
          if (nextIdx >= _state.sections.length) nextIdx = 0;
          // Ghost → téléportation
          if (_state.sections[nextIdx] && _state.sections[nextIdx].getAttribute('data-ghost')) {
            _goToIdx(grid, nextIdx, true);
            setTimeout(function() { _ghostTeleport(grid); }, 400);
          } else {
            _goToIdx(grid, nextIdx, true);
          }
        }, 320);
      }
    };
    sec.addEventListener('scroll', sec._advH, { passive: true });
  });
}

// ── Ghost loop : téléportation silencieuse ──
function _setupInfiniteLoop() {
  var grid = document.getElementById('k-grid');
  if (!grid || window.innerWidth >= 900) return;
  var existing = grid.querySelector('[data-ghost]');
  if (existing) existing.remove();
  var toutSec = grid.querySelector('.k-cat-section[data-cat="all"]');
  if (!toutSec) return;
  var ghost = toutSec.cloneNode(true);
  ghost.setAttribute('data-ghost', 'true');
  grid.appendChild(ghost);
  // Recalculer sections avec le ghost
  _state.sections = Array.from(grid.querySelectorAll('.k-cat-section'));
}

function _ghostTeleport(grid) {
  // Sauter silencieusement au vrai Tout (index 0) sans animation
  _reshuffleToutInDOM();
  _state.currentIdx = 0;
  _setX(grid, 0, false);
  _syncChip(0);
  _updateDots();
}

function _reshuffleToutInDOM() {
  var toutSec = document.querySelector('#k-grid .k-cat-section[data-cat="all"]:not([data-ghost])');
  if (!toutSec) return;
  var secGrid = toutSec.querySelector('.k-sec-grid');
  if (!secGrid) return;
  var cards = Array.from(secGrid.children);
  for (var i = cards.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
  }
  var frag = document.createDocumentFragment();
  cards.forEach(function(c) { frag.appendChild(c); });
  secGrid.appendChild(frag);
}

// ── Touch handlers ──
function _setupTouchNav(grid) {
  // Cleanup
  if (grid._ptStart) grid.removeEventListener('touchstart', grid._ptStart);
  if (grid._ptMove)  grid.removeEventListener('touchmove',  grid._ptMove);
  if (grid._ptEnd)   grid.removeEventListener('touchend',   grid._ptEnd);

  var startX = 0, startY = 0, startTime = 0;
  var isDragging = false, startTrackX = 0;
  var LOCK_THRESHOLD = 8; // px avant de locker l'axe
  var lockedAxis = null;  // 'x' | 'y' | null

  grid._ptStart = function(e) {
    if (e.touches.length !== 1) return;
    var t = e.target;
    // Ne pas intercepter sur les éléments scrollables verticalement
    if (t.closest('.k-card-carousel, .k-modal, .k-cart-drawer, .k-cats, ' +
                   '.k-subcats-rail, input, textarea, select, button')) return;
    startX      = e.touches[0].clientX;
    startY      = e.touches[0].clientY;
    startTime   = Date.now();
    startTrackX = _state.trackX;
    isDragging  = false;
    lockedAxis  = null;
  };

  grid._ptMove = function(e) {
    if (e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;

    // Locker l'axe
    if (!lockedAxis) {
      if (Math.abs(dx) > LOCK_THRESHOLD || Math.abs(dy) > LOCK_THRESHOLD) {
        lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
    }
    if (lockedAxis !== 'x') return;

    // On est en mode swipe horizontal
    e.preventDefault();
    isDragging = true;

    // Résistance aux bords
    var n = _state.sections.length;
    var maxX = 0;
    var minX = -(n - 1) * window.innerWidth;
    var targetX = startTrackX + dx;
    if (targetX > maxX) targetX = maxX + (targetX - maxX) * 0.25;
    if (targetX < minX) targetX = minX + (targetX - minX) * 0.25;

    _setX(grid, targetX, false);

    // Sync chip en temps réel
    var pct = -targetX / window.innerWidth;
    var idx = Math.round(pct);
    idx = Math.max(0, Math.min(n - 1, idx));
    _syncChip(idx);
    _updateDots();
  };

  grid._ptEnd = function(e) {
    if (!isDragging) { lockedAxis = null; return; }
    isDragging = false;

    var dx       = e.changedTouches[0].clientX - startX;
    var dt       = Date.now() - startTime;
    var velocity = Math.abs(dx) / dt; // px/ms
    var n        = _state.sections.length;

    // Snap : vitesse ou distance
    var currentFloat = -_state.trackX / window.innerWidth;
    var idx = Math.round(currentFloat);

    if (velocity > 0.3 || Math.abs(dx) > window.innerWidth * 0.35) {
      idx = dx < 0
        ? Math.ceil(currentFloat)   // swipe gauche → section suivante
        : Math.floor(currentFloat); // swipe droite → section précédente
    }

    idx = Math.max(0, Math.min(n - 1, idx));
    _state.currentIdx = idx;

    // Ghost check
    if (_state.sections[idx] && _state.sections[idx].getAttribute('data-ghost')) {
      _goToIdx(grid, idx, true);
      setTimeout(function() { _ghostTeleport(grid); }, 380);
    } else {
      _goToIdx(grid, idx, true);
    }
    lockedAxis = null;
  };

  grid.addEventListener('touchstart', grid._ptStart, { passive: true });
  grid.addEventListener('touchmove',  grid._ptMove,  { passive: false }); // false pour preventDefault
  grid.addEventListener('touchend',   grid._ptEnd,   { passive: true });
}

// ── Setup CSS des sections ──
function _applyPagerCSS(grid) {
  var sections = _state.sections;
  var vw   = window.innerWidth;
  var vh   = window.innerHeight;
  var bnav = document.querySelector('.k-bnav');
  var bnavH = bnav ? bnav.offsetHeight : 56;

  // ── Mesurer le top de la zone chips (dernière chose avant la grille) ──
  // On prend getBoundingClientRect du grid AVANT toute modif
  var gridTop = grid.getBoundingClientRect().top;
  // Si gridTop est négatif ou 0 (déjà fixed), utiliser la valeur stockée
  if (gridTop <= 0 && _state._gridTop) gridTop = _state._gridTop;
  if (gridTop > 0) _state._gridTop = gridTop;
  if (!gridTop || gridTop < 50) gridTop = 180; // fallback

  var pagerH = vh - gridTop - bnavH;
  if (pagerH < 300) pagerH = 300;
  document.documentElement.style.setProperty('--pager-h', pagerH + 'px');

  // ── #k-grid : fixed, couvre exactement la zone catalogue ──────
  // Évite tout problème de parent overflow/padding
  grid.style.cssText = [
    'position:fixed',
    'top:' + gridTop + 'px',
    'left:0',
    'width:' + vw + 'px',
    'height:' + pagerH + 'px',
    'overflow:visible',
    'margin:0',
    'padding:0',
    'display:block',
    'grid-template-columns:none',
    'gap:0',
    'z-index:5',
    'background:var(--sand)',
  ].join(';') + ';';

  // ── #k-catalog-section : placeholder pour garder la hauteur dans le flux ──
  var catalogSec = document.getElementById('k-catalog-section');
  if (catalogSec) {
    catalogSec.style.cssText = [
      'height:' + pagerH + 'px',
      'overflow:hidden',
      'padding:0',
      'margin:0',
    ].join(';') + ';';
  }

  // ── Chaque section : absolute côte à côte dans le grid fixed ──
  sections.forEach(function(sec, i) {
    sec.style.cssText = [
      'position:absolute',
      'top:0',
      'left:' + (i * vw) + 'px',
      'width:' + vw + 'px',
      'height:' + pagerH + 'px',
      'overflow-y:scroll',
      'overflow-x:hidden',
      '-webkit-overflow-scrolling:touch',
      'overscroll-behavior-y:auto',
      'overscroll-behavior-x:none',
      'box-sizing:border-box',
      'padding:0 0 ' + (bnavH + 64) + 'px',
      'touch-action:pan-y',
      'margin:0',
    ].join(';') + ';';
  });
}

// ── Point d'entrée principal ──
function _setupMobilePager() {
  var grid = document.getElementById('k-grid');
  if (!grid || window.innerWidth >= 900) return;

  _state.sections    = Array.from(grid.querySelectorAll('.k-cat-section'));
  _state.currentIdx  = 0;
  _state.isAnimating = false;
  _state.trackX      = 0;

  if (!_state.sections.length) return;

  // Appliquer le CSS inline (contourne overflow:clip du reset)
  _applyPagerCSS(grid);

  // Touch navigation
  _setupTouchNav(grid);

  // Dots
  _setupPagerDots(grid);

  // Recalc au resize
  window.removeEventListener('resize', _setupMobilePager);
  window.addEventListener('resize', _setupMobilePager);
}

// ── Navigation externe (depuis chip click) ──
function _scrollPagerToCat(cat) {
  var grid = document.getElementById('k-grid');
  if (!grid) return;
  var idx = _state.sections.findIndex(function(s) {
    return s.dataset.cat === cat && !s.getAttribute('data-ghost');
  });
  if (idx === -1) return;
  _goToIdx(grid, idx, true);
}

function _scrollPagerToGhost() {
  var grid = document.getElementById('k-grid');
  if (!grid) return;
  var idx = _state.sections.findIndex(function(s) { return !!s.getAttribute('data-ghost'); });
  if (idx === -1) return;
  _goToIdx(grid, idx, true);
  setTimeout(function() { _ghostTeleport(grid); }, 400);
}

// Stubs compatibilité (appelés par b-catalog.js)
function _setupHorizontalWrap()    { /* géré par _setupTouchNav */ }
function _syncChipToScroll()       { _syncChip(_state.currentIdx); }
function _onPagerScroll()          { /* non utilisé en mode translateX */ }

export {
  _setupMobilePager,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
  _scrollPagerToCat,
  _scrollPagerToGhost,
  _reshuffleToutInDOM,
  _setupInfiniteLoop,
  _setupPagerDots,
};
