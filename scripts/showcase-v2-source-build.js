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
 * @version       2026-09-v14
 *
 * SHOWCASE V2 — fixtures fournisseur déterministes.
 *
 * Ce builder ne découvre aucun produit sur Internet. Il fabrique exactement
 * les 500 lignes attendues par le plan V2, avec des identités produit et des
 * descriptions marchandes en français, ainsi qu'un média SVG contrôlé par
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
  'Mode & Beauté/Femme': ['Robe femme en coton', 'Blouse femme en lin', 'Jupe midi femme', 'Sac à main femme en cuir', 'Veste décontractée femme'],
  'Mode & Beauté/Homme': ['Chemise homme en coton', 'Veste décontractée homme', 'Pantalon chino homme', 'Ceinture homme en cuir', 'Chaussures à lacets homme'],
  'Mode & Beauté/Enfant': ['T-shirt enfant en coton', 'Sac à dos scolaire enfant', 'Veste décontractée enfant', 'Baskets enfant', 'Ensemble uniforme scolaire enfant'],
  'Mode & Beauté/Beauté': ['Crème hydratante visage', 'Rouge à lèvres mat', 'Eau de parfum', 'Mascara volume', 'Savon nettoyant doux'],
  'Maison/Confort': ['Ventilateur de table électrique', "Chauffage d'appoint portable", 'Fer à repasser vapeur', 'Aspirateur compact', 'Oreiller de lit'],
  'Maison/Cuisine': ['Bouilloire électrique', 'Poêle en acier inoxydable', 'Ménagère en acier inoxydable', 'Blender de cuisine', 'Lot de bols en céramique'],
  'Maison/Déco': ['Vase décoratif en céramique', 'Lampe de table', 'Coussin décoratif', 'Horloge murale', 'Bougie parfumée'],
  'Maison/Enfants': ['Sac à dos scolaire', 'Trousse scolaire', 'Cahier à spirale', 'Chaise de bureau enfant', 'Set de fournitures scolaires'],
  'Tech/Phones': ['Smartphone Android', 'Smartphone double SIM', 'Smartphone 5G', 'Téléphone mobile débloqué', 'Smartphone renforcé'],
  'Tech/Audio': ['Casque audio sans fil', 'Enceinte Bluetooth', 'Écouteurs sans fil', 'Microphone USB', 'Casque gaming'],
  'Tech/Montres': ['Montre numérique', 'Montre connectée', 'Montre mécanique', 'Montre sport', 'Montre classique'],
  'Bricolage/Outillage': ['Perceuse sans fil', 'Jeu de tournevis cruciformes', 'Marteau arrache-clou', 'Pince universelle', 'Clé à molette'],
  'Bricolage/Electricité': ['Lot de connecteurs électriques', 'Rallonge électrique', 'Prise électrique murale', 'Interrupteur mural', 'Adaptateur de prise électrique'],
  'Bricolage/Sécurité': ['Cadenas en acier', 'Cylindre de serrure de porte', 'Caméra de sécurité domestique', 'Verrou de sécurité pour porte', 'Coffre-fort compact'],
  'Créations personnelles/Cérémonie': ['Robe de soirée femme', 'Robe de mariée', 'Costume habillé homme', 'Veste de smoking', 'Tenue de cérémonie'],
  'Créations personnelles/Cadeau': ['Coffret cadeau rigide', 'Boîte souvenir personnalisable', 'Mug souvenir', 'Cadre photo décoratif en bois', 'Sac cadeau en tissu'],
  'Créations personnelles/Impression': ['Mug en céramique imprimé', 'Carte de vœux imprimée', 'Affiche A4 imprimée', 'Carnet imprimé', 'Set de papeterie personnalisable'],
  'Auto/Filtres': ['Filtre à huile moteur', 'Filtre à air automobile', 'Filtre à carburant', "Filtre d'habitacle", 'Kit filtres huile et air moteur'],
  'Auto/Freinage': ['Disque de frein avant', 'Jeu de plaquettes de frein', 'Étrier de frein arrière', 'Disque de frein ventilé', 'Kit de freinage à disque'],
  'Auto/Éclairage': ['Phare avant gauche', 'Phare avant droit', 'Projecteur LED automobile', 'Feu arrière complet', "Paire d'ampoules LED automobile"],
  'Auto/Moto': ['Casque moto', 'Rétroviseur moto', 'Feu LED moto', 'Support téléphone moto', 'Antivol moto'],
});

const FIXTURE_SERIES = Object.freeze(['Classique', 'Essentiel', 'Premium', 'Compact', 'Quotidien', 'Pro', 'Urbain', 'Sélection', 'Atelier', 'Signature']);

const DESCRIPTION_LEADS = Object.freeze({
  'Mode & Beauté/Femme': 'Pièce de mode femme pensée pour un usage quotidien, avec une présentation actuelle et une finition soignée.',
  'Mode & Beauté/Homme': 'Pièce de mode homme conçue pour un usage quotidien, facile à porter et à associer.',
  'Mode & Beauté/Enfant': 'Article enfant pratique et confortable, adapté aux usages du quotidien.',
  'Mode & Beauté/Beauté': 'Produit de beauté pensé pour une routine simple, avec une utilisation claire et agréable au quotidien.',
  'Maison/Confort': 'Équipement maison pratique, conçu pour améliorer le confort dans les usages du quotidien.',
  'Maison/Cuisine': 'Article de cuisine fonctionnel et simple à utiliser, adapté à une utilisation régulière.',
  'Maison/Déco': 'Objet décoratif pensé pour apporter une touche simple et chaleureuse à la maison.',
  'Maison/Enfants': 'Article pratique pour accompagner les activités scolaires et quotidiennes des enfants.',
  'Tech/Phones': 'Téléphone pensé pour les usages mobiles du quotidien, avec une prise en main simple et polyvalente.',
  'Tech/Audio': 'Équipement audio conçu pour une écoute confortable et une utilisation simple au quotidien.',
  'Tech/Montres': 'Montre pensée pour un usage quotidien, avec un design lisible et facile à porter.',
  'Bricolage/Outillage': 'Outil pratique pour les travaux courants, avec une prise en main simple et efficace.',
  'Bricolage/Electricité': 'Accessoire électrique destiné aux installations et usages courants de la maison.',
  'Bricolage/Sécurité': 'Équipement de sécurité conçu pour renforcer simplement la protection des biens et des accès.',
  'Créations personnelles/Cérémonie': 'Article de cérémonie destiné aux occasions habillées, avec une présentation élégante et soignée.',
  'Créations personnelles/Cadeau': 'Article cadeau pensé pour une attention personnelle, facile à offrir et à présenter.',
  'Créations personnelles/Impression': 'Support personnalisable destiné à l’impression, au cadeau ou à la communication visuelle.',
  'Auto/Filtres': 'Pièce automobile destinée à l’entretien courant et au bon fonctionnement du véhicule.',
  'Auto/Freinage': 'Pièce de freinage destinée à l’entretien et au remplacement des éléments d’usure du véhicule.',
  'Auto/Éclairage': 'Équipement d’éclairage automobile destiné au remplacement ou à l’amélioration de la visibilité du véhicule.',
  'Auto/Moto': 'Équipement moto pratique, pensé pour l’usage quotidien, la sécurité ou le confort de conduite.',
});

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
  const descriptionLead = DESCRIPTION_LEADS[key];
  if (!types?.length) throw new Error(`Aucune fixture produit définie pour ${key}`);
  if (!descriptionLead) throw new Error(`Aucune description produit définie pour ${key}`);
  const base = types[slot.localIndex % types.length];
  const series = FIXTURE_SERIES[Math.floor(slot.localIndex / types.length) % FIXTURE_SERIES.length];
  const sourceTitle = `${base} — ${series}`;
  const description = [
    `${base}.`,
    descriptionLead,
    `Gamme ${series}, présentée dans la catégorie ${slot.category} / ${slot.subcategory}.`,
  ].join(' ');
  const product = {
    product_ref: slot.product_ref,
    category: slot.category,
    subcategory: slot.subcategory,
    name: sourceTitle,
    source_title: sourceTitle,
    source_description: description.slice(0, DESCRIPTION_MAX_LENGTH),
    description: description.slice(0, DESCRIPTION_MAX_LENGTH),
    source_locale: 'fr',
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
  DESCRIPTION_LEADS,
  segmentKey,
  parseArgs,
  escapeXml,
  fixtureSvgDataUri,
  fixtureProductForSlot,
  buildCatalogue,
  fixtureSummary,
};
