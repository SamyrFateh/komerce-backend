/**
 * @module render-categories
 * @brief Renderer unique du rail categories Komerce.
 * LOT images — les chips affichent de vraies images catégorie.
 */

import { sanitize } from '../b-utils.js';
import { getRailCategories } from '../shop-schema.js';

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
