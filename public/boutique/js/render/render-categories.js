/**
 * @module render-categories
 * @brief Renderer unique du rail categories Komerce.
 */

import { sanitize } from '../b-utils.js';
import { getRailCategories } from '../shop-schema.js';

function renderChipPhoto(category) {
  const badge = category.railBadge || {};
  if (badge.kind === 'text') {
    return `<span class="k-chip-photo"><span>${sanitize(badge.text || category.shortLabel || category.label)}</span></span>`;
  }
  return `<span class="k-chip-photo">${badge.svg || ''}</span>`;
}

export function renderCategoryRailMarkup(activeCategoryKey) {
  return getRailCategories().map((category) => `
    <button class="k-chip${category.key === activeCategoryKey ? ' active' : ''}" data-cat="${sanitize(category.key)}">
      ${renderChipPhoto(category)}
      <span class="k-chip-label">${sanitize(category.shortLabel || category.label)}</span>
    </button>
  `).join('');
}
