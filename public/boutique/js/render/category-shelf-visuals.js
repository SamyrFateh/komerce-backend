/**
 * @komerce-arch-lite
 * @role          category-shelf-visual-registry
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/render/render-categories.js
 * @purpose       Registre de présentation unique des objets visuels de la navigation Komerce Shelf.
 * @impact-areas  category-navigation, subcategory-navigation
 * @version       2026-09
 */
'use strict';

import { matchesSubcategory, normalizeCategoryKey } from '../shop-schema.js';

export const KOMERCE_SHELF_SPRITE = '/boutique/categories/komerce-shelf-sprite.svg';
export const KOMERCE_SHOWCASE_V1_MODE = '/boutique/categories/komerce-showcase-v1-mode.webp?v=3';

export const KOMERCE_CATEGORY_CUTOUTS = Object.freeze({
  all: '/boutique/categories/cat-all-v3.webp?v=1',
  soldes: '/boutique/categories/cat-soldes-v3.webp?v=1',
  mode: '/boutique/categories/cat-mode-v3.webp?v=1',
  maison: '/boutique/categories/cat-maison-v3.webp?v=1',
  tech: '/boutique/categories/cat-tech-v3.webp?v=1',
  bricolage: '/boutique/categories/cat-bricolage-v3.webp?v=1',
  perso: '/boutique/categories/cat-perso-v3.webp?v=1',
  auto: '/boutique/categories/cat-auto-v3.webp?v=1',
});

export const KOMERCE_MODE_SUBCATEGORY_CUTOUTS = Object.freeze({
  femme: '/boutique/categories/sub-mode-femme-v4.svg?v=1',
  homme: '/boutique/categories/sub-mode-homme-v4.svg?v=1',
  enfant: '/boutique/categories/sub-mode-enfant-v4.svg?v=1',
  beaute: '/boutique/categories/sub-mode-beaute-v4.svg?v=1',
});

const CATEGORY_VISUALS = {
  all: 'cutout:all',
  Soldes: 'cutout:soldes',
  'Mode & Beauté': 'cutout:mode',
  Maison: 'cutout:maison',
  Tech: 'cutout:tech',
  Bricolage: 'cutout:bricolage',
  'Créations personnelles': 'cutout:perso',
  Auto: 'cutout:auto',
};

const SUBCATEGORY_VISUALS = {
  'Mode & Beauté': {
    __all: 'showcase-mode:0:0',
    Femme: 'mode-cutout:femme',
    Homme: 'mode-cutout:homme',
    Enfant: 'mode-cutout:enfant',
    Beauté: 'mode-cutout:beaute',
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

const SHOWCASE_ATLASES = {
  'showcase-mode': KOMERCE_SHOWCASE_V1_MODE,
};

/**
 * Rend la cellule neutre « Tout voir » de l'atlas historique. Les sous-catégories
 * Mode exposées utilisent désormais chacune leur propre cutout direct.
 */
function renderAtlasCell(visual, extraClass = '') {
  const match = /^(showcase-mode):(\d):(\d)$/.exec(visual);
  if (!match) return '';
  const [, family, colRaw, rowRaw] = match;
  const src = SHOWCASE_ATLASES[family];
  const col = Number(colRaw);
  const row = Number(rowRaw);
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<span class="k-shelf-object${cls} k-shelf-object--image k-shelf-atlas-cell" data-atlas-family="${family}" data-atlas-col="${col}" data-atlas-row="${row}" aria-hidden="true"><img class="k-shelf-atlas-image" src="${src}" alt="" loading="eager" decoding="async"></span>`;
}

function renderCategoryCutout(visual, extraClass = '') {
  const key = visual.slice('cutout:'.length);
  const src = KOMERCE_CATEGORY_CUTOUTS[key];
  if (!src) return '';
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<img class="k-shelf-object${cls} k-shelf-cutout-image" src="${src}" alt="" aria-hidden="true" loading="eager" decoding="async" width="512" height="512">`;
}

function renderModeSubcategoryCutout(visual, extraClass = '') {
  const key = visual.slice('mode-cutout:'.length);
  const src = KOMERCE_MODE_SUBCATEGORY_CUTOUTS[key];
  if (!src) return '';
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<img class="k-shelf-object${cls} k-shelf-cutout-image k-mode-subcategory-cutout" src="${src}" alt="" aria-hidden="true" loading="eager" decoding="async" width="512" height="512">`;
}

function normalizeProductImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  if (url.startsWith('/') || /^https?:\/\//i.test(url)) return url;
  return null;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Picks one deterministic REAL catalog image for a subcategory.
 * The catalog remains the media source of truth: no parallel subcategory asset catalog.
 * Stable ordering prevents the navigation image from changing with ranking/shuffle order.
 */
export function getShelfSubcategoryProductImage(products, categoryKey, subcategoryKey) {
  if (!Array.isArray(products) || !products.length || !subcategoryKey) return null;
  const canonicalCategory = normalizeCategoryKey(categoryKey);
  const candidates = products
    .filter((product) => {
      if (!product || !normalizeProductImageUrl(product.image_url)) return false;
      if (normalizeCategoryKey(product.category) !== canonicalCategory) return false;
      return matchesSubcategory(categoryKey, subcategoryKey, product.subcategory);
    })
    .sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aKey = String(a.product_ref || a.id || a.name || '');
      const bKey = String(b.product_ref || b.id || b.name || '');
      return aKey.localeCompare(bKey, 'fr');
    });
  if (candidates.length) return normalizeProductImageUrl(candidates[0].image_url);

  const categoryCandidates = products
    .filter((product) => product
      && normalizeProductImageUrl(product.image_url)
      && normalizeCategoryKey(product.category) === canonicalCategory)
    .sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aKey = String(a.product_ref || a.id || a.name || '');
      const bKey = String(b.product_ref || b.id || b.name || '');
      return aKey.localeCompare(bKey, 'fr');
    });
  return categoryCandidates.length ? normalizeProductImageUrl(categoryCandidates[0].image_url) : null;
}

export function renderShelfProductPhoto(src, extraClass = '') {
  const safeSrc = normalizeProductImageUrl(src);
  if (!safeSrc) return '';
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<img class="k-shelf-object${cls} k-shelf-product-photo" src="${escapeAttribute(safeSrc)}" alt="" aria-hidden="true" loading="eager" decoding="async">`;
}

export function getShelfCategoryVisual(categoryKey) {
  return CATEGORY_VISUALS[categoryKey] || null;
}

export function getShelfSubcategoryVisual(categoryKey, subcategoryKey) {
  return SUBCATEGORY_VISUALS[categoryKey]?.[subcategoryKey] || null;
}

export function renderShelfUse(visual, extraClass = '') {
  if (!visual) return '';
  if (visual.startsWith('cutout:')) {
    return renderCategoryCutout(visual, extraClass);
  }
  if (visual.startsWith('mode-cutout:')) {
    return renderModeSubcategoryCutout(visual, extraClass);
  }
  if (visual.startsWith('showcase-mode:')) {
    return renderAtlasCell(visual, extraClass);
  }

  const cls = extraClass ? ` ${extraClass}` : '';
  return `<svg class="k-shelf-object${cls}" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><use href="${KOMERCE_SHELF_SPRITE}#${visual}"></use></svg>`;
}
