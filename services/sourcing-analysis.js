/**
 * @komerce-arch
 * @role          sourcing-analysis
 * @domain        unknown
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       business_rules, order_items, orders, product_variants, products
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

/**
 * services/sourcing-analysis.js
 *
 * Extrait de routes/sourcing-engine.js — GOD-FILES-5 (2026-05-25)
 *
 * Expose les fonctions de lecture (GET) du moteur sourcing :
 *   getAnalysis(filters)           → analyse complète du portefeuille
 *   getAnalysisById(productId)     → analyse d'un produit
 *   getSynthesis()                 → synthèse portefeuille (KPIs)
 *   getConfig()                    → seuils sourcing actuels
 *   getProductVariants(productId)  → variantes d'un produit (B1)
 *
 * Les mutations (PUT products/:id, PUT products/:id/variants, POST bulk-rail)
 * vivent dans services/sourcing-mutations.js. routes/sourcing-engine.js est
 * une façade mince : aucune logique métier inline (B1 clos).
 *
 * Règle I-08 : tous les seuils sont lus depuis business_rules (DB).
 * Aucun coefficient dur dans ce fichier.
 */

const log = require('../utils/logger').child({ module: 'sourcing-analysis' });
const db  = require('../db');

// ══════════════════════════════════════════════════════════════════════════
// Helpers LOT I : normalisation des doublons cost_kmf/cost_price_kmf
//                 et weight_kg/weight_g
// ══════════════════════════════════════════════════════════════════════════
//
// La table products a accumulé des colonnes en doublon :
//   - cost_kmf (initial, INTEGER)  vs cost_price_kmf (ajouté plus tard, INTEGER)
//   - weight_kg (initial, NUMERIC) vs weight_g (ajouté plus tard, INTEGER)
//
// Le pricing utilise cost_kmf + weight_kg.
// Ce moteur de sourcing utilisait historiquement cost_price_kmf + weight_g.
// Conséquence : un produit créé d'un côté n'apparaissait pas de l'autre.
//
// Solution :
//   - Lecture : helpers ci-dessous lisent en priorité la valeur "principale"
//     puis tombent sur le doublon. Une seule source de vérité dans la logique.
//   - Écriture : la migration 042 synchronise les colonnes existantes,
//     et toute mise à jour côté code écrit les 2 colonnes en parallèle.
//
function getProductCostKmf(p) {
  if (p.cost_kmf != null && p.cost_kmf > 0) return Number(p.cost_kmf);
  if (p.cost_price_kmf != null && p.cost_price_kmf > 0) return Number(p.cost_price_kmf);
  return null;
}
function getProductWeightG(p) {
  if (p.weight_kg != null && Number(p.weight_kg) > 0) return Math.round(Number(p.weight_kg) * 1000);
  if (p.weight_g != null && Number(p.weight_g) > 0) return Number(p.weight_g);
  return null;
}
function getProductWeightKg(p) {
  if (p.weight_kg != null && Number(p.weight_kg) > 0) return Number(p.weight_kg);
  if (p.weight_g != null && Number(p.weight_g) > 0) return Number(p.weight_g) / 1000;
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// Helper : lire une valeur de paramétrage depuis business_rules
// ══════════════════════════════════════════════════════════════════════════
// NOTE: business_rules est la table clé/valeur appropriée pour ces seuils.
// finance_config est un singleton à colonnes (variables financières globales)
// et n'est PAS un kv-store — d'où le fix de cette fonction.
// Si la clé n'existe pas en BDD, le fallback fourni est utilisé.
async function getCfg(key, fallback) {
  try {
    const { rows } = await db.query(
      `SELECT value FROM business_rules WHERE key = $1 LIMIT 1`,
      [key.toUpperCase()]  // les clés business_rules sont en MAJ par convention
    );
    if (rows.length && rows[0].value !== null && rows[0].value !== undefined) {
      // value peut être un JSON {value: 42} ou directement un nombre
      const raw = rows[0].value;
      if (typeof raw === 'object' && raw !== null && 'value' in raw) {
        const v = Number(raw.value);
        return isNaN(v) ? raw.value : v;
      }
      const v = Number(raw);
      return isNaN(v) ? raw : v;
    }
  } catch (_) { /* table may not exist */ }
  return fallback;
}

// ══════════════════════════════════════════════════════════════════════════
// Charger tous les seuils sourcing depuis business_rules (I-08)
// ══════════════════════════════════════════════════════════════════════════
async function loadSourcingConfig() {
  const [
    costFixedPerOrderKmf,
    breakEvenOrderKmf,
    maxActiveProducts,
    marginTargetA, marginTargetB, marginTargetC, marginTargetD,
    priceMaxA, priceMaxD, priceMinB, priceMinC,
    weightMaxA, weightMaxB, weightMaxD,
    catalogCapMvp,
    deadThresholdDays,
    starThresholdSales30d,
  ] = await Promise.all([
    getCfg('cost_fixed_per_order_kmf',  4200),
    getCfg('break_even_order_kmf',      14000),
    getCfg('max_active_products',       120),
    getCfg('margin_target_rail_a_pct',  45),   // 40-50% → cible 45%
    getCfg('margin_target_rail_b_pct',  18),   // 15-22% → cible 18%
    getCfg('margin_target_rail_c_pct',  35),   // 30-40% → cible 35%
    getCfg('margin_target_rail_d_pct',  70),   // 60-80% → cible 70%
    getCfg('price_max_rail_a_kmf',      10000),
    getCfg('price_max_rail_d_kmf',      5000),
    getCfg('price_min_rail_b_kmf',      30000),
    getCfg('price_min_rail_c_kmf',      20000),
    getCfg('weight_max_rail_a_g',       500),
    getCfg('weight_max_rail_b_g',       5000),
    getCfg('weight_max_rail_d_g',       200),
    getCfg('catalog_cap_mvp',           120),
    getCfg('dead_threshold_days',       30),
    getCfg('star_threshold_sales_30d',  3),
  ]);

  return {
    costFixedPerOrderKmf,
    breakEvenOrderKmf,
    maxActiveProducts,
    margins: { A: marginTargetA, B: marginTargetB, C: marginTargetC, D: marginTargetD },
    priceRanges: {
      A: { max: priceMaxA },
      B: { min: priceMinB },
      C: { min: priceMinC },
      D: { max: priceMaxD },
    },
    weightMax: { A: weightMaxA, B: weightMaxB, D: weightMaxD },
    catalogCapMvp,
    deadThresholdDays,
    starThresholdSales30d,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// MOTEUR D'ANALYSE — le cœur
// ══════════════════════════════════════════════════════════════════════════

/**
 * Analyse un produit et retourne l'intelligence.
 * Fonctionne avec des données partielles — explicite ce qui manque.
 */
function analyzeProduct(product, cfg, salesMap) {
  const p = product;
  const analysis = {
    id: p.id,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    price_kmf: p.price_kmf,
    image_url: p.image_url,
    is_active: p.is_active,

    // Métadonnées sourcing (peut être null) — lecture normalisée Lot I
    sourcing: {
      rail: p.sourcing_rail || null,
      rail_source: p.sourcing_rail ? 'declared' : null,
      cost_price_kmf: getProductCostKmf(p),
      weight_g: getProductWeightG(p),
      volume_class: p.volume_class,
      fragility: p.fragility,
      sale_mode: p.sale_mode,
      exposure_mode: p.exposure_mode,
      lifecycle_status: p.lifecycle_status || 'unknown',
      quality_validated: p.quality_validated || false,
      real_weight_known: p.real_weight_known || false,
      real_price_validated: p.real_price_validated || false,
      delivery_delay_days: p.delivery_delay_days,
      supplier_notes: p.supplier_notes,
      last_review_at: p.last_review_at,
    },

    // Calculés
    computed: {
      margin_pct: null,
      margin_kmf: null,
      standalone_viable: null,
      inferred_rail: null,
      sales_30d: salesMap[p.id] || 0,
    },

    // Résultats moteur
    status: null,          // en_phase / sous_reserve / test_requis / hors_phase
    status_color: null,    // green / orange / red
    reason: null,          // phrase simple métier
    confidence: null,      // forte / moyenne / faible
    gaps: [],              // ce qui manque
    action: null,          // suggestion d'action
    exposure_suggestion: null,   // suggestion exposition
    sale_suggestion: null,       // suggestion mode vente
    alerts: [],            // alertes spécifiques
  };

  // ── Étape 1 : Calcul de marge ──────────────────────────────────────────
  const costKmfNorm = getProductCostKmf(p);
  if (costKmfNorm && p.price_kmf) {
    analysis.computed.margin_kmf = p.price_kmf - costKmfNorm;
    analysis.computed.margin_pct = Math.round((analysis.computed.margin_kmf / p.price_kmf) * 100);
  }

  // ── Étape 2 : Standalone viable ? ──────────────────────────────────────
  analysis.computed.standalone_viable = p.price_kmf >= cfg.breakEvenOrderKmf;

  // ── Étape 3 : Inférence du rail ────────────────────────────────────────
  if (p.sourcing_rail) {
    analysis.computed.inferred_rail = p.sourcing_rail;
    analysis.sourcing.rail_source = 'declared';
  } else {
    // Inférence prudente depuis le prix
    const price = p.price_kmf || 0;
    if (price <= cfg.priceRanges.D.max) {
      analysis.computed.inferred_rail = 'D';
    } else if (price <= cfg.priceRanges.A.max) {
      analysis.computed.inferred_rail = 'A';
    } else if (price >= cfg.priceRanges.B.min) {
      analysis.computed.inferred_rail = 'B';
    } else if (price >= cfg.priceRanges.C.min) {
      analysis.computed.inferred_rail = 'C';
    } else {
      // Zone grise (10k-20k) — pourrait être A haut de gamme ou B entrée
      analysis.computed.inferred_rail = 'A';
    }
    analysis.sourcing.rail_source = 'inferred';
  }

  const rail = analysis.computed.inferred_rail;
  const marginTarget = cfg.margins[rail] || 30;

  // ── Étape 4 : Identifier les gaps ──────────────────────────────────────
  if (!getProductCostKmf(p)) analysis.gaps.push('Prix d\'achat manquant');
  if (!getProductWeightG(p) && !p.real_weight_known) analysis.gaps.push('Poids réel inconnu');
  if (!p.quality_validated) analysis.gaps.push('Qualité non validée');
  if (!p.delivery_delay_days) analysis.gaps.push('Délai réel non mesuré');
  if (!p.sourcing_rail) analysis.gaps.push('Rail non assigné (inféré)');
  if (!p.sale_mode) analysis.gaps.push('Mode vente non défini');
  if (!p.fragility) analysis.gaps.push('Fragilité non évaluée');
  if (!p.volume_class) analysis.gaps.push('Gabarit non renseigné');
  if (analysis.computed.sales_30d === 0 && p.lifecycle_status === 'active') {
    analysis.gaps.push('Rotation 0 vente sur 30j');
  }
  if (!p.real_price_validated) analysis.gaps.push('Prix de revente non validé terrain');

  // ── Étape 5 : Calculer la confiance ────────────────────────────────────
  const totalFields = 10;
  const filledFields = [
    p.sourcing_rail, getProductCostKmf(p), getProductWeightG(p), p.fragility,
    p.volume_class, p.sale_mode, p.quality_validated ? 'yes' : null,
    p.delivery_delay_days, p.real_price_validated ? 'yes' : null,
    p.real_weight_known ? 'yes' : null,
  ].filter(Boolean).length;

  const completeness = filledFields / totalFields;
  if (completeness >= 0.7) analysis.confidence = 'forte';
  else if (completeness >= 0.4) analysis.confidence = 'moyenne';
  else analysis.confidence = 'faible';

  // ── Étape 6 : Déterminer le statut global ──────────────────────────────
  // Le moteur est prudent : sans données, il ne dit pas "hors phase",
  // il dit "test requis" (besoin d'info).

  let score = 0; // 0 = neutre, positif = bon, négatif = problème

  // Marge OK ?
  if (analysis.computed.margin_pct !== null) {
    if (analysis.computed.margin_pct >= marginTarget) score += 2;
    else if (analysis.computed.margin_pct >= marginTarget * 0.7) score += 1;
    else score -= 2;
  }

  // Standalone viable ?
  if (analysis.computed.standalone_viable) score += 1;
  else if (rail === 'A' || rail === 'D') score += 0; // normal pour ces rails
  else score -= 1;

  // Qualité validée ?
  if (p.quality_validated) score += 1;

  // Poids dans les limites du rail ?
  const weightG = getProductWeightG(p);
  if (weightG && cfg.weightMax[rail]) {
    if (weightG <= cfg.weightMax[rail]) score += 1;
    else score -= 1;
  }

  // Cycle de vie ?
  if (['star', 'steady'].includes(p.lifecycle_status)) score += 2;
  else if (p.lifecycle_status === 'active') score += 1;
  else if (p.lifecycle_status === 'dead') score -= 3;
  else if (p.lifecycle_status === 'candidate') score += 0;

  // Ventes ?
  const sales = analysis.computed.sales_30d;
  if (sales >= cfg.starThresholdSales30d) score += 2;
  else if (sales > 0) score += 1;
  // Pas de pénalité si pas de vente (produit peut être nouveau)

  // Détermination
  if (score >= 4 && analysis.gaps.length <= 2) {
    analysis.status = 'en_phase';
    analysis.status_color = 'green';
  } else if (score >= 2 || (score >= 0 && analysis.gaps.length <= 4)) {
    analysis.status = 'sous_reserve';
    analysis.status_color = 'orange';
  } else if (completeness < 0.3) {
    analysis.status = 'test_requis';
    analysis.status_color = 'orange';
  } else {
    analysis.status = 'hors_phase';
    analysis.status_color = 'red';
  }

  // ── Étape 7 : Raison principale ───────────────────────────────────────
  if (analysis.status === 'en_phase') {
    if (sales >= cfg.starThresholdSales30d) {
      analysis.reason = `Produit performant — ${sales} ventes/30j, marge ${analysis.computed.margin_pct || '?'}%`;
    } else {
      analysis.reason = 'Conforme au modèle, données suffisantes';
    }
  } else if (analysis.status === 'sous_reserve') {
    if (analysis.gaps.length > 0) {
      analysis.reason = `Potentiel OK mais ${analysis.gaps.length} info(s) manquante(s) : ${analysis.gaps.slice(0, 2).join(', ')}`;
    } else if (analysis.computed.margin_pct !== null && analysis.computed.margin_pct < marginTarget) {
      analysis.reason = `Marge ${analysis.computed.margin_pct}% < cible ${marginTarget}% pour rail ${rail}`;
    } else {
      analysis.reason = 'Données partielles — à compléter';
    }
  } else if (analysis.status === 'test_requis') {
    analysis.reason = `Trop peu de données (${filledFields}/${totalFields} champs renseignés)`;
  } else {
    // hors_phase
    if (p.lifecycle_status === 'dead') {
      analysis.reason = `Produit mort — 0 vente depuis ${cfg.deadThresholdDays}j`;
    } else if (analysis.computed.margin_pct !== null && analysis.computed.margin_pct < marginTarget * 0.5) {
      analysis.reason = `Marge insuffisante (${analysis.computed.margin_pct}% vs ${marginTarget}% cible)`;
    } else {
      analysis.reason = 'Non conforme au modèle actuel';
    }
  }

  // ── Étape 8 : Suggestions ─────────────────────────────────────────────

  // Action
  if (analysis.status === 'hors_phase') {
    if (p.lifecycle_status === 'dead') analysis.action = 'geler';
    else if (analysis.computed.margin_pct !== null && analysis.computed.margin_pct < 10) analysis.action = 'refuser';
    else analysis.action = 'geler';
  } else if (analysis.status === 'test_requis') {
    analysis.action = 'tester';
  } else if (analysis.status === 'sous_reserve') {
    if (analysis.computed.margin_pct !== null && analysis.computed.margin_pct < marginTarget) {
      analysis.action = 'négocier';
    } else if (!p.quality_validated) {
      analysis.action = 'tester';
    } else {
      analysis.action = 'compléter les données';
    }
  } else {
    // en_phase
    if (sales >= cfg.starThresholdSales30d) analysis.action = 'pousser';
    else if (rail === 'A' || rail === 'D') analysis.action = 'bundler';
    else analysis.action = 'maintenir';
  }

  // Exposition
  if (analysis.status === 'hors_phase') {
    analysis.exposure_suggestion = 'caché';
  } else if (analysis.status === 'test_requis') {
    analysis.exposure_suggestion = 'caché_test';
  } else if (p.lifecycle_status === 'star' || sales >= cfg.starThresholdSales30d) {
    analysis.exposure_suggestion = 'catalogue_visible';
  } else if (rail === 'C') {
    analysis.exposure_suggestion = 'sur_demande';
  } else if (rail === 'B' && p.price_kmf >= 100000) {
    analysis.exposure_suggestion = 'showroom';
  } else {
    analysis.exposure_suggestion = 'catalogue_visible';
  }

  // Vente
  if (!analysis.computed.standalone_viable) {
    if (rail === 'A' || rail === 'D') analysis.sale_suggestion = 'bundle_obligatoire';
    else analysis.sale_suggestion = 'bundle_conseillé';
  } else if (rail === 'C') {
    analysis.sale_suggestion = 'acompte_précommande';
  } else if (rail === 'B') {
    analysis.sale_suggestion = 'standalone_possible';
  } else {
    analysis.sale_suggestion = 'standalone_possible';
  }

  // ── Étape 9 : Alertes spécifiques ─────────────────────────────────────
  if (p.price_kmf && p.price_kmf < cfg.costFixedPerOrderKmf) {
    analysis.alerts.push({
      level: 'critical',
      message: `Prix vente (${p.price_kmf} KMF) < coût fixe par commande (${cfg.costFixedPerOrderKmf} KMF)`,
    });
  }
  if (analysis.computed.margin_pct !== null && analysis.computed.margin_pct < 0) {
    analysis.alerts.push({
      level: 'critical',
      message: `Marge NÉGATIVE (${analysis.computed.margin_pct}%) — vente à perte`,
    });
  }
  const wG = getProductWeightG(p);
  if (wG && cfg.weightMax[rail] && wG > cfg.weightMax[rail]) {
    analysis.alerts.push({
      level: 'warning',
      message: `Poids ${wG}g dépasse le max rail ${rail} (${cfg.weightMax[rail]}g)`,
    });
  }
  if (p.is_active && !p.quality_validated && p.lifecycle_status !== 'candidate' && p.lifecycle_status !== 'test') {
    analysis.alerts.push({
      level: 'warning',
      message: 'Produit actif en vente sans validation qualité',
    });
  }

  return analysis;
}

// ══════════════════════════════════════════════════════════════════════════
// Helper : ventes 30j par produit
// ══════════════════════════════════════════════════════════════════════════
async function getSales30d() {
  const map = {};
  try {
    const { rows } = await db.query(`
      SELECT oi.product_id, COUNT(DISTINCT oi.order_id) AS sales_count
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at > NOW() - INTERVAL '30 days'
        AND o.status NOT IN ('cancelled', 'refunded')
      GROUP BY oi.product_id
    `);
    for (const r of rows) map[r.product_id] = Number(r.sales_count);
  } catch (_) { /* order_items may not exist */ }
  return map;
}

// ══════════════════════════════════════════════════════════════════════════
// API publique du service
// ══════════════════════════════════════════════════════════════════════════

/**
 * getAnalysis(filters) — analyse complète du portefeuille
 * @param {object} filters — { rail?, status?, category?, active_only? }
 * @returns {object} — { generated_at, config, total, products }
 */
async function getAnalysis(filters = {}) {
  const cfg = await loadSourcingConfig();
  const salesMap = await getSales30d();

  const { rail, status, category, active_only } = filters;

  let sql = `SELECT * FROM products WHERE 1=1`;
  const params = [];
  if (active_only === 'true') {
    sql += ` AND is_active = TRUE`;
  }
  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }
  sql += ` ORDER BY sort_order ASC, name ASC`;

  const { rows: products } = await db.query(sql, params);

  const analyses = products.map(p => analyzeProduct(p, cfg, salesMap));

  // Filtres post-analyse
  let filtered = analyses;
  if (rail) filtered = filtered.filter(a => a.computed.inferred_rail === rail.toUpperCase());
  if (status) filtered = filtered.filter(a => a.status === status);

  return {
    generated_at: new Date().toISOString(),
    config: {
      break_even_kmf: cfg.breakEvenOrderKmf,
      cost_fixed_kmf: cfg.costFixedPerOrderKmf,
      margins_target: cfg.margins,
      catalog_cap: cfg.catalogCapMvp,
    },
    total: filtered.length,
    products: filtered,
  };
}

/**
 * getAnalysisById(productId) — analyse d'un produit
 * @param {string|number} productId
 * @returns {object} analyse du produit, ou null si introuvable
 */
async function getAnalysisById(productId) {
  const cfg = await loadSourcingConfig();
  const salesMap = await getSales30d();

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
  if (!rows.length) return null;

  return analyzeProduct(rows[0], cfg, salesMap);
}

/**
 * getSynthesis() — synthèse portefeuille (KPIs)
 * @returns {object} — KPIs, top produits, alertes globales
 */
async function getSynthesis() {
  const cfg = await loadSourcingConfig();
  const salesMap = await getSales30d();

  const { rows: products } = await db.query(
    `SELECT * FROM products WHERE is_active = TRUE ORDER BY sort_order ASC`
  );

  const analyses = products.map(p => analyzeProduct(p, cfg, salesMap));

  // Compteurs par statut
  const byStatus = { en_phase: [], sous_reserve: [], test_requis: [], hors_phase: [] };
  for (const a of analyses) {
    if (byStatus[a.status]) byStatus[a.status].push(a);
  }

  // Par rail
  const byRail = { A: 0, B: 0, C: 0, D: 0, unknown: 0 };
  for (const a of analyses) {
    const r = a.computed.inferred_rail;
    if (byRail[r] !== undefined) byRail[r]++;
    else byRail.unknown++;
  }

  // Par confiance
  const byConfidence = { forte: 0, moyenne: 0, faible: 0 };
  for (const a of analyses) {
    if (byConfidence[a.confidence] !== undefined) byConfidence[a.confidence]++;
  }

  // Top produits
  const sortedBySales = [...analyses].sort((a, b) => b.computed.sales_30d - a.computed.sales_30d);
  const topPush = sortedBySales.filter(a => a.status === 'en_phase').slice(0, 5);
  const topWatch = analyses.filter(a => a.status === 'sous_reserve' && a.alerts.length > 0).slice(0, 5);
  const topFreeze = analyses.filter(a => a.status === 'hors_phase').slice(0, 5);

  // Alertes globales
  const globalAlerts = [];
  if (analyses.length > cfg.catalogCapMvp) {
    globalAlerts.push({
      level: 'warning',
      message: `${analyses.length} produits actifs > plafond MVP (${cfg.catalogCapMvp})`,
    });
  }
  const noRailCount = analyses.filter(a => a.sourcing.rail_source === 'inferred').length;
  if (noRailCount > analyses.length * 0.5) {
    globalAlerts.push({
      level: 'info',
      message: `${noRailCount}/${analyses.length} produits sans rail assigné (inféré automatiquement)`,
    });
  }
  const noCostCount = analyses.filter(a => !a.sourcing.cost_price_kmf).length;
  if (noCostCount > 0) {
    globalAlerts.push({
      level: 'info',
      message: `${noCostCount} produit(s) sans prix d'achat — marge non calculable`,
    });
  }
  const criticalAlerts = analyses.filter(a => a.alerts.some(al => al.level === 'critical'));
  if (criticalAlerts.length > 0) {
    globalAlerts.push({
      level: 'critical',
      message: `${criticalAlerts.length} produit(s) avec alertes critiques`,
    });
  }

  // Complétude données
  const avgCompleteness = analyses.length > 0
    ? Math.round(analyses.reduce((sum, a) => {
        const filled = [
          a.sourcing.rail, a.sourcing.cost_price_kmf, a.sourcing.weight_g,
          a.sourcing.fragility, a.sourcing.volume_class, a.sourcing.sale_mode,
          a.sourcing.quality_validated ? 'y' : null, a.sourcing.delivery_delay_days,
          a.sourcing.real_price_validated ? 'y' : null, a.sourcing.real_weight_known ? 'y' : null,
        ].filter(Boolean).length;
        return sum + (filled / 10) * 100;
      }, 0) / analyses.length)
    : 0;

  return {
    generated_at: new Date().toISOString(),
    total_active: analyses.length,
    catalog_cap: cfg.catalogCapMvp,

    by_status: {
      en_phase: byStatus.en_phase.length,
      sous_reserve: byStatus.sous_reserve.length,
      test_requis: byStatus.test_requis.length,
      hors_phase: byStatus.hors_phase.length,
    },

    by_rail: byRail,
    by_confidence: byConfidence,
    data_completeness_pct: avgCompleteness,

    top_push: topPush.map(a => ({
      id: a.id, name: a.name, sales_30d: a.computed.sales_30d,
      margin_pct: a.computed.margin_pct, rail: a.computed.inferred_rail,
    })),
    top_watch: topWatch.map(a => ({
      id: a.id, name: a.name, reason: a.reason,
      alerts: a.alerts.length, rail: a.computed.inferred_rail,
    })),
    top_freeze: topFreeze.map(a => ({
      id: a.id, name: a.name, reason: a.reason,
      rail: a.computed.inferred_rail,
    })),

    global_alerts: globalAlerts,
  };
}

/**
 * getConfig() — lire les seuils sourcing actuels
 * @returns {object} — config + explications
 */
async function getConfig() {
  const cfg = await loadSourcingConfig();
  return {
    ...cfg,
    explanation: {
      rails: {
        A: 'Essentiels quotidiens (60% CA visé) — bundle obligatoire',
        B: 'Hero products (25% CA) — locomotive rentabilité',
        C: 'Sur-mesure (10% CA) — signature de marque',
        D: 'Impulsifs sympas (5% CA) — appât, pas fond',
      },
      lifecycle: {
        candidate: 'Identifié, pas encore testé',
        test: 'En test (3-5 unités commandées)',
        active: 'En vente, suivi des performances',
        star: '> 3 ventes/30j — à pousser',
        steady: '1-3 ventes/30j — maintien discret',
        dead: '0 vente 30j — retrait candidat',
        revision: 'En révision trimestrielle',
      },
    },
  };
}

/**
 * getProductVariants(productId) — lecture seule des variantes d'un produit
 * @param {string} productId
 * @returns {object|null} — null si produit introuvable
 */
async function getProductVariants(productId) {
  const { rows: prodRows } = await db.query(
    `SELECT id, has_variants FROM products WHERE id = $1`,
    [productId]
  );
  if (!prodRows.length) return null;

  const { rows } = await db.query(
    `SELECT id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order,
            created_at, updated_at
       FROM product_variants
      WHERE product_id = $1
      ORDER BY variant_type ASC, display_order ASC, variant_value ASC`,
    [productId]
  );

  return {
    product_id:   productId,
    has_variants: prodRows[0].has_variants,
    variants:     rows,
    total:        rows.length,
  };
}

module.exports = {
  getAnalysis,
  getAnalysisById,
  getSynthesis,
  getConfig,
  getProductVariants,
  // Exportés aussi pour usage interne (PUT /products/:id renvoie une analyse fraîche)
  loadSourcingConfig,
  getSales30d,
  analyzeProduct,
};
