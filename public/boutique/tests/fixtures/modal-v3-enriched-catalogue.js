'use strict';

/**
 * Catalogue déterministe pour éprouver Product Modal v3 sans base ni réseau.
 *
 * Six topologies complémentaires :
 * - Golden Elite : SKU irréguliers, rupture, prix et médias dynamiques ;
 * - vêtement dense : boutons qui wrap et libellés usuels ;
 * - meuble : trois axes et données techniques ;
 * - éditorial simple : contenu riche sans variante ;
 * - SKU minimal : variantes sans contenu éditorial ;
 * - stress : titre long, quatre axes, huit médias et contenu très dense.
 */

const golden = require('./golden-elite-pro-detail.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(hex, n) {
  const tail = Number(n).toString(16).padStart(12, '0');
  return `${hex.repeat(8)}-${hex.repeat(4)}-4${hex.repeat(3)}-8${hex.repeat(3)}-${tail}`;
}

function svgData(title, subtitle, background, accent) {
  const safeTitle = String(title).replace(/[&<>]/g, '');
  const safeSubtitle = String(subtitle || '').replace(/[&<>]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
    <rect width="960" height="720" rx="36" fill="${background}"/>
    <circle cx="760" cy="150" r="118" fill="${accent}" opacity=".18"/>
    <circle cx="170" cy="590" r="150" fill="${accent}" opacity=".12"/>
    <rect x="170" y="150" width="620" height="390" rx="42" fill="#fff" opacity=".86"/>
    <path d="M260 445 C340 300 450 280 520 380 C575 458 650 430 720 310" fill="none" stroke="${accent}" stroke-width="28" stroke-linecap="round"/>
    <text x="480" y="615" text-anchor="middle" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#1f3024">${safeTitle}</text>
    <text x="480" y="660" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#657065">${safeSubtitle}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function content({ brand, short, highlights = [], specifications = [], sections = [], materials = [], care = [], warnings = [] }) {
  return {
    brand,
    short_description: short,
    highlights: highlights.map((label, index) => ({ key: `h${index + 1}`, label })),
    specifications: specifications.map((spec, index) => ({
      group: spec.group || 'Général',
      key: spec.key || `spec-${index + 1}`,
      label: spec.label,
      value: String(spec.value),
      unit: spec.unit || null,
      display_order: index,
    })),
    sections,
    materials,
    care,
    warnings,
    provenance: { source: 'TEST_FIXTURE', enrichment_version: 'modal-v3-catalogue-1', reviewed: true },
  };
}

function delivery(code, label, priceKmf = null, etaLabel = null) {
  return {
    code,
    label,
    available: true,
    price_kmf: priceKmf,
    eta_label: etaLabel,
    unavailable_reason: null,
  };
}

function axis(key, values, thumbnails = {}) {
  return {
    key,
    display_name: key,
    values: values.map((value) => ({ value, thumbnail_url: thumbnails[value] || null })),
  };
}

function cartesian(axes) {
  return axes.reduce(
    (rows, current) => rows.flatMap((row) => current.values.map(({ value }) => ({ ...row, [current.key]: value }))),
    [{}]
  );
}

function makeUnits({ hex, prefix, axes, basePrice, omit = () => false, outOfStock = () => false, price = () => basePrice, mediaIds = () => [] }) {
  return cartesian(axes)
    .filter((values) => !omit(values))
    .map((values, index) => ({
      sku_id: uid(hex, 1000 + index),
      sku: `${prefix}-${Object.values(values).map((v) => String(v).toUpperCase().replace(/[^A-Z0-9]+/g, '-')).join('-')}`,
      option_values: values,
      stock_status: outOfStock(values) ? 'OUT_OF_STOCK' : 'AVAILABLE',
      available_quantity: outOfStock(values) ? 0 : 3 + (index % 9),
      price_kmf: price(values, index),
      media_ids: mediaIds(values),
    }));
}

function makeMedia(hex, entries) {
  return entries.map((entry, index) => ({
    id: uid(hex, 2000 + index),
    url: svgData(entry.title, entry.subtitle, entry.background, entry.accent),
    role: entry.role || 'PRODUCT',
    alt: entry.alt || entry.title,
    option_values: entry.option_values || {},
  }));
}

function detailBase({ id, reference, name, description, category, subcategory, series, priceKmf, oldPriceKmf = null, promoPct = null, inventoryModel, media, axes, units, deliveryOptions, productContent }) {
  return {
    contract_version: '1',
    inventory_model: inventoryModel,
    product: { id, reference, name, description, category, subcategory, series },
    pricing: { price_kmf: priceKmf, old_price_kmf: oldPriceKmf, promo_pct: promoPct },
    media,
    option_axes: axes,
    sellable_units: units,
    delivery_options: deliveryOptions,
    content: productContent,
  };
}

const garmentMedia = makeMedia('b', [
  { title: 'Veste Atelier', subtitle: 'Vue principale', background: '#f4eadf', accent: '#8a5d3b' },
  { title: 'Marron', subtitle: 'Tissu texturé', background: '#ead8c8', accent: '#74482e', option_values: { Couleur: 'Marron' } },
  { title: 'Beige', subtitle: 'Coupe naturelle', background: '#f4efe4', accent: '#b39870', option_values: { Couleur: 'Beige' } },
  { title: 'Noir', subtitle: 'Finition urbaine', background: '#e8e8e8', accent: '#252525', option_values: { Couleur: 'Noir' } },
  { title: 'Détail couture', subtitle: 'Renfort épaules', background: '#f7f1e9', accent: '#8a5d3b', role: 'DETAIL' },
]);
const garmentAxes = [
  axis('Couleur', ['Marron', 'Beige', 'Noir'], {
    Marron: garmentMedia[1].url,
    Beige: garmentMedia[2].url,
    Noir: garmentMedia[3].url,
  }),
  axis('Taille', ['S', 'M', 'L', 'XL']),
];
const garment = detailBase({
  id: uid('b', 2),
  reference: 'FIX-VETEMENT-PREMIUM',
  name: 'Veste saharienne premium coupe structurée',
  description: 'Veste légère à poches multiples, adaptée au quotidien et aux voyages.',
  category: 'Mode & Beauté',
  subcategory: 'vestes',
  series: 'Atelier Komerce',
  priceKmf: 38500,
  oldPriceKmf: 45000,
  promoPct: 14,
  inventoryModel: 'SKU',
  media: garmentMedia,
  axes: garmentAxes,
  units: makeUnits({
    hex: 'b', prefix: 'FIX-VESTE', axes: garmentAxes, basePrice: 38500,
    omit: (v) => (v.Couleur === 'Noir' && v.Taille === 'XL') || (v.Couleur === 'Beige' && v.Taille === 'S'),
    outOfStock: (v) => v.Couleur === 'Marron' && v.Taille === 'L',
    price: (v) => v.Taille === 'XL' ? 41500 : 38500,
    mediaIds: (v) => [garmentMedia.find((m) => m.option_values.Couleur === v.Couleur)?.id].filter(Boolean),
  }),
  deliveryOptions: [delivery('AIR_EXPRESS', 'Livraison express', 2500, '5 à 8 jours'), delivery('SEA_STANDARD', 'Livraison maritime', null, '3 à 5 semaines')],
  productContent: content({
    brand: 'Atelier Komerce',
    short: 'Coupe structurée, toile respirante et poches fonctionnelles.',
    highlights: ['Toile souple mais structurée', 'Quatre poches fonctionnelles', 'Doublure légère respirante', 'Coupe compatible avec la superposition'],
    specifications: [
      { group: 'Coupe', label: 'Longueur dos', value: 72, unit: 'cm' },
      { group: 'Matière', label: 'Composition', value: '72% coton, 28% lin' },
      { group: 'Détails', label: 'Fermeture', value: 'Boutons renforcés' },
    ],
    sections: [{ key: 'size-guide', title: 'Guide des tailles', type: 'KEY_VALUE', text: null, items: [], entries: [{ label: 'S', value: 'Poitrine 88–94 cm' }, { label: 'M', value: 'Poitrine 95–101 cm' }, { label: 'L', value: 'Poitrine 102–108 cm' }, { label: 'XL', value: 'Poitrine 109–116 cm' }], display_order: 0 }],
    materials: ['Coton', 'Lin', 'Boutons résine'],
    care: ['Lavage délicat à 30 °C', 'Séchage à plat recommandé'],
    warnings: ['Les dimensions peuvent varier de 1 à 2 cm selon la série.'],
  }),
});

const furnitureMedia = makeMedia('c', [
  { title: 'Console Mwezi', subtitle: '160 cm · noyer', background: '#efe3d4', accent: '#6d4937' },
  { title: 'Chêne clair', subtitle: 'Finition naturelle', background: '#f2e6ce', accent: '#b98d55', option_values: { Finition: 'Chêne clair' } },
  { title: 'Noyer foncé', subtitle: 'Finition profonde', background: '#eaded6', accent: '#5e3c2f', option_values: { Finition: 'Noyer foncé' } },
  { title: 'Blanc mat', subtitle: 'Finition minérale', background: '#f3f3f0', accent: '#a3a39c', option_values: { Finition: 'Blanc mat' } },
  { title: 'Détail piètement', subtitle: 'Métal thermolaqué', background: '#ece9e2', accent: '#222', role: 'DETAIL' },
]);
const furnitureAxes = [axis('Dimensions', ['120 cm', '160 cm', '200 cm']), axis('Finition', ['Chêne clair', 'Noyer foncé', 'Blanc mat']), axis('Piètement', ['Bois', 'Métal noir'])];
const furniture = detailBase({
  id: uid('c', 3), reference: 'FIX-MEUBLE-CONFIGURABLE', name: 'Console modulaire Mwezi à trois configurations',
  description: 'Console de séjour configurable en largeur, finition et piètement.', category: 'Maison', subcategory: 'meubles', series: 'Mwezi Living',
  priceKmf: 125000, inventoryModel: 'SKU', media: furnitureMedia, axes: furnitureAxes,
  units: makeUnits({
    hex: 'c', prefix: 'FIX-MWEZI', axes: furnitureAxes, basePrice: 125000,
    omit: (v) => (v.Dimensions === '200 cm' && v.Piètement === 'Bois') || (v.Finition === 'Blanc mat' && v.Piètement === 'Bois'),
    outOfStock: (v) => v.Dimensions === '160 cm' && v.Finition === 'Noyer foncé' && v.Piètement === 'Métal noir',
    price: (v) => 105000 + ({ '120 cm': 0, '160 cm': 25000, '200 cm': 52000 }[v.Dimensions]) + (v.Piètement === 'Métal noir' ? 12000 : 0),
    mediaIds: (v) => [furnitureMedia.find((m) => m.option_values.Finition === v.Finition)?.id].filter(Boolean),
  }),
  deliveryOptions: [delivery('FREIGHT_HOME', 'Livraison spécialisée à domicile', 15000, '4 à 6 semaines')],
  productContent: content({
    brand: 'Mwezi Living', short: 'Plateau renforcé, finitions durables et montage guidé.',
    highlights: ['Trois largeurs pour s’adapter à la pièce', 'Plateau renforcé anti-flèche', 'Piètement démontable', 'Quincaillerie numérotée'],
    specifications: [
      { group: 'Dimensions', label: 'Profondeur', value: 42, unit: 'cm' },
      { group: 'Dimensions', label: 'Hauteur', value: 78, unit: 'cm' },
      { group: 'Structure', label: 'Charge maximale', value: 80, unit: 'kg' },
      { group: 'Colisage', label: 'Nombre de colis', value: 2 },
    ],
    sections: [{ key: 'assembly', title: 'Montage', type: 'TEXT', text: 'Assemblage à deux personnes recommandé. Visserie et clé incluses.', items: [], entries: [], display_order: 0 }],
    materials: ['Panneau multiplis plaqué', 'Bois massif ou acier thermolaqué'], care: ['Nettoyer avec un chiffon doux légèrement humide'], warnings: ['Fixation murale recommandée dans les foyers avec jeunes enfants.'],
  }),
});

const editorialMedia = makeMedia('d', [
  { title: 'Luminaire Bahari', subtitle: 'Vue principale', background: '#edf2ee', accent: '#2f7a62' },
  { title: 'Ambiance salon', subtitle: 'Lumière chaude', background: '#f6ead5', accent: '#d49b45', role: 'SCENE' },
  { title: 'Tressage', subtitle: 'Détail matière', background: '#efe7da', accent: '#96734d', role: 'DETAIL' },
  { title: 'Base', subtitle: 'Acier stable', background: '#ececec', accent: '#353535', role: 'DETAIL' },
  { title: 'Dimensions', subtitle: 'Hauteur 148 cm', background: '#f4f4ef', accent: '#476f60', role: 'SIZE_GUIDE' },
]);
const editorial = detailBase({
  id: uid('d', 4), reference: 'FIX-EDITORIAL-SIMPLE', name: 'Lampadaire tressé Bahari',
  description: 'Lampadaire décoratif à lumière chaude, silhouette légère et base stable.', category: 'Maison', subcategory: 'luminaires', series: 'Bahari',
  priceKmf: 68000, inventoryModel: 'SIMPLE', media: editorialMedia, axes: [], units: [],
  deliveryOptions: [delivery('SEA_STANDARD', 'Livraison maritime', null, '3 à 5 semaines')],
  productContent: content({
    brand: 'Bahari', short: 'Un produit simple sans variante, mais riche en contenu et médias.',
    highlights: ['Éclairage doux non éblouissant', 'Abat-jour tressé à la main', 'Interrupteur au pied', 'Câble textile de 2,2 m'],
    specifications: [
      { group: 'Dimensions', label: 'Hauteur', value: 148, unit: 'cm' },
      { group: 'Éclairage', label: 'Culot', value: 'E27' },
      { group: 'Éclairage', label: 'Puissance maximale', value: 12, unit: 'W LED' },
      { group: 'Sécurité', label: 'Indice', value: 'IP20' },
    ],
    sections: [{ key: 'story', title: 'Conception', type: 'TEXT', text: 'Le tressage diffuse la lumière et crée un motif discret sur les murs.', items: [], entries: [], display_order: 0 }],
    materials: ['Fibre tressée', 'Structure acier', 'Câble textile'], care: ['Dépoussiérer avec une brosse douce'], warnings: ['Usage intérieur uniquement.', 'Ampoule non fournie.'],
  }),
});

const minimalMedia = makeMedia('e', [
  { title: 'Boîtes modulaires', subtitle: 'Lot configurable', background: '#e7eef4', accent: '#3f6e96' },
  { title: 'Transparent', subtitle: 'Contrôle visuel', background: '#eef5f8', accent: '#78a4b5', option_values: { Finition: 'Transparent' } },
  { title: 'Fumé', subtitle: 'Aspect discret', background: '#e6e8ea', accent: '#444d55', option_values: { Finition: 'Fumé' } },
]);
const minimalAxes = [axis('Format', ['Petit', 'Moyen', 'Grand']), axis('Finition', ['Transparent', 'Fumé'])];
const skuMinimal = detailBase({
  id: uid('e', 5), reference: 'FIX-SKU-MINIMAL', name: 'Boîtes de rangement modulaires', description: 'Modules empilables disponibles en plusieurs formats.',
  category: 'Maison', subcategory: 'rangement', series: 'Ordre', priceKmf: 8500, inventoryModel: 'SKU', media: minimalMedia, axes: minimalAxes,
  units: makeUnits({ hex: 'e', prefix: 'FIX-BOX', axes: minimalAxes, basePrice: 8500, omit: (v) => v.Format === 'Grand' && v.Finition === 'Fumé', outOfStock: (v) => v.Format === 'Moyen' && v.Finition === 'Transparent', price: (v) => ({ Petit: 8500, Moyen: 11500, Grand: 15500 }[v.Format]) }),
  deliveryOptions: [delivery('SEA_STANDARD', 'Livraison standard')],
  productContent: content({ brand: null, short: 'Fixture SKU volontairement pauvre en contenu.' }),
});

const stressMedia = makeMedia('f', [
  { title: 'Station créative', subtitle: 'Vue complète', background: '#ede9f6', accent: '#6c4aa0' },
  { title: 'Sable volcanique', subtitle: 'Coloris', background: '#efe7da', accent: '#8b6b4b', option_values: { Couleur: 'Sable volcanique' } },
  { title: 'Vert lagon profond', subtitle: 'Coloris', background: '#dfeee9', accent: '#1f7564', option_values: { Couleur: 'Vert lagon profond' } },
  { title: 'Noir minéral', subtitle: 'Coloris', background: '#e6e6e6', accent: '#202020', option_values: { Couleur: 'Noir minéral' } },
  { title: 'Plateau', subtitle: 'Détail surface', background: '#f1ece5', accent: '#8f6d4f', role: 'DETAIL' },
  { title: 'Connectique', subtitle: 'Détail technique', background: '#e7edf0', accent: '#466b7c', role: 'DETAIL' },
  { title: 'En situation', subtitle: 'Bureau complet', background: '#f3e9d6', accent: '#c57b32', role: 'SCENE' },
  { title: 'Dimensions', subtitle: 'Guide complet', background: '#f2f2ee', accent: '#5b5b55', role: 'SIZE_GUIDE' },
]);
const stressAxes = [axis('Couleur', ['Sable volcanique', 'Vert lagon profond', 'Noir minéral']), axis('Largeur du plateau', ['120 cm', '160 cm', '200 cm']), axis('Module latéral', ['Sans module', 'Caisson 3 tiroirs']), axis('Gestion des câbles', ['Passe-câbles simple', 'Rail complet'])];
const stress = detailBase({
  id: uid('f', 6), reference: 'FIX-STRESS-LAYOUT-ULTRA-LONG-REFERENCE-2026',
  name: 'Station de travail créative modulable avec plateau renforcé et organisation complète des câbles',
  description: 'Fixture de résistance destinée à éprouver les titres longs, les variantes nombreuses, les médias et les détails étendus.',
  category: 'Bricolage', subcategory: 'mobilier-technique', series: 'Stress Lab', priceKmf: 210000, oldPriceKmf: 255000, promoPct: 18,
  inventoryModel: 'SKU', media: stressMedia, axes: stressAxes,
  units: makeUnits({
    hex: 'f', prefix: 'FIX-STRESS', axes: stressAxes, basePrice: 210000,
    omit: (v) => (v['Largeur du plateau'] === '120 cm' && v['Module latéral'] === 'Caisson 3 tiroirs' && v['Gestion des câbles'] === 'Rail complet') || (v.Couleur === 'Noir minéral' && v['Largeur du plateau'] === '200 cm'),
    outOfStock: (v) => v.Couleur === 'Vert lagon profond' && v['Largeur du plateau'] === '160 cm' && v['Module latéral'] === 'Caisson 3 tiroirs',
    price: (v) => 210000 + ({ '120 cm': 0, '160 cm': 45000, '200 cm': 90000 }[v['Largeur du plateau']]) + (v['Module latéral'] === 'Caisson 3 tiroirs' ? 32000 : 0) + (v['Gestion des câbles'] === 'Rail complet' ? 9500 : 0),
    mediaIds: (v) => [stressMedia.find((m) => m.option_values.Couleur === v.Couleur)?.id].filter(Boolean),
  }),
  deliveryOptions: [delivery('FREIGHT_HOME', 'Livraison spécialisée avec prise de rendez-vous', 22000, '4 à 7 semaines'), delivery('PICKUP_HUB', 'Retrait au hub Komerce', 0, '3 à 5 semaines')],
  productContent: content({
    brand: 'Stress Lab', short: 'Fixture volontairement dense pour tester la robustesse complète de la modale V3.',
    highlights: ['Plateau renforcé anti-flèche', 'Quatre axes de configuration indépendants', 'Gestion des câbles évolutive', 'Caisson latéral réversible', 'Bords adoucis', 'Piètement réglable', 'Montage guidé', 'Pièces de rechange référencées'],
    specifications: [
      { group: 'Structure', label: 'Charge maximale du plateau', value: 120, unit: 'kg' },
      { group: 'Structure', label: 'Épaisseur du plateau', value: 32, unit: 'mm' },
      { group: 'Ergonomie', label: 'Hauteur réglable', value: '72 à 78', unit: 'cm' },
      { group: 'Connectique', label: 'Passages de câble', value: 3 },
      { group: 'Colisage', label: 'Nombre maximal de colis', value: 5 },
      { group: 'Montage', label: 'Durée indicative', value: 75, unit: 'min' },
      { group: 'Garantie', label: 'Durée', value: 2, unit: 'ans' },
    ],
    sections: [
      { key: 'installation', title: 'Installation', type: 'TEXT', text: 'Prévoir une zone libre de 2,5 m × 2 m. Le montage à deux personnes est fortement recommandé.', items: [], entries: [], display_order: 0 },
      { key: 'compatibility', title: 'Compatibilités', type: 'BULLETS', text: null, items: ['Bras écran à pince', 'Multiprise sous plateau', 'Caisson réversible gauche/droite'], entries: [], display_order: 1 },
    ],
    materials: ['Multiplis haute densité', 'Acier thermolaqué', 'Patins élastomère', 'Rail aluminium'],
    care: ['Nettoyer sans produit abrasif', 'Resserrer la visserie après un mois', 'Éviter l’exposition directe prolongée au soleil'],
    warnings: ['Le colis le plus lourd dépasse 30 kg.', 'Ne pas déplacer la station assemblée en la tirant par le plateau.'],
  }),
});

const elite = clone(golden);
elite.product.reference = 'GOLDEN-ELITE-PRO';

const cases = [
  { key: 'elite', search: 'Elite Pro', detail: elite, validSelection: { Couleur: 'Bleu', Taille: '42' }, issueSelection: { Couleur: 'Bleu', Taille: '43' }, expectedAxes: 2 },
  { key: 'garment', search: 'saharienne', detail: garment, validSelection: { Couleur: 'Marron', Taille: 'M' }, issueSelection: { Couleur: 'Marron', Taille: 'L' }, expectedAxes: 2 },
  { key: 'furniture', search: 'Mwezi', detail: furniture, validSelection: { Dimensions: '160 cm', Finition: 'Chêne clair', Piètement: 'Métal noir' }, issueSelection: { Dimensions: '160 cm', Finition: 'Noyer foncé', Piètement: 'Métal noir' }, expectedAxes: 3 },
  { key: 'editorial', search: 'Bahari', detail: editorial, validSelection: null, issueSelection: null, expectedAxes: 0 },
  { key: 'sku-minimal', search: 'modulaires', detail: skuMinimal, validSelection: { Format: 'Petit', Finition: 'Transparent' }, issueSelection: { Format: 'Moyen', Finition: 'Transparent' }, expectedAxes: 2 },
  { key: 'stress', search: 'Station de travail', detail: stress, validSelection: { Couleur: 'Sable volcanique', 'Largeur du plateau': '160 cm', 'Module latéral': 'Sans module', 'Gestion des câbles': 'Rail complet' }, issueSelection: { Couleur: 'Vert lagon profond', 'Largeur du plateau': '160 cm', 'Module latéral': 'Caisson 3 tiroirs', 'Gestion des câbles': 'Passe-câbles simple' }, expectedAxes: 4 },
];

function toListProduct(detail) {
  const availableUnits = (detail.sellable_units || []).filter((unit) => unit.stock_status === 'AVAILABLE');
  return {
    id: detail.product.id,
    product_ref: detail.product.reference,
    reference: detail.product.reference,
    name: detail.product.name,
    description: detail.product.description || '',
    category: detail.product.category,
    subcategory: detail.product.subcategory,
    price_kmf: detail.pricing.price_kmf,
    old_price_kmf: detail.pricing.old_price_kmf,
    promo_pct: detail.pricing.promo_pct,
    image_url: detail.media[0]?.url || '',
    images: detail.media.map((entry) => entry.url),
    inventory_model: detail.inventory_model,
    has_variants: detail.inventory_model === 'SKU',
    is_available: detail.inventory_model === 'SIMPLE' || availableUnits.length > 0,
    stock: detail.inventory_model === 'SIMPLE' ? 12 : availableUnits.reduce((sum, unit) => sum + Number(unit.available_quantity || 0), 0),
  };
}

const products = cases.map(({ detail }) => toListProduct(detail));
const byId = new Map(cases.map((entry) => [String(entry.detail.product.id), entry]));

module.exports = {
  cases,
  products,
  byId,
  toListProduct,
  getCaseById(id) { return byId.get(String(id)) || null; },
};
