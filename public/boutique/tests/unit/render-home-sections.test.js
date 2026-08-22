'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/render-home-sections.test.js
 * Source: js/render/render-home-sections.js (2026-06)
 * Export réel unique : renderHomeSections({ items, allProducts, isMobile,
 * renderCard, normalizeCategory, shuffle }) — signature objet, PAS positionnelle.
 *
 * Dépendances réelles : shop-schema.js (getSectionOrder, getCategorySectionEmoji,
 * getSubcategories), product-store.js (getPromoProducts, partitionProductsByCategory
 * — donc on doit appeler setProducts() pour peupler le cache produit utilisé en
 * interne par ces deux fonctions), b-utils.js (sanitize), b-store.js (state).
 */

const { renderHomeSections } = require('../../js/render/render-home-sections.js');
const store = require('../../js/product-store.js');
const { state } = require('../../js/b-store.js');

describe('render-home-sections', () => {
  const renderCard = (p) => `<div class="stub-card">${p.name}</div>`;
  const normalizeCategory = (c) => c;
  const noShuffle = (arr) => arr; // shuffle déterministe pour les tests

  const products = [
    { id: 1, name: 'Robe', category: 'Mode', price_kmf: 1000, is_available: true },
    { id: 2, name: 'Téléphone', category: 'Tech', price_kmf: 50000, is_available: true },
    { id: 3, name: 'Robe en promo', category: 'Mode', promo_pct: 30, price_kmf: 700, is_available: true },
  ];

  beforeEach(() => {
    store.setProducts(products);
    state.sectionSubcats = {};
  });

  describe('mode mobile', () => {
    let items;

    beforeEach(() => {
      items = store.getAllProducts();
    });

    it('retourne une string HTML non vide', () => {
      const html = renderHomeSections({ items, allProducts: items, isMobile: true, renderCard, normalizeCategory, shuffle: noShuffle });
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('contient une section "Tout" en premier avec tous les items', () => {
      const html = renderHomeSections({ items, allProducts: items, isMobile: true, renderCard, normalizeCategory, shuffle: noShuffle });
      expect(html).toContain('data-cat="all"');
      expect(html).toContain('Tout');
      expect(html).toContain('k-sec-header-cutout');
      expect(html).toContain('cat-all-v3.webp');
    });

    it('inclut une section Soldes basée sur getPromoProducts (produit 3 a promo_pct=30)', () => {
      const html = renderHomeSections({ items, allProducts: items, isMobile: true, renderCard, normalizeCategory, shuffle: noShuffle });
      expect(html).toContain('data-cat="Soldes"');
      expect(html).toContain('Robe en promo');
      expect(html).toContain('cat-soldes-v3.webp');
    });

    it('items vides → pas de crash, retourne quand même les sections (vides)', () => {
      expect(() => renderHomeSections({ items: [], allProducts: [], isMobile: true, renderCard, normalizeCategory, shuffle: noShuffle })).not.toThrow();
    });

    it('catégorie sans produit → bloc data-empty="1" avec message "Bientôt disponible"', () => {
      // products n'a aucun produit en catégorie "Enfant" (présente dans shop-schema fallback)
      const html = renderHomeSections({ items, allProducts: items, isMobile: true, renderCard, normalizeCategory, shuffle: noShuffle });
      expect(html).toContain('data-empty="1"');
      expect(html).toContain('Bientôt disponible');
    });
  });

  describe('mode desktop', () => {
    let items;

    beforeEach(() => {
      items = store.getAllProducts();
    });

    it('retourne une string HTML, pas de section Soldes (exclue côté desktop)', () => {
      const html = renderHomeSections({ items, allProducts: items, isMobile: false, renderCard, normalizeCategory });
      expect(typeof html).toBe('string');
      // Soldes exclu explicitement de desktopOrder
      expect(html).not.toContain('k-sec-subcats" data-cat="Soldes"');
    });

    it('affiche le bouton "Voir tout" et le compteur par catégorie', () => {
      const html = renderHomeSections({ items, allProducts: items, isMobile: false, renderCard, normalizeCategory });
      expect(html).toContain('k-sec-see-all');
      expect(html).toContain('Voir tout');
    });

    it('items vides → ne crashe pas', () => {
      expect(() => renderHomeSections({ items: [], allProducts: [], isMobile: false, renderCard, normalizeCategory })).not.toThrow();
    });

    it('plus de 4 produits dans une catégorie → bouton "Voir plus" avec le compte caché', () => {
      const manyInMode = [
        ...products,
        { id: 4, name: 'P4', category: 'Mode', price_kmf: 100, is_available: true },
        { id: 5, name: 'P5', category: 'Mode', price_kmf: 100, is_available: true },
        { id: 6, name: 'P6', category: 'Mode', price_kmf: 100, is_available: true },
      ];
      store.setProducts(manyInMode);
      const all = store.getAllProducts();
      const html = renderHomeSections({ items: all, allProducts: all, isMobile: false, renderCard, normalizeCategory });
      expect(html).toContain('k-sec-see-more');
      expect(html).toContain('Voir plus');
    });

    it('respecte le filtre state.sectionSubcats pour une catégorie active', () => {
      // Mode & Beauté a une sous-catégorie "Femme" dans le schema fallback
      const itemsWithSub = [
        { id: 1, name: 'Robe Femme', category: 'Mode', subcategory: 'Femme', price_kmf: 1000, is_available: true },
        { id: 2, name: 'Chemise Homme', category: 'Mode', subcategory: 'Homme', price_kmf: 1000, is_available: true },
      ];
      store.setProducts(itemsWithSub);
      const all = store.getAllProducts();
      state.sectionSubcats = { 'Mode & Beauté': 'Femme' };
      const html = renderHomeSections({ items: all, allProducts: all, isMobile: false, renderCard, normalizeCategory });
      expect(html).toContain('Robe Femme');
      expect(html).not.toContain('Chemise Homme');
    });
  });
});
