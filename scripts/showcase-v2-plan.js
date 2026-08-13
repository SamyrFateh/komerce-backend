#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-plan
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        showcase_product, taxonomy_slot
 * @outputs       normalized_supplier_product_v2
 * @depends       scripts/showcase-catalog.js
 * @used-by       scripts/showcase-v2-source-build.js, scripts/showcase-v2-seed.js
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @version       2026-08-v1
 */
'use strict';

const { roundKmf, stableInt, normalizeImages } = require('./showcase-catalog');

const TAXONOMY_TARGETS = Object.freeze([
  { category: 'Mode & Beauté', subcategory: 'Femme', count: 35, rich: 25, queries: ['women dress product white background', 'women clothing product isolated'] },
  { category: 'Mode & Beauté', subcategory: 'Homme', count: 25, rich: 18, queries: ['men shirt product white background', 'mens clothing product isolated'] },
  { category: 'Mode & Beauté', subcategory: 'Enfant', count: 25, rich: 17, queries: ['children clothing product white background', 'kids clothes isolated'] },
  { category: 'Mode & Beauté', subcategory: 'Beauté', count: 45, rich: 32, queries: ['cosmetics product white background', 'skin care product isolated', 'makeup product white background'] },

  { category: 'Maison', subcategory: 'Confort', count: 25, rich: 18, queries: ['home appliance product white background', 'household appliance isolated'] },
  { category: 'Maison', subcategory: 'Cuisine', count: 25, rich: 17, queries: ['kitchenware product white background', 'kitchen utensil isolated'] },
  { category: 'Maison', subcategory: 'Déco', count: 20, rich: 14, queries: ['home decoration product isolated', 'decorative object white background'] },
  { category: 'Maison', subcategory: 'Enfants', count: 20, rich: 14, queries: ['school supplies product isolated', 'children desk accessory white background'] },

  { category: 'Tech', subcategory: 'Phones', count: 30, rich: 21, queries: ['smartphone product isolated', 'mobile phone white background'] },
  { category: 'Tech', subcategory: 'Audio', count: 30, rich: 21, queries: ['headphones product isolated', 'speaker product white background'] },
  { category: 'Tech', subcategory: 'Montres', count: 30, rich: 21, queries: ['wristwatch product isolated', 'smartwatch product white background'] },

  { category: 'Bricolage', subcategory: 'Outillage', count: 25, rich: 18, queries: ['hand tool product isolated', 'power tool white background'] },
  { category: 'Bricolage', subcategory: 'Electricité', count: 25, rich: 17, queries: ['electrical equipment product isolated', 'electrical connector white background'] },
  { category: 'Bricolage', subcategory: 'Sécurité', count: 20, rich: 14, queries: ['padlock product isolated', 'door lock white background'] },

  { category: 'Créations personnelles', subcategory: 'Cérémonie', count: 20, rich: 14, queries: ['ceremonial dress isolated', 'formal clothing white background'] },
  { category: 'Créations personnelles', subcategory: 'Cadeau', count: 20, rich: 14, queries: ['gift box product isolated', 'personalized gift object white background'] },
  { category: 'Créations personnelles', subcategory: 'Impression', count: 15, rich: 11, queries: ['printed mug isolated', 'printed stationery product white background'] },

  { category: 'Auto', subcategory: 'Filtres', count: 20, rich: 14, queries: ['automotive filter product isolated', 'oil filter white background'] },
  { category: 'Auto', subcategory: 'Freinage', count: 15, rich: 10, queries: ['brake disc product isolated', 'brake pad white background'] },
  { category: 'Auto', subcategory: 'Éclairage', count: 15, rich: 10, queries: ['car headlight product isolated', 'automotive lamp white background'] },
  { category: 'Auto', subcategory: 'Moto', count: 15, rich: 10, queries: ['motorcycle part product isolated', 'motorcycle accessory white background'] },
]);

const VARIANT_PROFILES = Object.freeze({
  clothing: [
    { key: 'Couleur', values: ['Noir', 'Beige'] },
    { key: 'Taille', values: ['S', 'M', 'L'] },
  ],
  beauty: [{ key: 'Teinte', values: ['01', '02', '03'] }],
  capacity: [{ key: 'Capacité', values: ['Standard', 'Grande'] }],
  kitchen: [
    { key: 'Format', values: ['Petit', 'Grand'] },
    { key: 'Pack', values: ['1', '2'] },
  ],
  color: [{ key: 'Couleur', values: ['Noir', 'Blanc', 'Bleu'] }],
  format: [{ key: 'Format', values: ['Petit', 'Moyen', 'Grand'] }],
  phones: [
    { key: 'Couleur', values: ['Noir', 'Bleu'] },
    { key: 'Stockage', values: ['128 Go', '256 Go'] },
  ],
  watches: [
    { key: 'Couleur', values: ['Noir', 'Argent'] },
    { key: 'Bracelet', values: ['Silicone', 'Acier'] },
  ],
  tools: [
    { key: 'Dimension', values: ['Standard', 'Grand'] },
    { key: 'Pack', values: ['1', '2'] },
  ],
  length: [{ key: 'Longueur', values: ['1 m', '2 m', '3 m'] }],
  secure: [{ key: 'Format', values: ['Standard', 'Renforcé'] }],
  print: [
    { key: 'Format', values: ['A4', 'A3'] },
    { key: 'Pack', values: ['1', '5'] },
  ],
  pack: [{ key: 'Pack', values: ['1', '2', '4'] }],
  axle: [{ key: 'Essieu', values: ['Avant', 'Arrière'] }],
  side: [{ key: 'Côté', values: ['Gauche', 'Droit'] }],
});

function profileFor(category, subcategory) {
  if (category === 'Mode & Beauté' && ['Femme', 'Homme', 'Enfant'].includes(subcategory)) return VARIANT_PROFILES.clothing;
  if (category === 'Mode & Beauté' && subcategory === 'Beauté') return VARIANT_PROFILES.beauty;
  if (category === 'Maison' && subcategory === 'Confort') return VARIANT_PROFILES.capacity;
  if (category === 'Maison' && subcategory === 'Cuisine') return VARIANT_PROFILES.kitchen;
  if (category === 'Maison' && subcategory === 'Déco') return VARIANT_PROFILES.color;
  if (category === 'Maison' && subcategory === 'Enfants') return VARIANT_PROFILES.format;
  if (category === 'Tech' && subcategory === 'Phones') return VARIANT_PROFILES.phones;
  if (category === 'Tech' && subcategory === 'Audio') return VARIANT_PROFILES.color;
  if (category === 'Tech' && subcategory === 'Montres') return VARIANT_PROFILES.watches;
  if (category === 'Bricolage' && subcategory === 'Outillage') return VARIANT_PROFILES.tools;
  if (category === 'Bricolage' && subcategory === 'Electricité') return VARIANT_PROFILES.length;
  if (category === 'Bricolage' && subcategory === 'Sécurité') return VARIANT_PROFILES.secure;
  if (category === 'Créations personnelles' && subcategory === 'Cérémonie') return VARIANT_PROFILES.clothing;
  if (category === 'Créations personnelles' && subcategory === 'Cadeau') return VARIANT_PROFILES.format;
  if (category === 'Créations personnelles' && subcategory === 'Impression') return VARIANT_PROFILES.print;
  if (category === 'Auto' && subcategory === 'Filtres') return VARIANT_PROFILES.pack;
  if (category === 'Auto' && subcategory === 'Freinage') return VARIANT_PROFILES.axle;
  if (category === 'Auto' && subcategory === 'Éclairage') return VARIANT_PROFILES.side;
  if (category === 'Auto' && subcategory === 'Moto') return VARIANT_PROFILES.secure;
  return VARIANT_PROFILES.format;
}

function buildSlots() {
  const slots = [];
  let globalIndex = 0;
  for (const target of TAXONOMY_TARGETS) {
    for (let localIndex = 0; localIndex < target.count; localIndex += 1) {
      slots.push({
        globalIndex,
        localIndex,
        product_ref: `SHOWCASE-V2-${String(globalIndex + 1).padStart(4, '0')}`,
        category: target.category,
        subcategory: target.subcategory,
        rich: localIndex < target.rich,
        queries: target.queries,
      });
      globalIndex += 1;
    }
  }
  return slots;
}

function cartesianAxes(axes) {
  let combos = [{}];
  for (const axis of axes) {
    combos = combos.flatMap((base) => axis.values.map((value) => ({ ...base, [axis.key]: value })));
  }
  return combos;
}

function buildV2Contract(product, slot) {
  const images = normalizeImages(product).slice(0, 3);
  const axes = slot.rich ? profileFor(slot.category, slot.subcategory) : [];
  const optionAxes = axes.map((axis, index) => ({
    key: axis.key,
    display_name: axis.key,
    values: [...axis.values],
    display_order: index,
  }));

  const media = images.map((url, index) => {
    const row = {
      supplier_media_id: `${slot.product_ref}-M${index + 1}`,
      url,
      role: index === 0 ? 'PRODUCT' : (index === 1 ? 'SCENE' : 'DETAIL'),
      alt: product.name || slot.product_ref,
      option_values: null,
      display_order: index,
    };
    if (slot.rich && index === 1 && axes[0] && slot.globalIndex % 3 === 0) {
      row.option_values = { [axes[0].key]: axes[0].values[0] };
    }
    return row;
  });

  let combos = slot.rich ? cartesianAxes(axes) : [];
  if (slot.rich && combos.length > 2 && slot.globalIndex % 4 === 0) combos = combos.slice(0, -1);

  const sellableUnits = combos.map((combo, index) => {
    const supplierSku = `${slot.product_ref}-SUP-${String(index + 1).padStart(2, '0')}`;
    const conditionalMedia = media
      .filter((m) => !m.option_values || Object.entries(m.option_values).every(([k, v]) => combo[k] === v))
      .map((m) => m.supplier_media_id);
    const stockSeed = stableInt(`${supplierSku}:stock`, 0, 12);
    return {
      supplier_sku: supplierSku,
      option_values: combo,
      stock_available: stockSeed < 2 ? 0 : stockSeed,
      purchase_price: roundKmf(Math.max(500, Number(product.price_kmf || 5000) * 0.55)),
      currency: 'KMF',
      media_refs: conditionalMedia,
      is_active: true,
    };
  });

  return {
    schema_version: '2',
    supplier_name: 'Komerce Showcase V2',
    supplier_product_id: product.source || slot.product_ref,
    product_name: product.name || slot.product_ref,
    supplier_category: `${slot.category} / ${slot.subcategory}`,
    purchase_price: roundKmf(Math.max(500, Number(product.price_kmf || 5000) * 0.55)),
    currency: 'KMF',
    image_url: images[0] || null,
    product_url: product.source_url || null,
    description: product.description || product.name || slot.product_ref,
    stock_available: slot.rich ? sellableUnits.reduce((sum, unit) => sum + (unit.stock_available || 0), 0) : Number(product.stock || 10),
    source_locale: product.source_locale || 'en',
    source_title: product.source_title || product.name || slot.product_ref,
    source_description: product.source_description ?? null,
    media,
    option_axes: slot.rich ? optionAxes : null,
    sellable_units: slot.rich ? sellableUnits : null,
    highlights: [
      { key: 'showcase-source', label: 'Donnée source préservée et raffinée par Komerce' },
      { key: 'showcase-taxonomy', label: `${slot.category} · ${slot.subcategory}` },
    ],
    raw_payload: {
      source: product.source || null,
      source_url: product.source_url || null,
      source_attribution: product.source_attribution || null,
      showcase_v2: { product_ref: slot.product_ref, category: slot.category, subcategory: slot.subcategory, rich: slot.rich },
    },
  };
}

function summary() {
  const slots = buildSlots();
  return {
    products: slots.length,
    rich_products: slots.filter((slot) => slot.rich).length,
    categories: [...new Set(slots.map((slot) => slot.category))],
    subcategories: [...new Set(slots.map((slot) => `${slot.category}/${slot.subcategory}`))],
  };
}

module.exports = {
  TAXONOMY_TARGETS,
  VARIANT_PROFILES,
  profileFor,
  buildSlots,
  cartesianAxes,
  buildV2Contract,
  summary,
};
