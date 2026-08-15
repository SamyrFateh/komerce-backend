/**
 * @komerce-arch
 * @role          boutique-taxonomy-schema
 * @domain        catalog
 * @layer         schema
 * @criticality   high
 * @inputs        category_keys, db_categories, subcategory_config
 * @outputs       normalized_categories, section_order, icons, subcategories
 * @depends       none
 * @used-by       b-catalog.js, b-subcat.js, b-cart.js, b-desktop-sidebar.js, renderers
 * @doctrine      taxonomy_source_unique, categories_sans_hardcode_metier, navigation_sans_friction
 * @impact-areas  catalog, category-navigation, product-grid, admin-category-config
 * @version       2026-06
 */
'use strict';

/**
 * @module shop-schema
 * @brief Source de vérité déclarative de la boutique Komerce.
 *
 * LOT 10 — DB-driven: les catégories et sous-catégories sont désormais
 * chargées depuis GET /api/categories (table boutique_categories +
 * boutique_subcategories). L'admin peut les modifier sans toucher au JS.
 *
 * NAV v2 — le schema expose aussi la distinction navigation :
 *   - universe : famille métier, ex. Mode, Maison, Tech ;
 *   - commercial_filter : filtre transversal, ex. Soldes / Promos ;
 *   - system : entrée technique, ex. Tout.
 *
 * Stratégie de chargement (DSC-A0) :
 *   - Par défaut : fetch GET /api/categories au boot (chemin DB).
 *   - Fallback opt-in explicite : window.KOMERCE_FORCE_FALLBACK_CATEGORIES === true
 *     (injection serveur, tests, ou urgence ops).
 *   - Dégradation gracieuse : si le fetch échoue → fallback.
 *   - Le fallback (_FALLBACK_CATEGORIES) est un sous-ensemble strict du seed 061
 *     (DSC-A1) ; il ne présente jamais une taxonomie divergente de la DB.
 *
 * Contrat d'invariants (DSC-A3) :
 *   §3.1 — desktop et mobile lisent réellement GET /api/categories par défaut.
 *   §3.2 — même en dégradé, jamais de taxonomie divergente du seed 061.
 *   §6.2 — aucune liste de catégories codée en dur hors de ce fichier.
 *
 * Tous les exports publics restent compatibles: getCategoryList(),
 * getSubcategories(), normalizeCategoryKey(), etc.
 *
 * See:
 * - docs/BOUTIQUE_CATEGORY_NAVIGATION_REDESIGN.md
 */

// ─── Fallback hardcodé — sous-ensemble strict du seed 061 (DSC-A1) ───────────
// Utilisé UNIQUEMENT si :
//   (a) GET /api/categories échoue (réseau, pré-migration), ou
//   (b) window.KOMERCE_FORCE_FALLBACK_CATEGORIES === true (opt-in explicite).
// Toutes les clés de ce fallback sont présentes dans le seed 061.
// Ne pas ajouter de catégorie ici sans l'ajouter d'abord dans la migration 061.

const NAV_TYPES = {
  SYSTEM: 'system',
  UNIVERSE: 'universe',
  COMMERCIAL_FILTER: 'commercial_filter',
};

const _ICON_SVGS = {
  Soldes:           '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  'Mode & Beauté':  '<svg viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
  Tech:             '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  Enfant:           '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="5"/><path d="M12 12v10M7 22h10"/></svg>',
  Maison:           '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  Sport:            '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M6.5 6.5 17.5 17.5M4 12h.01M20 12h.01M12 4v.01M12 20v.01"/></svg>',
  'Sur-mesure':     '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
};

// ─── _CATEGORY_IMAGES — source unique du rail image ─────────────────────────
// Une campagne visuelle se met à jour ici, sans dupliquer les chemins dans
// index.html. Tous les assets partagent le même format 640×348 et la même
// direction photo ; le renderer fournit le fallback si un fichier échoue.
const _CATEGORY_IMAGES = {
  all:                       '/boutique/categories/all-v2.webp',
  Soldes:                    '/boutique/categories/soldes-v2.webp',
  'Mode & Beauté':           '/boutique/categories/mode-v2.webp',
  Maison:                    '/boutique/categories/maison-v2.webp',
  Tech:                      '/boutique/categories/tech-v2.webp',
  Bricolage:                 '/boutique/categories/bricolage-v2.webp',
  'Créations personnelles':  '/boutique/categories/creations-v2.webp',
  Auto:                      '/boutique/categories/auto-v2.webp',
  Enfant:           '/boutique/categories/enfant.jpg',       // DSC-A2 : asset à créer
  Sport:            '/boutique/categories/sport.jpg',        // DSC-A2 : asset à créer
  'Sur-mesure':     '/boutique/categories/sur-mesure.jpg',   // DSC-A2 : asset à créer
};

// Les clés de navigation sont stables et lisibles, tandis que le catalogue
// historique contient encore plusieurs libellés métier. Ce pont reste ici,
// dans la source de vérité taxonomique, pour que toutes les surfaces filtrent
// les mêmes ensembles sans heuristique sur le nom des produits.
const _SUBCATEGORY_DB_KEY_ALIASES = {
  Tech: {
    Phones:  ['Phones', 'Téléphones'],
    Ordi:    ['Ordi', 'Ordinateurs', 'Tablettes'],
    Audio:   ['Audio', 'Accessoires'],
    Montres: ['Montres', 'Gadgets'],
    Gaming:  ['Gaming'],
  },
};

function _subcategoryDbKeys(categoryKey, subcategory) {
  const configured = Array.isArray(subcategory?.dbKeys) && subcategory.dbKeys.length
    ? subcategory.dbKeys
    : [subcategory?.key];
  const aliases = _SUBCATEGORY_DB_KEY_ALIASES[categoryKey]?.[subcategory?.key] || [];
  return [...new Set([...configured, ...aliases].filter(Boolean))];
}

// Fallback secours — aligné sur boutique_categories (vérification 2026-07-24).
// Source unique : la base. Ce fallback n'intervient qu'en cas de panne réseau.
// Catégories masquées en base (show_in_rail=false) : Enfant, Sport, Sur-mesure — absentes ici.
// Images manquantes en base (Bricolage, Auto) : fallback emoji via render-categories.js (onerror).
const _FALLBACK_CATEGORIES = [
  {
    key: 'all', label: 'Tout', shortLabel: 'Tout',
    type: NAV_TYPES.SYSTEM, sectionEmoji: '🔥', iconSvg: null,
    image: _CATEGORY_IMAGES.all, dbKeys: [], filterType: null, filter: null,
    displayOrder: 0, showInRail: true, showInSections: false, showInMobileRail: true,
    subcategories: [],
  },
  {
    key: 'Soldes', label: 'Soldes', shortLabel: 'Soldes',
    type: NAV_TYPES.COMMERCIAL_FILTER, sectionEmoji: '🏷️', iconSvg: _ICON_SVGS.Soldes,
    image: _CATEGORY_IMAGES.Soldes, dbKeys: [], filterType: 'promo', filter: { promo: true },
    displayOrder: 1, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [],
  },
  {
    key: 'Mode & Beauté', label: 'Mode & Beauté', shortLabel: 'Mode',
    type: NAV_TYPES.UNIVERSE, sectionEmoji: '👗', iconSvg: _ICON_SVGS['Mode & Beauté'],
    image: _CATEGORY_IMAGES['Mode & Beauté'], dbKeys: ['Mode', 'Beauté'], filterType: null, filter: null,
    displayOrder: 2, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [
      { key: 'Femme',  label: 'Femme',           shortLabel: 'Femme',  icon: '👗', dbKeys: ['Femme'] },
      { key: 'Homme',  label: 'Homme',           shortLabel: 'Homme',  icon: '👔', dbKeys: ['Homme'] },
      { key: 'Enfant', label: 'Enfant & Bébé',   shortLabel: 'Enfant', icon: '🍼', dbKeys: ['Enfant'] },
      { key: 'Beauté', label: 'Beauté & Bien-être', shortLabel: 'Beauté', icon: '💄', dbKeys: ['Beauté'] },
    ],
  },
  {
    key: 'Maison', label: 'Maison', shortLabel: 'Maison',
    type: NAV_TYPES.UNIVERSE, sectionEmoji: '🏠', iconSvg: _ICON_SVGS.Maison,
    image: _CATEGORY_IMAGES.Maison, dbKeys: ['Maison'], filterType: null, filter: null,
    displayOrder: 3, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [
      { key: 'Confort',  label: 'Confort & Énergie',  shortLabel: 'Confort',  icon: '🔋', dbKeys: ['Confort'] },
      { key: 'Cuisine',  label: 'Cuisine',             shortLabel: 'Cuisine',  icon: '🍳', dbKeys: ['Cuisine'] },
      { key: 'Déco',     label: 'Déco & Rangement',   shortLabel: 'Déco',     icon: '🖼', dbKeys: ['Déco'] },
      { key: 'Enfants',  label: 'Enfants & Scolaire', shortLabel: 'Enfants',  icon: '🧸', dbKeys: ['Enfants'] },
    ],
  },
  {
    key: 'Tech', label: 'Tech', shortLabel: 'Tech',
    type: NAV_TYPES.UNIVERSE, sectionEmoji: '📱', iconSvg: _ICON_SVGS.Tech,
    image: _CATEGORY_IMAGES.Tech, dbKeys: ['Tech'], filterType: null, filter: null,
    displayOrder: 4, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [
      { key: 'Phones',  label: 'Tél.',    shortLabel: 'Tél.',    icon: '📱', dbKeys: ['Phones'] },
      { key: 'Ordi',    label: 'Ordi',    shortLabel: 'Ordi',    icon: '💻', dbKeys: ['Ordi'] },
      { key: 'Audio',   label: 'Audio',   shortLabel: 'Audio',   icon: '🎧', dbKeys: ['Audio'] },
      { key: 'Montres', label: 'Montres', shortLabel: 'Montres', icon: '⌚', dbKeys: ['Montres'] },
      { key: 'Gaming',  label: 'Gaming',  shortLabel: 'Gaming',  icon: '🎮', dbKeys: ['Gaming'] },
    ],
  },
  {
    key: 'Bricolage', label: 'Bricolage', shortLabel: 'Bricol.',
    type: NAV_TYPES.UNIVERSE, sectionEmoji: '🔧', iconSvg: null,
    image: _CATEGORY_IMAGES.Bricolage, dbKeys: ['Bricolage'], filterType: null, filter: null,
    displayOrder: 5, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [
      { key: 'Outillage',    label: 'Outils & Fixation',        shortLabel: 'Outils', icon: '🔧', dbKeys: ['Outillage'] },
      { key: 'Electricité',  label: 'Électricité & Plomberie',  shortLabel: 'Élec.',  icon: '⚡', dbKeys: ['Electricité'] },
      { key: 'Sécurité',     label: 'Serrures & Sécurité',      shortLabel: 'Sécu.',  icon: '🔒', dbKeys: ['Sécurité'] },
    ],
  },
  {
    key: 'Créations personnelles', label: 'Personnalisé', shortLabel: 'Perso.',
    type: NAV_TYPES.UNIVERSE, sectionEmoji: '✨', iconSvg: null,
    image: _CATEGORY_IMAGES['Créations personnelles'], dbKeys: ['Créations', 'Sur-mesure'], filterType: null, filter: null,
    displayOrder: 6, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [
      { key: 'Cérémonie',  label: 'Tenues de cérémonie',   shortLabel: 'Cérémo.',  icon: '👑', dbKeys: ['Cérémonie'] },
      { key: 'Cadeau',     label: 'Cadeaux personnalisés',  shortLabel: 'Cadeau',   icon: '🎁', dbKeys: ['Cadeau'] },
      { key: 'Impression', label: 'Impression & Design',    shortLabel: 'Imprim.',  icon: '🖨️', dbKeys: ['Impression'] },
    ],
  },
  {
    key: 'Auto', label: 'Auto & Moto', shortLabel: 'Auto',
    type: NAV_TYPES.UNIVERSE, sectionEmoji: '🚗', iconSvg: null,
    image: _CATEGORY_IMAGES.Auto, dbKeys: ['Auto', 'Moto'], filterType: null, filter: null,
    displayOrder: 7, showInRail: true, showInSections: true, showInMobileRail: true,
    subcategories: [
      { key: 'Filtres',   label: 'Filtres & Entretien',       shortLabel: 'Filtres', icon: '🔧', dbKeys: ['Filtres'] },
      { key: 'Freinage',  label: 'Freinage & Sécurité',       shortLabel: 'Frein.',  icon: '🛑', dbKeys: ['Freinage'] },
      { key: 'Éclairage', label: 'Éclairage & Électrique',    shortLabel: 'Éclai.',  icon: '💡', dbKeys: ['Éclairage'] },
      { key: 'Moto',      label: 'Moto',                      shortLabel: 'Moto',    icon: '🏍️', dbKeys: ['Moto'] },
    ],
  },
];

let _categories = null;
let _byKey = null;
let _loadPromise = null;

function _inferNavType(row) {
  if (row.type) return row.type;
  if (row.key === 'all') return NAV_TYPES.SYSTEM;
  if (row.filter_type) return NAV_TYPES.COMMERCIAL_FILTER;
  return NAV_TYPES.UNIVERSE;
}

function _buildFilter(row) {
  if (row.filter && typeof row.filter === 'object') return row.filter;
  if (row.filter_json && typeof row.filter_json === 'object') return row.filter_json;
  if (row.filter_type === 'promo') return { promo: true };
  if (row.filter_type) return { type: row.filter_type };
  return null;
}

function _buildFromRows(rows) {
  return rows.map(row => {
    const type = _inferNavType(row);
    return {
      key:            row.key,
      label:          row.label,
      shortLabel:     row.short_label || row.shortLabel || row.label,
      type,
      sectionEmoji:   row.section_emoji || row.sectionEmoji || '📦',
      iconSvg:        row.icon_svg || row.iconSvg || null,
      image:          row.image_url || row.image || _CATEGORY_IMAGES[row.key] || null,
      imageUrl:       row.image_url || row.image || _CATEGORY_IMAGES[row.key] || null,
      themeToken:     row.theme_token || row.themeToken || null,
      accentToken:    row.accent_token || row.accentToken || null,
      dbKeys:         Array.isArray(row.db_keys) ? row.db_keys : Array.isArray(row.dbKeys) ? row.dbKeys : [],
      filterType:     row.filter_type || row.filterType || null,
      filter:         _buildFilter(row),
      displayOrder:   row.display_order || row.displayOrder || 0,
      showInRail:     row.show_in_rail !== false && row.showInRail !== false,
      showInSections: row.show_in_sections !== false && row.showInSections !== false,
      showInMobileRail: row.show_in_mobile_rail !== false && row.showInMobileRail !== false && row.show_in_rail !== false,
      railBadge:      row.icon_svg ? { kind: 'svg', svg: row.icon_svg } : row.section_emoji ? { kind: 'text', text: row.section_emoji } : null,
      subcategories:  Array.isArray(row.subcategories) ? row.subcategories.map(s => ({
        key:        s.key,
        label:      s.label,
        shortLabel: s.short_label || s.shortLabel || s.label,
        icon:       s.icon || '✨',
        dbKeys:     Array.isArray(s.db_keys) ? s.db_keys : Array.isArray(s.dbKeys) ? s.dbKeys : [s.key],
      })) : [],
    };
  });
}

function _buildIndex(cats) {
  const map = new Map();
  cats.forEach(c => {
    map.set(c.key, c);
    (c.dbKeys || []).forEach(dbKey => { if (!map.has(dbKey)) map.set(dbKey, c); });
  });
  return map;
}

async function _doFetch() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('empty');
    _categories = _buildFromRows(rows);
    _byKey      = _buildIndex(_categories);
  } catch (err) {
    console.warn('[shop-schema] API indisponible, fallback hardcodé', err.message);
    _categories = _FALLBACK_CATEGORIES;
    _byKey      = _buildIndex(_categories);
  }
}

// DSC-A0 : le chemin DB est le défaut.
// Le fallback n'est actif que si window.KOMERCE_FORCE_FALLBACK_CATEGORIES === true (opt-in explicite).
const _FORCE_FALLBACK = (typeof window !== 'undefined') && (window.KOMERCE_FORCE_FALLBACK_CATEGORIES === true);
if (typeof window !== 'undefined' && typeof fetch !== 'undefined' && !_FORCE_FALLBACK) {
  _loadPromise = _doFetch();
} else {
  _categories = _FALLBACK_CATEGORIES;
  _byKey      = _buildIndex(_categories);
}

export async function loadShopSchema() {
  if (_categories) return;
  if (_loadPromise) await _loadPromise;
  if (!_categories) {
    _categories = _FALLBACK_CATEGORIES;
    _byKey      = _buildIndex(_categories);
  }
}

export function getRawCategories() { return _categories || _FALLBACK_CATEGORIES; }
function _cats() { return _categories || _FALLBACK_CATEGORIES; }
function _idx()  { return _byKey      || _buildIndex(_FALLBACK_CATEGORIES); }
export function getCategoryList() { return [..._cats()].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)); }
export function getRailCategories() {
  return getCategoryList().filter(c => c.showInRail !== false).map(c => {
    if (c.railBadge) return c;
    return { ...c, railBadge: c.iconSvg ? { kind: 'svg', svg: c.iconSvg } : c.sectionEmoji ? { kind: 'text', text: c.sectionEmoji } : null };
  });
}
export function getMobileRailCategories() { return getRailCategories().filter(c => c.showInMobileRail !== false); }
export function getUniverseCategories() { return getCategoryList().filter(c => c.type === NAV_TYPES.UNIVERSE); }
export function getCommercialFilters() { return getCategoryList().filter(c => c.type === NAV_TYPES.COMMERCIAL_FILTER); }
export function getRailCategoryKeys() { return getCategoryList().filter(c => c.showInRail !== false).map(c => c.key); }
export function getCategoryByKey(key) { return _idx().get(key) || null; }
export function getCategoryType(key) { return getCategoryByKey(key)?.type || null; }
export function isCommercialFilter(key) { return getCategoryType(key) === NAV_TYPES.COMMERCIAL_FILTER; }
export function isUniverseCategory(key) { return getCategoryType(key) === NAV_TYPES.UNIVERSE; }
export function getSectionOrder() { return getCategoryList().filter(c => c.showInSections).map(c => c.key); }
export function getCategoryLabel(key) { const c = getCategoryByKey(key); return c ? c.label : key; }
export function getCategoryIcon(key) { const c = getCategoryByKey(key); return c?.railBadge || null; }
export function getCategorySectionEmoji(key) { const c = getCategoryByKey(key); return c?.sectionEmoji || '📦'; }
export function getCategoryImage(key) { const c = getCategoryByKey(key); return c?.image || _CATEGORY_IMAGES[key] || null; }
export function getCategoryFilter(key) { return getCategoryByKey(key)?.filter || null; }
export function normalizeCategoryKey(rawCategory) { if (!rawCategory) return rawCategory; const c = _idx().get(rawCategory); return c ? c.key : rawCategory; }
export function getDbKeysForCategory(categoryKey) { const c = getCategoryByKey(categoryKey); if (!c) return [categoryKey]; if (Array.isArray(c.dbKeys) && c.dbKeys.length) return [...c.dbKeys]; return [c.key]; }
export function getSubcategories(categoryKey) {
  const c = _idx().get(categoryKey);
  return c?.subcategories
    ? c.subcategories.map(s => ({ ...s, dbKeys: _subcategoryDbKeys(c.key, s) }))
    : [];
}
export function getSubcategoryMeta(categoryKey, subcategoryKey) { const list = getSubcategories(categoryKey); return list.find(s => s.key === subcategoryKey) || { key: subcategoryKey, label: subcategoryKey, shortLabel: subcategoryKey, icon: '✨', dbKeys: [subcategoryKey] }; }
export function getDbKeysForSubcategory(categoryKey, subcategoryKey) { return getSubcategoryMeta(categoryKey, subcategoryKey).dbKeys; }
export function matchesSubcategory(categoryKey, subcategoryKey, productSubcategory) {
  if (!subcategoryKey) return true;
  return getDbKeysForSubcategory(categoryKey, subcategoryKey).includes(productSubcategory);
}
export function getNextSubcategoryKey(categoryKey, currentSubcategoryKey) { const list = getSubcategories(categoryKey); for (let i = 0; i < list.length - 1; i++) { if (list[i].key === currentSubcategoryKey) return list[i + 1].key; } return null; }
export function createDefaultNavigationState() { return { activeUniverse: 'all', activeSubcategory: null, activeCommercialFilter: null, searchQuery: '', sort: 'recommended' }; }
export function getLegacySubcatsMap() {
  const map = {};
  _cats().forEach(c => {
    if (c.key === 'all' || c.type === NAV_TYPES.COMMERCIAL_FILTER) return;
    map[c.key] = c.subcategories || [];
    (c.dbKeys || []).forEach(dbKey => { if (!map[dbKey]) map[dbKey] = c.subcategories || []; });
  });
  return map;
}

export const SHOP_SCHEMA = {
  brand: { name: 'Komerce', tagline: 'Qui cherche bien trouve bien !', heroImage: '/images/hero_banner.png' },
  nav: [
    { k: 'home', label: 'Accueil', icon: 'home' },
    { k: 'tracking', label: 'Suivi', icon: 'map-pin' },
    { k: 'favorites', label: 'Favoris', icon: 'heart' },
    { k: 'cart', label: 'Panier', icon: 'basket' },
  ],
  navigation: {
    types: NAV_TYPES,
    createDefaultState: createDefaultNavigationState,
  },
  get categories() { return getCategoryList(); },
  get universes() { return getUniverseCategories(); },
  get commercialFilters() { return getCommercialFilters(); },
};

export { NAV_TYPES };
