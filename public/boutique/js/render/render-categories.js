/**
 * @module render-categories
 * @brief Renderer unique du rail categories Komerce.
 * LOT images — les chips affichent de vraies images catégorie.
 */

import { sanitize } from '../b-utils.js';
import { getRailCategories } from '../shop-schema.js';

function renderChipPhoto(category) {
  // Priorité : image réelle > SVG > emoji texte
  if (category.image) {
    return `<span class="k-chip-photo"><img src="${sanitize(category.image)}" alt="${sanitize(category.label)}" loading="lazy" width="80" height="80"></span>`;
  }
  const badge = category.railBadge || {};
  if (badge.kind === 'svg') {
    return `<span class="k-chip-photo">${badge.svg || ''}</span>`;
  }
  if (badge.kind === 'text') {
    return `<span class="k-chip-photo"><span>${sanitize(badge.text || category.shortLabel || category.label)}</span></span>`;
  }
  return `<span class="k-chip-photo"><span>${sanitize(category.sectionEmoji || category.shortLabel || category.label)}</span></span>`;
}

export function renderCategoryRailMarkup(activeCategoryKey) {
  return getRailCategories().map((category) => `
    <button class="k-chip${category.key === activeCategoryKey ? ' active' : ''}" data-cat="${sanitize(category.key)}">
      ${renderChipPhoto(category)}
      <span class="k-chip-label">${sanitize(category.shortLabel || category.label)}</span>
    </button>
  `).join('');
}
