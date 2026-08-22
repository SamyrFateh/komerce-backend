/**
 * @komerce-arch
 * @role          home-sections-renderer
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   medium
 * @inputs        product_sections, category_order, render_card_callback
 * @outputs       home_section_html, category_blocks, see_all_actions
 * @depends       shop-schema.js, render/render-product-card.js
 * @used-by       b-catalog.js
 * @doctrine      boutique_canal_decouverte, rendu_sans_logique_metier, taxonomy_source_unique
 * @impact-areas  home, catalog, product-grid, category-navigation
 * @version       2026-06
 */
'use strict';

/**
 * @module render-home-sections
 * @brief Renderer unique des sections home Komerce.
 *
 * Refactorisé v2 :
 *   - Soldes intégré via getSectionOrder() (showInSections: true dans shop-schema)
 *   - Plus de bloc Soldes en dur — unifié avec les autres catégories
 *   - Soldes filtré via getPromoProducts() dans partitionProductsByCategory
 */

import { getCategorySectionEmoji, getSectionOrder, getSubcategories, matchesSubcategory } from '../shop-schema.js';
import { getPromoProducts, partitionProductsByCategory } from '../product-store.js';
import { sanitize } from '../b-utils.js';
import { state } from '../b-store.js';
import { getShelfCategoryVisual, renderShelfUse } from './category-shelf-visuals.js';

function renderSectionVisual(category, fallbackEmoji = '') {
  const visual = getShelfCategoryVisual(category);
  if (!visual) {
    return '<span class="k-sec-header-emoji">' + sanitize(fallbackEmoji) + '</span>';
  }
  return '<span class="k-sec-header-cutout" aria-hidden="true">' +
    renderShelfUse(visual, 'k-shelf-object--section') +
    '</span>';
}

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
      renderSectionVisual('all', '🔥') +
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

      const isEmpty = !products || products.length === 0;
      const emoji = getCategorySectionEmoji(category);
      const emptyAttr = isEmpty ? ' data-empty="1"' : '';
      parts.push('<div class="k-cat-section" data-cat="' + sanitize(category) + '"' + emptyAttr + '>');
      parts.push(
        '<div class="k-sec-header" data-cat="' + sanitize(category) + '">' +
        renderSectionVisual(category, emoji) +
        '<span class="k-sec-header-name">' + sanitize(category) + '</span>' +
        (isEmpty ? '' : '<span class="k-sec-header-count">' + products.length + '</span>') +
        '</div>'
      );
      if (isEmpty) {
        parts.push('<div class="k-sec-empty"><span class="k-sec-empty-icon">📦</span><span class="k-sec-empty-msg">Bientôt disponible</span></div>');
      } else {
        parts.push('<div class="k-sec-grid">');
        for (const product of products) parts.push(renderCard(product));
        parts.push('</div>');
      }
      parts.push('</div>');
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

  // Ordre desktop : catégories avec produits dans l'ordre schema (Soldes exclu sur desktop)
  const desktopOrder = order.filter(cat => cat !== 'Soldes' && byCategory[cat]);
  // Ajouter les catégories non listées en schema (Autres, etc.)
  for (const cat in byCategory) {
    if (!desktopOrder.includes(cat)) desktopOrder.push(cat);
  }

  for (const category of desktopOrder) {
    let products = byCategory[category];
    if (!products || products.length === 0) continue;

    // ── Calcul des sous-catégories à afficher ─────────────────────
    // On ne garde que les subcats du schema qui ont au moins 1 produit dans
    // cette catégorie (évite chips orphelines vides). On utilise `products`
    // AVANT filtrage pour conserver toutes les chips quand une est active.
    const schemaSubs = getSubcategories(category) || [];
    const availableSubs = schemaSubs.filter(s =>
      products.some(p => matchesSubcategory(category, s.key, p.subcategory))
    );

    // Appliquer le filtre sectionSubcats si actif pour cette catégorie (desktop)
    const activeSub = state.sectionSubcats && state.sectionSubcats[category];
    if (activeSub) {
      products = products.filter(p => matchesSubcategory(category, activeSub, p.subcategory));
    }

    const emoji = getCategorySectionEmoji(category);
    const total = totalByCategory[category] || products.length;
    const anchorId = 'k-sec-' + category.replace(/[^a-zA-Z0-9]/g, '-');
    parts.push('<div class="k-cat-section" data-cat="' + sanitize(category) + '">');
    parts.push(
      '<div class="k-sec-header" id="' + anchorId + '" data-cat="' + sanitize(category) + '">' +
      renderSectionVisual(category, emoji) +
      '<span class="k-sec-header-name">' + sanitize(category) + '</span>' +
      '<span class="k-sec-header-count">' + total + '</span>' +
      '<button class="k-sec-see-all" data-see-cat="' + sanitize(category) + '">Voir tout →</button>' +
      '</div>'
    );

    // ── Rail subchips Temu-style (desktop uniquement, ≥2 subcats dispos) ──
    if (availableSubs.length >= 2) {
      const catAttr = sanitize(category);
      let railHtml = '<div class="k-sec-subcats" data-cat="' + catAttr + '">';
      // Chip "Tout" — toujours en premier, active si aucun filtre actif
      railHtml += '<button class="k-sec-subchip k-sec-subchip-all' + (activeSub ? '' : ' active') +
        '" type="button" data-sec-cat="' + catAttr + '" data-sec-sub-all="1">Tout</button>';
      for (const s of availableSubs) {
        const isActive = activeSub === s.key;
        railHtml += '<button class="k-sec-subchip' + (isActive ? ' active' : '') +
          '" type="button" data-sec-cat="' + catAttr + '" data-sec-sub="' + sanitize(s.key) + '">' +
          (s.icon ? '<span class="k-sec-subchip-icon">' + s.icon + '</span>' : '') +
          '<span class="k-sec-subchip-label">' + sanitize(s.label || s.key) + '</span>' +
          '</button>';
      }
      railHtml += '</div>';
      parts.push(railHtml);
    }

    const INITIAL_VISIBLE = 4;
    const visibleProducts = products.slice(0, INITIAL_VISIBLE);
    const hiddenProducts  = products.slice(INITIAL_VISIBLE);
    const hasMore         = hiddenProducts.length > 0;

    parts.push('<div class="k-sec-grid">');
    for (const product of visibleProducts) parts.push(renderCard(product));
    if (hasMore) {
      for (const product of hiddenProducts) {
        // Wrap chaque carte cachée dans un span invisible — retiré au clic "Voir plus"
        parts.push('<span class="k-sec-more-card" style="display:none;contents:none;">' + renderCard(product) + '</span>');
      }
    }
    parts.push('</div>');

    // Bouton "Voir plus" — affiché uniquement s'il reste des cartes cachées
    if (hasMore) {
      parts.push(
        '<div class="k-sec-see-more-wrap">' +
          '<button class="k-sec-see-more" type="button" data-see-more-cat="' + sanitize(category) + '">' +
            'Voir plus (' + hiddenProducts.length + ')' +
          '</button>' +
        '</div>'
      );
    }

    parts.push('</div>');
  }

  return parts.join('');
}
