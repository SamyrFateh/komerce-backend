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
  all:                       '/boutique/images/categories/all.jpg',
  Soldes:                    '/boutique/images/categories/soldes.jpg',
  'Mode & Beauté':           '/boutique/images/categories/mode.jpg',
  Maison:                    '/boutique/images/categories/maison.jpg',
  Tech:                      '/boutique/images/categories/tech.jpg',
  Bricolage:                 '/boutique/images/categories/bricolage.jpg',
  'Créations personnelles':  '/boutique/images/categories/creations.jpg',
  Auto:                      '/boutique/images/categories/auto.jpg',
};

const _FALLBACK_CATEGORIES = [
  // ── Filtre transverse "Tout" ──────────────────────────────────
  { key: 'all', label: 'Tout', shortLabel: 'Tout', sectionEmoji: '🔥', iconSvg: null, image: _CATEGORY_IMAGES['all'], dbKeys: [], filterType: null, displayOrder: 0, showInRail: true, showInSections: false, subcategories: [] },

  // ── Filtre transverse "Soldes" (chip-filter promo) ────────────
  { key: 'Soldes', label: 'Soldes', shortLabel: 'Soldes', sectionEmoji: '🏷️', iconSvg: _ICON_SVGS['Soldes'], image: _CATEGORY_IMAGES['Soldes'], dbKeys: [], filterType: 'promo', displayOrder: 1, showInRail: true, showInSections: true, subcategories: [] },

  // ── PILIER 1 : Mode & Beauté ──────────────────────────────────
  // Ancrage culturel n°1. Absorbe : Sport (rétrocompat), Beauté, Enfant/Bébé.
  // Logique : achat féminin/familial groupé — tenue + soins + bébé dans un seul colis.
  { key: 'Mode & Beauté', label: 'Mode & Beauté', shortLabel: 'Mode', sectionEmoji: '👗', iconSvg: _ICON_SVGS['Mode & Beauté'], image: _CATEGORY_IMAGES['Mode & Beauté'],
    dbKeys: ['Mode', 'Beauté', 'Sport', 'Enfant'],  // ← Enfant + Sport : rétrocompat produits existants
    filterType: null, displayOrder: 2, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Femme',   label: 'Femme',           shortLabel: 'Femme',  icon: '👗' },  // Hijab, Boubou, Shoes, Parfum inclus
      { key: 'Homme',   label: 'Homme',           shortLabel: 'Homme',  icon: '👔' },  // Boubou homme, Shoes inclus
      { key: 'Enfant',  label: 'Enfant & Bébé',   shortLabel: 'Enfant', icon: '🍼' },  // Bébé, Garçon, Fille, Puériculture inclus
      { key: 'Beauté',  label: 'Beauté & Bien-être', shortLabel: 'Beauté', icon: '💄' }, // Soins, Cheveux, Maquillage, Vitamines, Parapharmacie inclus
    ],
  },

  // ── PILIER 2 : Maison ─────────────────────────────────────────
  // Le foyer au sens large. Absorbe : Solaire léger, Énergie, Jouets, Scolaire.
  // Logique : la diaspora équipe la maison ET les enfants dans le même colis.
  { key: 'Maison', label: 'Maison', shortLabel: 'Maison', sectionEmoji: '🏠', iconSvg: _ICON_SVGS['Maison'], image: _CATEGORY_IMAGES['Maison'],
    dbKeys: ['Maison', 'Solaire', 'Énergie', 'Jouets'],  // ← rétrocompat anciens piliers
    filterType: null, displayOrder: 3, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Confort',  label: 'Confort & Énergie', shortLabel: 'Confort', icon: '🔋' }, // Lampes, power banks, ventilateurs inclus
      { key: 'Cuisine',  label: 'Cuisine',            shortLabel: 'Cuisine', icon: '🍳' },
      { key: 'Déco',     label: 'Déco & Rangement',   shortLabel: 'Déco',    icon: '🖼️' }, // Salon, Chambre, Rangement inclus
      { key: 'Enfants',  label: 'Enfants & Scolaire', shortLabel: 'Enfants', icon: '🧸' }, // Jouets, cahiers, cartables inclus
    ],
  },

  // ── PILIER 3 : Tech ───────────────────────────────────────────
  // Téléphonie absorbée — la diaspora envoie des téléphones, c'est quasi culturel.
  { key: 'Tech', label: 'Tech', shortLabel: 'Tech', sectionEmoji: '📱', iconSvg: _ICON_SVGS['Tech'], image: _CATEGORY_IMAGES['Tech'],
    dbKeys: ['Tech', 'Phones', 'Téléphonie'],
    filterType: null, displayOrder: 4, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Phones',   label: 'Téléphones',       shortLabel: 'Tél.',    icon: '📱' },
      { key: 'Audio',    label: 'Audio & Accessoires', shortLabel: 'Audio', icon: '🎧' }, // Câbles, chargeurs inclus
      { key: 'Montres',  label: 'Montres & Gadgets', shortLabel: 'Montres', icon: '⌚' },
    ],
  },

  // ── PILIER 4 : Bricolage ──────────────────────────────────────
  // Quincaillerie locale aléatoire aux Comores — fort besoin diaspora.
  // Frontière stricte : léger + installable sans technicien.
  { key: 'Bricolage', label: 'Bricolage', shortLabel: 'Bricol.', sectionEmoji: '🔧', iconSvg: _ICON_SVGS['Bricolage'], image: _CATEGORY_IMAGES['Bricolage'],
    dbKeys: ['Bricolage', 'Quincaillerie'],
    filterType: null, displayOrder: 5, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Outillage',   label: 'Outils & Fixation',       shortLabel: 'Outils',  icon: '🔧' },
      { key: 'Electricité', label: 'Électricité & Plomberie', shortLabel: 'Élec.',   icon: '⚡' },
      { key: 'Sécurité',    label: 'Serrures & Sécurité',     shortLabel: 'Sécu.',   icon: '🔐' },
    ],
  },

  // ── PILIER 5 : Créations personnelles ────────────────────────
  // Grand Mariage comorien — demande groupée, haute valeur émotionnelle.
  // Modèle : print-on-demand (Printify/Gelato) + atelier Moroni pour l'urgence.
  { key: 'Créations personnelles', label: 'Personnalisé', shortLabel: 'Perso.', sectionEmoji: '✨', iconSvg: _ICON_SVGS['Créations personnelles'], image: _CATEGORY_IMAGES['Créations personnelles'],
    dbKeys: ['Sur-mesure', 'Créations', 'Personnalisé'],  // ← rétrocompat
    filterType: null, displayOrder: 6, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Cérémonie',  label: 'Tenues de cérémonie',   shortLabel: 'Cérémo.', icon: '👑' },
      { key: 'Cadeau',     label: 'Cadeaux personnalisés',  shortLabel: 'Cadeau',  icon: '🎁' },
      { key: 'Impression', label: 'Impression & Design',    shortLabel: 'Imprim.', icon: '🖨️' },
    ],
  },

  // ── PILIER 6 : Auto ───────────────────────────────────────────
  // Parc concentré sur Toyota (Vitz, Hilux, Hiace, Land Cruiser).
  // Sourcing : Valeo Service Middle East — Jebel Ali Free Zone, Dubaï.
  // Frontière stricte : pièces légères uniquement.
  { key: 'Auto', label: 'Auto & Moto', shortLabel: 'Auto', sectionEmoji: '🔩', iconSvg: _ICON_SVGS['Auto'], image: _CATEGORY_IMAGES['Auto'],
    dbKeys: ['Auto', 'Moto', 'Pièces'],
    filterType: null, displayOrder: 7, showInRail: true, showInSections: true,
    subcategories: [
      { key: 'Filtres',   label: 'Filtres & Entretien',    shortLabel: 'Filtres', icon: '🔧' },
      { key: 'Freinage',  label: 'Freinage & Sécurité',    shortLabel: 'Frein.',  icon: '🛑' },
      { key: 'Éclairage', label: 'Éclairage & Électrique', shortLabel: 'Éclai.', icon: '💡' },
      { key: 'Moto',      label: 'Moto',                   shortLabel: 'Moto',    icon: '🏍️' },
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
    image:          row.image || _CATEGORY_IMAGES[row.key] || null,
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
// FLAG TRANSITION : pendant la bascule 8→6 catégories, on peut forcer le
// fallback pour ne pas dépendre de la migration backend. Mettre window.
// KOMERCE_FORCE_FALLBACK_CATEGORIES=true (par défaut, vu que la table DB
// n'est pas encore migrée). Une fois que la table DB aura été mise à jour
// avec les 6 catégories, retirer ce flag pour repasser au DB-driven.
const _FORCE_FALLBACK = (typeof window !== 'undefined') &&
  (window.KOMERCE_FORCE_FALLBACK_CATEGORIES !== false);

if (typeof window !== 'undefined' && typeof fetch !== 'undefined' && !_FORCE_FALLBACK) {
  _loadPromise = _doFetch();
} else {
  // SSR / tests / flag transition — utiliser fallback directement
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

/** Version allégée de getRailCategories() — retourne uniquement les clés,
 *  sans calculer les railBadge. Utilisée par le FOUC fix de home-controller
 *  pour comparer les chips statiques HTML sans déclencher de rendu. */
export function getRailCategoryKeys() {
  return getCategoryList()
    .filter(c => c.showInRail !== false)
    .map(c => c.key);
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

export function getCategoryImage(key) {
  const c = getCategoryByKey(key);
  return c?.image || _CATEGORY_IMAGES[key] || null;
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
