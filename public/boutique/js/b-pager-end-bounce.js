/**
 * @komerce-arch-lite
 * @role          mobile-pager-end-bounce
 * @domain        catalog
 * @layer         ui-state
 * @owner         public/boutique/js/b-pager-end-bounce.js
 * @purpose       Avancer automatiquement vers la catégorie suivante après une arrivée verticale volontaire en bas de page.
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership
 * @version       2026-09
 */
'use strict';

// Courte respiration historique : le bas est perçu avant que la page suivante
// remonte automatiquement, sans demander un second geste à l'utilisateur.
const BOTTOM_TOLERANCE_PX = 32;
const TOUCH_BOTTOM_TOLERANCE_PX = 64;
const DOWN_EPSILON_PX = 2;
const UP_CANCEL_PX = 8;
const VERTICAL_INTENT_PX = 8;
const VERTICAL_DOMINANCE = 1.25;
const AUTO_ADVANCE_DELAY_MS = 350;
const TOUCH_ADVANCE_DELAY_MS = 220;
const HINT_DURATION_MS = 900;

function isAtBottom(page, tolerance = BOTTOM_TOLERANCE_PX) {
  if (!page) return false;
  return page.scrollHeight <= page.clientHeight + 8
    || page.scrollTop + page.clientHeight >= page.scrollHeight - tolerance;
}

function distanceFromBottom(page) {
  if (!page) return Infinity;
  return page.scrollHeight - page.clientHeight - page.scrollTop;
}

function nextPageLabel(nextPage) {
  const category = nextPage?.dataset?.cat || 'Tout';
  return document.querySelector(
    `#k-cats .k-chip[data-cat="${category}"] .k-chip-label`
  )?.textContent?.trim() || category;
}

function removeHint(page) {
  page?.querySelector('.k-pager-next-hint')?.remove();
}

function showNextHint(page, nextPage) {
  if (!page || !nextPage) return null;
  removeHint(page);

  const hint = document.createElement('div');
  hint.className = 'k-pager-next-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = `${nextPageLabel(nextPage)} →`;
  page.appendChild(hint);
  setTimeout(() => hint.remove(), HINT_DURATION_MS);
  return hint;
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
  removeHint(page);
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
    showNextHint(page, nextPage);
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
  setupPagerEndBounce,
  teardownPagerEndBounce,
  isAtBottom,
  distanceFromBottom,
  nextPageLabel,
  showNextHint,
};
