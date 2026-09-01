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

/**
 * Source canonique des 23 sous-catégories métier.
 * Les fichiers sont des WebP transparents normalisés 512×512. La navigation ne
 * dépend donc plus du cadrage, du fond ou de la disponibilité réseau d'une photo
 * produit brute. Une photo catalogue réelle reste disponible comme secours.
 */
export const KOMERCE_SUBCATEGORY_CUTOUTS = Object.freeze({
  'mode-cutout:femme': '/boutique/categories/subcutouts/sub-mode-femme-v1.webp?v=1',
  'mode-cutout:homme': '/boutique/categories/subcutouts/sub-mode-homme-v1.webp?v=1',
  'mode-cutout:enfant': '/boutique/categories/subcutouts/sub-mode-enfant-v1.webp?v=1',
  'mode-cutout:beaute': '/boutique/categories/subcutouts/sub-mode-beaute-v1.webp?v=1',
  'sub-maison-confort': '/boutique/categories/subcutouts/sub-maison-confort-v1.webp?v=1',
  'sub-maison-cuisine': '/boutique/categories/subcutouts/sub-maison-cuisine-v1.webp?v=1',
  'sub-maison-deco': '/boutique/categories/subcutouts/sub-maison-deco-v1.webp?v=1',
  'sub-maison-enfants': '/boutique/categories/subcutouts/sub-maison-enfants-v1.webp?v=1',
  'sub-tech-phone': '/boutique/categories/subcutouts/sub-tech-phones-v1.webp?v=1',
  'sub-tech-ordi': '/boutique/categories/subcutouts/sub-tech-ordi-v1.webp?v=1',
  'sub-tech-audio': '/boutique/categories/subcutouts/sub-tech-audio-v1.webp?v=1',
  'sub-tech-montre': '/boutique/categories/subcutouts/sub-tech-montres-v1.webp?v=1',
  'sub-tech-gaming': '/boutique/categories/subcutouts/sub-tech-gaming-v1.webp?v=1',
  'sub-brico-outils': '/boutique/categories/subcutouts/sub-brico-outillage-v1.webp?v=1',
  'sub-brico-elec': '/boutique/categories/subcutouts/sub-brico-electricite-v1.webp?v=1',
  'sub-brico-securite': '/boutique/categories/subcutouts/sub-brico-securite-v1.webp?v=1',
  'sub-perso-ceremonie': '/boutique/categories/subcutouts/sub-perso-ceremonie-v1.webp?v=1',
  'sub-perso-cadeau': '/boutique/categories/subcutouts/sub-perso-cadeau-v1.webp?v=1',
  'sub-perso-impression': '/boutique/categories/subcutouts/sub-perso-impression-v1.webp?v=1',
  'sub-auto-filtres': '/boutique/categories/subcutouts/sub-auto-filtres-v1.webp?v=1',
  'sub-auto-freinage': '/boutique/categories/subcutouts/sub-auto-freinage-v1.webp?v=1',
  'sub-auto-eclairage': '/boutique/categories/subcutouts/sub-auto-eclairage-v1.webp?v=1',
  'sub-auto-moto': '/boutique/categories/subcutouts/sub-auto-moto-v1.webp?v=1',
});

// Compatibilité des consommateurs historiques Mode : une seule vérité de fichier.
export const KOMERCE_MODE_SUBCATEGORY_CUTOUTS = Object.freeze({
  femme: KOMERCE_SUBCATEGORY_CUTOUTS['mode-cutout:femme'],
  homme: KOMERCE_SUBCATEGORY_CUTOUTS['mode-cutout:homme'],
  enfant: KOMERCE_SUBCATEGORY_CUTOUTS['mode-cutout:enfant'],
  beaute: KOMERCE_SUBCATEGORY_CUTOUTS['mode-cutout:beaute'],
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

/** Rend la cellule neutre « Tout voir » de l'atlas historique. */
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

function renderSubcategoryCutout(visual, extraClass = '') {
  const src = KOMERCE_SUBCATEGORY_CUTOUTS[visual];
  if (!src) return '';
  const cls = extraClass ? ` ${extraClass}` : '';
  const modeClass = visual.startsWith('mode-cutout:') ? ' k-mode-subcategory-cutout' : '';
  return `<img class="k-shelf-object${cls} k-shelf-cutout-image k-subcategory-canonical-cutout${modeClass}" src="${src}" alt="" aria-hidden="true" loading="eager" decoding="async" width="512" height="512">`;
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

/** Choisit une image catalogue déterministe, utilisée uniquement comme secours. */
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

function missingMediaSvg() {
  return '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="7" y="9" width="34" height="30" rx="5"></rect><circle cx="18" cy="20" r="4"></circle><path d="M10 35l9-9 7 7 5-5 7 7"></path></svg>';
}

export function renderShelfMissingMedia(categoryKey, subcategoryKey, extraClass = '') {
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<span class="k-shelf-object${cls} k-shelf-media-placeholder" data-shelf-media="missing" data-shelf-category="${escapeAttribute(categoryKey || '')}" data-shelf-subcategory="${escapeAttribute(subcategoryKey || '')}" aria-hidden="true">${missingMediaSvg()}</span>`;
}

/**
 * Contrat média du niveau 2 : cutout canonique → photo produit de secours →
 * placeholder neutre. Le navigateur ne doit jamais exposer une image cassée.
 */
export function renderShelfSubcategoryMedia(products, categoryKey, subcategoryKey, extraClass = '') {
  const visual = getShelfSubcategoryVisual(categoryKey, subcategoryKey);
  const canonicalSrc = visual ? KOMERCE_SUBCATEGORY_CUTOUTS[visual] : null;
  const fallbackSrc = getShelfSubcategoryProductImage(products, categoryKey, subcategoryKey);
  const cls = extraClass ? ` ${extraClass}` : '';
  const categoryAttr = escapeAttribute(categoryKey || '');
  const subcategoryAttr = escapeAttribute(subcategoryKey || '');

  if (canonicalSrc) {
    const fallbackAttr = fallbackSrc ? ` data-shelf-fallback-src="${escapeAttribute(fallbackSrc)}"` : '';
    const modeClass = visual.startsWith('mode-cutout:') ? ' k-mode-subcategory-cutout' : '';
    return `<img class="k-shelf-object${cls} k-shelf-cutout-image k-subcategory-canonical-cutout${modeClass}" src="${escapeAttribute(canonicalSrc)}"${fallbackAttr} data-shelf-media="canonical" data-shelf-category="${categoryAttr}" data-shelf-subcategory="${subcategoryAttr}" alt="" aria-hidden="true" loading="eager" decoding="async" width="512" height="512">`;
  }

  if (fallbackSrc) {
    return `<img class="k-shelf-object${cls} k-shelf-product-photo" src="${escapeAttribute(fallbackSrc)}" data-shelf-media="product-fallback" data-shelf-category="${categoryAttr}" data-shelf-subcategory="${subcategoryAttr}" alt="" aria-hidden="true" loading="eager" decoding="async">`;
  }

  return renderShelfMissingMedia(categoryKey, subcategoryKey, extraClass);
}

function mediaHolder(node) {
  return node?.closest?.('[data-subcat], [data-flat-sub]') || null;
}

function setMediaStatus(node, status) {
  const holder = mediaHolder(node);
  if (holder) holder.dataset.shelfImageStatus = status;
}

function replaceWithMissingMedia(img) {
  const categoryKey = img.dataset.shelfCategory || '';
  const subcategoryKey = img.dataset.shelfSubcategory || '';
  const placeholder = document.createElement('span');
  const preservedClasses = Array.from(img.classList)
    .filter((name) => !['k-shelf-cutout-image', 'k-subcategory-canonical-cutout', 'k-mode-subcategory-cutout', 'k-shelf-product-photo'].includes(name));
  placeholder.className = `${preservedClasses.join(' ')} k-shelf-media-placeholder`.trim();
  placeholder.dataset.shelfMedia = 'missing';
  placeholder.dataset.shelfCategory = categoryKey;
  placeholder.dataset.shelfSubcategory = subcategoryKey;
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.innerHTML = missingMediaSvg();
  const holder = mediaHolder(img);
  img.replaceWith(placeholder);
  if (holder) holder.dataset.shelfImageStatus = 'missing';
  console.warn('[boutique] missing subcategory media', categoryKey, subcategoryKey);
}

/** Active les fallbacks runtime et rend l'état média observable dans le DOM. */
export function bindShelfMediaFallbacks(root = document) {
  if (!root?.querySelectorAll) return;

  root.querySelectorAll('[data-shelf-media]').forEach((node) => {
    setMediaStatus(node, node.dataset.shelfMedia || 'missing');
  });

  root.querySelectorAll('img[data-shelf-media]').forEach((img) => {
    if (img.dataset.shelfFallbackBound === '1') return;
    img.dataset.shelfFallbackBound = '1';

    const onFailure = () => {
      const currentState = img.dataset.shelfMedia;
      const fallbackSrc = normalizeProductImageUrl(img.dataset.shelfFallbackSrc);
      const currentSrc = normalizeProductImageUrl(img.getAttribute('src'));

      if (currentState === 'canonical' && fallbackSrc && fallbackSrc !== currentSrc) {
        img.dataset.shelfMedia = 'product-fallback';
        delete img.dataset.shelfFallbackSrc;
        img.classList.remove('k-shelf-cutout-image', 'k-subcategory-canonical-cutout', 'k-mode-subcategory-cutout');
        img.classList.add('k-shelf-product-photo');
        setMediaStatus(img, 'product-fallback');
        img.src = fallbackSrc;
        return;
      }

      replaceWithMissingMedia(img);
    };

    img.addEventListener('error', onFailure);
    if (img.complete && img.naturalWidth === 0) onFailure();
  });
}

export function getShelfCategoryVisual(categoryKey) {
  return CATEGORY_VISUALS[categoryKey] || null;
}

export function getShelfSubcategoryVisual(categoryKey, subcategoryKey) {
  return SUBCATEGORY_VISUALS[categoryKey]?.[subcategoryKey] || null;
}

export function renderShelfUse(visual, extraClass = '') {
  if (!visual) return '';
  if (visual.startsWith('cutout:')) return renderCategoryCutout(visual, extraClass);
  if (KOMERCE_SUBCATEGORY_CUTOUTS[visual]) return renderSubcategoryCutout(visual, extraClass);
  if (visual.startsWith('showcase-mode:')) return renderAtlasCell(visual, extraClass);

  const cls = extraClass ? ` ${extraClass}` : '';
  return `<svg class="k-shelf-object${cls}" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><use href="${KOMERCE_SHELF_SPRITE}#${visual}"></use></svg>`;
}
