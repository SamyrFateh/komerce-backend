/**
 * @komerce-arch-lite
 * @role          mobile-pager-end-bounce
 * @domain        catalog
 * @layer         ui-state
 * @owner         public/boutique/js/b-pager-end-bounce.js
 * @purpose       Avancer automatiquement vers la catégorie suivante après une arrivée verticale volontaire en bas de page.
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership, discovery-rail
 * @version       2026-09
 */
'use strict';

// Le relâchement du premier geste vertical déclenche le passage presque
// immédiatement. Le petit délai laisse Samsung Browser terminer son touchend
// sans réintroduire un état intermédiaire visible ou un second geste.
const BOTTOM_TOLERANCE_PX = 32;
const TOUCH_BOTTOM_TOLERANCE_PX = 64;
const DOWN_EPSILON_PX = 2;
const UP_CANCEL_PX = 8;
const VERTICAL_INTENT_PX = 8;
const VERTICAL_DOMINANCE = 1.25;
const AUTO_ADVANCE_DELAY_MS = 160;
const TOUCH_ADVANCE_DELAY_MS = 40;
const PAGER_BUMP_EVENT = 'komerce:pager-bump';

function isAtBottom(page, tolerance = BOTTOM_TOLERANCE_PX) {
  if (!page) return false;
  return page.scrollHeight <= page.clientHeight + 8
    || page.scrollTop + page.clientHeight >= page.scrollHeight - tolerance;
}

function distanceFromBottom(page) {
  if (!page) return Infinity;
  return page.scrollHeight - page.clientHeight - page.scrollTop;
}

function resetGesture(runtime) {
  runtime.verticalIntent = false;
  runtime.horizontalIntent = false;
  runtime.startX = 0;
  runtime.startY = 0;
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

function scheduleAdvance(page, nextPage, runtime, isBlocked, onAdvance, delay) {
  clearTimeout(runtime.advanceTimer);
  runtime.advanceTimer = setTimeout(() => {
    runtime.advanceTimer = null;
    if (
      isBlocked?.()
      || runtime.horizontalIntent
      || !runtime.movingDown
      || !isAtBottom(page, TOUCH_BOTTOM_TOLERANCE_PX)
    ) return;

    runtime.movingDown = false;
    // Le bump est une entrée métier distincte d'un tap/swipe horizontal.
    // L'événement part AVANT onAdvance afin que les surfaces de tête de page
    // (notamment Disponible ici) puissent être montées avant le repositionnement.
    emitPagerBump(page, nextPage);
    onAdvance(page, nextPage);
  }, delay);
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

function setupPagerEndBounce({ pages, isBlocked, onAdvance }) {
  const realPages = Array.from(pages || []);
  teardownPagerEndBounce(realPages);
  if (realPages.length < 2 || typeof onAdvance !== 'function') return 0;

  realPages.forEach((page, pageIndex) => {
    const nextPage = realPages[(pageIndex + 1) % realPages.length];
    const runtime = {
      advanceTimer: null,
      lastScrollTop: page.scrollTop,
      movingDown: false,
      verticalIntent: false,
      horizontalIntent: false,
      startX: 0,
      startY: 0,
      onScroll: null,
      onTouchStart: null,
      onTouchMove: null,
      onTouchEnd: null,
      onTouchCancel: null,
    };

    runtime.onScroll = () => {
      if (isBlocked?.()) {
        cancelAdvance(page, runtime);
        return;
      }
      const currentTop = page.scrollTop;
      if (currentTop > runtime.lastScrollTop + DOWN_EPSILON_PX) {
        runtime.movingDown = true;
      } else if (currentTop < runtime.lastScrollTop - UP_CANCEL_PX) {
        runtime.movingDown = false;
      }
      runtime.lastScrollTop = currentTop;

      if (runtime.movingDown && isAtBottom(page) && !runtime.horizontalIntent) {
        scheduleAdvance(
          page,
          nextPage,
          runtime,
          isBlocked,
          onAdvance,
          AUTO_ADVANCE_DELAY_MS
        );
      } else if (!isAtBottom(page)) {
        cancelAdvance(page, runtime);
      }
    };

    runtime.onTouchStart = (event) => {
      const point = touchPoint(event);
      cancelAdvance(page, runtime);
      resetGesture(runtime);
      if (!point || isBlocked?.()) return;
      runtime.startX = point.clientX;
      runtime.startY = point.clientY;
    };

    runtime.onTouchMove = (event) => {
      if (isBlocked?.()) return;
      const point = touchPoint(event);
      if (!point) return;

      const pullUp = runtime.startY - point.clientY;
      const horizontalTravel = Math.abs(runtime.startX - point.clientX);
      runtime.verticalIntent = pullUp >= VERTICAL_INTENT_PX
        && pullUp > horizontalTravel * VERTICAL_DOMINANCE;
      runtime.horizontalIntent = horizontalTravel > Math.abs(pullUp)
        && horizontalTravel >= VERTICAL_INTENT_PX;

      if (runtime.horizontalIntent) cancelAdvance(page, runtime);
    };

    runtime.onTouchEnd = () => {
      if (
        !isBlocked?.()
        && runtime.verticalIntent
        && !runtime.horizontalIntent
        && isAtBottom(page, TOUCH_BOTTOM_TOLERANCE_PX)
      ) {
        runtime.movingDown = true;
        scheduleAdvance(
          page,
          nextPage,
          runtime,
          isBlocked,
          onAdvance,
          TOUCH_ADVANCE_DELAY_MS
        );
      }
    };

    runtime.onTouchCancel = () => {
      runtime.movingDown = false;
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
  setupPagerEndBounce,
  teardownPagerEndBounce,
  isAtBottom,
  distanceFromBottom,
};
