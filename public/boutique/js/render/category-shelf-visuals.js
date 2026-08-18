/**
 * @komerce-arch-lite
 * @role          category-shelf-visual-registry
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/render/render-categories.js
 * @purpose       Registre de présentation unique des objets visuels de la navigation Komerce Shelf.
 * @impact-areas  category-navigation, subcategory-navigation
 * @version       2026-08
 */
'use strict';

export const KOMERCE_SHELF_SPRITE = '/boutique/categories/komerce-shelf-sprite.svg';

const CATEGORY_VISUALS = {
  all: 'cat-all',
  Soldes: 'cat-soldes',
  'Mode & Beauté': '/boutique/categories/mode-v3.webp',
  Maison: 'cat-maison',
  Tech: 'cat-tech',
  Bricolage: 'cat-bricolage',
  'Créations personnelles': 'cat-perso',
  Auto: 'cat-auto',
};

const SUBCATEGORY_VISUALS = {
  'Mode & Beauté': {
    Femme: '/boutique/categories/sub/mode-femme.webp',
    Homme: '/boutique/categories/sub/mode-homme.webp',
    Enfant: '/boutique/categories/sub/mode-enfant.webp',
    Beauté: '/boutique/categories/sub/mode-beaute.webp',
  },
  Maison: {
    Confort: 'sub-maison-confort',
    Cuisine: 'sub-maison-cuisine',
    Déco: 'sub-maison-deco',
    Enfants: 'sub-maison-enfants',
  },
  Tech: {
    Phones: 'sub-tech-phone',
    Ordi: 'sub-tech-ordi',
    Audio: 'sub-tech-audio',
    Montres: 'sub-tech-montre',
    Gaming: 'sub-tech-gaming',
  },
  Bricolage: {
    Outillage: 'sub-brico-outils',
    Electricité: 'sub-brico-elec',
    Sécurité: 'sub-brico-securite',
  },
  'Créations personnelles': {
    Cérémonie: 'sub-perso-ceremonie',
    Cadeau: 'sub-perso-cadeau',
    Impression: 'sub-perso-impression',
  },
  Auto: {
    Filtres: 'sub-auto-filtres',
    Freinage: 'sub-auto-freinage',
    Éclairage: 'sub-auto-eclairage',
    Moto: 'sub-auto-moto',
  },
};

function isImageVisual(visual) {
  return typeof visual === 'string' && /\.(?:avif|webp|png|jpe?g)(?:\?|$)/i.test(visual);
}

export function getShelfCategoryVisual(categoryKey) {
  return CATEGORY_VISUALS[categoryKey] || null;
}

export function getShelfSubcategoryVisual(categoryKey, subcategoryKey) {
  return SUBCATEGORY_VISUALS[categoryKey]?.[subcategoryKey] || null;
}

export function renderShelfUse(visual, extraClass = '') {
  if (!visual) return '';
  const cls = extraClass ? ` ${extraClass}` : '';

  if (isImageVisual(visual)) {
    return `<img class="k-shelf-object${cls} k-shelf-object--image" src="${visual}" alt="" aria-hidden="true" loading="lazy" decoding="async" width="176" height="160" onerror="this.remove();">`;
  }

  return `<svg class="k-shelf-object${cls}" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><use href="${KOMERCE_SHELF_SPRITE}#${visual}"></use></svg>`;
}
