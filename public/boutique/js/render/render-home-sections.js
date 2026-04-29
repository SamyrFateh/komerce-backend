/**
 * @module render-home-sections
 * @brief Renderer unique des sections home Komerce.
 */

import { getCategorySectionEmoji, getSectionOrder } from '../shop-schema.js';
import { getPromoProducts, partitionProductsByCategory } from '../product-store.js';
import { sanitize } from '../b-utils.js';

export function renderHomeSections({
  items,
  allProducts,
  isMobile,
  renderCard,
  normalizeCategory,
  shuffle,
}) {
  const order = getSectionOrder();
  const byCategory = partitionProductsByCategory(items);
  const totalByCategory = {};

  for (const product of allProducts) {
    const category = normalizeCategory(product.category) || 'Autres';
    totalByCategory[category] = (totalByCategory[category] || 0) + 1;
  }

  const parts = [];

  if (isMobile) {
    const allShuffled = shuffle(items.slice()).slice(0, 40);
    parts.push('<div class="k-cat-section" data-cat="all">');
    parts.push(
      '<div class="k-sec-header" data-cat="all">' +
      '<span class="k-sec-header-emoji">🔥</span>' +
      '<span class="k-sec-header-name">Tout</span>' +
      '<span class="k-sec-header-count">' + items.length + '</span>' +
      '</div>'
    );
    parts.push('<div class="k-sec-grid">');
    for (const product of allShuffled) parts.push(renderCard(product));
    parts.push('</div></div>');

    const soldes = shuffle(getPromoProducts().slice()).slice(0, 30);
    if (soldes.length > 0) {
      parts.push('<div class="k-cat-section" data-cat="Soldes">');
      parts.push(
        '<div class="k-sec-header" data-cat="Soldes">' +
        '<span class="k-sec-header-emoji">🏷️</span>' +
        '<span class="k-sec-header-name">Soldes</span>' +
        '<span class="k-sec-header-count">' + soldes.length + '</span>' +
        '</div>'
      );
      parts.push('<div class="k-sec-grid">');
      for (const product of soldes) parts.push(renderCard(product));
      parts.push('</div></div>');
    }

    for (const category of order) {
      const products = byCategory[category];
      if (!products || products.length === 0) continue;
      const emoji = getCategorySectionEmoji(category);
      const total = totalByCategory[category] || products.length;
      parts.push('<div class="k-cat-section" data-cat="' + sanitize(category) + '">');
      parts.push(
        '<div class="k-sec-header" data-cat="' + sanitize(category) + '">' +
        '<span class="k-sec-header-emoji">' + emoji + '</span>' +
        '<span class="k-sec-header-name">' + sanitize(category) + '</span>' +
        '<span class="k-sec-header-count">' + total + '</span>' +
        '<button class="k-sec-see-all" data-see-cat="' + sanitize(category) + '">Voir tout →</button>' +
        '</div>'
      );
      parts.push('<div class="k-sec-grid">');
      for (const product of products) parts.push(renderCard(product));
      parts.push('</div></div>');
    }

    return parts.join('');
  }

  const desktopOrder = [];
  for (const category of order) {
    if (byCategory[category]) desktopOrder.push(category);
  }
  for (const categoryKey in byCategory) {
    if (!desktopOrder.includes(categoryKey)) desktopOrder.push(categoryKey);
  }

  for (const category of desktopOrder) {
    const products = byCategory[category];
    const emoji = getCategorySectionEmoji(category);
    const total = totalByCategory[category] || products.length;
    const anchorId = 'k-sec-' + category.replace(/[^a-zA-Z0-9]/g, '-');
    parts.push('<div class="k-cat-section" data-cat="' + sanitize(category) + '">');
    parts.push(
      '<div class="k-sec-header" id="' + anchorId + '" data-cat="' + sanitize(category) + '">' +
      '<span class="k-sec-header-emoji">' + emoji + '</span>' +
      '<span class="k-sec-header-name">' + sanitize(category) + '</span>' +
      '<span class="k-sec-header-count">' + total + '</span>' +
      '<button class="k-sec-see-all" data-see-cat="' + sanitize(category) + '">Voir tout →</button>' +
      '</div>'
    );
    parts.push('<div class="k-sec-grid">');
    for (const product of products) parts.push(renderCard(product));
    parts.push('</div></div>');
  }

  return parts.join('');
}
