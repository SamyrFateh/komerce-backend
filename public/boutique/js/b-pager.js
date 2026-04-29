/**
 * b-pager.js — Module ES · §15 PAGER TEMU
 * Extrait de boutique.js — Option C Phase 10
 *
 * Navigation circulaire Temu-style + ghost loop
 * Découplement : émet bus('chip:center') au lieu d'importer centerActiveChip
 */

import { bus }           from './b-bus.js';
import {
  state, dom, $, $$, scroll,
}                         from './b-store.js';

'use strict';

  // ── State variables ──
  var _sectionObserver = null;  // IntersectionObserver vertical (désactivé en mode pager)

  // ║  §15 · PAGER TEMU — Navigation circulaire + ghost loop            ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-pager.js

  /**
   * Initialise le pager horizontal Temu-style pour le mobile.
   * Configure le scroll-snap, les observers et la navigation circulaire (ghost loop).
   */
  function _setupMobilePager() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    // ── Calculate pager height: viewport minus header/hero/cats ──
    var hdr = document.querySelector('.k-header');
    var hero = document.getElementById('k-hero');
    var cats = document.querySelector('.k-cats-shell');
    var usedH = (hdr ? hdr.offsetHeight : 0)
              + (hero ? hero.offsetHeight : 0)
              + (cats ? cats.offsetHeight : 0);
    document.documentElement.style.setProperty('--pager-h', (window.innerHeight - usedH) + 'px');
    // Disconnect vertical observer (horizontal scroll handles sync)
    if (_sectionObserver) { _sectionObserver.disconnect(); _sectionObserver = null; }
    // Remove old listeners, add new — rAF for instant + scrollend for final
    grid.removeEventListener('scroll', _onPagerScroll);
    grid.addEventListener('scroll', _onPagerScroll, { passive: true });
    grid.removeEventListener('scrollend', _syncChipToScroll);
    grid.addEventListener('scrollend', _syncChipToScroll, { passive: true });
    // ── Direction lock: handled by CSS touch-action zones ──
    // pan-y on .k-cat-section (products = vertical only)
    // pan-x on .k-sec-header (section header = horizontal swipe zone)
    // No JS direction detection needed — hardware-level separation
    // Recalc on resize/orientation change
    window.removeEventListener('resize', _setupMobilePager);
    window.addEventListener('resize', _setupMobilePager);
    // Setup auto-advance when section reaches bottom
    _setupHorizontalWrap();
  }

  /* ── Auto-advance to next category when vertical scroll ends ──
     When user scrolls down to bottom of a section → smooth snap to next.
     Uses direction tracking (_wasDown) to avoid false triggers.         */
  /* ── Auto-advance circulaire : bas → section suivante (wrap premier↔dernier)
     + retour arrière : haut de première section → dernière                    */
  /**
 * Auto-avance entre sections du pager (scroll bas → suivante).
 * Dernière section → ghost Tout (navigation circulaire).
 */
  function _setupSectionAutoAdvance() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    var sections = Array.from(grid.querySelectorAll('.k-cat-section'));
    var n = sections.length;
    if (!n) return;

    sections.forEach(function(sec, idx) {
      if (sec.getAttribute('data-ghost')) return; // skip ghost
      // Cleanup old listeners
      if (sec._advHandler)      sec.removeEventListener('scroll',     sec._advHandler);
      if (sec._advHandlerEnd)   sec.removeEventListener('scrollend',  sec._advHandlerEnd);
      if (sec._wrapTouchStart)  sec.removeEventListener('touchstart', sec._wrapTouchStart);
      if (sec._wrapTouchEnd)    sec.removeEventListener('touchend',   sec._wrapTouchEnd);

      var _advTimer = null;
      var _lastST   = 0;
      var _wasDown  = false;

      /**
       * Vérifie si la section courante du pager est scrollée jusqu'en bas.
       * @returns {boolean} true si le bas est atteint (marge 8px)
       */
      function _atBottom() {
        if (sec.scrollHeight <= sec.clientHeight + 40) return false; // section trop courte, pas de scroll
        return sec.scrollTop + sec.clientHeight >= sec.scrollHeight - 32;
      }
      /**
       * Vérifie si la section courante du pager est en haut.
       * @returns {boolean} true si scrollTop ≤ 4px
       */
      function _atTop()    { return sec.scrollTop <= 4; }

      /**
       * Navigue vers une section du pager par index, avec scroll optionnel en haut/bas.
       * @param {number}  targetIdx      - Index de la section cible (0-indexed)
       * @param {boolean} [scrollToBottom] - Si true, scrolle en bas de la section après navigation
       */
      function _goTo(targetIdx, scrollToBottom) {
        if (scroll.scrollingToSection) return;
        var targetSec = sections[(targetIdx + n) % n];
        if (!targetSec) return;
        _wasDown = false;
        // Ghost Tout → scroll vers le fantôme en avant (téléportation gérée par scrollend)
        if (targetSec.getAttribute('data-ghost')) {
          _scrollPagerToGhost();
          document.querySelectorAll('.k-chip').forEach(function(c) {
            c.classList.toggle('active', c.dataset.cat === 'all');
          });
          var allChip = document.querySelector('.k-chip[data-cat="all"]');
          if (allChip && typeof centerActiveChip === 'function') bus.emit('chip:center', allChip);
          return;
        }
        var cat = targetSec.dataset.cat;
        if (!cat) return;
        _scrollPagerToCat(cat);
        // Sync chip immédiatement (sans attendre scrollend)
        document.querySelectorAll('.k-chip').forEach(function(c) {
          c.classList.toggle('active', c.dataset.cat === cat);
        });
        var activeChip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
        if (activeChip && typeof centerActiveChip === 'function') bus.emit('chip:center', activeChip);
        setTimeout(function() {
          if (scrollToBottom) {
            targetSec.scrollTop = targetSec.scrollHeight;
          } else {
            if (targetSec.scrollTop > 0) targetSec.scrollTop = 0;
          }
        }, 450);
      }

      // ── Scroll down → advance to next (wrap: last → first) ──
      sec._advHandler = function() {
        var st = sec.scrollTop;
        if (st > _lastST + 2)      _wasDown = true;
        else if (st < _lastST - 8) _wasDown = false;
        _lastST = st;
        if (_wasDown && _atBottom()) {
          clearTimeout(_advTimer);
          _advTimer = setTimeout(function() {
            if (_wasDown && _atBottom()) _goTo(idx + 1, false); // wrap: last→first
          }, 300);
        }
      };
      sec._advHandlerEnd = function() {
        _lastST = sec.scrollTop;
        if (_wasDown && _atBottom()) {
          clearTimeout(_advTimer);
          _goTo(idx + 1, false);
        }
      };
      sec.addEventListener('scroll',    sec._advHandler,    { passive: true });
      sec.addEventListener('scrollend', sec._advHandlerEnd, { passive: true });

      // ── Pull down from top (first section only) → go to last ──
      // (finger moves DOWN on screen = trying to scroll UP past top)
      var _touchY0 = 0;
      sec._wrapTouchStart = function(e) { _touchY0 = e.touches[0].clientY; };
      sec._wrapTouchEnd   = function(e) {
        if (!_atTop()) return;
        var dy = e.changedTouches[0].clientY - _touchY0; // positive = finger down = scroll up intent
        if (dy > 60) _goTo(idx - 1, true); // wrap: first→last (scrolled to bottom of last)
      };
      // Only bind on first section for "go back to last" (and optionally all for prev)
      if (idx === 0) {
        sec.addEventListener('touchstart', sec._wrapTouchStart, { passive: true });
        sec.addEventListener('touchend',   sec._wrapTouchEnd,   { passive: true });
      }
    });
  }

  /* ── Horizontal wrap : swipe gauche sur dernière → première,
                          swipe droite sur première → dernière  ──            */
  /**
 * Wrap horizontal circulaire : dernière catégorie → ghost Tout.
 */
  function _setupHorizontalWrap() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    // Remove old listeners
    if (grid._hwTouchStart) grid.removeEventListener('touchstart', grid._hwTouchStart);
    if (grid._hwTouchEnd)   grid.removeEventListener('touchend',   grid._hwTouchEnd);

    var _tx0 = 0, _ty0 = 0;

    grid._hwTouchStart = function(e) {
      _tx0 = e.touches[0].clientX;
      _ty0 = e.touches[0].clientY;
    };
    grid._hwTouchEnd = function(e) {
      var dx = e.changedTouches[0].clientX - _tx0;
      var dy = e.changedTouches[0].clientY - _ty0;
      // Horizontal seulement (angle < 45°)
      if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
      var sections = Array.from(grid.querySelectorAll('.k-cat-section'));
      var n = sections.length;
      if (!n) return;
      // Détection par scrollLeft absolu — résiste au snap bounce
      var maxScroll = grid.scrollWidth - grid.clientWidth;
      var atLeft  = grid.scrollLeft < grid.clientWidth * 0.4;
      var atRight = maxScroll > 0 && grid.scrollLeft > maxScroll - grid.clientWidth * 0.4;
      // wraps gérés par ghost Tout (infinite loop)
    };
    grid.addEventListener('touchstart', grid._hwTouchStart, { passive: true });
    grid.addEventListener('touchend',   grid._hwTouchEnd,   { passive: true });
  }

  // ── Sync pill ↔ scroll : rAF instant (zéro retard) ──
  var _pagerRaf = null;
  /**
   * Synchronise la chip active dans la barre catégories selon la position de scroll du pager.
   * Utilise offsetLeft pour une détection précise (pas une division par width).
   */
  function _syncChipToScroll() {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var sections = grid.querySelectorAll('.k-cat-section');
    var scrollCenter = grid.scrollLeft + grid.clientWidth / 2;
    var bestIdx = 0, bestDist = Infinity;
    for (var i = 0; i < sections.length; i++) {
      var secCenter = sections[i].offsetLeft + sections[i].offsetWidth / 2;
      var dist = Math.abs(scrollCenter - secCenter);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (sections[bestIdx]) {
      var cat = sections[bestIdx].dataset.cat;
      document.querySelectorAll('.k-chip').forEach(function(c) {
        c.classList.toggle('active', c.dataset.cat === cat);
      });
      var activeChip = document.querySelector('.k-chip.active');
      if (activeChip && typeof centerActiveChip === 'function') bus.emit('chip:center', activeChip);
    }
  }

  /**
   * Handler debounced sur le scroll horizontal du pager.
   * Déclenche _syncChipToScroll + auto-avance vers section suivante si bas atteint.
   */
  function _onPagerScroll() {
    if (scroll.scrollingToSection) return;
    if (_pagerRaf) return;
    _pagerRaf = requestAnimationFrame(function() {
      _pagerRaf = null;
      _syncChipToScroll();
    });
  }

  /**
   * Fait défiler le pager horizontal jusqu'à la section de la catégorie donnée.
   * Met à jour la chip active et déclenche le chargement des produits si nécessaire.
   * @param {string} cat - Slug catégorie (ex: "mode", "tech", "all")
   */
  function _scrollPagerToCat(cat) {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var section = grid.querySelector('.k-cat-section[data-cat="' + cat + '"]');
    if (!section) return;
    scroll.scrollingToSection = true;
    grid.scrollTo({ left: section.offsetLeft, behavior: 'smooth' });
    // Use scrollend to clear flag (precise) + timeout fallback (safe)
    grid.addEventListener('scrollend', function _clr() {
      scroll.scrollingToSection = false;
      grid.removeEventListener('scrollend', _clr);
    }, { once: true });
    setTimeout(function() { scroll.scrollingToSection = false; }, 600);
  }

  /* ── Scroll vers la section fantôme (ghost Tout en fin de pager) ── */
  /**
 * Défile le pager vers le ghost Tout (clone en avant).
 */
  function _scrollPagerToGhost() {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    var ghost = grid.querySelector('.k-cat-section[data-ghost]');
    if (!ghost) return;
    scroll.scrollingToSection = true;
    grid.scrollTo({ left: ghost.offsetLeft, behavior: 'smooth' });
    grid.addEventListener('scrollend', function _clr() {
      scroll.scrollingToSection = false;
      grid.removeEventListener('scrollend', _clr);
    }, { once: true });
    setTimeout(function() { scroll.scrollingToSection = false; }, 700);
  }

  /* ── Reshuffle Tout : mélange les cartes DOM à chaque téléportation ── */
  /**
 * Reshuffle Fisher-Yates les produits Tout dans le DOM.
 * Appelé à chaque téléportation → dopamine loop.
 */
  function _reshuffleToutInDOM() {
    var toutSec = document.querySelector('#k-grid .k-cat-section[data-cat="all"]:not([data-ghost])');
    if (!toutSec) return;
    var secGrid = toutSec.querySelector('.k-sec-grid');
    if (!secGrid) return;
    var cards = Array.from(secGrid.children);
    for (var _ri = cards.length - 1; _ri > 0; _ri--) {
      var _rj = Math.floor(Math.random() * (_ri + 1));
      var _rt = cards[_ri]; cards[_ri] = cards[_rj]; cards[_rj] = _rt;
    }
    var _rf = document.createDocumentFragment();
    cards.forEach(function(c) { _rf.appendChild(c); });
    secGrid.appendChild(_rf);
  }

  /* ── Infinite loop : ghost Tout en fin → téléportation silencieuse ──
     Principe : on clone la section Tout et on l'ajoute à la fin du pager.
     L'utilisateur arrive sur le ghost en scrollant en avant, puis scrollend
     détecte la position et remet scrollLeft=0 (vrai Tout) sans animation.  */
  /**
 * Initialise la navigation circulaire infinie Temu.
 */
  function _setupInfiniteLoop() {
    var grid = document.getElementById('k-grid');
    if (!grid || window.innerWidth >= 900) return;
    // Supprimer l'ancien ghost si présent
    var existing = grid.querySelector('[data-ghost]');
    if (existing) existing.remove();
    // Cloner la section Tout
    var toutSec = grid.querySelector('.k-cat-section[data-cat="all"]');
    if (!toutSec) return;
    var ghost = toutSec.cloneNode(true);
    ghost.setAttribute('data-ghost', 'true');
    grid.appendChild(ghost);
    // Téléportation silencieuse quand l'utilisateur atterrit sur le ghost
    /**
     * Détecte l'arrivée sur le ghost "Tout" en fin de pager.
     * Déclenche la téléportation silencieuse vers la vraie section "Tout" + reshuffle.
     */
    function _ghostCheck() {
      var ghostEl = grid.querySelector('[data-ghost]');
      if (!ghostEl) return;
      if (Math.abs(grid.scrollLeft - ghostEl.offsetLeft) < grid.clientWidth * 0.45) {
        // Désactiver snap + smooth, sauter au vrai Tout, réactiver
        grid.style.scrollBehavior = 'auto';
        grid.style.scrollSnapType = 'none';
        _reshuffleToutInDOM();
        grid.scrollLeft = 0;
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            grid.style.scrollBehavior = '';
            grid.style.scrollSnapType = '';
            _syncChipToScroll();
          });
        });
      }
    }
    // Nettoyage listeners précédents
    if (grid._ghostCheck) {
      grid.removeEventListener('scrollend', grid._ghostCheck);
      clearTimeout(grid._ghostTimer);
    }
    grid._ghostCheck = _ghostCheck;
    grid.addEventListener('scrollend', _ghostCheck, { passive: true });
    // Fallback pour navigateurs sans scrollend natif
    grid.addEventListener('scroll', function() {
      clearTimeout(grid._ghostTimer);
      grid._ghostTimer = setTimeout(_ghostCheck, 200);
    }, { passive: true });
  }

  // ══════════════════════════════════════════════════════════
  // DEBUG BUTTON (temporaire) — affiche infos flat subcat à l'écran
  // Tape sur le bouton 🐛 en bas-droite pour voir le diagnostic


export {
  _setupMobilePager,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
  _scrollPagerToCat,
  _scrollPagerToGhost,
  _reshuffleToutInDOM,
  _setupInfiniteLoop
};
