/**
 * @module shop-schema
 * @brief Source de vérité déclarative de la boutique Komerce.
 *
 * LOT 10 — DB-driven: les catégories et sous-catégories sont désormais
 * chargées depuis GET /api/categories (table boutique_categories +
 * boutique_subcategories). L'admin peut les modifier sans toucher au JS.
 *
 * Stratégie de chargement:
 *   1. Fetch démarré immédiatement à l'import du module (parallèle au boot).
 *   2. loadShopSchema() attendue dans boutique init avant le premier rendu.
 *   3. Si l'API échoue (pré-migration, réseau) → fallback hardcodé identique
 *      à l'ancienne version (0 régression).
 *
 * Tous les exports publics restent identiques: getCategoryList(),
 * getSubcategories(), normalizeCategoryKey(), etc.
 */

// ─── Fallback hardcodé — architecture v2 (marché comorien / diaspora) ────────
// Utilisé si GET /api/categories échoue ou est appelé avant résolution.
// Labels, icônes et sous-catégories modifiables via backoffice (/api/categories)
// sans toucher à ce fichier. Seuls `key`, `dbKeys` et `filterType` sont stables.

const _ICON_SVGS = {
  Soldes:                   '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  'Mode & Beauté':          '<svg viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
  Maison:                   '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  Tech:                     '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  Bricolage:                '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  'Créations personnelles': '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  Auto:                     '<svg viewBox="0 0 24 24"><path d="M14 16H9m10 0h3v-3.15a2 2 0 0 0-1.1-1.8l-2.5-1.25A4 4 0 0 0 15.75 9H8.25a4 4 0 0 0-2.65 1.8L3.1 12.05A2 2 0 0 0 2 13.85V16h2m14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg>',
};

const _CATEGORY_IMAGES = {
  all:                       '/boutique/categories/all.jpg',
  Soldes:                    '/boutique/categories/soldes.jpg',
  'Mode & Beauté':           '/boutique/categories/mode.jpg',
  Maison:                    '/boutique/categories/maison.jpg',
  Tech:                      '/boutique/categories/tech.jpg',
  Bricolage:                 '/boutique/categories/bricolage.jpg',
  'Créations personnelles':  '/boutique/categories/creations.jpg',
  Auto:                      '/boutique/categories/auto.jpg',
};

const _FALLBACK_CATEGORIES = [
  { key: 'all', label: 'Tout', shortLabel: 'Tout', sectionEmoji: '🔥', iconSvg: null, image: _CATEGORY_IMAGES.all, dbKeys: [], filterType: null, displayOrder: 0, showInRail: true, showInSections: false, subcategories: [] },
  { key: 'Soldes', label: 'Soldes', shortLabel: 'Soldes', sectionEmoji: '🏷️', iconSvg: _ICON_SVGS.Soldes, image: _CATEGORY_IMAGES.Soldes, dbKeys: [], filterType: 'promo', displayOrder: 1, showInRail: true, showInSections: true, subcategories: [] },
  { key: 'Mode & Beauté', label: 'Mode & Beauté', shortLabel: 'Mode', sectionEmoji: '👗', iconSvg: _ICON_SVGS['Mode & Beauté'], image: _CATEGORY_IMAGES['Mode & Beauté'], dbKeys: ['Mode', 'Beauté', 'Sport', 'Enfant'], filterType: null, displayOrder: 2, showInRail: true, showInSections: true, subcategories: [
    { key: 'Femme', label: 'Femme', shortLabel: 'Femme', icon: '👗' },
    { key: 'Homme', label: 'Homme', shortLabel: 'Homme', icon: '👔' },
    { key: 'Enfant', label: 'Enfant & Bébé', shortLabel: 'Enfant', icon: '🍼' },
    { key: 'Beauté', label: 'Beauté & Bien-être', shortLabel: 'Beauté', icon: '💄' },
  ] },
  { key: 'Maison', label: 'Maison', shortLabel: 'Maison', sectionEmoji: '🏠', iconSvg: _ICON_SVGS.Maison, image: _CATEGORY_IMAGES.Maison, dbKeys: ['Maison', 'Solaire', 'Énergie', 'Jouets'], filterType: null, displayOrder: 3, showInRail: true, showInSections: true, subcategories: [
    { key: 'Confort', label: 'Confort & Énergie', shortLabel: 'Confort', icon: '🔋' },
    { key: 'Cuisine', label: 'Cuisine', shortLabel: 'Cuisine', icon: '🍳' },
    { key: 'Déco', label: 'Déco & Rangement', shortLabel: 'Déco', icon: '🖼️' },
    { key: 'Enfants', label: 'Enfants & Scolaire', shortLabel: 'Enfants', icon: '🧸' },
  ] },
  { key: 'Tech', label: 'Tech', shortLabel: 'Tech', sectionEmoji: '📱', iconSvg: _ICON_SVGS.Tech, image: _CATEGORY_IMAGES.Tech, dbKeys: ['Tech', 'Phones', 'Téléphonie'], filterType: null, displayOrder: 4, showInRail: true, showInSections: true, subcategories: [
    { key: 'Phones', label: 'Téléphones', shortLabel: 'Tél.', icon: '📱' },
    { key: 'Audio', label: 'Audio & Accessoires', shortLabel: 'Audio', icon: '🎧' },
    { key: 'Montres', label: 'Montres & Gadgets', shortLabel: 'Montres', icon: '⌚' },
  ] },
  { key: 'Bricolage', label: 'Bricolage', shortLabel: 'Bricol.', sectionEmoji: '🔧', iconSvg: _ICON_SVGS.Bricolage, image: _CATEGORY_IMAGES.Bricolage, dbKeys: ['Bricolage', 'Quincaillerie'], filterType: null, displayOrder: 5, showInRail: true, showInSections: true, subcategories: [
    { key: 'Outillage', label: 'Outils & Fixation', shortLabel: 'Outils', icon: '🔧' },
    { key: 'Electricité', label: 'Électricité & Plomberie', shortLabel: 'Élec.', icon: '⚡' },
    { key: 'Sécurité', label: 'Serrures & Sécurité', shortLabel: 'Sécu.', icon: '🔐' },
  ] },
  { key: 'Créations personnelles', label: 'Personnalisé', shortLabel: 'Perso.', sectionEmoji: '✨', iconSvg: _ICON_SVGS['Créations personnelles'], image: _CATEGORY_IMAGES['Créations personnelles'], dbKeys: ['Sur-mesure', 'Créations', 'Personnalisé'], filterType: null, displayOrder: 6, showInRail: true, showInSections: true, subcategories: [
    { key: 'Cérémonie', label: 'Tenues de cérémonie', shortLabel: 'Cérémo.', icon: '👑' },
    { key: 'Cadeau', label: 'Cadeaux personnalisés', shortLabel: 'Cadeau', icon: '🎁' },
    { key: 'Impression', label: 'Impression & Design', shortLabel: 'Imprim.', icon: '🖨️' },
  ] },
  { key: 'Auto', label: 'Auto & Moto', shortLabel: 'Auto', sectionEmoji: '🔩', iconSvg: _ICON_SVGS.Auto, image: _CATEGORY_IMAGES.Auto, dbKeys: ['Auto', 'Moto', 'Pièces'], filterType: null, displayOrder: 7, showInRail: true, showInSections: true, subcategories: [
    { key: 'Filtres', label: 'Filtres & Entretien', shortLabel: 'Filtres', icon: '🔧' },
    { key: 'Freinage', label: 'Freinage & Sécurité', shortLabel: 'Frein.', icon: '🛑' },
    { key: 'Éclairage', label: 'Éclairage & Électrique', shortLabel: 'Éclai.', icon: '💡' },
    { key: 'Moto', label: 'Moto', shortLabel: 'Moto', icon: '🏍️' },
  ] },
];

let _categories = null;
let _byKey = null;
let _loadPromise = null;

function _buildFromRows(rows) {
  const cats = rows.map(row => ({
    key:            row.key,
    label:          row.label,
    shortLabel:     row.short_label || row.label,
    sectionEmoji:   row.section_emoji || '📦',
    iconSvg:        row.icon_svg || null,
    image:          row.image || _CATEGORY_IMAGES[row.key] || null,
    dbKeys:         Array.isArray(row.db_keys) ? row.db_keys : [],
    filterType:     row.filter_type || null,
    displayOrder:   row.display_order || 0,
    showInRail:     row.show_in_rail !== false,
    showInSections: row.show_in_sections !== false,
    railBadge:      row.icon_svg ? { kind: 'svg', svg: row.icon_svg } : row.section_emoji ? { kind: 'text', text: row.section_emoji } : null,
    subcategories:  Array.isArray(row.subcategories) ? row.subcategories.map(s => ({
      key:        s.key,
      label:      s.label,
      shortLabel: s.short_label || s.label,
      icon:       s.icon || '✨',
    })) : [],
  }));
  return cats;
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

const _FORCE_FALLBACK = (typeof window !== 'undefined') && (window.KOMERCE_FORCE_FALLBACK_CATEGORIES !== false);
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
export function getRailCategoryKeys() { return getCategoryList().filter(c => c.showInRail !== false).map(c => c.key); }
export function getCategoryByKey(key) { return _idx().get(key) || null; }
export function getSectionOrder() { return getCategoryList().filter(c => c.showInSections).map(c => c.key); }
export function getCategoryLabel(key) { const c = getCategoryByKey(key); return c ? c.label : key; }
export function getCategoryIcon(key) { const c = getCategoryByKey(key); return c?.railBadge || null; }
export function getCategorySectionEmoji(key) { const c = getCategoryByKey(key); return c?.sectionEmoji || '📦'; }
export function getCategoryImage(key) { const c = getCategoryByKey(key); return c?.image || _CATEGORY_IMAGES[key] || null; }
export function normalizeCategoryKey(rawCategory) { if (!rawCategory) return rawCategory; const c = _idx().get(rawCategory); return c ? c.key : rawCategory; }
export function getDbKeysForCategory(categoryKey) { const c = getCategoryByKey(categoryKey); if (!c) return [categoryKey]; if (Array.isArray(c.dbKeys) && c.dbKeys.length) return [...c.dbKeys]; return [c.key]; }
export function getSubcategories(categoryKey) { const c = _idx().get(categoryKey); return c?.subcategories ? [...c.subcategories] : []; }
export function getSubcategoryMeta(categoryKey, subcategoryKey) { const list = getSubcategories(categoryKey); return list.find(s => s.key === subcategoryKey) || { key: subcategoryKey, label: subcategoryKey, shortLabel: subcategoryKey, icon: '✨' }; }
export function getNextSubcategoryKey(categoryKey, currentSubcategoryKey) { const list = getSubcategories(categoryKey); for (let i = 0; i < list.length - 1; i++) { if (list[i].key === currentSubcategoryKey) return list[i + 1].key; } return null; }
export function getLegacySubcatsMap() {
  const map = {};
  _cats().forEach(c => {
    if (c.key === 'all' || c.key === 'Soldes') return;
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
  get categories() { return getCategoryList(); },
};
