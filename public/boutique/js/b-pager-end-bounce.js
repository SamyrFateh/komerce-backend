/**
 * @komerce-arch-lite
 * @role          mobile-pager-end-bounce
 * @domain        catalog
 * @layer         ui-state
 * @owner         public/boutique/js/b-pager-end-bounce.js
 * @purpose       Passage de rayon volontaire et réversible : tirer depuis le bas avance, tirer depuis le haut recule.
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership, discovery-rail
 * @version       2026-09
 */
'use strict';

// Passage de rayon VOLONTAIRE et RÉVERSIBLE (mobile uniquement).
//
// Avant : arriver à moins de 32 px du bas par un simple scroll basculait au
// rayon suivant après 160 ms — on quittait le rayon sans avoir vu la dernière
// rangée, et rien ne permettait de revenir en remontant.
//
// Maintenant :
//  - AVANCER : le geste doit COMMENCER alors que la page est déjà en bas, puis
//    tirer vers le haut d'au moins PULL_PX. Arriver en bas ne fait rien.
//  - RECULER : le geste doit COMMENCER alors que la page est tout en haut, puis
//    tirer vers le bas d'au moins PULL_PX → rayon précédent, posé sur sa fin.
//    Le premier rayon ne recule pas (il n'a pas de précédent).
// Une page trop courte pour défiler est à la fois « en haut » et « en bas » :
// les deux gestes y fonctionnent, chacun dans son sens.
const BOTTOM_TOLERANCE_PX = 32;
const EDGE_START_TOLERANCE_PX = 4;
const PULL_PX = 56;
const VERTICAL_DOMINANCE = 1.25;
const TOUCH_ADVANCE_DELAY_MS = 40;
const PAGER_BUMP_EVENT = 'komerce:pager-bump';

function isAtBottom(page, tolerance = BOTTOM_TOLERANCE_PX) {
  if (!page) return false;
  return page.scrollHeight <= page.clientHeight + 8
    || page.scrollTop + page.clientHeight >= page.scrollHeight - tolerance;
}

function isAtTop(page, tolerance = EDGE_START_TOLERANCE_PX) {
  if (!page) return false;
  return page.scrollTop <= tolerance;
}

function distanceFromBottom(page) {
  if (!page) return Infinity;
  return page.scrollHeight - page.clientHeight - page.scrollTop;
}

function resetGesture(runtime) {
  runtime.tracking = false;
  runtime.startX = 0;
  runtime.startY = 0;
  runtime.pullUp = 0;
  runtime.pullDown = 0;
  runtime.horizontal = 0;
  runtime.startedAtBottom = false;
  runtime.startedAtTop = false;
}

function cancelAdvance(page, runtime) {
  clearTimeout(runtime.advanceTimer);
  runtime.advanceTimer = null;
}

function emitPagerBump(page, nextPage) {
  if (typeof window === 'undefined' || typeof window.CustomEvent !== 'function') return;
  window.dispatchEvent(new window.CustomEvent(PAGER_BUMP_EVENT, {
    detail: {
      from: page?.dataset?.cat || 'all',
      to: nextPage?.dataset?.cat || 'all',
    },
  }));
}

function touchPoint(event) {
  return event.touches?.[0] || event.changedTouches?.[0] || null;
}

function teardownPagerEndBounce(pages) {
  (pages || []).forEach((page) => {
    const runtime = page._pagerEndBounce;
    if (!runtime) return;

    page.removeEventListener('scroll', runtime.onScroll);
    page.removeEventListener('touchstart', runtime.onTouchStart);
    page.removeEventListener('touchmove', runtime.onTouchMove);
    page.removeEventListener('touchend', runtime.onTouchEnd);
    page.removeEventListener('touchcancel', runtime.onTouchCancel);
    cancelAdvance(page, runtime);
    delete page._pagerEndBounce;
  });
}

function setupPagerEndBounce({ pages, isBlocked, onAdvance, onRetreat }) {
  const realPages = Array.from(pages || []);
  teardownPagerEndBounce(realPages);
  if (realPages.length < 2 || typeof onAdvance !== 'function') return 0;

  realPages.forEach((page, pageIndex) => {
    const nextPage = realPages[(pageIndex + 1) % realPages.length];
    const prevPage = pageIndex > 0 ? realPages[pageIndex - 1] : null;
    const runtime = { advanceTimer: null };
    resetGesture(runtime);

    const schedule = (fire) => {
      clearTimeout(runtime.advanceTimer);
      runtime.advanceTimer = setTimeout(() => {
        runtime.advanceTimer = null;
        if (isBlocked?.()) return;
        fire();
      }, TOUCH_ADVANCE_DELAY_MS);
    };

    // Le scroll n'avance plus jamais seul ; il annule seulement un passage en
    // attente si la page a quitté le bord d'où le geste est parti.
    runtime.onScroll = () => {
      if (!runtime.advanceTimer) return;
      if (isBlocked?.()) { cancelAdvance(page, runtime); return; }
      if (runtime.pendingDirection === 'next' && !isAtBottom(page)) cancelAdvance(page, runtime);
      if (runtime.pendingDirection === 'prev' && !isAtTop(page, BOTTOM_TOLERANCE_PX)) cancelAdvance(page, runtime);
    };

    runtime.onTouchStart = (event) => {
      cancelAdvance(page, runtime);
      resetGesture(runtime);
      const point = event.touches?.[0] || null;
      if (!point || isBlocked?.()) return;
      runtime.tracking = true;
      runtime.startX = point.clientX;
      runtime.startY = point.clientY;
      runtime.startedAtBottom = isAtBottom(page, EDGE_START_TOLERANCE_PX);
      runtime.startedAtTop = isAtTop(page);
    };

    runtime.onTouchMove = (event) => {
      if (!runtime.tracking || isBlocked?.()) return;
      const point = touchPoint(event);
      if (!point) return;
      runtime.pullUp = runtime.startY - point.clientY;
      runtime.pullDown = point.clientY - runtime.startY;
      runtime.horizontal = Math.abs(runtime.startX - point.clientX);
    };

    runtime.onTouchEnd = () => {
      if (!runtime.tracking || isBlocked?.()) { resetGesture(runtime); return; }
      const { pullUp, pullDown, horizontal, startedAtBottom, startedAtTop } = runtime;
      resetGesture(runtime);

      if (startedAtBottom && pullUp >= PULL_PX && pullUp > horizontal * VERTICAL_DOMINANCE
          && isAtBottom(page)) {
        runtime.pendingDirection = 'next';
        schedule(() => {
          // Le bump est une entrée métier distincte d'un tap/swipe horizontal.
          // L'événement part AVANT onAdvance afin que les surfaces de tête de
          // page (notamment Disponible ici) soient montées avant le repositionnement.
          emitPagerBump(page, nextPage);
          onAdvance(page, nextPage);
        });
        return;
      }

      if (prevPage && typeof onRetreat === 'function'
          && startedAtTop && pullDown >= PULL_PX && pullDown > horizontal * VERTICAL_DOMINANCE
          && isAtTop(page, BOTTOM_TOLERANCE_PX)) {
        runtime.pendingDirection = 'prev';
        schedule(() => onRetreat(page, prevPage));
      }
    };

    runtime.onTouchCancel = () => {
      cancelAdvance(page, runtime);
      resetGesture(runtime);
    };

    page.addEventListener('scroll', runtime.onScroll, { passive: true });
    page.addEventListener('touchstart', runtime.onTouchStart, { passive: true });
    page.addEventListener('touchmove', runtime.onTouchMove, { passive: true });
    page.addEventListener('touchend', runtime.onTouchEnd, { passive: true });
    page.addEventListener('touchcancel', runtime.onTouchCancel, { passive: true });
    page._pagerEndBounce = runtime;
  });

  return realPages.length;
}

export {
  PAGER_BUMP_EVENT,
  PULL_PX,
  setupPagerEndBounce,
  teardownPagerEndBounce,
  isAtBottom,
  isAtTop,
  distanceFromBottom,
};
