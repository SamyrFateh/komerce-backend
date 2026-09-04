/**
 * @komerce-arch-lite
 * @role          mobile-pager-end-bounce
 * @domain        catalog
 * @layer         ui-state
 * @owner         public/boutique/js/b-pager-end-bounce.js
 * @purpose       Signaler la fin d'une page mobile et n'avancer qu'après une seconde impulsion verticale volontaire.
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership
 * @version       2026-09
 */
'use strict';

const BOTTOM_TOLERANCE_PX = 12;
const LEAVE_BOTTOM_PX = 48;
const PULL_THRESHOLD_PX = 42;
const ARM_DURATION_MS = 4500;
const HINT_DURATION_MS = 900;

function isAtBottom(page) {
  if (!page) return false;
  return page.scrollTop + page.clientHeight >= page.scrollHeight - BOTTOM_TOLERANCE_PX;
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
  runtime.startedArmed = false;
  runtime.pulledUp = false;
  runtime.startX = 0;
  runtime.startY = 0;
}

function disarmPage(page, runtime) {
  runtime.armed = false;
  clearTimeout(runtime.armTimer);
  runtime.armTimer = null;
  removeHint(page);
}

function armPage(page, nextPage, runtime) {
  runtime.armed = true;
  clearTimeout(runtime.armTimer);
  showNextHint(page, nextPage);
  runtime.armTimer = setTimeout(() => disarmPage(page, runtime), ARM_DURATION_MS);
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
    disarmPage(page, runtime);
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
      armed: false,
      armTimer: null,
      lastScrollTop: page.scrollTop,
      startedArmed: false,
      pulledUp: false,
      startX: 0,
      startY: 0,
      onScroll: null,
      onTouchStart: null,
      onTouchMove: null,
      onTouchEnd: null,
      onTouchCancel: null,
    };

    runtime.onScroll = () => {
      if (isBlocked?.()) return;
      const currentTop = page.scrollTop;
      const movingDown = currentTop > runtime.lastScrollTop;
      runtime.lastScrollTop = currentTop;

      if (distanceFromBottom(page) > LEAVE_BOTTOM_PX) {
        disarmPage(page, runtime);
        return;
      }
      if (movingDown && isAtBottom(page) && !runtime.armed) {
        armPage(page, nextPage, runtime);
      }
    };

    runtime.onTouchStart = (event) => {
      const point = touchPoint(event);
      resetGesture(runtime);
      if (!point || isBlocked?.()) return;
      runtime.startX = point.clientX;
      runtime.startY = point.clientY;
      runtime.startedArmed = runtime.armed && isAtBottom(page);
    };

    runtime.onTouchMove = (event) => {
      if (!runtime.startedArmed || isBlocked?.()) return;
      const point = touchPoint(event);
      if (!point) return;

      const pullUp = runtime.startY - point.clientY;
      const horizontalTravel = Math.abs(runtime.startX - point.clientX);
      runtime.pulledUp = pullUp >= PULL_THRESHOLD_PX
        && pullUp > horizontalTravel * 1.25;
    };

    runtime.onTouchEnd = () => {
      const shouldAdvance = runtime.startedArmed
        && runtime.pulledUp
        && isAtBottom(page)
        && !isBlocked?.();

      if (shouldAdvance) {
        disarmPage(page, runtime);
        onAdvance(page, nextPage);
      } else if (!runtime.armed && isAtBottom(page) && !isBlocked?.()) {
        // Une page courte ou déjà positionnée en bas reçoit elle aussi un
        // premier signal ; elle ne peut jamais avancer sur ce même geste.
        armPage(page, nextPage, runtime);
      }
      resetGesture(runtime);
    };

    runtime.onTouchCancel = () => resetGesture(runtime);

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
