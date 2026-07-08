'use strict';
const PRODUCTS = {
  powerBank: { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Power Bank 20000mAh Fast Charge', name_source: 'Power Bank 20000mAh Fast Charge', description_source: '20000mAh capacity, fast charging. USB-C + USB-A.', source_locale: 'en', category: 'tech', content_source: 'connector_raw' },
  abaya: { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'عباية فاخرة مطرزة', name_source: 'عباية فاخرة مطرزة', description_source: 'Premium Embroidered Abaya. Open front. Fabric: Nidha silk blend.', source_locale: 'ar', category: 'mode', content_source: 'connector_raw' },
  parfum: { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Oud Wood Intense EDP 100ml', name_source: 'Oud Wood Intense EDP 100ml', description_source: 'Eau de Parfum 100ml. Top: cinnamon, cardamom. Heart: oud. Base: sandalwood.', source_locale: 'en', category: null, content_source: 'connector_raw' },
  electronique: { id: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Smart Watch T900 Ultra 2', name_source: 'Smart Watch T900 Ultra 2', description_source: 'T900 Ultra 2 smartwatch. 2.2" AMOLED. Bluetooth 5.3. IP68.', source_locale: 'en', category: 'tech', content_source: 'connector_raw' },
  sansDonneeSource: { id: 'aaaaaaaa-0000-0000-0000-000000000005', name: null, name_source: null, description_source: null, source_locale: null, category: null, content_source: 'manual' },
};
const ENRICHED_OUTPUTS = {
  powerBank: { name_fr: 'Batterie externe 20000 mAh charge rapide', description_fr: 'Batterie externe compacte 20000 mAh avec charge rapide.', category: 'tech', fragility: 'electronique', confidence: 0.95, review_notes: [] },
  abaya: { name_fr: 'Abaya brodée — taille unique', description_fr: 'Abaya ouverte brodée. Tissu : mélange soie Nidha.', category: 'mode', fragility: null, confidence: 0.88, review_notes: ['Source en arabe'] },
  parfum: { name_fr: 'Eau de parfum Oud Wood 100 ml', description_fr: 'Eau de parfum 100 ml. Notes de tête : cannelle, cardamome.', category: 'beaute', fragility: null, confidence: 0.72, review_notes: ['Catégorie proposée beaute'] },
  electronique: { name_fr: 'Montre connectée T900 Ultra 2', description_fr: 'Montre connectée T900 Ultra 2. Écran AMOLED.', category: 'tech', fragility: 'electronique', confidence: 0.91, review_notes: [] },
};
const TEST_GLOSSARY = [
  { term_source: 'power bank', term_fr: 'batterie externe', note: null },
  { term_source: 'smart watch', term_fr: 'montre connectée', note: null },
];
const TEST_CATEGORIES = ['tech', 'mode', 'beaute', 'maison', 'sport', 'enfant', 'alimentaire'];
const TEST_OVERRIDES = {
  nameOverride: { field_name: 'name', field_value: 'Batterie nomade 20000 mAh (retouche admin)' },
  emojiOverride: { field_name: 'emoji', field_value: '🔋' },
  sqlInjection: { field_name: 'price_kmf; DROP TABLE products', field_value: '0' },
  validDescription: { field_name: 'description', field_value: 'Description retouchée.' },
};
module.exports = { PRODUCTS, ENRICHED_OUTPUTS, TEST_GLOSSARY, TEST_CATEGORIES, TEST_OVERRIDES };
