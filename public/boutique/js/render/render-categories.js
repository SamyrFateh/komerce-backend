/**
 * @component Boutique / Category Rail Renderer
 * @owner render-categories.js
 *
 * Responsibility:
 * - Render the HTML markup for category chips only.
 * - Use shop-schema.js as the only category data source.
 * - Provide resilient image fallback markup for category chips.
 * - Render desktop universe chips from the navigation v2 schema.
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
 *
 * See:
 * - docs/BOUTIQUE_COMPONENT_OWNERSHIP.md
 * - docs/BOUTIQUE_CATEGORY_NAVIGATION_REDESIGN.md
 */

import { sanitize } from '../b-utils.js';
import { getRailCategories, getDesktopUniverseCategories } from '../shop-schema.js';

function fallbackBadge(category) {
  const badge = category.railBadge || {};
  if (badge.kind === 'svg') return badge.svg || '';
  if (badge.kind === 'text') return `<span>${sanitize(badge.text || category.shortLabel || category.label)}</span>`;
  return `<span>${sanitize(category.sectionEmoji || category.shortLabel || category.label)}</span>`;
}

function renderChipPhoto(category) {
  // Priorité : image réelle > SVG > texte court. Si l'image échoue, on révèle le fallback.
  if (category.image) {
    return `<span class="k-chip-photo k-chip-photo--img">
      <img src="${sanitize(category.image)}" alt="${sanitize(category.label)}" loading="lazy" width="80" height="80" onerror="this.closest('.k-chip-photo').classList.add('is-img-error');this.remove();">
      <span class="k-chip-fallback" aria-hidden="true">${fallbackBadge(category)}</span>
    </span>`;
  }
  return `<span class="k-chip-photo">${fallbackBadge(category)}</span>`;
}

export function renderCategoryRailMarkup(activeCategoryKey) {
  return getRailCategories().map((category) => `
    <button class="k-chip${category.key === activeCategoryKey ? ' active' : ''}" data-cat="${sanitize(category.key)}" aria-label="${sanitize(category.label)}">
      ${renderChipPhoto(category)}
      <span class="k-chip-label">${sanitize(category.shortLabel || category.label)}</span>
    </button>
  `).join('');
}

export function renderDesktopUniverseRailMarkup(activeCategoryKey) {
  return getDesktopUniverseCategories().map((category) => `
    <button class="k-desktop-universe${category.key === activeCategoryKey ? ' is-active' : ''}" data-cat="${sanitize(category.key)}" aria-label="${sanitize(category.label)}">
      <span class="k-desktop-universe-icon">${fallbackBadge(category)}</span>
      <span class="k-desktop-universe-label">${sanitize(category.shortLabel || category.label)}</span>
    </button>
  `).join('');
}
