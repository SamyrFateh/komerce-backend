/**
 * @komerce-arch
 * @role          desktop-catalog-enhancer
 * @domain        catalog
 * @layer         ui-enhancer
 * @criticality   high
 * @inputs        catalog_state, desktop_viewport, view_events
 * @outputs       desktop_sidebar_sync, category_focus, nav_stack_height
 * @depends       b-bus.js, b-store.js, b-scroll-owner.js, controllers/home-controller.js
 * @used-by       boutique.js
 * @doctrine      boutique_canal_decouverte, desktop_premium, navigation_sans_friction
 * @impact-areas  desktop-catalog, category-navigation, home-layout
 * @version       2026-07
 */
'use strict';

/**
 * @module b-catalog-desktop-enhancers
 * @brief Enrichissements actifs du catalogue desktop ≥ 900 px.
 *
 * Les anciennes expérimentations promo strip, merchandising, overlay produit
 * et recherche « Option B » étaient neutralisées par des `return` définitifs.
 * Elles ont été retirées pour que ce module ne contienne plus de code mort.
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';
import {
  syncRailActiveState,
  renderSubcatRail,
} from './controllers/home-controller.js';
import { isDesktop, getScrollY } from './b-scroll-owner.js';

/**
 * Survol d'une catégorie desktop : prévisualise son rail de sous-catégories
 * sans modifier la catégorie réellement sélectionnée ni la grille.
 */
function setupSubcatOnHover() {
  if (!isDesktop()) return;

  const catsEl = document.querySelector('.k-cats');
  if (!catsEl) return;

  let hoverTimer = null;
  let previewActive = false;

  catsEl.addEventListener('mouseenter', function onCategoryEnter(event) {
    const chip = event.target.closest('.k-chip');
    if (!chip) return;

    const category = chip.dataset.cat;
    if (!category || category === 'all') return;

    if (category === state.activeCat) {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      return;
    }

    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      previewActive = true;
      renderSubcatRail(category);
      syncRailActiveState(category, { center: false });
    }, 80);
  }, true);

  catsEl.addEventListener('mouseleave', function onCategoriesLeave() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (!previewActive) return;

    previewActive = false;
    renderSubcatRail(state.activeCat || null);
    syncRailActiveState(state.activeCat || 'all', { center: false });
  });
}

/**
 * Masque les éléments desktop exclusifs à la boutique dans les autres vues.
 * Les sélecteurs résiduels restent tolérés pendant la purge progressive du DOM.
 */
function setupViewChangedGuard() {
  bus.on('view:changed', function onViewChanged(tab) {
    const isShop = tab === 'shop';
    const merch = document.querySelector('.k-home-merch');
    const strip = document.querySelector('.k-promo-strip');
    const scrollTop = document.querySelector('.k-scroll-top');

    if (merch) merch.style.display = isShop ? '' : 'none';
    if (strip) strip.style.display = isShop ? '' : 'none';
    if (scrollTop) {
      scrollTop.classList.toggle('is-visible', isShop && getScrollY() > 600);
    }
  });
}

/**
 * Maintient --nav-stack-h à la hauteur cumulée header + navigation sticky.
 */
function setupNavStackVar() {
  if (!isDesktop()) return;

  const bar = document.getElementById('k-sticky-bar');
  const header = document.querySelector('.k-header');
  if (!bar) return;

  const root = document.documentElement;
  let animationFrame = 0;

  function measure() {
    animationFrame = 0;
    const headerHeight = header ? header.getBoundingClientRect().height : 72;
    const barHeight = bar.getBoundingClientRect().height;
    root.style.setProperty('--nav-stack-h', `${Math.round(headerHeight + barHeight)}px`);
  }

  function update() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(measure);
  }

  update();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    if (header) observer.observe(header);
  }

  window.addEventListener('resize', update, { passive: true });
}

/**
 * Point d'entrée unique des enrichissements desktop actifs.
 */
export function setupCatalogDesktopEnhancers() {
  if (!isDesktop()) return;
  setupSubcatOnHover();
  setupNavStackVar();
  setupViewChangedGuard();
}
