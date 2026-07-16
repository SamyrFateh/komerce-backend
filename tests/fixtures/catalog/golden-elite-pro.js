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

module.exports = {
  PRODUCT_ID,
  PRODUCT_REF,
  SKU_IDS,
  MEDIA_BASE,
  productRow,
  variantRows,
  skuRows,
  SCENARIOS,
  commercialTransportRails,
  EXPECTED_DELIVERY_OPTIONS,
};
