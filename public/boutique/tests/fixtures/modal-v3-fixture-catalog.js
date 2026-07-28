'use strict';

/**
 * Catalogue déterministe de fixtures Product Detail v1 pour la validation
 * fonctionnelle et visuelle de la modale produit v3.
 *
 * Objectifs couverts :
 * - diversité des topologies produit (LEGACY_VARIANTS et SKU) ;
 * - recherche catalogue réelle dans les tests ;
 * - variantes, ruptures, incompatibilités, prix et médias dynamiques ;
 * - contenu éditorial riche indépendant du modèle d'inventaire ;
 * - résistance du layout desktop/mobile.
 *
 * Ces fixtures sont uniquement destinées aux tests front locaux. Elles ne
 * remplacent pas la Golden Chain réelle (seed + raffinerie + base).
 */

const goldenEliteDetail = require('./golden-elite-pro-detail.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function svgDataUri({ label, subtitle = '', accent = '#287d3e', secondary = '#f3eadc', mark = 'K' }) {
  const safeLabel = String(label).replace(/[<&>]/g, '');
  const safeSubtitle = String(subtitle).replace(/[<&>]/g, '');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${secondary}"/>
          <stop offset="1" stop-color="#ffffff"/>
        </linearGradient>
      </defs>
      <rect width="960" height="960" rx="72" fill="url(#bg)"/>
      <circle cx="760" cy="190" r="110" fill="${accent}" opacity="0.12"/>
      <circle cx="180" cy="760" r="150" fill="${accent}" opacity="0.08"/>
      <rect x="210" y="220" width="540" height="440" rx="80" fill="#ffffff" stroke="${accent}" stroke-width="18"/>
      <text x="480" y="455" text-anchor="middle" font-family="Arial, sans-serif" font-size="210" font-weight="700" fill="${accent}">${mark}</text>
      <text x="480" y="735" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#1f3024">${safeLabel}</text>
      <text x="480" y="785" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" fill="#6d796d">${safeSubtitle}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function media({ id, label, subtitle, role = 'PRODUCT', optionValues = {}, accent, secondary, mark }) {
  return {
    id,
    url: svgDataUri({ label, subtitle, accent, secondary, mark }),
    role,
    alt: subtitle ? `${label} — ${subtitle}` : label,
    option_values: optionValues,
  };
}

function axis(key, values) {
  return {
    key,
    display_name: key,
    values: values.map((entry) => (
      typeof entry === 'string'
        ? { value: entry, thumbnail_url: null }
        : { value: entry.value, thumbnail_url: entry.thumbnail_url || null }
    )),
  };
}

function unit({ id, sku, optionValues, stock = 8, status, price, mediaIds = [] }) {
  const resolvedStatus = status || (stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK');
  return {
    sku_id: id,
    sku,
    option_values: optionValues,
    stock_status: resolvedStatus,
    available_quantity: resolvedStatus === 'AVAILABLE' ? stock : 0,
    price_kmf: price,
    media_ids: mediaIds,
  };
}

function content({
  brand,
  shortDescription,
  highlights = [],
  specifications = [],
  sections = [],
  materials = [],
  care = [],
  warnings = [],
}) {
  return {
    brand: brand || null,
    short_description: shortDescription || null,
    highlights: highlights.map((label, index) => ({ key: `h${index + 1}`, label })),
    specifications: specifications.map((spec, index) => ({
      group: spec.group || 'Général',
      key: spec.key || `spec-${index + 1}`,
      label: spec.label,
      value: String(spec.value),
      unit: spec.unit || null,
      display_order: index,
    })),
    sections: sections.map((section, index) => ({
      key: section.key || `section-${index + 1}`,
      title: section.title,
      type: section.type || 'TEXT',
      text: section.text || null,
      items: section.items || [],
      entries: section.entries || [],
      display_order: index,
    })),
    materials,
    care,
    warnings,
    provenance: {
      source: 'MANUAL',
      enrichment_version: 'modal-v3-fixtures-v1',
      reviewed: true,
    },
  };
}

function delivery(code, label, { price = null, eta = null, available = true, reason = null } = {}) {
  return {
    code,
    label,
    available,
    price_kmf: price,
    eta_label: eta,
    unavailable_reason: reason,
  };
}

const GARMENT_MEDIA = {
  neutral: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb2001',
  brown: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb2002',
  beige: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb2003',
  black: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb2004',
  detail: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb2005',
};

const premiumGarment = {
  contract_version: '1',
  inventory_model: 'SKU',
  product: {
    id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb0001',
    reference: 'FIX-VETEMENT-PREMIUM',
    name: 'Veste saharienne premium à coupe ajustée',
    description: 'Veste légère structurée, pensée pour les journées chaudes et les soirées plus fraîches.',
    category: 'Mode & Beauté',
    subcategory: 'vestes',
    series: 'Komerce Atelier',
  },
  pricing: { price_kmf: 18900, old_price_kmf: 22900, promo_pct: 17 },
  media: [
    media({ id: GARMENT_MEDIA.neutral, label: 'Veste premium', subtitle: 'Vue principale', accent: '#8a5d3b', secondary: '#f3eadc', mark: 'V' }),
    media({ id: GARMENT_MEDIA.brown, label: 'Veste premium', subtitle: 'Marron', accent: '#7b4f2f', secondary: '#efe0d2', mark: 'M', optionValues: { Couleur: 'Marron' } }),
    media({ id: GARMENT_MEDIA.beige, label: 'Veste premium', subtitle: 'Beige sable', accent: '#b28e64', secondary: '#f5eddf', mark: 'B', optionValues: { Couleur: 'Beige sable' } }),
    media({ id: GARMENT_MEDIA.black, label: 'Veste premium', subtitle: 'Noir profond', accent: '#242424', secondary: '#e8e8e8', mark: 'N', optionValues: { Couleur: 'Noir profond' } }),
    media({ id: GARMENT_MEDIA.detail, label: 'Veste premium', subtitle: 'Détail poche et couture', role: 'DETAIL', accent: '#8a5d3b', secondary: '#f7f2e8', mark: 'D' }),
  ],
  option_axes: [
    axis('Couleur', [
      { value: 'Marron', thumbnail_url: svgDataUri({ label: 'Marron', accent: '#7b4f2f', secondary: '#efe0d2', mark: 'M' }) },
      { value: 'Beige sable', thumbnail_url: svgDataUri({ label: 'Beige', accent: '#b28e64', secondary: '#f5eddf', mark: 'B' }) },
      { value: 'Noir profond', thumbnail_url: svgDataUri({ label: 'Noir', accent: '#242424', secondary: '#e8e8e8', mark: 'N' }) },
    ]),
    axis('Taille', ['S', 'M', 'L', 'XL']),
  ],
  sellable_units: [
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1101', sku: 'VEST-MAR-S', optionValues: { Couleur: 'Marron', Taille: 'S' }, price: 18900, mediaIds: [GARMENT_MEDIA.brown, GARMENT_MEDIA.detail] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1102', sku: 'VEST-MAR-M', optionValues: { Couleur: 'Marron', Taille: 'M' }, price: 18900, mediaIds: [GARMENT_MEDIA.brown, GARMENT_MEDIA.detail] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1103', sku: 'VEST-MAR-L', optionValues: { Couleur: 'Marron', Taille: 'L' }, stock: 0, price: 18900, mediaIds: [GARMENT_MEDIA.brown] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1201', sku: 'VEST-BEI-S', optionValues: { Couleur: 'Beige sable', Taille: 'S' }, price: 18900, mediaIds: [GARMENT_MEDIA.beige] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1202', sku: 'VEST-BEI-M', optionValues: { Couleur: 'Beige sable', Taille: 'M' }, price: 18900, mediaIds: [GARMENT_MEDIA.beige] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1203', sku: 'VEST-BEI-L', optionValues: { Couleur: 'Beige sable', Taille: 'L' }, price: 19900, mediaIds: [GARMENT_MEDIA.beige] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1204', sku: 'VEST-BEI-XL', optionValues: { Couleur: 'Beige sable', Taille: 'XL' }, stock: 0, price: 19900, mediaIds: [GARMENT_MEDIA.beige] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1302', sku: 'VEST-NOI-M', optionValues: { Couleur: 'Noir profond', Taille: 'M' }, price: 20900, mediaIds: [GARMENT_MEDIA.black] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1303', sku: 'VEST-NOI-L', optionValues: { Couleur: 'Noir profond', Taille: 'L' }, price: 20900, mediaIds: [GARMENT_MEDIA.black] }),
    unit({ id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb1304', sku: 'VEST-NOI-XL', optionValues: { Couleur: 'Noir profond', Taille: 'XL' }, price: 21900, mediaIds: [GARMENT_MEDIA.black] }),
  ],
  delivery_options: [
    delivery('SEA_STANDARD', 'Livraison standard', { eta: 'Sous 3 à 5 semaines' }),
    delivery('AIR_EXPRESS', 'Livraison express', { price: 3500, eta: 'Sous 7 à 10 jours' }),
  ],
  content: content({
    brand: 'Komerce Atelier',
    shortDescription: 'Une veste structurée et respirante, facile à porter au quotidien.',
    highlights: [
      'Coupe ajustée sans gêner les mouvements',
      'Tissu léger adapté aux climats chauds',
      'Quatre poches fonctionnelles',
      'Doublure intérieure douce et respirante',
    ],
    specifications: [
      { group: 'Coupe', label: 'Silhouette', value: 'Ajustée' },
      { group: 'Coupe', label: 'Longueur', value: 'Mi-hanches' },
      { group: 'Tissu', label: 'Composition', value: 'Coton et fibres techniques' },
      { group: 'Tissu', label: 'Respirabilité', value: 'Élevée' },
      { group: 'Détails', label: 'Poches', value: '4' },
      { group: 'Détails', label: 'Fermeture', value: 'Boutons renforcés' },
    ],
    sections: [{
      key: 'size-guide',
      title: 'Guide des tailles',
      type: 'KEY_VALUE',
      entries: [
        { label: 'S', value: 'Tour de poitrine 88–94 cm' },
        { label: 'M', value: 'Tour de poitrine 95–101 cm' },
        { label: 'L', value: 'Tour de poitrine 102–108 cm' },
        { label: 'XL', value: 'Tour de poitrine 109–116 cm' },
      ],
    }],
    materials: ['Coton majoritaire', 'Fibres techniques respirantes', 'Boutons polymère renforcé'],
    care: ['Lavage délicat à 30 °C', 'Séchage à l’air libre', 'Repassage doux sur l’envers'],
    warnings: ['Les mesures peuvent varier de 1 à 2 cm selon la série de production.'],
  }),
};

const FURNITURE_MEDIA = {
  neutral: 'cccccccc-3333-4ccc-8ccc-cccccccc2001',
  oak: 'cccccccc-3333-4ccc-8ccc-cccccccc2002',
  walnut: 'cccccccc-3333-4ccc-8ccc-cccccccc2003',
  white: 'cccccccc-3333-4ccc-8ccc-cccccccc2004',
  assembly: 'cccccccc-3333-4ccc-8ccc-cccccccc2005',
};

const configurableFurniture = {
  contract_version: '1',
  inventory_model: 'SKU',
  product: {
    id: 'cccccccc-3333-4ccc-8ccc-cccccccc0001',
    reference: 'FIX-MEUBLE-CONFIGURABLE',
    name: 'Console modulable Horizon avec plateau personnalisable',
    description: 'Console contemporaine configurable selon la largeur, la finition du plateau et le type de piètement.',
    category: 'Maison',
    subcategory: 'mobilier',
    series: 'Horizon',
  },
  pricing: { price_kmf: 68000, old_price_kmf: null, promo_pct: null },
  media: [
    media({ id: FURNITURE_MEDIA.neutral, label: 'Console Horizon', subtitle: 'Composition neutre', accent: '#73543b', secondary: '#eee6d8', mark: 'H' }),
    media({ id: FURNITURE_MEDIA.oak, label: 'Console Horizon', subtitle: 'Chêne clair naturel', accent: '#b68b58', secondary: '#f4eadb', mark: 'C', optionValues: { Finition: 'Chêne clair naturel' } }),
    media({ id: FURNITURE_MEDIA.walnut, label: 'Console Horizon', subtitle: 'Noyer foncé veiné', accent: '#5b3b29', secondary: '#eadfd6', mark: 'N', optionValues: { Finition: 'Noyer foncé veiné' } }),
    media({ id: FURNITURE_MEDIA.white, label: 'Console Horizon', subtitle: 'Blanc mat anti-traces', accent: '#8b8b84', secondary: '#f5f5f1', mark: 'B', optionValues: { Finition: 'Blanc mat anti-traces' } }),
    media({ id: FURNITURE_MEDIA.assembly, label: 'Console Horizon', subtitle: 'Montage et fixations', role: 'DETAIL', accent: '#287d3e', secondary: '#eaf5eb', mark: 'A' }),
  ],
  option_axes: [
    axis('Dimensions', ['120 × 35 cm', '160 × 40 cm', '200 × 45 cm']),
    axis('Finition', [
      { value: 'Chêne clair naturel', thumbnail_url: svgDataUri({ label: 'Chêne clair', accent: '#b68b58', secondary: '#f4eadb', mark: 'C' }) },
      { value: 'Noyer foncé veiné', thumbnail_url: svgDataUri({ label: 'Noyer foncé', accent: '#5b3b29', secondary: '#eadfd6', mark: 'N' }) },
      { value: 'Blanc mat anti-traces', thumbnail_url: svgDataUri({ label: 'Blanc mat', accent: '#8b8b84', secondary: '#f5f5f1', mark: 'B' }) },
    ]),
    axis('Piètement', ['Bois massif assorti', 'Métal noir thermolaqué']),
  ],
  sellable_units: [
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc1101', sku: 'HOR-120-CH-BOIS', optionValues: { Dimensions: '120 × 35 cm', Finition: 'Chêne clair naturel', Piètement: 'Bois massif assorti' }, price: 68000, mediaIds: [FURNITURE_MEDIA.oak, FURNITURE_MEDIA.assembly] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc1102', sku: 'HOR-120-CH-MET', optionValues: { Dimensions: '120 × 35 cm', Finition: 'Chêne clair naturel', Piètement: 'Métal noir thermolaqué' }, price: 72000, mediaIds: [FURNITURE_MEDIA.oak] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc1202', sku: 'HOR-120-NO-MET', optionValues: { Dimensions: '120 × 35 cm', Finition: 'Noyer foncé veiné', Piètement: 'Métal noir thermolaqué' }, price: 76000, mediaIds: [FURNITURE_MEDIA.walnut] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc1302', sku: 'HOR-120-BL-MET', optionValues: { Dimensions: '120 × 35 cm', Finition: 'Blanc mat anti-traces', Piètement: 'Métal noir thermolaqué' }, price: 71000, mediaIds: [FURNITURE_MEDIA.white] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc2101', sku: 'HOR-160-CH-BOIS', optionValues: { Dimensions: '160 × 40 cm', Finition: 'Chêne clair naturel', Piètement: 'Bois massif assorti' }, price: 84000, mediaIds: [FURNITURE_MEDIA.oak] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc2102', sku: 'HOR-160-CH-MET', optionValues: { Dimensions: '160 × 40 cm', Finition: 'Chêne clair naturel', Piètement: 'Métal noir thermolaqué' }, price: 88000, mediaIds: [FURNITURE_MEDIA.oak] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc2202', sku: 'HOR-160-NO-MET', optionValues: { Dimensions: '160 × 40 cm', Finition: 'Noyer foncé veiné', Piètement: 'Métal noir thermolaqué' }, stock: 0, price: 92000, mediaIds: [FURNITURE_MEDIA.walnut] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc2302', sku: 'HOR-160-BL-MET', optionValues: { Dimensions: '160 × 40 cm', Finition: 'Blanc mat anti-traces', Piètement: 'Métal noir thermolaqué' }, price: 87000, mediaIds: [FURNITURE_MEDIA.white] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc3102', sku: 'HOR-200-CH-MET', optionValues: { Dimensions: '200 × 45 cm', Finition: 'Chêne clair naturel', Piètement: 'Métal noir thermolaqué' }, price: 108000, mediaIds: [FURNITURE_MEDIA.oak] }),
    unit({ id: 'cccccccc-3333-4ccc-8ccc-cccccccc3202', sku: 'HOR-200-NO-MET', optionValues: { Dimensions: '200 × 45 cm', Finition: 'Noyer foncé veiné', Piètement: 'Métal noir thermolaqué' }, price: 116000, mediaIds: [FURNITURE_MEDIA.walnut] }),
  ],
  delivery_options: [
    delivery('SEA_SPECIAL', 'Livraison mobilier spécialisée', { price: 6500, eta: 'Sous 5 à 7 semaines' }),
  ],
  content: content({
    brand: 'Horizon Living',
    shortDescription: 'Une console configurable qui teste les libellés longs et les choix sur trois axes.',
    highlights: [
      'Plateau renforcé prévu pour une charge répartie de 60 kg',
      'Piètement démontable pour faciliter le transport',
      'Patins réglables pour compenser les sols irréguliers',
      'Finitions résistantes aux usages quotidiens',
    ],
    specifications: [
      { group: 'Structure', label: 'Charge maximale', value: '60', unit: 'kg' },
      { group: 'Structure', label: 'Épaisseur du plateau', value: '30', unit: 'mm' },
      { group: 'Structure', label: 'Assemblage', value: 'Ferrures métalliques renforcées' },
      { group: 'Finition', label: 'Protection', value: 'Vernis mat ou laque anti-traces' },
      { group: 'Logistique', label: 'Colis', value: '2' },
      { group: 'Logistique', label: 'Montage estimé', value: '35', unit: 'min' },
    ],
    sections: [
      { key: 'assembly', title: 'Montage', type: 'TEXT', text: 'Le plateau et le piètement sont livrés séparément. Les fixations et une notice illustrée sont incluses.' },
      { key: 'clearances', title: 'Dégagement conseillé', type: 'KEY_VALUE', entries: [
        { label: 'À l’arrière', value: '5 cm' },
        { label: 'Sur les côtés', value: '10 cm' },
        { label: 'Devant', value: '60 cm' },
      ] },
    ],
    materials: ['Panneau haute densité', 'Placage bois ou laque mate', 'Acier thermolaqué selon option'],
    care: ['Nettoyer avec un chiffon doux légèrement humide', 'Éviter les produits abrasifs', 'Resserrer les fixations après trois mois'],
    warnings: ['Fixer au mur dans les foyers avec de jeunes enfants.', 'La version 200 cm n’est pas proposée avec le piètement bois massif.'],
  }),
};

const editorialSimple = {
  contract_version: '1',
  inventory_model: 'LEGACY_VARIANTS',
  product: {
    id: 'dddddddd-4444-4ddd-8ddd-dddddddd0001',
    reference: 'FIX-EDITORIAL-SIMPLE',
    name: 'Coffret de rangement textile respirant — collection maison',
    description: 'Ensemble de boîtes souples pour organiser vêtements, linge et accessoires sans multiplier les variantes commerciales.',
    category: 'Maison',
    subcategory: 'rangement',
    series: 'Maison ordonnée',
  },
  pricing: { price_kmf: 14500, old_price_kmf: 18000, promo_pct: 19 },
  media: [
    media({ id: 'dddddddd-4444-4ddd-8ddd-dddddddd2001', label: 'Coffret textile', subtitle: 'Ensemble complet', accent: '#647d8c', secondary: '#edf2f4', mark: 'R' }),
    media({ id: 'dddddddd-4444-4ddd-8ddd-dddddddd2002', label: 'Coffret textile', subtitle: 'Disposition tiroir', role: 'SCENE', accent: '#647d8c', secondary: '#f4efe6', mark: 'T' }),
    media({ id: 'dddddddd-4444-4ddd-8ddd-dddddddd2003', label: 'Coffret textile', subtitle: 'Détail couture', role: 'DETAIL', accent: '#445b68', secondary: '#edf2f4', mark: 'D' }),
    media({ id: 'dddddddd-4444-4ddd-8ddd-dddddddd2004', label: 'Coffret textile', subtitle: 'Poches latérales', role: 'DETAIL', accent: '#7b8f9b', secondary: '#f5f0e7', mark: 'P' }),
    media({ id: 'dddddddd-4444-4ddd-8ddd-dddddddd2005', label: 'Coffret textile', subtitle: 'Dimensions', role: 'SIZE_GUIDE', accent: '#287d3e', secondary: '#eaf5eb', mark: '↔' }),
  ],
  option_axes: [],
  sellable_units: [],
  delivery_options: [delivery('SEA_STANDARD', 'Livraison standard', { eta: 'Sous 3 à 5 semaines' })],
  content: content({
    brand: 'Maison ordonnée',
    shortDescription: 'Un produit simple mais fortement enrichi : galerie, détails, matériaux, entretien et conseils.',
    highlights: [
      'Tissu respirant qui limite les odeurs de confinement',
      'Structure souple qui se replie à plat',
      'Poignées renforcées sur les côtés',
      'Formats complémentaires pour tiroirs et étagères',
      'Fenêtre translucide pour identifier le contenu',
    ],
    specifications: [
      { group: 'Ensemble', label: 'Nombre de pièces', value: '10' },
      { group: 'Ensemble', label: 'Poids total', value: '1.8', unit: 'kg' },
      { group: 'Grand format', label: 'Dimensions', value: '44 × 30 × 20', unit: 'cm' },
      { group: 'Format moyen', label: 'Dimensions', value: '32 × 22 × 16', unit: 'cm' },
      { group: 'Petit format', label: 'Dimensions', value: '16 × 12 × 10', unit: 'cm' },
      { group: 'Usage', label: 'Compatibilité', value: 'Tiroirs, placards et étagères' },
    ],
    sections: [
      { key: 'use-cases', title: 'Exemples d’utilisation', type: 'BULLETS', items: ['Sous-vêtements', 'T-shirts', 'Foulards', 'Accessoires', 'Linge de maison'] },
      { key: 'organization', title: 'Conseil d’organisation', type: 'TEXT', text: 'Réserver un format par catégorie facilite le rangement et évite de déplacer tout le contenu du tiroir.' },
    ],
    materials: ['Tissu non tissé respirant', 'Renforts en carton recyclé', 'Fenêtre PEVA translucide'],
    care: ['Dépoussiérer avec un chiffon sec', 'Nettoyer localement avec une éponge humide', 'Laisser sécher complètement avant rangement'],
    warnings: ['Ne pas laver en machine.', 'Ne pas stocker de produits humides.'],
  }),
};

const skuMinimal = {
  contract_version: '1',
  inventory_model: 'SKU',
  product: {
    id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee0001',
    reference: 'FIX-SKU-MINIMAL',
    name: 'Nettoyant concentré multi-usage',
    description: 'Produit SKU volontairement pauvre en contenu éditorial pour vérifier que les variantes ne dépendent pas de l’enrichissement.',
    category: 'Maison',
    subcategory: 'entretien',
    series: null,
  },
  pricing: { price_kmf: 3500, old_price_kmf: null, promo_pct: null },
  media: [
    media({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee2001', label: 'Nettoyant', subtitle: 'Flacon neutre', accent: '#2e8b7d', secondary: '#e8f4f1', mark: 'N' }),
    media({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee2002', label: 'Nettoyant', subtitle: 'Citron', accent: '#d6a500', secondary: '#fff8d8', mark: 'C', optionValues: { Parfum: 'Citron frais' } }),
  ],
  option_axes: [
    axis('Format', ['250 ml', '500 ml', '1 litre']),
    axis('Parfum', ['Neutre', 'Citron frais']),
  ],
  sellable_units: [
    unit({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee1101', sku: 'NET-250-NEU', optionValues: { Format: '250 ml', Parfum: 'Neutre' }, price: 3500, mediaIds: ['eeeeeeee-5555-4eee-8eee-eeeeeeee2001'] }),
    unit({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee1102', sku: 'NET-250-CIT', optionValues: { Format: '250 ml', Parfum: 'Citron frais' }, price: 3800, mediaIds: ['eeeeeeee-5555-4eee-8eee-eeeeeeee2002'] }),
    unit({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee1201', sku: 'NET-500-NEU', optionValues: { Format: '500 ml', Parfum: 'Neutre' }, price: 5900, mediaIds: ['eeeeeeee-5555-4eee-8eee-eeeeeeee2001'] }),
    unit({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee1202', sku: 'NET-500-CIT', optionValues: { Format: '500 ml', Parfum: 'Citron frais' }, stock: 0, price: 6300, mediaIds: ['eeeeeeee-5555-4eee-8eee-eeeeeeee2002'] }),
    unit({ id: 'eeeeeeee-5555-4eee-8eee-eeeeeeee1301', sku: 'NET-1L-NEU', optionValues: { Format: '1 litre', Parfum: 'Neutre' }, price: 9800, mediaIds: ['eeeeeeee-5555-4eee-8eee-eeeeeeee2001'] }),
  ],
  delivery_options: [delivery('SEA_STANDARD', 'Livraison standard')],
  content: content({
    brand: null,
    shortDescription: 'Concentré à diluer selon l’usage.',
    warnings: ['Tenir hors de portée des enfants.'],
  }),
};

const STRESS_COLORS = ['Bleu nuit métallisé', 'Vert forêt profond', 'Sable nacré lumineux', 'Rouge terre cuite'];
const STRESS_CAPACITIES = ['Format compact 12 L', 'Format quotidien 20 L', 'Grand format voyage 32 L', 'Très grand format familial 48 L'];
const STRESS_FINISHES = ['Finition mate anti-traces', 'Finition satinée renforcée', 'Finition brillante premium'];
const STRESS_PACKS = ['Produit seul', 'Pack avec housse et sangle', 'Pack complet avec accessoires'];

const stressMedia = [
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2001', label: 'Organiseur Nomade', subtitle: 'Vue neutre', accent: '#3b556f', secondary: '#edf2f7', mark: 'N' }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2002', label: 'Organiseur Nomade', subtitle: STRESS_COLORS[0], accent: '#24364b', secondary: '#e8edf2', mark: 'B', optionValues: { Couleur: STRESS_COLORS[0] } }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2003', label: 'Organiseur Nomade', subtitle: STRESS_COLORS[1], accent: '#315742', secondary: '#e8f0e9', mark: 'V', optionValues: { Couleur: STRESS_COLORS[1] } }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2004', label: 'Organiseur Nomade', subtitle: STRESS_COLORS[2], accent: '#b69b6c', secondary: '#f5efe4', mark: 'S', optionValues: { Couleur: STRESS_COLORS[2] } }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2005', label: 'Organiseur Nomade', subtitle: STRESS_COLORS[3], accent: '#a94d35', secondary: '#f5e7e2', mark: 'R', optionValues: { Couleur: STRESS_COLORS[3] } }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2006', label: 'Organiseur Nomade', subtitle: 'Compartiments intérieurs', role: 'DETAIL', accent: '#287d3e', secondary: '#eaf5eb', mark: '1' }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2007', label: 'Organiseur Nomade', subtitle: 'Sangles et attaches', role: 'DETAIL', accent: '#c85a2e', secondary: '#f7ebe6', mark: '2' }),
  media({ id: 'ffffffff-6666-4fff-8fff-ffffffff2008', label: 'Organiseur Nomade', subtitle: 'Tableau des dimensions', role: 'SIZE_GUIDE', accent: '#6b756d', secondary: '#f1f1ed', mark: '↔' }),
];

function buildStressUnits() {
  const units = [];
  let seq = 0;
  for (let ci = 0; ci < STRESS_COLORS.length; ci += 1) {
    for (let ai = 0; ai < STRESS_CAPACITIES.length; ai += 1) {
      for (let fi = 0; fi < STRESS_FINISHES.length; fi += 1) {
        for (let pi = 0; pi < STRESS_PACKS.length; pi += 1) {
          if ((ci + (ai * 2) + fi + pi) % 3 !== 0) continue;
          seq += 1;
          const stock = seq % 7 === 0 ? 0 : 2 + (seq % 11);
          const price = 26000 + (ai * 6500) + (fi * 2200) + (pi * 4800) + (ci * 900);
          units.push(unit({
            id: `ffffffff-6666-4fff-8fff-ffffffff${String(1000 + seq).padStart(4, '0')}`,
            sku: `STRESS-${ci + 1}-${ai + 1}-${fi + 1}-${pi + 1}`,
            optionValues: {
              Couleur: STRESS_COLORS[ci],
              Capacité: STRESS_CAPACITIES[ai],
              Finition: STRESS_FINISHES[fi],
              Conditionnement: STRESS_PACKS[pi],
            },
            stock,
            price,
            mediaIds: [`ffffffff-6666-4fff-8fff-ffffffff200${ci + 2}`, 'ffffffff-6666-4fff-8fff-ffffffff2006'],
          }));
        }
      }
    }
  }
  return units;
}

const stressLayout = {
  contract_version: '1',
  inventory_model: 'SKU',
  product: {
    id: 'ffffffff-6666-4fff-8fff-ffffffff0001',
    reference: 'FIX-STRESS-LAYOUT-ULTRA-LONG-REFERENCE-2026',
    name: 'Organiseur de voyage modulaire très grand format avec compartiments extensibles et accessoires premium',
    description: 'Fixture de résistance destinée à provoquer des retours à la ligne, un configurateur dense et un contenu long sur tous les viewports.',
    category: 'Mode & Beauté',
    subcategory: 'bagagerie',
    series: 'Nomade Extrême — édition validation responsive',
  },
  pricing: { price_kmf: 26000, old_price_kmf: 39000, promo_pct: 33 },
  media: stressMedia,
  option_axes: [
    axis('Couleur', STRESS_COLORS.map((value, index) => ({ value, thumbnail_url: stressMedia[index + 1].url }))),
    axis('Capacité', STRESS_CAPACITIES),
    axis('Finition', STRESS_FINISHES),
    axis('Conditionnement', STRESS_PACKS),
  ],
  sellable_units: buildStressUnits(),
  delivery_options: [
    delivery('SEA_STANDARD', 'Livraison maritime standard avec regroupement', { eta: 'Sous 4 à 6 semaines' }),
    delivery('AIR_EXPRESS', 'Livraison aérienne express prioritaire', { price: 8500, eta: 'Sous 5 à 8 jours' }),
  ],
  content: content({
    brand: 'Nomade Extrême',
    shortDescription: 'Fixture volontairement dense : quatre axes, huit médias, libellés longs, promotion et documentation étendue.',
    highlights: [
      'Compartiments extensibles avec séparateurs repositionnables',
      'Tissu extérieur renforcé avec traitement déperlant',
      'Poignées rembourrées et sangle réglable amovible',
      'Fenêtres d’identification protégées sur chaque module',
      'Fermetures à glissière double sens avec tirettes longues',
      'Structure compressible pour réduire le volume à vide',
      'Compatibilité valise, placard et rangement sous lit',
      'Accessoires organisés dans une pochette dédiée',
    ],
    specifications: [
      { group: 'Construction', label: 'Type de structure', value: 'Semi-rigide renforcée' },
      { group: 'Construction', label: 'Résistance à l’abrasion', value: 'Usage intensif' },
      { group: 'Construction', label: 'Traitement extérieur', value: 'Déperlant' },
      { group: 'Dimensions', label: 'Profondeur variable', value: '12 à 34', unit: 'cm' },
      { group: 'Dimensions', label: 'Charge recommandée', value: '18', unit: 'kg' },
      { group: 'Dimensions', label: 'Poids à vide', value: '1.9', unit: 'kg' },
      { group: 'Accessoires', label: 'Séparateurs', value: '6' },
      { group: 'Accessoires', label: 'Pochettes', value: '4' },
      { group: 'Accessoires', label: 'Sangle', value: 'Réglable et amovible' },
      { group: 'Logistique', label: 'Conditionnement', value: 'Carton renforcé individuel' },
      { group: 'Logistique', label: 'Garantie test', value: '12', unit: 'mois' },
      { group: 'Compatibilité', label: 'Usages', value: 'Voyage, maison, véhicule, stockage saisonnier' },
    ],
    sections: [
      { key: 'capacity-guide', title: 'Guide des capacités', type: 'KEY_VALUE', entries: STRESS_CAPACITIES.map((value, index) => ({ label: value, value: `${3 + (index * 2)} à ${6 + (index * 4)} tenues légères` })) },
      { key: 'packing-method', title: 'Méthode de rangement conseillée', type: 'BULLETS', items: ['Rouler les vêtements souples', 'Placer les objets lourds au fond', 'Séparer le linge propre du linge utilisé', 'Utiliser la compression uniquement après fermeture'] },
      { key: 'long-note', title: 'À propos de cette fixture', type: 'TEXT', text: 'Ce produit n’est pas une recommandation commerciale. Il concentre volontairement les cas difficiles afin de révéler les défauts de hauteur, de wrapping, de scroll, de lecture et de hiérarchie avant qu’ils n’apparaissent sur un vrai catalogue.' },
    ],
    materials: ['Polyester haute densité', 'Mousse de protection EVA', 'Sangles en nylon renforcé', 'Fermetures métalliques traitées', 'Doublure polyester lavable'],
    care: ['Nettoyer localement avec un savon doux', 'Ne pas utiliser de javel', 'Sécher complètement ouvert', 'Ranger sans compression prolongée'],
    warnings: ['Ne pas dépasser la charge recommandée.', 'Les teintes affichées peuvent varier légèrement selon l’écran.', 'La matrice de combinaisons est volontairement incomplète pour les tests.'],
  }),
};

const FIXTURE_ORDER = Object.freeze([
  'goldenElite',
  'premiumGarment',
  'configurableFurniture',
  'editorialSimple',
  'skuMinimal',
  'stressLayout',
]);

const FIXTURES = Object.freeze({
  goldenElite: clone(goldenEliteDetail),
  premiumGarment,
  configurableFurniture,
  editorialSimple,
  skuMinimal,
  stressLayout,
});

const FIXTURE_EXPECTATIONS = Object.freeze({
  goldenElite: { inventory: 'SKU', axes: 2, rich: true, irregularMatrix: true },
  premiumGarment: { inventory: 'SKU', axes: 2, rich: true, irregularMatrix: true },
  configurableFurniture: { inventory: 'SKU', axes: 3, rich: true, irregularMatrix: true },
  editorialSimple: { inventory: 'LEGACY_VARIANTS', axes: 0, rich: true, irregularMatrix: false },
  skuMinimal: { inventory: 'SKU', axes: 2, rich: false, irregularMatrix: true },
  stressLayout: { inventory: 'SKU', axes: 4, rich: true, irregularMatrix: true },
});

function fixtureListProduct(detail) {
  const primary = (detail.media || []).find((entry) => entry.role === 'PRODUCT') || detail.media?.[0] || null;
  const available = (detail.sellable_units || []).filter((entry) => entry.stock_status === 'AVAILABLE');
  const stock = detail.inventory_model === 'SKU'
    ? available.reduce((sum, entry) => sum + Number(entry.available_quantity || 0), 0)
    : 12;
  return {
    id: detail.product.id,
    product_ref: detail.product.reference,
    reference: detail.product.reference,
    name: detail.product.name,
    description: detail.product.description || '',
    category: detail.product.category || 'Test',
    subcategory: detail.product.subcategory || null,
    price_kmf: detail.pricing.price_kmf,
    promo_pct: detail.pricing.promo_pct,
    image_url: primary?.url || '',
    images: (detail.media || []).map((entry) => entry.url),
    inventory_model: detail.inventory_model,
    has_variants: detail.option_axes.length > 0,
    is_available: detail.inventory_model === 'LEGACY_VARIANTS' || available.length > 0,
    stock,
  };
}

function fixtureCatalogList() {
  return FIXTURE_ORDER.map((key) => fixtureListProduct(FIXTURES[key]));
}

function getFixture(keyOrIdOrReference) {
  const direct = FIXTURES[keyOrIdOrReference];
  if (direct) return clone(direct);
  const needle = String(keyOrIdOrReference || '');
  const found = FIXTURE_ORDER
    .map((key) => FIXTURES[key])
    .find((detail) => detail.product.id === needle || detail.product.reference === needle);
  return found ? clone(found) : null;
}

function searchFixtureCatalog(query) {
  const needle = normalize(query);
  if (!needle) return fixtureCatalogList();
  return fixtureCatalogList().filter((product) => normalize([
    product.name,
    product.product_ref,
    product.reference,
    product.description,
    product.category,
    product.subcategory,
  ].filter(Boolean).join(' ')).includes(needle));
}

module.exports = {
  FIXTURE_ORDER,
  FIXTURES,
  FIXTURE_EXPECTATIONS,
  fixtureListProduct,
  fixtureCatalogList,
  getFixture,
  searchFixtureCatalog,
};
