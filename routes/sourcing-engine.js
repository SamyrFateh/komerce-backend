/**
 * KOMERCE — Moteur de lecture sourcing
 *
 * Philosophie :
 * "Le moteur ne remplace pas le jugement terrain.
 *  Il l'éclaire, le cadre, puis apprend de lui."
 *
 * Ce moteur :
 * - Lit les produits et leurs métadonnées sourcing
 * - Croise avec le modèle économique (finance_config)
 * - Livre une intelligence exploitable par produit + synthèse portefeuille
 * - N'invente rien — explicite l'incertitude
 * - Fonctionne même avec des données partielles
 *
 * Endpoints :
 *   GET  /api/admin/sourcing/analysis          — analyse complète du portefeuille
 *   GET  /api/admin/sourcing/analysis/:id       — analyse d'un produit
 *   GET  /api/admin/sourcing/synthesis          — synthèse portefeuille (KPIs)
 *   PUT  /api/admin/sourcing/products/:id       — enrichir les métadonnées sourcing
 *   POST /api/admin/sourcing/bulk-rail          — assigner un rail à N produits
 *   GET  /api/admin/sourcing/config             — lire les seuils sourcing
 *
 * Toutes routes : admin only
 * Tous seuils : lus depuis finance_config (variabilisés)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
// Helper : lire une valeur depuis finance_config (même pattern que dashboard)
// ══════════════════════════════════════════════════════════════════════════
async function getCfg(key, fallback) {
  try {
    const { rows } = await db.query(
      `SELECT value FROM finance_config WHERE key = $1 AND is_active = TRUE LIMIT 1`,
      [key]
    );
    if (rows.length && rows[0].value !== null && rows[0].value !== undefined) {
      const v = Number(rows[0].value);
      return isNaN(v) ? rows[0].value : v;
    }
  } catch (_) { /* table may not exist yet */ }
  return fallback;
}

// ══════════════════════════════════════════════════════════════════════════
// Charger tous les seuils sourcing depuis finance_config
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

    // Métadonnées sourcing (peut être null)
    sourcing: {
      rail: p.sourcing_rail || null,
      rail_source: p.sourcing_rail ? 'declared' : null,
      cost_price_kmf: p.cost_price_kmf,
      weight_g: p.weight_g,
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
  if (p.cost_price_kmf && p.price_kmf) {
    analysis.computed.margin_kmf = p.price_kmf - p.cost_price_kmf;
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
  if (!p.cost_price_kmf) analysis.gaps.push('Prix d\'achat manquant');
  if (!p.weight_g && !p.real_weight_known) analysis.gaps.push('Poids réel inconnu');
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
    p.sourcing_rail, p.cost_price_kmf, p.weight_g, p.fragility,
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
  if (p.weight_g && cfg.weightMax[rail]) {
    if (p.weight_g <= cfg.weightMax[rail]) score += 1;
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
  if (p.weight_g && cfg.weightMax[rail] && p.weight_g > cfg.weightMax[rail]) {
    analysis.alerts.push({
      level: 'warning',
      message: `Poids ${p.weight_g}g dépasse le max rail ${rail} (${cfg.weightMax[rail]}g)`,
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
// 1. GET /analysis — analyse complète du portefeuille
// ══════════════════════════════════════════════════════════════════════════
router.get('/analysis', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cfg = await loadSourcingConfig();
    const salesMap = await getSales30d();

    // Filtres optionnels
    const { rail, status, category, active_only } = req.query;

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

    res.json({
      generated_at: new Date().toISOString(),
      config: {
        break_even_kmf: cfg.breakEvenOrderKmf,
        cost_fixed_kmf: cfg.costFixedPerOrderKmf,
        margins_target: cfg.margins,
        catalog_cap: cfg.catalogCapMvp,
      },
      total: filtered.length,
      products: filtered,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 2. GET /analysis/:id — analyse d'un produit
// ══════════════════════════════════════════════════════════════════════════
router.get('/analysis/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cfg = await loadSourcingConfig();
    const salesMap = await getSales30d();

    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const analysis = analyzeProduct(rows[0], cfg, salesMap);
    res.json(analysis);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. GET /synthesis — synthèse portefeuille (KPIs)
// ══════════════════════════════════════════════════════════════════════════
router.get('/synthesis', authenticate, requireAdmin, async (req, res, next) => {
  try {
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

    res.json({
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
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. PUT /products/:id — enrichir les métadonnées sourcing
// ══════════════════════════════════════════════════════════════════════════
router.put('/products/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      'sourcing_rail', 'cost_price_kmf', 'weight_g', 'volume_class',
      'fragility', 'sale_mode', 'exposure_mode', 'lifecycle_status',
      'quality_validated', 'real_weight_known', 'real_price_validated',
      'delivery_delay_days', 'supplier_notes',
    ];

    const sets = [];
    const vals = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx}`);
        vals.push(req.body[key]);
        idx++;
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    // Always update last_review_at
    sets.push(`last_review_at = NOW()`);

    vals.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );

    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    // Return fresh analysis
    const cfg = await loadSourcingConfig();
    const salesMap = await getSales30d();
    const analysis = analyzeProduct(rows[0], cfg, salesMap);

    res.json({ success: true, product: analysis });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 5. POST /bulk-rail — assigner un rail à plusieurs produits
// ══════════════════════════════════════════════════════════════════════════
router.post('/bulk-rail', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { product_ids, rail } = req.body;
    if (!product_ids || !Array.isArray(product_ids) || !rail) {
      return res.status(400).json({ error: 'product_ids (array) et rail (A/B/C/D) requis' });
    }
    if (!['A', 'B', 'C', 'D'].includes(rail.toUpperCase())) {
      return res.status(400).json({ error: 'Rail invalide — A, B, C ou D' });
    }

    const { rowCount } = await db.query(
      `UPDATE products SET sourcing_rail = $1, last_review_at = NOW() WHERE id = ANY($2)`,
      [rail.toUpperCase(), product_ids]
    );

    res.json({ success: true, updated: rowCount });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 6. GET /config — lire les seuils sourcing actuels
// ══════════════════════════════════════════════════════════════════════════
router.get('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const cfg = await loadSourcingConfig();
    res.json({
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
    });
  } catch (err) { next(err); }
});

module.exports = router;
