#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-fixture-builder
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        scripts/showcase-v2-plan.js
 * @outputs       data/catalogue-test-raw/showcase-catalog-v2-source.json
 * @depends       scripts/showcase-v2-plan.js, scripts/showcase-catalog.js
 * @used-by       showcase v2 staging deploy
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md
 * @version       2026-08-v10
 *
 * SHOWCASE V2 — fixtures fournisseur déterministes.
 *
 * Ce builder ne découvre aucun produit sur Internet. Il fabrique exactement
 * les 500 lignes attendues par le plan V2, avec des identités produit propres,
 * des descriptions source anglaises explicites et un média SVG contrôlé par
 * produit. La Raffinerie reçoit ainsi des données qui ressemblent à un flux
 * marchand normalisé, sans bruit éditorial ou culturel propre à Wikimedia.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSlots } = require('./showcase-v2-plan');
const { roundKmf, stableInt } = require('./showcase-catalog');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2-source.json');
const DESCRIPTION_MAX_LENGTH = 10000;
const FIXTURE_SUPPLIER = 'Komerce Fixture Supplier';

const FIXTURE_TYPES = Object.freeze({
  'Mode & Beauté/Femme': ["Women's cotton dress", "Women's linen blouse", "Women's midi skirt", "Women's leather handbag", "Women's casual jacket"],
  'Mode & Beauté/Homme': ["Men's cotton shirt", "Men's casual jacket", "Men's chino trousers", "Men's leather belt", "Men's lace-up shoes"],
  'Mode & Beauté/Enfant': ['Kids cotton t-shirt', 'Kids school backpack', 'Kids casual jacket', 'Kids sneakers', 'Kids school uniform set'],
  'Mode & Beauté/Beauté': ['Hydrating face cream', 'Matte lipstick', 'Eau de parfum spray', 'Volumizing mascara', 'Gentle cleansing soap'],
  'Maison/Confort': ['Electric desk fan', 'Portable space heater', 'Steam clothes iron', 'Compact vacuum cleaner', 'Bed pillow'],
  'Maison/Cuisine': ['Electric kettle', 'Stainless steel frying pan', 'Kitchen knife set', 'Countertop blender', 'Ceramic bowl set'],
  'Maison/Déco': ['Ceramic flower vase', 'Table lamp', 'Decorative cushion', 'Wall clock', 'Scented candle'],
  'Maison/Enfants': ['School backpack', 'Pencil case', 'Spiral notebook', 'Kids desk chair', 'Stationery set'],
  'Tech/Phones': ['Android smartphone', 'Dual SIM smartphone', '5G smartphone', 'Mobile phone handset', 'Rugged smartphone'],
  'Tech/Audio': ['Wireless headphones', 'Bluetooth speaker', 'True wireless earbuds', 'USB microphone', 'Gaming headset'],
  'Tech/Montres': ['Digital wristwatch', 'Smartwatch', 'Mechanical wristwatch', 'Sports watch', 'Classic wristwatch'],
  'Bricolage/Outillage': ['Cordless drill', 'Phillips screwdriver set', 'Claw hammer', 'Combination pliers', 'Adjustable wrench'],
  'Bricolage/Electricité': ['Electrical connector set', 'Power extension cord', 'Wall electrical socket', 'Light switch', 'Electrical plug adapter'],
  'Bricolage/Sécurité': ['Steel padlock', 'Door lock cylinder', 'Home security camera', 'Door security latch', 'Compact safe'],
  'Créations personnelles/Cérémonie': ["Women's formal evening dress", 'Wedding dress', "Men's formal suit", 'Tuxedo jacket', 'Ceremonial gown'],
  'Créations personnelles/Cadeau': ['Rigid gift box', 'Personalized keepsake box', 'Souvenir mug', 'Decorative gift item', 'Present box'],
  'Créations personnelles/Impression': ['Printed ceramic mug', 'Printed greeting card', 'A4 poster print', 'Printed notebook', 'Personalized stationery set'],
  'Auto/Filtres': ['Engine oil filter', 'Automotive air filter', 'Fuel filter', 'Cabin air filter', 'Car filter kit'],
  'Auto/Freinage': ['Front brake disc', 'Brake pad set', 'Rear brake caliper', 'Brake rotor', 'Disc brake kit'],
  'Auto/Éclairage': ['Left car headlight', 'Right car headlight', 'LED headlamp', 'Tail light assembly', 'Automotive lamp'],
  'Auto/Moto': ['Motorcycle helmet', 'Motorcycle rear-view mirror', 'Motorcycle LED light', 'Motorcycle phone mount', 'Motorcycle lock'],
});

const FIXTURE_SERIES = Object.freeze(['Classic', 'Essential', 'Premium', 'Compact', 'Everyday', 'Pro', 'Urban', 'Select', 'Studio', 'Core']);

function segmentKey(target) { return `${target.category}/${target.subcategory}`; }

function parseArgs(argv) {
  const out = { target: 500, output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--output') out.output = path.resolve(next());
    else throw new Error(`Argument inconnu: ${argv[i]}`);
  }
  if (!Number.isInteger(out.target) || out.target !== 500) throw new Error('--target doit être exactement 500 pour la campagne Showcase V2');
  return out;
}

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function fixtureSvgDataUri(product) {
  const title = escapeXml(product.source_title);
  const category = escapeXml(product.category);
  const subcategory = escapeXml(product.subcategory);
  const ref = escapeXml(product.product_ref);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">',
    '<rect width="900" height="900" fill="#ffffff"/>',
    '<rect x="72" y="72" width="756" height="756" rx="48" fill="#f6f6f6" stroke="#dedede" stroke-width="3"/>',
    '<circle cx="450" cy="330" r="150" fill="#eeeeee" stroke="#d6d6d6" stroke-width="3"/>',
    `<text x="450" y="585" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="700" fill="#202020">${title}</text>`,
    `<text x="450" y="642" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" fill="#555555">${category} · ${subcategory}</text>`,
    `<text x="450" y="706" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#888888">${ref}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function fixtureProductForSlot(slot) {
  const key = segmentKey(slot);
  const types = FIXTURE_TYPES[key];
  if (!types?.length) throw new Error(`Aucune fixture produit définie pour ${key}`);
  const base = types[slot.localIndex % types.length];
  const series = FIXTURE_SERIES[Math.floor(slot.localIndex / types.length) % FIXTURE_SERIES.length];
  const seriesNo = String(slot.localIndex + 1).padStart(2, '0');
  const sourceTitle = `${base} — ${series} ${seriesNo}`;
  const description = [
    `Commercial supplier catalogue item: ${base}.`,
    `Sellable physical product intended for e-commerce listing in ${slot.category} / ${slot.subcategory}.`,
    'The source record describes the product itself, with no person, artwork, museum object or editorial scene.',
  ].join(' ');
  const product = {
    product_ref: slot.product_ref,
    category: slot.category,
    subcategory: slot.subcategory,
    name: sourceTitle,
    source_title: sourceTitle,
    source_description: description.slice(0, DESCRIPTION_MAX_LENGTH),
    description: description.slice(0, DESCRIPTION_MAX_LENGTH),
    source_locale: 'en',
    source: `fixture:${slot.product_ref}`,
    source_url: `https://fixtures.komerce.test/products/${slot.product_ref.toLowerCase()}`,
    source_attribution: { supplier: FIXTURE_SUPPLIER, license: 'synthetic-test-fixture' },
    price_kmf: roundKmf(stableInt(`${slot.product_ref}:price`, 2500, 85000)),
    stock: stableInt(`${slot.product_ref}:stock`, 3, 40),
    sort_order: slot.globalIndex + 500,
    showcase_v2: { slot_index: slot.globalIndex, rich: slot.rich, category: slot.category, subcategory: slot.subcategory, fixture: true },
  };
  const image = fixtureSvgDataUri(product);
  product.image_url = image;
  product.images = [image];
  return product;
}

function buildCatalogue() {
  const slots = buildSlots();
  const output = slots.map(fixtureProductForSlot);
  const sources = new Set(output.map((row) => row.source));
  const heroes = new Set(output.map((row) => row.image_url));
  if (output.length !== 500 || sources.size !== 500 || heroes.size !== 500) {
    throw new Error(`Invariant V2 cassé: products=${output.length}, sources=${sources.size}, heroes=${heroes.size}`);
  }
  return output;
}

function fixtureSummary(products) {
  return {
    products: products.length,
    rich: products.filter((row) => row.showcase_v2?.rich).length,
    categories: new Set(products.map((row) => row.category)).size,
    subcategories: new Set(products.map((row) => `${row.category}/${row.subcategory}`)).size,
    unique_sources: new Set(products.map((row) => row.source)).size,
    unique_heroes: new Set(products.map((row) => row.image_url)).size,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const products = buildCatalogue();
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
  console.log(`[showcase-v2-fixtures] ${JSON.stringify(fixtureSummary(products))}`);
  console.log(`[showcase-v2-fixtures] -> ${options.output}`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error('[showcase-v2-fixtures] échec:', error.message); process.exitCode = 1; }
}

module.exports = {
  DESCRIPTION_MAX_LENGTH,
  FIXTURE_SUPPLIER,
  FIXTURE_TYPES,
  FIXTURE_SERIES,
  segmentKey,
  parseArgs,
  escapeXml,
  fixtureSvgDataUri,
  fixtureProductForSlot,
  buildCatalogue,
  fixtureSummary,
};
