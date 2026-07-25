/**
 * geometry-fixtures.js — Fixtures pour tests/e2e/modal-geometry.spec.js.
 *
 * Dérivées du contrat détail réel (tests/fixtures/golden-elite-pro-detail.js),
 * jamais réinventées à la main : on clone puis on mute des champs précis,
 * en gardant contract_version/pricing/media/content/delivery_options intacts.
 *
 *   buildSimpleFixture()   → SIMPLE, sans axes, contenu enrichi retiré
 *                            (produit court — pas de scroll requis).
 *   buildEnrichedFixture() → SKU, 4 couleurs × 5 tailles = 20 combos,
 *                            contenu enrichi conservé (produit haut —
 *                            scroll requis, cf. accord du 26/07).
 */
'use strict';

const golden = require('../../fixtures/golden-elite-pro-detail.js');

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildSimpleFixture() {
  const detail = clone(golden);
  detail.inventory_model = 'SIMPLE';
  detail.product.inventory_model = 'SIMPLE';
  detail.option_axes = [];
  detail.sellable_units = [];
  detail.content = null;
  return detail;
}

function buildEnrichedFixture() {
  const detail = clone(golden);
  const COLORS = ['Bleu', 'Noir', 'Rouge', 'Blanc'];
  const SIZES = ['40', '41', '42', '43', '44'];

  detail.option_axes = [
    {
      key: 'Couleur',
      display_name: 'Couleur',
      values: COLORS.map((value) => ({
        value,
        thumbnail_url: `/images/products/golden-elite-pro/${value.toLowerCase()}-main.svg`,
      })),
    },
    {
      key: 'Taille',
      display_name: 'Taille',
      values: SIZES.map((value) => ({ value, thumbnail_url: null })),
    },
  ];

  const units = [];
  let seq = 0;
  for (const color of COLORS) {
    for (const size of SIZES) {
      seq += 1;
      units.push({
        id: `enriched-unit-${String(seq).padStart(3, '0')}`,
        sku: `GOLDEN-ELITE-PRO-${color.toUpperCase()}-${size}`,
        option_values: { Couleur: color, Taille: size },
        stock_status: 'AVAILABLE',
        available_quantity: 12,
        price_kmf: detail.pricing.price_kmf,
      });
    }
  }
  detail.sellable_units = units;
  return detail;
}

module.exports = { buildSimpleFixture, buildEnrichedFixture };
