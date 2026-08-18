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
 * @version       2026-06
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

/**
 * Mappe une catégorie fournisseur (texte libre) vers une customs_categories.key Komerce.
 * Logique simple par mots-clés FR + EN.
 */
function mapCategory(supplierCat, komerceCats) {
  const cats = Array.isArray(komerceCats) ? komerceCats : [];
  if (!supplierCat) {
    const fallback = cats.find(c => c.key === 'autre') || cats[0];
    return { key: fallback?.key || 'autre', source: 'default', confidence: 'low' };
  }
  const s = supplierCat.toLowerCase();
  const rules = [
    { keys: ['phone', 'mobile', 'téléphone', 'smartphone'], catKey: 'phones' },
    { keys: ['cloth', 'vetement', 'vêtement', 'robe', 'chemise', 'pantalon', 'fashion'], catKey: 'vetements' },
    { keys: ['tissu', 'fabric', 'textile'], catKey: 'tissus' },
    { keys: ['cosmetic', 'beauty', 'parfum', 'cosmétique', 'maquillage'], catKey: 'cosmetiques' },
    { keys: ['toy', 'jouet', 'enfant', 'kids'], catKey: 'enfants' },
    { keys: ['accessoire', 'accessory', 'bag', 'sac'], catKey: 'accessoires' },
    { keys: ['cuisine', 'kitchen', 'maison', 'home'], catKey: 'maison' },
    { keys: ['electronic', 'gadget', 'electrique'], catKey: 'electronique' },
  ];
  for (const r of rules) {
    if (r.keys.some(k => s.includes(k))) {
      const cat = cats.find(c => c.key === r.catKey);
      if (cat) return { key: cat.key, source: 'mapped', confidence: 'medium' };
    }
  }
  const fallback = cats.find(c => c.key === 'autre') || cats[0];
  return { key: fallback?.key || 'autre', source: 'default', confidence: 'low' };
}

/**
 * Estime le poids si non fourni, par défaut catégorie.
 */
function estimateWeight(suppliedWeight, categoryKey, komerceCats) {
  if (suppliedWeight != null && Number(suppliedWeight) > 0) {
    return { value: Number(suppliedWeight), source: 'supplier', confidence: 'high' };
  }
  const defaults = {
    phones: 0.3, vetements: 0.4, tissus: 0.6, cosmetiques: 0.2,
    enfants: 0.5, accessoires: 0.3, maison: 1.5, electronique: 1.0,
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
    phones: 0.001, vetements: 0.005, tissus: 0.008, cosmetiques: 0.0008,
    enfants: 0.006, accessoires: 0.003, maison: 0.020, electronique: 0.010,
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

  // Catégorie
  const catMap = mapCategory(product.supplier_category, komerceCats);
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

  // Override §10 : sans données marché, jamais PRIORITY
  let sourcingDecision = reco.sourcing_decision;
  let reason = reco.reason || '';
  if (reco.health_status === 'loss') {
    sourcingDecision = 'LOSS';
    reason = reason || 'Coût supérieur au prix recommandé — produit non rentabilisable.';
  } else if (reco.health_status === 'danger') {
    sourcingDecision = 'AVOID';
    reason = reason || 'Marge dangereusement faible. Renégocier ou éviter.';
  } else if (reco.health_status === 'fragile') {
    sourcingDecision = 'WATCH';
    reason = reason || 'Marge fragile. Surveiller les coûts terrain avant sourcing massif.';
  } else if (reco.health_status === 'healthy' || reco.health_status === 'strong') {
    sourcingDecision = 'TEST';
    reason = 'Marge satisfaisante mais demande marché inconnue. Tester en faible quantité avant sourcing massif.';
  } else {
    sourcingDecision = 'WATCH';
    reason = 'Données insuffisantes pour décider. Compléter prix achat / poids / catégorie.';
  }

  const recommendedAction = ({
    PRIORITY: 'Importer comme produit test à fort potentiel',
    TEST:     'Importer comme produit test en faible quantité',
    WATCH:    'Mettre en watchlist, ne pas importer pour l\'instant',
    AVOID:    'Ne pas importer. Renégocier le prix fournisseur ou changer de produit.',
    LOSS:     'Ne pas importer. Coût supérieur au prix possible.',
  })[sourcingDecision] || 'À examiner manuellement';

  return {
    scan_result: reco,
    sourcing_decision: sourcingDecision,
    reason,
    recommended_action: recommendedAction,
    market_confidence: 'unknown',
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
  estimateWeight,
  estimateVolume,
  computeConfidence,
};
