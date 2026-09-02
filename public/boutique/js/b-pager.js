/**
 * @komerce-arch
 * @role          mobile-category-pager
 * @domain        catalog
 * @layer         ui-state
 * @criticality   high
 * @inputs        category_sections, scroll_state, viewport, modal_events
 * @outputs       horizontal_pager_state, active_chip_sync, section_auto_advance
 * @depends       b-bus.js, b-scroll-owner.js, b-store.js
 * @used-by       b-catalog.js, b-subcat.js, b-nav.js
 * @doctrine      navigation_sans_friction, categorie_souscategorie_switch_fluide, mobile_desktop_coherence
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership, product-grid
 * @version       2026-06
 */
'use strict';

/**
 * b-pager.js — Pager horizontal catégories principales mobile
 *
 * Features :
 * 1. Rail horizontal scroll-snap — une page par catégorie
 * 2. Ghost loop — après la dernière catégorie, une page clone de "Tout"
 *    → swipe dessus → téléportation silencieuse vers le vrai "Tout" (idx 0)
 * 3. Bounce vertical — en bas d'une page → scroll automatique vers la suivante
 * 4. Sync chips — au scroll natif, chip active = page visible
 */

import { bus }                      from './b-bus.js';
import { state, dom, setActiveCatState } from './b-store.js';
import { isDesktop }               from './b-scroll-owner.js';

'use strict';

// ── Variables CSS de la cage ──────────────────────────────────────

// ── Recalc robuste : re-mesure --pager-top APRÈS stabilisation (image hero / polices / resize) ──
// Cause du bug : _recalcPagerVars() ne tournait qu'une fois (1 rAF), souvent AVANT le chargement
// de l'image hero → #k-hero-fixed-wrap trop court → --pager-top trop petit → le pager fixe remonte
// sous le hero. Ces hooks relancent la mesure une fois le layout réellement stabilisé.
let _stabilizationHooksInstalled = false;
let _recalcRaf = 0;

function _scheduleRecalc() {
  if (_recalcRaf) cancelAnimationFrame(_recalcRaf);
  _recalcRaf = requestAnimationFrame(function () {
    _recalcRaf = requestAnimationFrame(function () {
      _recalcRaf = 0;
      _recalcPagerVars();
    });
  });
}

function _installStabilizationHooks() {
  if (_stabilizationHooksInstalled) return;
  _stabilizationHooksInstalled = true;

  const wrap = document.getElementById('k-hero-fixed-wrap');
  const img  = wrap && (wrap.querySelector('.k-hero-img') || wrap.querySelector('img'));
  if (img && !img.complete) {                         // 1) image hero chargée → wrap plus haut → re-mesurer
    img.addEventListener('load',  _scheduleRecalc, { once: true });
    img.addEventListener('error', _scheduleRecalc, { once: true });
  }
  if (document.fonts && document.fonts.ready) {        // 2) polices chargées → métriques slogan/chips
    document.fonts.ready.then(_scheduleRecalc).catch(function () {});
  }
  if (window.ResizeObserver && wrap) {                 // 3) toute variation de hauteur du wrap fixe
    try { new ResizeObserver(_scheduleRecalc).observe(wrap); } catch (e) {}
  }
  window.addEventListener('resize', _scheduleRecalc, { passive: true });           // 4) resize / rotation
  window.addEventListener('orientationchange', _scheduleRecalc, { passive: true });
}

function _recalcPagerVars() {
  // PATCH #233 — no pager vars on desktop
  if (isDesktop()) {
    destroyMobilePager();
    return;
  }

  const ps   = dom.pageScroll;
  const bnav = document.querySelector('.k-bnav');

  const bnavH = bnav ? bnav.offsetHeight : 56;

  // Mesurer la position viewport réelle du bas du dernier élément
  // qui précède la zone pager (header + hero + sticky-bar + chips).
  // getBoundingClientRect().bottom = position bas relative au viewport.
  let pagerTop = 0;
  [
    document.querySelector('.k-header'),
    document.getElementById('k-hero-fixed-wrap'),
    document.getElementById('k-sticky-bar'),
    document.querySelector('.k-hero-cats-sticky'),
    document.querySelector('.k-cats-shell'),
  ].forEach(function(el) {
    if (!el) return;
    const b = el.getBoundingClientRect().bottom;
    if (b > pagerTop) pagerTop = b;
  });
  // Fallback : si les éléments ne sont pas encore dans le DOM
  if (pagerTop < 10) {
    const wrap = document.getElementById('k-hero-fixed-wrap');
    pagerTop = (wrap ? wrap.offsetHeight : 180) + 44;
  }

  const pagerH = window.innerHeight - pagerTop - bnavH;

  document.documentElement.style.setProperty('--pager-top', pagerTop + 'px');
  document.documentElement.style.setProperty('--pager-h',   Math.max(pagerH, 300) + 'px');
  document.documentElement.style.setProperty('--pager-w',   window.innerWidth + 'px');
  document.documentElement.style.setProperty('--bnav-h',    bnavH + 'px');

  if (ps) {
    ps.style.top = pagerTop + 'px';
    ps.style.left = '0';
    ps.style.right = '0';
    ps.style.width = '100vw';
  }

  // Câble (une seule fois) les re-mesures après stabilisation du layout.
  _installStabilizationHooks();
}

// ── Helpers ───────────────────────────────────────────────────────

function _getGrid() { return document.getElementById('k-grid'); }

function _getPages(grid) {
  return Array.from((grid || _getGrid()).querySelectorAll(':scope > .k-cat-section'));
}

function _getRealPages(grid) {
  // Exclut le ghost
  return Array.from((grid || _getGrid()).querySelectorAll(':scope > .k-cat-section:not([data-ghost])'));
}

function _getCurrentIndex(grid) {
  const g = grid || _getGrid();
  if (!g) return 0;
  const w = g.clientWidth || window.innerWidth;
  return w > 0 ? Math.max(0, Math.round(g.scrollLeft / w)) : 0;
}

function _syncChip(cat) {
  // Mutation via setter centralisé (sans renderGrid — scroll context).
  // setActiveCatState émet catalog:cat-changed → sidebar + chip rail synced.
  setActiveCatState(cat);
  let activeChip = null;
  document.querySelectorAll('#k-cats .k-chip').forEach(chip => {
    const on = chip.dataset.cat === cat;
    chip.classList.toggle('active', on);
    if (on) activeChip = chip;
  });
  if (activeChip) bus.emit('chip:center', activeChip);
}

// Verrou anti-boucle : pendant un scroll programmatique,
// le listener scroll natif ne doit pas re-déclencher de navigation.
let _isProgrammaticScroll = false;
let _programmaticScrollTimer = null;
let _isSettingUpMobilePager = false; // guard réentrance — évite double-setup en rotation rapide

function _scrollToIndex(grid, idx, behavior = 'smooth') {
  const w = grid.clientWidth || window.innerWidth;
  if (w <= 0) {
    requestAnimationFrame(() => _scrollToIndex(grid, idx, behavior));
    return;
  }
  const left = idx * w;

  _isProgrammaticScroll = true;
  clearTimeout(_programmaticScrollTimer);

  grid.scrollTo({ left, behavior });

  // Verrou court : juste le temps d'éviter la boucle scroll→chip→scroll.
  // On ne force plus la position ensuite — le scroll-snap CSS s'en charge.
  _programmaticScrollTimer = setTimeout(() => {
    _isProgrammaticScroll = false;
  }, behavior === 'instant' ? 32 : 100);
}

// ── Ghost loop ────────────────────────────────────────────────────
// Ajoute un clone de la page "Tout" à la fin du rail.
// Quand l'utilisateur y arrive, on téléporte silencieusement vers le vrai Tout.

function _setupInfiniteLoop() {
  const grid = _getGrid();
  if (!grid || isDesktop()) return;
  grid.querySelectorAll('[data-ghost]').forEach(g => g.remove());

  const toutPage = grid.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');
  if (!toutPage) return;

  // Cloner la page Tout et l'ajouter à la fin
  const ghost = toutPage.cloneNode(true);
  // Les surfaces asynchrones montées dans le vrai "Tout" (Discovery, demain
  // d'autres blocs statiques) ne doivent pas être clonées dans la page ghost :
  // elles dupliqueraient leurs ids et leurs handlers sans appartenir à la boucle.
  ghost.querySelectorAll('[data-pager-static]').forEach(node => node.remove());
  ghost.setAttribute('data-ghost', 'true');
  ghost.dataset.cat = 'all';
  grid.appendChild(ghost);
}

function _ghostTeleport(grid) {
  // 1. Masquer le grid pendant la téléportation (évite le scintillement)
  grid.style.opacity    = '0';
  grid.style.transition = 'none';

  // 2. Mélanger les cartes de Tout (dopamine)
  _reshuffleToutInDOM();

  // 3. Téléporter vers idx 0 sans animation
  _scrollToIndex(grid, 0, 'instant');
  _syncChip('all');

  // 4. Réafficher après un frame (le browser a repositionné le scroll)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.style.opacity    = '';
      grid.style.transition = '';
    });
  });
}

// ── Scroll listener principal ─────────────────────────────────────

function _setupScrollSync(grid) {
  if (grid._pagerScrollH) grid.removeEventListener('scroll', grid._pagerScrollH);

  let raf = null;
  let lastIdx = -1;

  grid._pagerScrollH = () => {
    // Ne pas interférer pendant un scroll programmatique (évite la boucle scroll→chip→scroll)
    if (_isProgrammaticScroll) return;
    if (state.modalOpen) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const allPages = _getPages(grid);
      const idx = _getCurrentIndex(grid);
      const page = allPages[idx];
      if (!page) return;

      // Ghost détecté → téléportation
      if (page.dataset.ghost) {
        _ghostTeleport(grid);
        lastIdx = 0;
        return;
      }

      const cat = page.dataset.cat;
      if (cat && idx !== lastIdx) {
        lastIdx = idx;
        _syncChip(cat);
      }
    });
  };

  grid.addEventListener('scroll', grid._pagerScrollH, { passive: true });
}

// ── Bounce vertical → page suivante ──────────────────────────────

// Réinitialise l'état de scroll de toutes les pages (lastST, wasDown).
// Appelé à modal:opened/closed pour que le scroll restauré par
// window.scrollTo dans closeModal ne soit pas interprété comme un
// "scroll bas" de l'utilisateur → plus de page-suivante parasite.
function _resetAllPagesBounceState() {
  const grid = _getGrid();
  if (!grid) return;
  _getPages(grid).forEach(p => {
    if (p._bounceTimer) {
      clearTimeout(p._bounceTimer);
      p._bounceTimer = null;
    }
    p._bounceLastST  = p.scrollTop;
    p._bounceWasDown = false;
  });
}

// Listener bus : écouté une seule fois au boot du pager.
// Couvre le cas où un timer de 350ms est armé juste avant l'ouverture
// d'une modal et tirerait pendant/après son cycle.
let _busModalBound = false;
function _bindModalBusListeners() {
  if (_busModalBound) return;
  _busModalBound = true;
  bus.on('modal:opened', _resetAllPagesBounceState);
  bus.on('modal:closed', _resetAllPagesBounceState);
}

function _setupSectionAutoAdvance() {
  const grid = _getGrid();
  if (!grid || isDesktop()) return;

  _bindModalBusListeners();

  function _bindPage(page) {
    if (page._bounceH) page.removeEventListener('scroll', page._bounceH);
    if (page._bounceTimer) { clearTimeout(page._bounceTimer); page._bounceTimer = null; }
    page._bounceLastST  = 0;
    page._bounceWasDown = false;

    page._bounceH = () => {
      if (state.modalOpen) return;
      const st = page.scrollTop;
      const lastST  = page._bounceLastST  || 0;
      let   wasDown = page._bounceWasDown || false;
      if      (st > lastST + 2) wasDown = true;
      else if (st < lastST - 8) wasDown = false;
      page._bounceLastST  = st;
      page._bounceWasDown = wasDown;

      const atBottom = page.scrollHeight <= page.clientHeight + 8
        || page.scrollTop + page.clientHeight >= page.scrollHeight - 32;

      if (wasDown && atBottom) {
        if (page._bounceTimer) clearTimeout(page._bounceTimer);
        page._bounceTimer = setTimeout(() => {
          page._bounceTimer = null;
          // Re-test au moment de tirer : modal pu s'ouvrir entre temps,
          // ou le pager a été détruit (resize → desktop).
          if (!page._bounceWasDown || state.modalOpen) return;
          if (isDesktop()) return;
          const realPages = _getRealPages(grid);
          const currentIdx = _getCurrentIndex(grid);
          const total = realPages.length; // sans ghost
          const nextIdx = currentIdx + 1 >= total ? 0 : currentIdx + 1;

          // Hint visuel
          _showNextHint(page, realPages[nextIdx]);

          // Si on passe à 0 depuis la dernière → aller au ghost (scroll naturel)
          // puis téléporter
          if (nextIdx === 0) {
            const allPages = _getPages(grid);
            const ghostIdx = allPages.findIndex(p => p.dataset.ghost);
            if (ghostIdx >= 0) {
              _scrollToIndex(grid, ghostIdx, 'smooth');
              return;
            }
          }
          _scrollToIndex(grid, nextIdx, 'smooth');
        }, 350);
      } else if (page._bounceTimer) {
        clearTimeout(page._bounceTimer);
        page._bounceTimer = null;
      }
    };

    page.addEventListener('scroll', page._bounceH, { passive: true });

    // PATCH iOS : le rubber-band bottom ne déclenche pas toujours un scroll
    // event "atBottom" propre. Au touchend, on force une re-évaluation pour
    // garantir le bounce quand l'utilisateur lâche le doigt après être en bas.
    if (page._bounceTouchEnd) page.removeEventListener('touchend', page._bounceTouchEnd);
    page._bounceTouchEnd = () => {
      if (state.modalOpen) return;
      if (isDesktop()) return;
      // Évaluer at-bottom avec un seuil plus tolérant (rubber-band peut déformer
      // les valeurs scrollTop/scrollHeight transitoirement sur iOS).
      const atBottom = page.scrollHeight <= page.clientHeight + 8
        || page.scrollTop + page.clientHeight >= page.scrollHeight - 64;
      if (!atBottom || !page._bounceWasDown) return;
      // Force le bounce sans attendre le prochain scroll event
      if (page._bounceTimer) clearTimeout(page._bounceTimer);
      page._bounceTimer = setTimeout(() => {
        page._bounceTimer = null;
        if (state.modalOpen || isDesktop()) return;
        const realPages = _getRealPages(grid);
        const currentIdx = _getCurrentIndex(grid);
        const total = realPages.length;
        const nextIdx = currentIdx + 1 >= total ? 0 : currentIdx + 1;
        _showNextHint(page, realPages[nextIdx]);
        if (nextIdx === 0) {
          const allPages = _getPages(grid);
          const ghostIdx = allPages.findIndex(p => p.dataset.ghost);
          if (ghostIdx >= 0) {
            _scrollToIndex(grid, ghostIdx, 'smooth');
            return;
          }
        }
        _scrollToIndex(grid, nextIdx, 'smooth');
      }, 220);
    };
    page.addEventListener('touchend', page._bounceTouchEnd, { passive: true });
    page.addEventListener('touchcancel', page._bounceTouchEnd, { passive: true });
  }

  // Binder toutes les vraies pages (pas le ghost)
  _getRealPages(grid).forEach(_bindPage);
}

function _showNextHint(currentPage, nextPage) {
  if (!nextPage) return;
  const cat = nextPage.dataset.cat || 'Tout';
  const label = document.querySelector(`#k-cats .k-chip[data-cat="${cat}"] .k-chip-label`)?.textContent || cat;

  const existing = currentPage.querySelector('.k-pager-next-hint');
  if (existing) existing.remove();

  const hint = document.createElement('div');
  hint.className = 'k-pager-next-hint';
  hint.textContent = label + ' →';
  currentPage.appendChild(hint);
  setTimeout(() => hint.remove(), 900);
}

// ── Setup principal ───────────────────────────────────────────────

function _handlePagerResize() {
  if (isDesktop()) {
    destroyMobilePager();
    return;
  }
  _setupMobilePager();
}

function _setupMobilePager() {
  if (isDesktop()) {
    destroyMobilePager();
    return;
  }
  if (_isSettingUpMobilePager) return;
  _isSettingUpMobilePager = true;
  try {
    const grid = _getGrid();
    if (!grid) return;
    if (grid.classList.contains('k-grid-flat-subcat')) return;

    _recalcPagerVars();
    _setupScrollSync(grid);

    window.removeEventListener('resize', _setupMobilePager);
    window.removeEventListener('resize', _handlePagerResize);
    window.addEventListener('resize', _handlePagerResize);
  } finally {
    _isSettingUpMobilePager = false;
  }
}

// ── Navigation externe (chip click) ──────────────────────────────

function _scrollPagerToCat(cat, behavior = 'smooth') {
  const grid = _getGrid();
  if (!grid || isDesktop()) return false;
  const idx   = _getPages(grid).findIndex(p => p.dataset.cat === cat);
  if (idx < 0) return false;

  // Sync chip en premier pour éviter qu'un re-render perturbé par l'event
  // ne décale le scroll qui suit
  _syncChip(cat);
  _scrollToIndex(grid, idx, behavior);
  return true;
}

function _scrollPagerToGhost() { _scrollPagerToCat('all'); }

// ── Destroy ───────────────────────────────────────────────────────

function destroyMobilePager() {
  // Nettoyer le verrou de scroll programmatique
  _isProgrammaticScroll = false;
  clearTimeout(_programmaticScrollTimer);

  const grid = _getGrid();
  if (grid) {
    if (grid._pagerScrollH) {
      grid.removeEventListener('scroll', grid._pagerScrollH);
      grid._pagerScrollH = null;
    }
    if (grid._leftSwipeTouchStart) {
      document.removeEventListener('touchstart', grid._leftSwipeTouchStart);
      grid._leftSwipeTouchStart = null;
    }
    if (grid._leftSwipeTouchMove) {
      document.removeEventListener('touchmove', grid._leftSwipeTouchMove);
      grid._leftSwipeTouchMove = null;
    }
    if (grid._leftSwipeTouchEnd) {
      document.removeEventListener('touchend', grid._leftSwipeTouchEnd);
      grid._leftSwipeTouchEnd = null;
    }
    if (grid._leftSwipeScrollH) {
      grid.removeEventListener('scroll', grid._leftSwipeScrollH);
      grid._leftSwipeScrollH = null;
    }
    // Nettoyer bounces sur les pages (handler + timer pendant)
    _getPages(grid).forEach(p => {
      if (p._bounceH) { p.removeEventListener('scroll', p._bounceH); p._bounceH = null; }
      if (p._bounceTimer) { clearTimeout(p._bounceTimer); p._bounceTimer = null; }
      p._bounceLastST  = 0;
      p._bounceWasDown = false;
    });
    // Supprimer ghost
    grid.querySelectorAll('[data-ghost]').forEach(g => g.remove());
    grid.classList.remove('k-grid-cat-pager');
    ['transform','transition','width','height','position','overflow','willChange','display']
      .forEach(p => { grid.style[p] = ''; });
  }
  const ps = dom.pageScroll;
  if (ps) {
    ps.classList.remove('k-pager-active');
    [
      'position',
      'top',
      'left',
      'right',
      'bottom',
      'width',
      'height',
      'maxWidth',
      'overflow',
      'overflowX',
      'overflowY',
      'transform',
      'transition'
    ].forEach(p => { ps.style[p] = ''; });
  }

  document.documentElement.style.removeProperty('--pager-top');
  document.documentElement.style.removeProperty('--pager-h');
  document.documentElement.style.removeProperty('--pager-w');
  document.documentElement.style.removeProperty('--bnav-h');

  window.removeEventListener('resize', _setupMobilePager);
  window.removeEventListener('resize', _handlePagerResize);
}

// ── Reshuffle Tout ────────────────────────────────────────────────

function _reshuffleToutInDOM() {
  const grid = _getGrid();
  if (!grid) return;
  const sec = grid.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');
  if (!sec) return;
  const sg = sec.querySelector('.k-sec-grid');
  if (!sg) return;
  const cards = [...sg.children];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  sg.append(...cards);
}

// ── Stubs compatibilité ───────────────────────────────────────────
function _setupHorizontalWrap() { }
function _syncChipToScroll()    { }
function _onPagerScroll()       { }
function _setupPagerDots()      { }

export {
  _setupMobilePager,
  _recalcPagerVars,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
  _scrollPagerToCat,
  _scrollPagerToGhost,
  _reshuffleToutInDOM,
  _setupInfiniteLoop,
  _setupPagerDots,
  destroyMobilePager,
};
