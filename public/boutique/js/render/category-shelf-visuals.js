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
export const KOMERCE_MODE_PILOT_ATLAS = '/boutique/categories/mode-pilot-atlas.webp';

const CATEGORY_VISUALS = {
  all: 'cat-all',
  Soldes: 'cat-soldes',
  'Mode & Beauté': 'atlas:0:0',
  Maison: 'cat-maison',
  Tech: 'cat-tech',
  Bricolage: 'cat-bricolage',
  'Créations personnelles': 'cat-perso',
  Auto: 'cat-auto',
};

const SUBCATEGORY_VISUALS = {
  'Mode & Beauté': {
    __all: 'atlas:2:1',
    Femme: 'atlas:1:0',
    Homme: 'atlas:2:0',
    Enfant: 'atlas:0:1',
    Beauté: 'atlas:1:1',
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

function renderAtlasCell(visual, extraClass = '') {
  const match = /^atlas:(\d):(\d)$/.exec(visual);
  if (!match) return '';
  const col = Number(match[1]);
  const row = Number(match[2]);
  const cls = extraClass ? ` ${extraClass}` : '';
  const x = -(col * 256);
  const y = -(row * 256);
  return `<svg class="k-shelf-object${cls} k-shelf-object--image" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><image href="${KOMERCE_MODE_PILOT_ATLAS}" x="${x}" y="${y}" width="768" height="512" preserveAspectRatio="none"></image></svg>`;
}

export function getShelfCategoryVisual(categoryKey) {
  return CATEGORY_VISUALS[categoryKey] || null;
}

export function getShelfSubcategoryVisual(categoryKey, subcategoryKey) {
  return SUBCATEGORY_VISUALS[categoryKey]?.[subcategoryKey] || null;
}

export function renderShelfUse(visual, extraClass = '') {
  if (!visual) return '';
  if (visual.startsWith('atlas:')) return renderAtlasCell(visual, extraClass);

  const cls = extraClass ? ` ${extraClass}` : '';
  return `<svg class="k-shelf-object${cls}" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><use href="${KOMERCE_SHELF_SPRITE}#${visual}"></use></svg>`;
}
