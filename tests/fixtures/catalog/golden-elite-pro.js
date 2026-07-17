'use strict';

/**
 * GOLDEN PRODUCT — Chaussure de football Elite Pro
 *
 * Source canonique unique pour :
 *   - scripts/seed-golden-product.js   (insertion réelle en base)
 *   - tests/unit/golden-product-gpm1.test.js (verrouillage du contrat)
 *
 * Doctrine : UN SEUL PRODUIT MÉTIER. Ce fichier ne doit PAS être dupliqué
 * ou réécrit ailleurs — toute donnée du Golden Product vient d'ici.
 *
 * Les URLs média sont volontairement opaques et stables (cdn.example.com),
 * conformément à la convention déjà en place dans
 * tests/unit/catalog-product-detail.test.js. Aucune dépendance réseau.
 *
 * Pour les assets visuels locaux (GPM-6 / Playwright), voir
 * public/images/fixtures/golden-elite-pro/ et le mapping
 * public/images/fixtures/golden-elite-pro/media-map.json qui fait
 * correspondre chaque URL cdn.example.com à un SVG local déterministe.
 */

const PRODUCT_ID = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa0001';

const PRODUCT_REF = 'GOLDEN-ELITE-PRO';

const SKU_IDS = Object.freeze({
  'Bleu-42': 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1042',
  'Bleu-43': 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1043',
  'Bleu-44': 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1044',
  'Noir-42': 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1142',
  'Noir-43': 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1143',
  // Noir-44 : combinaison inexistante — volontairement absente.
});

const MEDIA_BASE = 'https://cdn.example.com/golden-elite-pro';

function productRow() {
  return {
    id: PRODUCT_ID,
    product_ref: PRODUCT_REF,
    sku: null,
    name: 'Chaussure de football Elite Pro',
    description:
      "Chaussure de football haute performance pour terrain synthétique, " +
      'tige textile renforcée, semelle multi-crampons et maintien ajusté.',
    category: 'sport',
    subcategory: 'chaussures-football',
    // Prix de base = tarif le plus représenté (42 000 KMF sur 3 des 5 SKU).
    // Le prix réellement facturé vient toujours du SKU sélectionné
    // (buildSellableUnits), jamais de ce champ pour une combinaison précise.
    price_kmf: 42000,
    promo_pct: null,
    image_url: `${MEDIA_BASE}/neutral-main.jpg`,
    images: [`${MEDIA_BASE}/neutral-main.jpg`],
    has_variants: true,
    inventory_model: 'SKU',
  };
}

function variantRows() {
  return [
    {
      variant_type: 'Couleur',
      variant_value: 'Bleu',
      image_url: `${MEDIA_BASE}/bleu-main.jpg`,
      images: [`${MEDIA_BASE}/bleu-main.jpg`, `${MEDIA_BASE}/bleu-scene.jpg`],
      display_order: 1,
    },
    {
      variant_type: 'Couleur',
      variant_value: 'Noir',
      image_url: `${MEDIA_BASE}/noir-main.jpg`,
      images: [`${MEDIA_BASE}/noir-main.jpg`, `${MEDIA_BASE}/noir-scene.jpg`],
      display_order: 2,
    },
    {
      variant_type: 'Taille',
      variant_value: '42',
      image_url: null,
      images: [],
      display_order: 1,
    },
    {
      variant_type: 'Taille',
      variant_value: '43',
      image_url: null,
      images: [],
      display_order: 2,
    },
    {
      variant_type: 'Taille',
      variant_value: '44',
      image_url: null,
      images: [],
      display_order: 3,
    },
  ];
}

// Tableau des scénarios — SEULE source de vérité des sellable units.
// { couleur, taille, sku, stock, price_kmf, expected } — expected décrit
// le résultat attendu côté modal (disponible / rupture / inexistant).
const SCENARIOS = Object.freeze([
  { couleur: 'Bleu', taille: '42', sku: 'GOLD-BLU-42', stock: 8, price_kmf: 42000, expected: 'disponible' },
  { couleur: 'Bleu', taille: '43', sku: 'GOLD-BLU-43', stock: 0, price_kmf: 42000, expected: 'rupture' },
  { couleur: 'Bleu', taille: '44', sku: 'GOLD-BLU-44', stock: 5, price_kmf: 45000, expected: 'disponible' },
  { couleur: 'Noir', taille: '42', sku: 'GOLD-BLK-42', stock: 4, price_kmf: 42000, expected: 'disponible' },
  { couleur: 'Noir', taille: '43', sku: 'GOLD-BLK-43', stock: 3, price_kmf: 43000, expected: 'disponible' },
  { couleur: 'Noir', taille: '44', sku: null, stock: null, price_kmf: null, expected: 'inexistant' },
]);

function skuRows() {
  return SCENARIOS
    .filter((s) => s.sku !== null)
    .map((s) => ({
      id: SKU_IDS[`${s.couleur}-${s.taille}`],
      sku: s.sku,
      variant_combo: { Couleur: s.couleur, Taille: s.taille },
      stock: s.stock,
      price_kmf: s.price_kmf,
    }));
}

// Rails de transport commercialement exposés dans le système réel
// aujourd'hui (services/transport-rails.js). AIR_EXPRESS existe comme rail
// connu mais n'est pas commercialement exposé (pricing PENDING) : il ne
// doit donc PAS apparaître ici. "Retrait relais" n'est pas un concept du
// Product Detail Contract (c'est un mode de fulfillment au niveau
// colis/commande) : il n'est délibérément pas modélisé dans ce fixture.
function commercialTransportRails() {
  return [
    {
      code: 'SEA_STANDARD',
      capacity_status: 'ACTIVE',
      pricing_status: 'ACTIVE',
      commercial_exposure: 'PUBLIC',
    },
  ];
}

const EXPECTED_DELIVERY_OPTIONS = Object.freeze([
  {
    code: 'SEA_STANDARD',
    label: 'Livraison standard',
    available: true,
    price_kmf: null,
    eta_label: null,
    unavailable_reason: null,
  },
]);

// ─────────────────────────────────────────────────────────────────────
// LOT CONTENT (commit 5) — matière éditoriale réelle du Golden Product.
//
// contentContract() a la forme normalized_source_contract V2 attendue par
// services/catalog-promotion/content.js (mapContentToProfileRow /
// mapContentToSectionRows / mapContentToAttributeRows) — PAS la forme du
// contrat public (celle-ci est reconstruite par
// services/catalog-product-detail.js::buildContent à la lecture). Une
// seule source de vérité éditoriale ici ; jamais dupliquée à la main dans
// un fixture frontend (voir public/boutique/tests/fixtures/golden-elite-pro-detail.js,
// régénéré depuis ce fichier + le service réel, jamais édité à la main).
//
// Richesse minimale exigée par la doctrine du chantier (§ PRODUIT PILOTE) :
// marque, description courte, ≥4 points forts, ≥6 caractéristiques (2
// groupes), matériaux, entretien, ≥1 avertissement, ≥1 section éditoriale
// KEY_VALUE (guide des tailles).
function contentContract() {
  return {
    brand: 'Elite Pro',
    short_description: 'Chaussure de football terrain synthétique, maintien ajusté.',
    highlights: [
      'Semelle multi-crampons adhérence optimale sur synthétique',
      'Tige textile renforcée résistante à l’abrasion',
      'Maintien ajusté sans point de pression',
      'Doublure respirante anti-transpiration',
    ],
    specifications: [
      { group_key: 'Semelle', attribute_key: 'type-semelle', label: 'Type', value: 'Crampons FG multi-directionnels' },
      { group_key: 'Semelle', attribute_key: 'matiere-semelle', label: 'Matière', value: 'TPU injecté' },
      { group_key: 'Tige', attribute_key: 'matiere-tige', label: 'Matière', value: 'Textile technique renforcé' },
      { group_key: 'Tige', attribute_key: 'fermeture', label: 'Fermeture', value: 'Lacets classiques' },
      { group_key: 'Général', attribute_key: 'poids', label: 'Poids (paire, taille 42)', value: '420', unit: 'g' },
      { group_key: 'Général', attribute_key: 'terrain', label: 'Terrain recommandé', value: 'Synthétique (SG/AG)' },
    ],
    sections: [
      {
        section_key: 'size-guide',
        title: 'Guide des tailles',
        section_type: 'KEY_VALUE',
        content: {
          entries: [
            { label: '42', value: 'EU 42 / UK 8' },
            { label: '43', value: 'EU 43 / UK 9' },
            { label: '44', value: 'EU 44 / UK 9.5' },
          ],
        },
        display_order: 0,
      },
    ],
    materials: [
      'Tige textile technique renforcée',
      'Semelle TPU injecté',
      'Doublure respirante',
    ],
    care: [
      'Nettoyer avec un chiffon humide après usage',
      'Ne pas laver en machine',
      'Laisser sécher à l’air libre, loin d’une source de chaleur directe',
    ],
    warnings: [
      'Ne convient pas à un usage sur terrain naturel ou stabilisé (crampons non adaptés)',
    ],
  };
}

// catalog_media : rôles PRODUCT / SCENE / DETAIL / SIZE_GUIDE, certains
// associés explicitement à la couleur (option_values.Couleur) pour prouver
// le filtrage média par sélection sans heuristique de nom de fichier.
const MEDIA_IDS = Object.freeze({
  productNeutral: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2001',
  bleuProduct: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2002',
  bleuScene: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2003',
  bleuDetail: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2004',
  noirProduct: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2005',
  noirScene: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2006',
  sizeGuide: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2007',
});

function catalogMediaRows() {
  return [
    { id: MEDIA_IDS.productNeutral, url: `${MEDIA_BASE}/neutral-main.jpg`, role: 'PRODUCT', alt: 'Chaussure de football Elite Pro', option_values: {} },
    { id: MEDIA_IDS.bleuProduct, url: `${MEDIA_BASE}/bleu-main.jpg`, role: 'PRODUCT', alt: 'Elite Pro Bleu', option_values: { Couleur: 'Bleu' } },
    { id: MEDIA_IDS.bleuScene, url: `${MEDIA_BASE}/bleu-scene.jpg`, role: 'SCENE', alt: 'Elite Pro Bleu en situation', option_values: { Couleur: 'Bleu' } },
    { id: MEDIA_IDS.bleuDetail, url: `${MEDIA_BASE}/bleu-detail-semelle.jpg`, role: 'DETAIL', alt: 'Détail semelle Elite Pro Bleu', option_values: { Couleur: 'Bleu' } },
    { id: MEDIA_IDS.noirProduct, url: `${MEDIA_BASE}/noir-main.jpg`, role: 'PRODUCT', alt: 'Elite Pro Noir', option_values: { Couleur: 'Noir' } },
    { id: MEDIA_IDS.noirScene, url: `${MEDIA_BASE}/noir-scene.jpg`, role: 'SCENE', alt: 'Elite Pro Noir en situation', option_values: { Couleur: 'Noir' } },
    { id: MEDIA_IDS.sizeGuide, url: `${MEDIA_BASE}/size-guide.jpg`, role: 'SIZE_GUIDE', alt: 'Guide des tailles Elite Pro', option_values: {} },
  ];
}

// product_sku_media — association explicite : le SKU Bleu-44 (palier de
// prix différent) pointe en plus vers le détail semelle, pour prouver que
// explicitSkuMediaMap étend (jamais ne remplace) les médias dérivés de la
// couleur.
function skuMediaRows() {
  return [
    { sku_id: SKU_IDS['Bleu-44'], media_id: MEDIA_IDS.bleuDetail },
  ];
}

module.exports = {
  PRODUCT_ID,
  PRODUCT_REF,
  SKU_IDS,
  MEDIA_BASE,
  MEDIA_IDS,
  productRow,
  variantRows,
  skuRows,
  SCENARIOS,
  commercialTransportRails,
  EXPECTED_DELIVERY_OPTIONS,
  contentContract,
  catalogMediaRows,
  skuMediaRows,
};
