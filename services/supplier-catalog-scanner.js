/**
 * @komerce-arch
 * @role          catalog-supplier-catalog-scanner
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/pricing-engine.js, utils/rates.js
 * @used-by       routes/sourcing-scanner.js, services/suppliers/catalog-import-orchestrator.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-09
 */

/**
 * KOMERCE — Supplier Catalog Scanner (LOT D — refactor connecteurs)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine §10 — Atelier Prix & Sourcing :
 *   "Le sourcing scanner n'achète pas à la place de l'admin.
 *    Il filtre, explique et priorise."
 *
 * ARCHITECTURE :
 *   Le scanner ne connaît AUCUN fournisseur spécifique.
 *   Il accepte uniquement des NormalizedSupplierProduct[] produits
 *   par les connecteurs (CSV, manuel, API stub).
 *
 *   Voir : services/suppliers/connectors/
 *
 * Pipeline :
 *   1. (en amont) Connecteur produit NormalizedSupplierProduct[]
 *   2. Normalisation Komerce  → cat Komerce, KMF, poids/volume estimés
 *   3. Scan pricing           → réutilise services/pricing-engine.js
 *   4. Décision               → sourcing_decision + reason
 *   5. (en aval) Routes persistent en BDD + admin décide
 *
 * Aucun import automatique vers products. Un sourcing_candidate devient
 * un produit UNIQUEMENT après validation explicite admin.
 */

'use strict';

const pricingEngine = require('./pricing-engine');
const { resolveFxRates } = require('../utils/rates');

// ═══════════════════════════════════════════════════════════════════════
// HELPERS NORMALISATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convertit un montant fournisseur en KMF.
 *
 * @param {number} amount
 * @param {string} currency  'AED' | 'EUR' | 'USD' | 'KMF'
 * @param {object} finance   { taux_aed_kmf, taux_change_eur_kmf }
 * @returns {number} montant en KMF (entier)
 */
const SUPPORTED_CURRENCIES = ['AED', 'EUR', 'USD', 'KMF'];

function convertToKMF(amount, currency, finance) {
  const v = Number(amount) || 0;
  if (!v) return 0;
  // ING-5 (verrou 3, doctrine ING-I2) — jamais deviner en silence : une devise
  // hors whitelist (ou absente) sur un montant réel est une erreur bloquante,
  // pas un repli discret. Avant : `return Math.round(v)` traitait n'importe
  // quelle devise inconnue comme du KMF (ex: GBP ÷~550 sur la valeur réelle).
  const cur = (currency || '').toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(cur)) {
    throw new Error(
      `Devise inconnue ou absente : "${currency}". Devises supportées : ${SUPPORTED_CURRENCIES.join(', ')}.`
    );
  }
  if (cur === 'KMF') return Math.round(v);
  const fx = resolveFxRates(finance);
  if (cur === 'AED') return Math.round(v * fx.aed_kmf);
  if (cur === 'EUR') return Math.round(v * fx.eur_kmf);
  return Math.round(v * fx.usd_kmf);
}

function findAvailableCategory(cats, keys) {
  for (const key of keys || []) {
    const cat = cats.find(c => c.key === key);
    if (cat) return cat;
  }
  return null;
}

/**
 * Mappe une catégorie/description fournisseur (texte libre) vers une
 * customs_categories.key Komerce. Les aliases gardent la compatibilité avec
 * les anciens jeux de catégories tout en privilégiant les 8 catégories
 * douanières canoniques actuellement seedées.
 */
function mapCategory(supplierCat, komerceCats) {
  const cats = Array.isArray(komerceCats) ? komerceCats : [];
  if (!supplierCat) {
    const fallback = cats.find(c => c.key === 'autre') || cats[0];
    return { key: fallback?.key || 'autre', source: 'default', confidence: 'low' };
  }
  const s = String(supplierCat).toLowerCase();
  const rules = [
    { keys: ['evening dress', 'formal suit', 'ceremon', 'cérémon', 'abaya', 'wedding dress'], catKeys: ['ceremonie', 'vetements'] },
    { keys: ['phone', 'mobile', 'téléphone', 'telephone', 'smartphone'], catKeys: ['phones'] },
    { keys: ['cosmetic', 'beauty', 'beauté', 'parfum', 'perfume', 'cosmétique', 'maquillage', 'skin care', 'skincare'], catKeys: ['cosmetiques'] },
    { keys: ['toy', 'jouet', 'enfant', 'kids', 'school supplies', 'school bag'], catKeys: ['enfants', 'vetements'] },
    { keys: ['home appliance', 'household appliance', 'electronic', 'electronics', 'gadget', 'electrique', 'électrique', 'headphone', 'speaker', 'smartwatch', 'wrist watch'], catKeys: ['electro', 'electronique', 'maison'] },
    { keys: ['power tool', 'hand tool', 'outillage', 'hardware', 'quincailler', 'padlock', 'door lock', 'brake', 'car oil filter', 'car air filter', 'motorcycle', 'car led', 'headlight'], catKeys: ['materiels', 'autre'] },
    { keys: ['kitchenware', 'kitchen utensil', 'cuisine', 'ustensil'], catKeys: ['materiels', 'maison', 'mariage'] },
    { keys: ['gift', 'cadeau', 'home decor', 'déco', 'deco', 'jewelry', 'bijou', 'vaisselle'], catKeys: ['mariage', 'accessoires', 'autre'] },
    { keys: ['cloth', 'clothing', 'vetement', 'vêtement', 'robe', 'dress', 'shirt', 'chemise', 'pantalon', 'fashion', 'tissu', 'fabric', 'textile'], catKeys: ['vetements', 'tissus'] },
    { keys: ['bag', 'sac', 'accessoire', 'accessory'], catKeys: ['mariage', 'accessoires', 'materiels'] },
    { keys: ['maison', 'home'], catKeys: ['mariage', 'maison', 'materiels'] },
  ];
  for (const r of rules) {
    if (!r.keys.some(k => s.includes(k))) continue;
    const cat = findAvailableCategory(cats, r.catKeys);
    if (cat) return { key: cat.key, source: 'mapped', confidence: 'medium' };
  }
  const fallback = cats.find(c => c.key === 'autre') || cats[0];
  return { key: fallback?.key || 'autre', source: 'default', confidence: 'low' };
}

const DISCOVERY_SEGMENT_CATEGORY_KEYS = Object.freeze({
  'mode-femme': ['vetements'],
  'mode-homme': ['vetements'],
  'mode-enfant': ['enfants', 'vetements'],
  beaute: ['cosmetiques'],
  'maison-confort': ['electro', 'maison'],
  'maison-cuisine': ['materiels', 'maison', 'mariage'],
  'maison-deco': ['mariage', 'maison'],
  'maison-enfants': ['enfants'],
  'tech-phones': ['phones'],
  'tech-audio': ['electro', 'electronique'],
  'tech-montres': ['electro', 'electronique'],
  'bricolage-outillage': ['materiels'],
  'bricolage-electricite': ['materiels', 'electro'],
  'bricolage-securite': ['materiels'],
  'creation-ceremonie': ['ceremonie', 'vetements'],
  'creation-cadeau': ['mariage'],
  'creation-impression': ['mariage', 'materiels'],
  'auto-filtres': ['materiels'],
  'auto-freinage': ['materiels'],
  'auto-eclairage': ['materiels', 'electro'],
  'auto-moto': ['materiels'],
});

function mapProductCategory(product, komerceCats) {
  const cats = Array.isArray(komerceCats) ? komerceCats : [];
  const discovery = product?.raw_payload?.discovery || {};
  const segmentKeys = DISCOVERY_SEGMENT_CATEGORY_KEYS[String(discovery.segment_id || '')];
  const segmentCat = findAvailableCategory(cats, segmentKeys);
  if (segmentCat) {
    return { key: segmentCat.key, source: 'mapped', confidence: 'high' };
  }

  // Pour les feeds non segmentés, la preuve sémantique la plus riche est le
  // nom produit + le contexte de découverte. La catégorie fournisseur Ali est
  // souvent seulement un identifiant numérique et ne suffit pas à elle seule.
  const hint = [
    discovery.target_category,
    discovery.target_subcategory,
    discovery.keyword,
    product?.product_name,
    product?.supplier_category,
  ].filter(Boolean).join(' ');
  return mapCategory(hint || product?.supplier_category, cats);
}

/**
 * Estime le poids si non fourni, par défaut catégorie.
 */
function estimateWeight(suppliedWeight, categoryKey, komerceCats) {
  if (suppliedWeight != null && Number(suppliedWeight) > 0) {
    return { value: Number(suppliedWeight), source: 'supplier', confidence: 'high' };
  }
  const defaults = {
    phones: 0.3, vetements: 0.4, tissus: 0.6, ceremonie: 0.5,
    cosmetiques: 0.2, enfants: 0.5, mariage: 0.6, materiels: 1.0,
    accessoires: 0.3, maison: 1.5, electro: 1.0, electronique: 1.0,
    autre: 0.5,
  };
  const cat = (komerceCats || []).find(c => c.key === categoryKey);
  if (cat?.default_weight_kg) {
    return { value: Number(cat.default_weight_kg), source: 'category', confidence: 'medium' };
  }
  if (defaults[categoryKey]) {
    return { value: defaults[categoryKey], source: 'category', confidence: 'low' };
  }
  return { value: 0.5, source: 'default', confidence: 'low' };
}

/**
 * Estime le volume en m³ depuis dimensions ou défaut catégorie.
 *
 * @param {Object|null} dimensions  — { l_cm, w_cm, h_cm } ou null
 * @param {string} categoryKey
 */
function estimateVolume(dimensions, categoryKey) {
  const d = dimensions || {};
  const lcm = Number(d.l_cm) || 0;
  const wcm = Number(d.w_cm) || 0;
  const hcm = Number(d.h_cm) || 0;
  if (lcm > 0 && wcm > 0 && hcm > 0) {
    return { value: (lcm * wcm * hcm) / 1_000_000, source: 'supplier', confidence: 'high' };
  }
  const defaults = {
    phones: 0.001, vetements: 0.005, tissus: 0.008, ceremonie: 0.007,
    cosmetiques: 0.0008, enfants: 0.006, mariage: 0.006, materiels: 0.010,
    accessoires: 0.003, maison: 0.020, electro: 0.010, electronique: 0.010,
    autre: 0.005,
  };
  return {
    value: defaults[categoryKey] || 0.005,
    source: 'category',
    confidence: 'low',
  };
}

/**
 * Calcule la confidence globale d'un candidat depuis les sources de ses champs.
 */
function computeConfidence(dataSources) {
  const values = Object.values(dataSources || {});
  if (!values.length) return 'low';
  const high = values.filter(s => s === 'supplier' || s === 'real').length;
  const medium = values.filter(s => s === 'category' || s === 'mapped' || s === 'manual').length;
  const ratio = high / values.length;
  if (ratio >= 0.6) return 'high';
  if ((high + medium) / values.length >= 0.6) return 'medium';
  return 'low';
}

// ═══════════════════════════════════════════════════════════════════════
// NORMALISATION : NormalizedSupplierProduct → candidate Komerce
// ═══════════════════════════════════════════════════════════════════════

/**
 * Transforme un NormalizedSupplierProduct en candidat enrichi
 * (cat Komerce, KMF, poids/volume estimés, marge cible héritée).
 *
 * @param {NormalizedSupplierProduct} product   — voir services/suppliers/normalized-product.js
 * @param {Object} options                       — { config? }
 * @returns {Object} candidate normalisé Komerce (prêt à insérer en sourcing_candidates)
 */
async function normalizeCandidate(product, options = {}) {
  const config = options.config || (await pricingEngine.loadGlobalConfig());
  const komerceCats = Object.values(config.categories || {});
  const dataSources = {};

  // Catégorie : conserver la provenance de découverte quand elle existe, puis
  // fallback sémantique. Ne jamais écraser une segmentation riche par un code
  // fournisseur opaque tel que "AliExpress category 63705".
  const catMap = mapProductCategory(product, komerceCats);
  const komerceCategory = catMap.key;
  dataSources.category = catMap.source;

  // Prix achat KMF
  const purchasePriceKmf = convertToKMF(product.purchase_price, product.currency, config.finance);
  dataSources.purchase_price = product.purchase_price ? 'supplier' : 'missing';

  // Poids
  const w = estimateWeight(product.weight_kg, komerceCategory, komerceCats);
  dataSources.weight = w.source;

  // Volume
  const v = estimateVolume(product.dimensions, komerceCategory);
  dataSources.volume = v.source;

  // Marge cible : héritée catégorie ou défaut config
  const cat = config.categories[komerceCategory];
  const targetMarginPct = cat?.default_margin_pct
    ? Number(cat.default_margin_pct)
    : Number(config.finance?.target_marge_brute_pct) || 40;
  dataSources.target_margin = cat?.default_margin_pct ? 'category' : 'default';

  return {
    // Identification fournisseur
    supplier_name: product.supplier_name,
    supplier_product_id: product.supplier_product_id || null,
    // Champs bruts conservés
    product_name: product.product_name,
    supplier_category: product.supplier_category || null,
    purchase_price: product.purchase_price || null,
    currency: product.currency || 'AED',
    image_url: product.image_url || null,
    product_url: product.product_url || null,
    description: product.description || null,
    stock_available: product.stock_available || null,
    min_order_qty: product.min_order_qty || null,
    supplier_delay_days: product.supplier_delay_days || null,
    weight_kg: product.weight_kg || null,
    dim_l_cm: product.dimensions?.l_cm || null,
    dim_w_cm: product.dimensions?.w_cm || null,
    dim_h_cm: product.dimensions?.h_cm || null,
    // Champs enrichis Komerce
    komerce_category: komerceCategory,
    purchase_price_kmf: purchasePriceKmf,
    estimated_weight_kg: w.value,
    estimated_volume_m3: v.value,
    target_margin_pct: targetMarginPct,
    data_sources: dataSources,
    confidence: computeConfidence(dataSources),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SCAN (réutilise pricing-engine)
// ═══════════════════════════════════════════════════════════════════════

function economicTestHealth(reco = {}) {
  const price = Number(reco.test_price_kmf) || 0;
  const variable = Number(reco.variable_cost_complete_kmf ?? reco.variable_cost_estimated_kmf) || 0;
  if (!(price > 0) || !(variable > 0)) return { status: 'unknown', margin_pct: null };
  const marginPct = ((price - variable) / price) * 100;
  let status;
  if (price < variable) status = 'loss';
  else if (marginPct < 15) status = 'danger';
  else if (marginPct < 25) status = 'fragile';
  else if (marginPct <= 40) status = 'healthy';
  else status = 'strong';
  return { status, margin_pct: Number(marginPct.toFixed(1)) };
}

/**
 * Scanne un candidat normalisé via pricing-engine.recommend().
 * Retourne le résultat doctrine + override la sourcing_decision selon §10.
 */
async function scanCandidate(candidate, options = {}) {
  const config = options.config || (await pricingEngine.loadGlobalConfig());

  // ING-5 (verrou 3, doctrine ING-I6) — pas de décision sourcing sur du vide.
  // Un prix d'achat manquant ou nul court-circuite en WATCH, sans même
  // consulter pricing-engine : avant, un coût de 0 pouvait produire une
  // marge "saine" et une décision TEST.
  if (!candidate.purchase_price_kmf) {
    return {
      scan_result: null,
      sourcing_decision: 'WATCH',
      reason: 'Prix d\'achat manquant — décision impossible.',
      recommended_action: 'Mettre en watchlist, ne pas importer pour l\'instant',
      market_confidence: 'unknown',
      confidence: candidate.confidence || 'low',
    };
  }

  // Une catégorie réellement non résolue reste un blocage de Raffinerie. On ne
  // laisse plus le fallback de tableau transformer silencieusement l'inconnu en
  // première catégorie (historiquement `phones`).
  if (candidate.data_sources?.category === 'default') {
    return {
      scan_result: null,
      sourcing_decision: 'WATCH',
      reason: 'Catégorie Komerce non résolue — décision impossible.',
      recommended_action: 'Compléter ou corriger la catégorie avant promotion.',
      market_confidence: 'unknown',
      confidence: candidate.confidence || 'low',
    };
  }

  const input = {
    product_id: null,
    category: candidate.komerce_category || 'autre',
    cost_kmf: candidate.purchase_price_kmf || 0,
    weight_kg: candidate.estimated_weight_kg || 0.5,
    volume_m3: candidate.estimated_volume_m3 || 0.005,
    current_price_kmf: 0,
    channel: candidate.channel || 'cash_relais',
  };

  const reco = await pricingEngine.recommend(input, { config });
  const testHealth = economicTestHealth(reco);
  const scanResult = {
    ...reco,
    economic_test_health_status: testHealth.status,
    economic_test_margin_pct: testHealth.margin_pct,
  };

  // Sans prix marché/humain, `health_status` reste honnêtement `unknown`.
  // La Raffinerie peut néanmoins décider TEST à partir de la référence
  // économique de test, qui reste explicitement NON autoritaire sur le marché.
  const decisionHealth = reco.health_status === 'unknown' ? testHealth.status : reco.health_status;
  let sourcingDecision = reco.sourcing_decision;
  let reason = reco.reason || '';
  if (decisionHealth === 'loss') {
    sourcingDecision = 'LOSS';
    reason = reason || 'Référence test sous le coût variable — produit non rentabilisable.';
  } else if (decisionHealth === 'danger') {
    sourcingDecision = 'AVOID';
    reason = reason || 'Référence test à contribution dangereusement faible. Renégocier ou éviter.';
  } else if (decisionHealth === 'fragile') {
    sourcingDecision = 'WATCH';
    reason = reason || 'Référence test à contribution fragile. Surveiller les coûts terrain avant sourcing.';
  } else if (decisionHealth === 'healthy' || decisionHealth === 'strong') {
    sourcingDecision = 'TEST';
    reason = 'Référence économique de test contributive ; demande marché encore inconnue. Tester en faible quantité sans traiter cette référence comme un prix marché.';
  } else {
    sourcingDecision = 'WATCH';
    reason = 'Données économiques insuffisantes pour décider. Compléter coût, poids, volume ou catégorie.';
  }

  const recommendedAction = ({
    PRIORITY: 'Importer comme produit test à fort potentiel',
    TEST:     'Importer comme produit test en faible quantité',
    WATCH:    'Mettre en watchlist, ne pas importer pour l\'instant',
    AVOID:    'Ne pas importer. Renégocier le prix fournisseur ou changer de produit.',
    LOSS:     'Ne pas importer. Coût supérieur au prix possible.',
  })[sourcingDecision] || 'À examiner manuellement';

  return {
    scan_result: scanResult,
    sourcing_decision: sourcingDecision,
    reason,
    recommended_action: recommendedAction,
    market_confidence: reco.market_confidence || 'unknown',
    confidence: candidate.confidence || 'low',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Pipeline principal — scanner = normalisation + scan
  normalizeCandidate,
  scanCandidate,

  // Helpers exposés (utiles pour tests)
  convertToKMF,
  mapCategory,
  mapProductCategory,
  economicTestHealth,
  estimateWeight,
  estimateVolume,
  computeConfidence,
};