/**
 * @module shop-schema
 * @brief Source de verite declarative de la boutique Komerce.
 *
 * Cette couche centralise:
 * - la marque
 * - la navigation
 * - les categories principales
 * - les sous-categories
 * - l'ordre d'affichage
 * - les icones/labelles utilises par le rail et les sections
 *
 * Regle de gouvernance:
 * une categorie ou une sous-categorie ne doit plus etre definie
 * ailleurs qu'ici.
 */

const MODE_SUBCATEGORIES = [
  { key: 'Femme', label: 'Femme', shortLabel: 'Femme', icon: '👗' },
  { key: 'Homme', label: 'Homme', shortLabel: 'Homme', icon: '👔' },
  { key: 'Hijab', label: 'Hijab', shortLabel: 'Hijab', icon: '🧕' },
  { key: 'Boubou', label: 'Boubou', shortLabel: 'Boubou', icon: '👘' },
  { key: 'Shoes', label: 'Shoes', shortLabel: 'Shoes', icon: '👟' },
];

const BEAUTY_SUBCATEGORIES = [
  { key: 'Parfums', label: 'Parfum', shortLabel: 'Parfum', icon: '🌸' },
  { key: 'Soins', label: 'Soin', shortLabel: 'Soin', icon: '🧴' },
  { key: 'Cheveux', label: 'Cheveux', shortLabel: 'Cheveux', icon: '💇' },
  { key: 'Maquillage', label: 'Maquil.', shortLabel: 'Maquil.', icon: '💄' },
  { key: 'Ongles', label: 'Ongles', shortLabel: 'Ongles', icon: '💅' },
];

const TECH_SUBCATEGORIES = [
  { key: 'Phones', label: 'Tel.', shortLabel: 'Tel.', icon: '📱' },
  { key: 'Ordi', label: 'Ordi', shortLabel: 'Ordi', icon: '💻' },
  { key: 'Audio', label: 'Audio', shortLabel: 'Audio', icon: '🎧' },
  { key: 'Montres', label: 'Montres', shortLabel: 'Montres', icon: '⌚' },
  { key: 'Gaming', label: 'Gaming', shortLabel: 'Gaming', icon: '🎮' },
];

const ENFANT_SUBCATEGORIES = [
  { key: 'Bébé', label: 'Bebe', shortLabel: 'Bebe', icon: '🍼' },
  { key: 'Garçon', label: 'Garcon', shortLabel: 'Garcon', icon: '👦' },
  { key: 'Fille', label: 'Fille', shortLabel: 'Fille', icon: '👧' },
  { key: 'Jouets', label: 'Jouets', shortLabel: 'Jouets', icon: '🧸' },
  { key: 'École', label: 'Ecole', shortLabel: 'Ecole', icon: '📚' },
];

const MAISON_SUBCATEGORIES = [
  { key: 'Cuisine', label: 'Cuisine', shortLabel: 'Cuisine', icon: '🍳' },
  { key: 'Salon', label: 'Salon', shortLabel: 'Salon', icon: '🛋' },
  { key: 'Chambre', label: 'Chambre', shortLabel: 'Chambre', icon: '🛏' },
  { key: 'Déco', label: 'Deco', shortLabel: 'Deco', icon: '🖼' },
  { key: 'Rangement', label: 'Rangem.', shortLabel: 'Rangem.', icon: '📦' },
];

const SPORT_SUBCATEGORIES = [
  { key: 'Foot', label: 'Foot', shortLabel: 'Foot', icon: '⚽' },
  { key: 'Fitness', label: 'Fitness', shortLabel: 'Fitness', icon: '💪' },
  { key: 'Natation', label: 'Natation', shortLabel: 'Natation', icon: '🏊' },
  { key: 'Yoga', label: 'Yoga', shortLabel: 'Yoga', icon: '🧘' },
  { key: 'Outdoor', label: 'Outdoor', shortLabel: 'Outdoor', icon: '🏕' },
];

const CUSTOM_SUBCATEGORIES = [
  { key: 'Couture', label: 'Couture', shortLabel: 'Couture', icon: '🧵' },
  { key: 'Design', label: 'Design', shortLabel: 'Design', icon: '✏️' },
  { key: 'Mesure', label: 'Mesure', shortLabel: 'Mesure', icon: '📏' },
  { key: 'Broderie', label: 'Broderie', shortLabel: 'Broderie', icon: '🪡' },
  { key: 'Premium', label: 'Premium', shortLabel: 'Premium', icon: '⭐' },
];

const CATEGORY_ICON_SVGS = {
  Soldes: '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  'Mode & Beauté': '<svg viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
  Tech: '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  Enfant: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="5"/><path d="M12 12v10M7 22h10"/></svg>',
  Maison: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  Sport: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M6.5 6.5 17.5 17.5M4 12h.01M20 12h.01M12 4v.01M12 20v.01"/></svg>',
  'Sur-mesure': '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
};

const SECTION_EMOJI = {
  all: '🔥',
  Soldes: '🏷️',
  'Mode & Beauté': '👗',
  Tech: '📱',
  Enfant: '🧒',
  Maison: '🏠',
  Sport: '⚽',
  'Sur-mesure': '✨',
  Autres: '📦',
};

function mergeSubcategories(...groups) {
  const seen = new Set();
  const merged = [];
  groups.flat().forEach((subcat) => {
    if (!subcat || seen.has(subcat.key)) return;
    seen.add(subcat.key);
    merged.push(subcat);
  });
  return merged;
}

export const SHOP_SCHEMA = {
  brand: {
    name: 'Komerce',
    tagline: 'Qui cherche bien trouve bien !',
    heroImage: '/images/hero_banner.png',
  },
  nav: [
    { key: 'shop', label: 'Boutique', icon: 'home' },
    { key: 'tracking', label: 'Suivi', icon: 'map-pin' },
    { key: 'favorites', label: 'Favoris', icon: 'heart' },
    { key: 'cart', label: 'Panier', icon: 'basket' },
  ],
  categories: [
    {
      key: 'all',
      label: 'Tout',
      shortLabel: 'Tout',
      order: 0,
      showInRail: true,
      showInSections: false,
      railBadge: { kind: 'text', text: 'Tout' },
      sectionMode: 'mixed',
    },
    {
      key: 'Soldes',
      label: 'Soldes',
      shortLabel: 'Soldes',
      order: 1,
      showInRail: true,
      showInSections: true,   // page dédiée dans le pager Temu
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS.Soldes },
      filter: (product) => (product.promo_pct || 0) > 0,
      dbKeys: [],              // pas de clé DB — filtre via promo_pct
    },
    {
      key: 'Mode & Beauté',
      label: 'Mode & Beauté',
      shortLabel: 'Mode',
      order: 2,
      showInRail: true,
      showInSections: true,
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS['Mode & Beauté'] },
      dbKeys: ['Mode', 'Beauté'],
      subcategories: mergeSubcategories(MODE_SUBCATEGORIES, BEAUTY_SUBCATEGORIES),
    },
    {
      key: 'Tech',
      label: 'Tech',
      shortLabel: 'Tech',
      order: 3,
      showInRail: true,
      showInSections: true,
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS.Tech },
      dbKeys: ['Tech'],
      subcategories: TECH_SUBCATEGORIES,
    },
    {
      key: 'Enfant',
      label: 'Enfant',
      shortLabel: 'Enfant',
      order: 4,
      showInRail: true,
      showInSections: true,
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS.Enfant },
      dbKeys: ['Enfant'],
      subcategories: ENFANT_SUBCATEGORIES,
    },
    {
      key: 'Maison',
      label: 'Maison',
      shortLabel: 'Maison',
      order: 5,
      showInRail: true,
      showInSections: true,
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS.Maison },
      dbKeys: ['Maison'],
      subcategories: MAISON_SUBCATEGORIES,
    },
    {
      key: 'Sport',
      label: 'Sport',
      shortLabel: 'Sport',
      order: 6,
      showInRail: true,
      showInSections: true,
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS.Sport },
      dbKeys: ['Sport'],
      subcategories: SPORT_SUBCATEGORIES,
    },
    {
      key: 'Sur-mesure',
      label: 'Sur-mesure',
      shortLabel: 'Pour vous...',
      order: 7,
      showInRail: true,
      showInSections: true,
      railBadge: { kind: 'svg', svg: CATEGORY_ICON_SVGS['Sur-mesure'] },
      dbKeys: ['Sur-mesure'],
      subcategories: CUSTOM_SUBCATEGORIES,
    },
  ],
};

const CATEGORY_BY_KEY = new Map(SHOP_SCHEMA.categories.map((category) => [category.key, category]));

export function getCategoryList() {
  return [...SHOP_SCHEMA.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getRailCategories() {
  return getCategoryList().filter((category) => category.showInRail !== false);
}

export function getCategoryByKey(key) {
  return CATEGORY_BY_KEY.get(key) || null;
}

export function getSectionOrder() {
  return getCategoryList()
    .filter((category) => category.showInSections)
    .map((category) => category.key);
}

export function getCategoryLabel(key) {
  const category = getCategoryByKey(key);
  return category ? category.label : key;
}

export function getCategoryIcon(key) {
  const category = getCategoryByKey(key);
  return category?.railBadge || null;
}

export function getCategorySectionEmoji(key) {
  return SECTION_EMOJI[key] || '📦';
}

export function normalizeCategoryKey(rawCategory) {
  if (!rawCategory) return rawCategory;
  const match = SHOP_SCHEMA.categories.find((category) => {
    if (category.key === rawCategory) return true;
    return Array.isArray(category.dbKeys) && category.dbKeys.includes(rawCategory);
  });
  return match ? match.key : rawCategory;
}

export function getDbKeysForCategory(categoryKey) {
  const category = getCategoryByKey(categoryKey);
  if (!category) return [categoryKey];
  if (Array.isArray(category.dbKeys) && category.dbKeys.length) return [...category.dbKeys];
  return [category.key];
}

export function getSubcategories(categoryKey) {
  if (categoryKey === 'Mode') return [...MODE_SUBCATEGORIES];
  if (categoryKey === 'Beauté') return [...BEAUTY_SUBCATEGORIES];
  const category = getCategoryByKey(categoryKey);
  return category?.subcategories ? [...category.subcategories] : [];
}

export function getSubcategoryMeta(categoryKey, subcategoryKey) {
  const list = getSubcategories(categoryKey);
  return list.find((subcat) => subcat.key === subcategoryKey) || {
    key: subcategoryKey,
    label: subcategoryKey,
    shortLabel: subcategoryKey,
    icon: '✨',
  };
}

export function getNextSubcategoryKey(categoryKey, currentSubcategoryKey) {
  const list = getSubcategories(categoryKey);
  for (let index = 0; index < list.length - 1; index += 1) {
    if (list[index].key === currentSubcategoryKey) {
      return list[index + 1].key;
    }
  }
  return null;
}

export function getLegacySubcatsMap() {
  return {
    Mode: [...MODE_SUBCATEGORIES],
    'Beauté': [...BEAUTY_SUBCATEGORIES],
    'Mode & Beauté': mergeSubcategories(MODE_SUBCATEGORIES, BEAUTY_SUBCATEGORIES),
    Tech: [...TECH_SUBCATEGORIES],
    Enfant: [...ENFANT_SUBCATEGORIES],
    Maison: [...MAISON_SUBCATEGORIES],
    Sport: [...SPORT_SUBCATEGORIES],
    'Sur-mesure': [...CUSTOM_SUBCATEGORIES],
  };
}
