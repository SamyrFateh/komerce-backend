/**
 * @komerce-arch
 * @role          catalog-supplier-catalog-scanner
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/pricing-engine.js, services/customs-dynamic-category-classifier.js, utils/rates.js
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
const { classifySupplierProduct } = require('./customs-dynamic-category-classifier');
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
const SUPPORTED_CURRENCIES = ['AED', 'EUR', 'USD', 'KMF', 'PLN'];

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
  if (cur === 'PLN') {
    const rate = Number(finance?.taux_pln_kmf);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('PLN_FX_RATE_REQUIRED: finance_config.taux_pln_kmf requis');
    return Math.round(v * rate);
  }
  const fx = resolveFxRates(finance);
  if (cur === 'AED') return Math.round(v * fx.aed_kmf);
  if (cur === 'EUR') return Math.round(v * fx.eur_kmf);
  return Math.round(v * fx.usd_kmf);
}

/**
 * Résolution dynamique : aucune clé de customs_categories n'est connue ici.
 * La configuration vient exclusivement des catégories actives chargées par
 * pricingEngine.loadGlobalConfig().
 */
function mapCategory(supplierCat, komerceCats) {
  return classifySupplierProduct({ supplier_category: supplierCat }, komerceCats);
}

function mapProductCategory(product, komerceCats) {
  return classifySupplierProduct(product, komerceCats);
}

function estimateWeight(suppliedWeight, categoryKey, komerceCats) {
  if (suppliedWeight != null && Number(suppliedWeight) > 0) {
    return { value: Number(suppliedWeight), source: 'supplier', confidence: 'high' };
  }
  const cat = (komerceCats || []).find(c => c.key === categoryKey);
  const configured = Number(cat?.default_weight_kg);
  if (Number.isFinite(configured) && configured > 0) {
    return { value: configured, source: 'category', confidence: 'medium' };
  }
  return { value: 0.5, source: 'default', confidence: 'low' };
}

function estimateVolume(dimensions, categoryKey, komerceCats) {
  const d = dimensions || {};
  const lcm = Number(d.l_cm) || 0;
  const wcm = Number(d.w_cm) || 0;
  const hcm = Number(d.h_cm) || 0;
  if (lcm > 0 && wcm > 0 && hcm > 0) {
    return { value: (lcm * wcm * hcm) / 1_000_000, source: 'supplier', confidence: 'high' };
  }

  const cat = (komerceCats || []).find(c => c.key === categoryKey);
  const dl = Number(cat?.default_dim_l_cm) || 0;
  const dw = Number(cat?.default_dim_w_cm) || 0;
  const dh = Number(cat?.default_dim_h_cm) || 0;
  if (dl > 0 && dw > 0 && dh > 0) {
    return { value: (dl * dw * dh) / 1_000_000, source: 'category', confidence: 'medium' };
  }

  return { value: 0.005, source: 'default', confidence: 'low' };
}

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

async function normalizeCandidate(product, options = {}) {
  const config = options.config || (await pricingEngine.loadGlobalConfig());
  const komerceCats = Object.values(config.categories || {});
  const dataSources = {};
  const catMap = mapProductCategory(product, komerceCats);
  const komerceCategory = catMap.key;
  dataSources.category = catMap.source;
  const purchasePriceKmf = convertToKMF(product.purchase_price, product.currency, config.finance);
  dataSources.purchase_price = product.purchase_price ? 'supplier' : 'missing';
  const w = estimateWeight(product.weight_kg, komerceCategory, komerceCats);
  dataSources.weight = w.source;
  const v = estimateVolume(product.dimensions, komerceCategory, komerceCats);
  dataSources.volume = v.source;
  const cat = config.categories[komerceCategory];
  const targetMarginPct = cat?.default_margin_pct ? Number(cat.default_margin_pct) : Number(config.finance?.target_marge_brute_pct) || 40;
  dataSources.target_margin = cat?.default_margin_pct ? 'category' : 'default';
  return {
    supplier_name: product.supplier_name,
    supplier_product_id: product.supplier_product_id || null,
    product_name: product.product_name,
    supplier_category: product.supplier_category || null,
    purchase_price: product.purchase_price || null,
    currency: product.currency || 'AED',
    image_url: product.image_url || null,
    product_url: product.product_url || null,
    description: product.description || null,
    stock_available: product.stock_available ?? null,
    min_order_qty: product.min_order_qty || null,
    supplier_delay_days: product.supplier_delay_days || null,
    weight_kg: product.weight_kg || null,
    dim_l_cm: product.dimensions?.l_cm || null,
    dim_w_cm: product.dimensions?.w_cm || null,
    dim_h_cm: product.dimensions?.h_cm || null,
    komerce_category: komerceCategory,
    purchase_price_kmf: purchasePriceKmf,
    estimated_weight_kg: w.value,
    estimated_volume_m3: v.value,
    target_margin_pct: targetMarginPct,
    data_sources: dataSources,
    confidence: computeConfidence(dataSources),
    category_resolution: {
      source: catMap.source,
      confidence: catMap.confidence,
      reason: catMap.reason || null,
      score: catMap.score || 0,
      second_candidate_key: catMap.second_candidate_key || null,
      second_score: catMap.second_score || 0,
      evidence: catMap.evidence || [],
    },
  };
}

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

async function scanCandidate(candidate, options = {}) {
  const config = options.config || (await pricingEngine.loadGlobalConfig());
  if (!candidate.purchase_price_kmf) {
    return { scan_result: null, sourcing_decision: 'WATCH', reason: 'Prix d\'achat manquant — décision impossible.', recommended_action: 'Mettre en watchlist, ne pas importer pour l\'instant', market_confidence: 'unknown', confidence: candidate.confidence || 'low' };
  }
  if (candidate.data_sources?.category === 'default') {
    return { scan_result: null, sourcing_decision: 'WATCH', reason: 'Catégorie Komerce non résolue — décision impossible.', recommended_action: 'Compléter ou corriger la catégorie avant promotion.', market_confidence: 'unknown', confidence: candidate.confidence || 'low' };
  }
  const input = { product_id: null, category: candidate.komerce_category, cost_kmf: candidate.purchase_price_kmf || 0, weight_kg: candidate.estimated_weight_kg || 0.5, volume_m3: candidate.estimated_volume_m3 || 0.005, current_price_kmf: 0, channel: candidate.channel || 'cash_relais' };
  const reco = await pricingEngine.recommend(input, { config });
  const testHealth = economicTestHealth(reco);
  const scanResult = { ...reco, economic_test_health_status: testHealth.status, economic_test_margin_pct: testHealth.margin_pct };
  const decisionHealth = reco.health_status === 'unknown' ? testHealth.status : reco.health_status;
  let sourcingDecision = reco.sourcing_decision;
  let reason = reco.reason || '';
  if (decisionHealth === 'loss') { sourcingDecision = 'LOSS'; reason = reason || 'Référence test sous le coût variable — produit non rentabilisable.'; }
  else if (decisionHealth === 'danger') { sourcingDecision = 'AVOID'; reason = reason || 'Référence test à contribution dangereusement faible. Renégocier ou éviter.'; }
  else if (decisionHealth === 'fragile') { sourcingDecision = 'WATCH'; reason = reason || 'Référence test à contribution fragile. Surveiller les coûts terrain avant sourcing.'; }
  else if (decisionHealth === 'healthy' || decisionHealth === 'strong') { sourcingDecision = 'TEST'; reason = 'Référence économique de test contributive ; demande marché encore inconnue. Tester en faible quantité sans traiter cette référence comme un prix marché.'; }
  else { sourcingDecision = 'WATCH'; reason = 'Données économiques insuffisantes pour décider. Compléter coût, poids, volume ou catégorie.'; }
  const recommendedAction = ({ PRIORITY: 'Importer comme produit test à fort potentiel', TEST: 'Importer comme produit test en faible quantité', WATCH: 'Mettre en watchlist, ne pas importer pour l\'instant', AVOID: 'Ne pas importer. Renégocier le prix fournisseur ou changer de produit.', LOSS: 'Ne pas importer. Coût supérieur au prix possible.' })[sourcingDecision] || 'À examiner manuellement';
  return { scan_result: scanResult, sourcing_decision: sourcingDecision, reason, recommended_action: recommendedAction, market_confidence: reco.market_confidence || 'unknown', confidence: candidate.confidence || 'low' };
}

module.exports = { normalizeCandidate, scanCandidate, convertToKMF, mapCategory, mapProductCategory, economicTestHealth, estimateWeight, estimateVolume, computeConfidence };