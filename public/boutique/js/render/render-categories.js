/**
 * @komerce-arch-lite
 * @role          boutique-render-categories
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-08
 */
'use strict';

/**
 * @component Boutique / Category Rail Renderer
 * @owner render-categories.js
 *
 * Responsibility:
 * - Render the HTML markup for category chips only.
 * - Use shop-schema.js as the only category data source.
 * - Render the Komerce Shelf presentation without changing taxonomy or behavior.
 * - Preserve the historical image fallback for resilience and rollback.
 *
 * Must not:
 * - Bind click handlers.
 * - Mutate state.activeCat or any catalog state.
 * - Scroll or center the category rail.
 * - Recalculate mobile pager variables.
 * - Duplicate category data already owned by shop-schema.js.
 *
 * Consumers:
 * - home-controller.js mounts and binds the rendered rail.
 */

import { sanitize } from '../b-utils.js';
import { getRailCategories } from '../shop-schema.js';
import { getShelfCategoryVisual, renderShelfUse } from './category-shelf-visuals.js';

function fallbackBadge(category) {
  const badge = category.railBadge || {};
  if (badge.kind === 'svg') return badge.svg || '';
  if (badge.kind === 'text') return `<span>${sanitize(badge.text || category.shortLabel || category.label)}</span>`;
  return `<span>${sanitize(category.sectionEmoji || category.shortLabel || category.label)}</span>`;
}

function renderLegacyImage(category) {
  if (!category.image) return '';
  return `<img class="k-shelf-legacy-image" src="${sanitize(category.image)}" alt="" aria-hidden="true" loading="lazy" width="640" height="348" onerror="this.remove();">`;
}

function renderChipPhoto(category) {
  const shelfVisual = getShelfCategoryVisual(category.key);

  if (shelfVisual) {
    return `<span class="k-chip-photo k-chip-photo--img k-shelf-object-slot" data-shelf-visual="${sanitize(shelfVisual)}">
      ${renderShelfUse(shelfVisual, 'k-shelf-object--category')}
      ${renderLegacyImage(category)}
      <span class="k-chip-fallback" aria-hidden="true">${fallbackBadge(category)}</span>
    </span>`;
  }

  // Dégradation gracieuse : ancien asset photo > badge SVG/texte.
  if (category.image) {
    return `<span class="k-chip-photo k-chip-photo--img">
      <img src="${sanitize(category.image)}" alt="${sanitize(category.label)}" loading="lazy" width="640" height="348" onerror="this.closest('.k-chip-photo').classList.add('is-img-error');this.remove();">
      <span class="k-chip-fallback" aria-hidden="true">${fallbackBadge(category)}</span>
    </span>`;
  }
  return `<span class="k-chip-photo">${fallbackBadge(category)}</span>`;
}

export function renderCategoryRailMarkup(activeCategoryKey) {
  return getRailCategories().map((category) => {
    const shelfVisual = getShelfCategoryVisual(category.key);
    return `
    <button class="k-chip k-cat-cutout${category.key === activeCategoryKey ? ' active' : ''}" data-cat="${sanitize(category.key)}"${shelfVisual ? ` data-shelf-visual="${sanitize(shelfVisual)}"` : ''} aria-label="${sanitize(category.label)}">
      ${renderChipPhoto(category)}
      <span class="k-chip-label">${sanitize(category.shortLabel || category.label)}</span>
    </button>`;
  }).join('');
}
