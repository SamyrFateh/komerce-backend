/**
 * @module render-home-sections
 * @brief Renderer unique des sections home Komerce.
 *
 * Refactorisé v2 :
 *   - Soldes intégré via getSectionOrder() (showInSections: true dans shop-schema)
 *   - Plus de bloc Soldes en dur — unifié avec les autres catégories
 *   - Soldes filtré via getPromoProducts() dans partitionProductsByCategory
 */

import { getCategorySectionEmoji, getSectionOrder } from '../shop-schema.js';
import { getPromoProducts, partitionProductsByCategory } from '../product-store.js';
import { sanitize } from '../b-utils.js';

/**
 * Partitionne les items en ajoutant Soldes comme catégorie virtuelle.
 * @param {Array} items - Produits à partitionner
 * @param {Function} normalizeCategory - Fonction de normalisation des catégories
 * @returns {Object} Map catégorie → produits
 */
function _partitionWithSoldes(items, normalizeCategory) {
  const byCategory = {};

  // Soldes en premier (filtre promo_pct)
  const soldes = getPromoProducts();
  if (soldes.length > 0) byCategory['Soldes'] = soldes;

  // Autres catégories
  for (const product of items) {
    const cat = normalizeCategory(product.category) || 'Autres';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(product);
  }
  return byCategory;
}

export function renderHomeSections({
  items,
  allProducts,
  isMobile,
  renderCard,
  normalizeCategory,
  shuffle,
}) {
  const order = getSectionOrder(); // inclut maintenant Soldes en position 1
  const parts = [];

  if (isMobile) {
    // Partitionner UNE FOIS avant la boucle (pas à chaque itération)
    const byCategoryMobile = partitionProductsByCategory(items);

    // ── PAGE "TOUT" — mélange aléatoire, toujours en premier ──
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

    // ── PAGES PAR CATÉGORIE (dont Soldes) — ordre défini par shop-schema ──
    for (const category of order) {
      let products;

      if (category === 'Soldes') {
        // Soldes : filtre par promo_pct, mélangé
        products = shuffle(getPromoProducts().slice()).slice(0, 30);
      } else {
        // Autres catégories : depuis la partition calculée une fois
        products = byCategoryMobile[category];
      }

      if (!products || products.length === 0) continue;

      const emoji = getCategorySectionEmoji(category);
      parts.push('<div class="k-cat-section" data-cat="' + sanitize(category) + '">');
      parts.push(
        '<div class="k-sec-header" data-cat="' + sanitize(category) + '">' +
        '<span class="k-sec-header-emoji">' + emoji + '</span>' +
        '<span class="k-sec-header-name">' + sanitize(category) + '</span>' +
        '<span class="k-sec-header-count">' + products.length + '</span>' +
        '</div>'
      );
      parts.push('<div class="k-sec-grid">');
      for (const product of products) parts.push(renderCard(product));
      parts.push('</div></div>');
    }

    return parts.join('');
  }

  // ── DESKTOP — sections empilées verticalement ──
  const byCategory = partitionProductsByCategory(items);
  const totalByCategory = {};
  for (const product of allProducts) {
    const cat = normalizeCategory(product.category) || 'Autres';
    totalByCategory[cat] = (totalByCategory[cat] || 0) + 1;
  }

  // Ordre desktop : catégories avec produits dans l'ordre schema (Soldes inclus)
  const desktopOrder = order.filter(cat => byCategory[cat] || cat === 'Soldes');
  // Ajouter les catégories non listées en schema (Autres, etc.)
  for (const cat in byCategory) {
    if (!desktopOrder.includes(cat)) desktopOrder.push(cat);
  }

  for (const category of desktopOrder) {
    const products = category === 'Soldes'
      ? getPromoProducts().slice(0, 20)
      : byCategory[category];
    if (!products || products.length === 0) continue;
    const emoji = getCategorySectionEmoji(category);
    const total = category === 'Soldes' ? products.length : (totalByCategory[category] || products.length);
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
