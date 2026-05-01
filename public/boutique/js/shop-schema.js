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

// ─── Fallback hardcodé (identique à l'ancienne version) ──────────────────────
// Utilisé si GET /api/categories échoue ou est appelé avant résolution.

const _ICON_SVGS = {
  Soldes:         '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  'Mode & Beauté':'<svg viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
  Tech:           '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  Enfant:         '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="5"/><path d="M12 12v10M7 22h10"/></svg>',
  Maison:         '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  Sport:          '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M6.5 6.5 17.5 17.5M4 12h.01M20 12h.01M12 4v.01M12 20v.01"/></svg>',
  'Sur-mesure':   '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
};

const _FALLBACK_CATEGORIES = [
  { key: 'all',          label: 'Tout',         shortLabel: 'Tout',          sectionEmoji: '🔥',  iconSvg: null,                          dbKeys: [],                     filterType: null,    displayOrder: 0, showInRail: true,  showInSections: false, subcategories: [] },
  { key: 'Soldes',       label: 'Soldes',        shortLabel: 'Soldes',        sectionEmoji: '🏷️', iconSvg: _ICON_SVGS['Soldes'],           dbKeys: [],                     filterType: 'promo', displayOrder: 1, showInRail: true,  showInSections: true,  subcategories: [] },
  { key: 'Mode & Beauté',label: 'Mode & Beauté', shortLabel: 'Mode',          sectionEmoji: '👗',  iconSvg: _ICON_SVGS['Mode & Beauté'],    dbKeys: ['Mode', 'Beauté'],     filterType: null,    displayOrder: 2, showInRail: true,  showInSections: true,
    subcategories: [
      { key: 'Femme',      label: 'Femme',      shortLabel: 'Femme',      icon: '👗' },
      { key: 'Homme',      label: 'Homme',      shortLabel: 'Homme',      icon: '👔' },
      { key: 'Hijab',      label: 'Hijab',      shortLabel: 'Hijab',      icon: '🧕' },
      { key: 'Boubou',     label: 'Boubou',     shortLabel: 'Boubou',     icon: '👘' },
      { key: 'Shoes',      label: 'Shoes',       shortLabel: 'Shoes',     icon: '👟' },
      { key: 'Parfums',    label: 'Parfum',      shortLabel: 'Parfum',    icon: '🌸' },
      { key: 'Soins',      label: 'Soin',        shortLabel: 'Soin',      icon: '🧴' },
      { key: 'Cheveux',    label: 'Cheveux',     shortLabel: 'Cheveux',   icon: '💇' },
      { key: 'Maquillage', label: 'Maquil.',     shortLabel: 'Maquil.',   icon: '💄' },
      { key: 'Ongles',     label: 'Ongles',      shortLabel: 'Ongles',    icon: '💅' },
    ],
  },
  { key: 'Tech',       label: 'Tech',       shortLabel: 'Tech',          sectionEmoji: '📱', iconSvg: _ICON_SVGS['Tech'],        dbKeys: ['Tech'],        filterType: null, displayOrder: 3, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Phones',  label: 'Tél.',    shortLabel: 'Tél.',   icon: '📱' },
      { key: 'Ordi',    label: 'Ordi',    shortLabel: 'Ordi',   icon: '💻' },
      { key: 'Audio',   label: 'Audio',   shortLabel: 'Audio',  icon: '🎧' },
      { key: 'Montres', label: 'Montres', shortLabel: 'Montres',icon: '⌚' },
      { key: 'Gaming',  label: 'Gaming',  shortLabel: 'Gaming', icon: '🎮' },
    ],
  },
  { key: 'Enfant',   label: 'Enfant',   shortLabel: 'Enfant',   sectionEmoji: '🧒', iconSvg: _ICON_SVGS['Enfant'],      dbKeys: ['Enfant'],      filterType: null, displayOrder: 4, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Bébé',   label: 'Bébé',   shortLabel: 'Bébé',   icon: '🍼' },
      { key: 'Garçon', label: 'Garçon', shortLabel: 'Garçon', icon: '👦' },
      { key: 'Fille',  label: 'Fille',  shortLabel: 'Fille',  icon: '👧' },
      { key: 'Jouets', label: 'Jouets', shortLabel: 'Jouets', icon: '🧸' },
      { key: 'École',  label: 'École',  shortLabel: 'École',  icon: '📚' },
    ],
  },
  { key: 'Maison',   label: 'Maison',   shortLabel: 'Maison',   sectionEmoji: '🏠', iconSvg: _ICON_SVGS['Maison'],      dbKeys: ['Maison'],      filterType: null, displayOrder: 5, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Cuisine',   label: 'Cuisine', shortLabel: 'Cuisine', icon: '🍳' },
      { key: 'Salon',     label: 'Salon',   shortLabel: 'Salon',   icon: '🛋'  },
      { key: 'Chambre',   label: 'Chambre', shortLabel: 'Chambre', icon: '🛏'  },
      { key: 'Déco',      label: 'Déco',    shortLabel: 'Déco',    icon: '🖼'  },
      { key: 'Rangement', label: 'Rangem.', shortLabel: 'Rangem.', icon: '📦' },
    ],
  },
  { key: 'Sport',      label: 'Sport',      shortLabel: 'Sport',        sectionEmoji: '⚽', iconSvg: _ICON_SVGS['Sport'],       dbKeys: ['Sport'],       filterType: null, displayOrder: 6, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Foot',     label: 'Foot',     shortLabel: 'Foot',     icon: '⚽' },
      { key: 'Fitness',  label: 'Fitness',  shortLabel: 'Fitness',  icon: '💪' },
      { key: 'Natation', label: 'Natation', shortLabel: 'Natation', icon: '🏊' },
      { key: 'Yoga',     label: 'Yoga',     shortLabel: 'Yoga',     icon: '🧘' },
      { key: 'Outdoor',  label: 'Outdoor',  shortLabel: 'Outdoor',  icon: '🏕' },
    ],
  },
  { key: 'Sur-mesure', label: 'Sur-mesure', shortLabel: 'Pour vous...', sectionEmoji: '✨', iconSvg: _ICON_SVGS['Sur-mesure'],  dbKeys: ['Sur-mesure'],  filterType: null, displayOrder: 7, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Couture',  label: 'Couture',  shortLabel: 'Couture',  icon: '🧵' },
      { key: 'Design',   label: 'Design',   shortLabel: 'Design',   icon: '✏️'  },
      { key: 'Mesure',   label: 'Mesure',   shortLabel: 'Mesure',   icon: '📏' },
      { key: 'Broderie', label: 'Broderie', shortLabel: 'Broderie', icon: '🪡' },
      { key: 'Premium',  label: 'Premium',  shortLabel: 'Premium',  icon: '⭐' },
    ],
  },
];

// ─── État interne ─────────────────────────────────────────────────────────────

/** @type {Array|null} Liste de catégories chargée depuis l'API */
let _categories = null;

/** @type {Map<string,Object>|null} Index par key (display + db_keys) */
let _byKey = null;

/** @type {Promise<void>|null} Promise unique de chargement */
let _loadPromise = null;

// ─── Construction depuis données API ─────────────────────────────────────────

function _buildFromRows(rows) {
  const cats = rows.map(row => ({
    key:            row.key,
    label:          row.label,
    shortLabel:     row.short_label || row.label,
    sectionEmoji:   row.section_emoji || '📦',
    iconSvg:        row.icon_svg || null,
    dbKeys:         Array.isArray(row.db_keys) ? row.db_keys : [],
    filterType:     row.filter_type || null,
    displayOrder:   row.display_order || 0,
    showInRail:     row.show_in_rail !== false,
    showInSections: row.show_in_sections !== false,
    // Compatibilité descendante shop-schema
    railBadge:      row.icon_svg
                      ? { kind: 'svg', svg: row.icon_svg }
                      : row.section_emoji
                        ? { kind: 'text', text: row.section_emoji }
                        : null,
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
    // Indexer aussi par db_keys pour normalizeCategoryKey + getSubcategories
    (c.dbKeys || []).forEach(dbKey => {
      if (!map.has(dbKey)) map.set(dbKey, c);
    });
  });
  return map;
}

// ─── Fetch API ────────────────────────────────────────────────────────────────

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

// Démarrer le fetch immédiatement à l'import (parallèle au boot de la page)
if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
  _loadPromise = _doFetch();
} else {
  // SSR / tests — utiliser fallback directement
  _categories = _FALLBACK_CATEGORIES;
  _byKey      = _buildIndex(_categories);
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Attend que le schéma soit chargé depuis l'API.
 * À appeler dans boutique init (DOMContentLoaded) avant tout rendu.
 */
export async function loadShopSchema() {
  if (_categories) return;
  if (_loadPromise) await _loadPromise;
  // Sécurité: si toujours null (erreur totale)
  if (!_categories) {
    _categories = _FALLBACK_CATEGORIES;
    _byKey      = _buildIndex(_categories);
  }
}

/** Accès direct aux données brutes (pour admin, debug) */
export function getRawCategories() {
  return _categories || _FALLBACK_CATEGORIES;
}

// ─── Helpers (identiques à l'ancienne API publique) ──────────────────────────

function _cats() { return _categories || _FALLBACK_CATEGORIES; }
function _idx()  { return _byKey      || _buildIndex(_FALLBACK_CATEGORIES); }

export function getCategoryList() {
  return [..._cats()].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

export function getRailCategories() {
  return getCategoryList()
    .filter(c => c.showInRail !== false)
    .map(c => {
      if (c.railBadge) return c;
      // Fallback : calcul railBadge depuis iconSvg / sectionEmoji
      // (utilisé quand la migration 061 n'est pas encore jouée en prod)
      return {
        ...c,
        railBadge: c.iconSvg
          ? { kind: 'svg', svg: c.iconSvg }
          : c.sectionEmoji
            ? { kind: 'text', text: c.sectionEmoji }
            : null,
      };
    });
}

export function getCategoryByKey(key) {
  return _idx().get(key) || null;
}

export function getSectionOrder() {
  return getCategoryList().filter(c => c.showInSections).map(c => c.key);
}

export function getCategoryLabel(key) {
  const c = getCategoryByKey(key);
  return c ? c.label : key;
}

export function getCategoryIcon(key) {
  const c = getCategoryByKey(key);
  return c?.railBadge || null;
}

export function getCategorySectionEmoji(key) {
  const c = getCategoryByKey(key);
  return c?.sectionEmoji || '📦';
}

export function normalizeCategoryKey(rawCategory) {
  if (!rawCategory) return rawCategory;
  // Chercher d'abord par clé directe, puis par dbKey
  const c = _idx().get(rawCategory);
  return c ? c.key : rawCategory;
}

export function getDbKeysForCategory(categoryKey) {
  const c = getCategoryByKey(categoryKey);
  if (!c) return [categoryKey];
  if (Array.isArray(c.dbKeys) && c.dbKeys.length) return [...c.dbKeys];
  return [c.key];
}

/**
 * Retourne les sous-catégories d'une catégorie.
 * Accepte la clé d'affichage ('Mode & Beauté') OU la clé DB ('Mode', 'Beauté').
 */
export function getSubcategories(categoryKey) {
  const c = _idx().get(categoryKey);
  return c?.subcategories ? [...c.subcategories] : [];
}

export function getSubcategoryMeta(categoryKey, subcategoryKey) {
  const list = getSubcategories(categoryKey);
  return list.find(s => s.key === subcategoryKey) || {
    key:        subcategoryKey,
    label:      subcategoryKey,
    shortLabel: subcategoryKey,
    icon:       '✨',
  };
}

export function getNextSubcategoryKey(categoryKey, currentSubcategoryKey) {
  const list = getSubcategories(categoryKey);
  for (let i = 0; i < list.length - 1; i++) {
    if (list[i].key === currentSubcategoryKey) return list[i + 1].key;
  }
  return null;
}

/**
 * Compatibilité descendante — retourne un objet { dbKey: subcats[] }
 * comme l'ancien SUBCATS de b-store.js.
 * Utilisé par les modules non encore migrés.
 */
export function getLegacySubcatsMap() {
  const map = {};
  _cats().forEach(c => {
    if (c.key === 'all' || c.key === 'Soldes') return;
    // Indexer par clé d'affichage
    map[c.key] = c.subcategories || [];
    // Indexer aussi par chaque db_key
    (c.dbKeys || []).forEach(dbKey => {
      if (!map[dbKey]) map[dbKey] = c.subcategories || [];
    });
  });
  return map;
}

// ─── Export SHOP_SCHEMA (compat descendante) ──────────────────────────────────
// Certains modules importent SHOP_SCHEMA directement.
// On l'expose comme un proxy live sur _cats().

export const SHOP_SCHEMA = {
  brand: {
    name:      'Komerce',
    tagline:   'Qui cherche bien trouve bien !',
    heroImage: '/images/hero_banner.png',
  },
  nav: [
    { k: 'home',      label: 'Accueil',  icon: 'home'    },
    { k: 'tracking',  label: 'Suivi',    icon: 'map-pin' },
    { k: 'favorites', label: 'Favoris',  icon: 'heart'   },
    { k: 'cart',      label: 'Panier',   icon: 'basket'  },
  ],
  get categories() { return getCategoryList(); },
};
