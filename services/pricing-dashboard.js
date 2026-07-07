/**
 * @komerce-arch
 * @role          economic-engine-pricing-dashboard
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       charges, customs_categories, finance_config, pricing_benchmarks, pricing_components, products, risk_provisions
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * services/pricing-dashboard.js
 *
 * Logique métier pour les endpoints de pilotage pricing.
 * Extrait de routes/pricing.js (GOD-FILES-1).
 *
 * Exports :
 *   computeDashboard()           → GET /api/pricing/dashboard
 *   listBenchmarks(query)        → GET /api/pricing/benchmarks
 *   computeBenchmarksGap(query)  → GET /api/pricing/benchmarks-gap
 *
 * Doctrine : Invariant I-08 — pricing lit les composantes DB, aucun coefficient dur.
 */

const db            = require('../db');
const pricingEngine = require('./pricing-engine');
const log           = require('../utils/logger').child({ module: 'pricing-dashboard' });

// ─── computeDashboard ──────────────────────────────────────────────────────

/**
 * Vue de pilotage pricing : CDR + verdicts + KPIs + alertes + doctrine.
 * @returns {Promise<object>} { kpis, alerts, doctrine, generated_at }
 */
async function computeDashboard() {
  // 1. Config finance (cible + objectif, pour affichage KPI uniquement)
  const { rows: [fc] } = await db.query(
    'SELECT target_marge_brute_pct, objectif_commandes_mois FROM finance_config WHERE id = 1'
  );
  const margeCiblePct = Number(fc?.target_marge_brute_pct) || 40;

  // 2. Config moteur (source de vérité unique — doctrine §13).
  //    AUCUN recalcul parallèle ici : on ne lit plus pricing_components ni les taux
  //    pour refaire un CDR « maison ». Tout passe par pricing-engine.recommend().
  const config = await pricingEngine.loadGlobalConfig();

  // 3. Tous les produits actifs
  const { rows: products } = await db.query(
    'SELECT id, name, category, price_kmf, cost_kmf, weight_kg FROM products WHERE is_active = TRUE'
  );

  // 4. CDR + verdict par produit — VIA LE MOTEUR (une seule vérité)
  const productsDestructive  = [];  // prix < coût variable → vente destructrice (§7 doctrine)
  const productsUndercovered = [];  // coût variable ≤ prix < CDR → contributif mais sous-couvert
  const productsCritical  = [];
  const margesByCategory  = {};
  let nbAligned = 0, nbUnder = 0, nbOver = 0, nbUnset = 0;
  let totalMargeEffective = 0, totalAvecPrix = 0;
  let nbRecoFailed = 0;
  let n3Sample = null;   // quote-part charges fixes (identique tous produits si scope global)

  // Lecture catalogue par les DEUX frontières (doctrine §7)
  const frontiers = { destructive: 0, undercovered: 0, covered: 0, unpriced: 0 };

  const dist = {
    by_health:   { loss: 0, danger: 0, fragile: 0, healthy: 0, strong: 0, unknown: 0 },
    by_sourcing: { PRIORITY: 0, TEST: 0, WATCH: 0, AVOID: 0, LOSS: 0, RENEGOTIATE: 0, INCREASE_PRICE: 0 },
    by_market:   { unknown: 0, testing: 0, validated: 0, scaling: 0, rejected: 0 },
    sample_size: 0,
  };

  for (const p of products) {
    const category = p.category || 'phones';
    let reco;
    try {
      reco = await pricingEngine.recommend(
        { product_id: p.id, category, current_price_kmf: p.price_kmf },
        { config }
      );
    } catch (_) { nbRecoFailed++; continue; }

    // Champs doctrinaux = source de vérité (mêmes chiffres que /recommend)
    const cdr         = reco.cdr_complete_kmf;
    const prixCalcule = reco.recommended_price_kmf;
    const prixActuel  = reco.current_price_kmf || 0;
    const margeEff    = reco.estimated_margin_pct;   // (prix - CDR complet) / prix
    if (n3Sample === null) n3Sample = reco.n3_fixed_overhead_allocation_kmf;

    // Classement par frontières (doctrine §7) : destructif < coût variable ≤ sous-couvert < CDR ≤ couvert
    const variableComplete = reco.variable_cost_complete_kmf;
    if (prixActuel <= 0)                       frontiers.unpriced++;
    else if (prixActuel < variableComplete)    frontiers.destructive++;
    else if (prixActuel < cdr)                 frontiers.undercovered++;
    else                                       frontiers.covered++;

    // Distributions doctrine (repris du même reco, plus de 2ᵉ boucle)
    if (reco.health_status     && dist.by_health[reco.health_status]       != null) dist.by_health[reco.health_status]++;
    if (reco.sourcing_decision && dist.by_sourcing[reco.sourcing_decision] != null) dist.by_sourcing[reco.sourcing_decision]++;
    if (reco.market_confidence && dist.by_market[reco.market_confidence]   != null) dist.by_market[reco.market_confidence]++;
    dist.sample_size++;

    if (margeEff !== null && prixActuel > 0) {
      totalMargeEffective += margeEff;
      totalAvecPrix++;
      if (!margesByCategory[category]) margesByCategory[category] = { sum: 0, count: 0 };
      margesByCategory[category].sum += margeEff;
      margesByCategory[category].count++;
    }

    if (prixActuel <= 0) { nbUnset++; }
    else if (prixCalcule > 0) {
      const ecart = (prixActuel - prixCalcule) / prixCalcule;
      if (Math.abs(ecart) <= 0.05) { nbAligned++; }
      else if (ecart < 0)          { nbUnder++;   }
      else                         { nbOver++;    }
    }

    // Doctrine §7 : deux frontières distinctes.
    //   Destructif (à perte) = prix < coût variable complet (N1+N2)
    //   Sous-couvert         = coût variable ≤ prix < CDR complet (contributif mais structure non couverte)
    if (prixActuel > 0 && prixActuel < variableComplete) {
      productsDestructive.push({ id: p.id, name: p.name, price_kmf: prixActuel, variable_cost_kmf: variableComplete, cdr_kmf: cdr, gap_kmf: variableComplete - prixActuel });
    } else if (prixActuel > 0 && prixActuel < cdr) {
      productsUndercovered.push({ id: p.id, name: p.name, price_kmf: prixActuel, variable_cost_kmf: variableComplete, cdr_kmf: cdr, gap_to_cdr_kmf: cdr - prixActuel });
    } else if (margeEff !== null && margeEff < 10) {
      productsCritical.push({ id: p.id, name: p.name, marge_pct: margeEff, price_kmf: prixActuel });
    }
  }
  const niveau2 = n3Sample != null ? n3Sample : 0;

  // 6. KPIs agrégés
  const nbWithCost       = products.filter(p => Number(p.cost_kmf) > 0).length;
  const couvertureCostPct = products.length > 0 ? Math.round(nbWithCost / products.length * 100) : 0;
  const margeMoyEff      = totalAvecPrix > 0
    ? Math.round((totalMargeEffective / totalAvecPrix) * 10) / 10
    : 0;

  const seuilCritique = 15;
  const categoriesEnDanger = Object.entries(margesByCategory)
    .filter(([, m]) => m.sum / m.count < seuilCritique)
    .map(([cat, m]) => ({ category: cat, marge_moyenne_pct: Math.round(m.sum / m.count * 10) / 10, nb_produits: m.count }));

  // 7. Date dernière modif config
  let lastChange = null;
  try {
    const { rows } = await db.query(
      `SELECT GREATEST(
                COALESCE((SELECT MAX(updated_at) FROM pricing_components), '1970-01-01'),
                COALESCE((SELECT MAX(updated_at) FROM risk_provisions),    '1970-01-01'),
                COALESCE((SELECT MAX(updated_at) FROM charges),            '1970-01-01'),
                COALESCE((SELECT MAX(updated_at) FROM customs_categories), '1970-01-01')
              ) AS last_change`
    );
    lastChange = rows[0]?.last_change;
  } catch (_) {}

  // 8. Alertes
  const alerts = [];
  if (productsDestructive.length) alerts.push({
    severity: 'critical', code: 'sale_destructive',
    title: 'Ventes destructrices (sous coût variable)',
    message: `${productsDestructive.length} produit(s) vendus en-dessous du coût variable complet — chaque vente détruit de la trésorerie.`,
    count: productsDestructive.length, products: productsDestructive.slice(0, 10),
  });
  if (productsUndercovered.length) alerts.push({
    severity: 'warning', code: 'sale_undercovered',
    title: 'Ventes sous CDR (contributives mais structure non couverte)',
    message: `${productsUndercovered.length} produit(s) couvrent leurs coûts variables mais n'amortissent pas la structure (entre coût variable et CDR complet).`,
    count: productsUndercovered.length, products: productsUndercovered.slice(0, 10),
  });
  if (productsCritical.length) alerts.push({
    severity: 'warning', code: 'low_margin',
    title: 'Marges faibles',
    message: `${productsCritical.length} produit(s) ont une marge effective inférieure à 10%.`,
    count: productsCritical.length, products: productsCritical.slice(0, 10),
  });
  if (categoriesEnDanger.length) alerts.push({
    severity: 'warning', code: 'category_low_margin',
    title: 'Catégories sous-rentables',
    message: `${categoriesEnDanger.length} catégorie(s) ont une marge moyenne inférieure à ${seuilCritique}%.`,
    count: categoriesEnDanger.length, categories: categoriesEnDanger,
  });
  if (margeMoyEff < margeCiblePct - 10 && totalAvecPrix > 0) alerts.push({
    severity: 'warning', code: 'global_margin_below_target',
    title: 'Marge globale sous la cible',
    message: `La marge moyenne effective est de ${margeMoyEff}% (cible : ${margeCiblePct}%, écart de ${Math.round((margeCiblePct - margeMoyEff) * 10) / 10}%).`,
  });
  if (couvertureCostPct < 80 && products.length > 5) alerts.push({
    severity: 'info', code: 'cost_coverage_low',
    title: 'Couverture coûts incomplète',
    message: `Seulement ${couvertureCostPct}% des produits ont un coût d'achat renseigné.`,
    count: products.length - nbWithCost,
  });
  if (nbUnset > 0) alerts.push({
    severity: 'info', code: 'unset_prices',
    title: 'Prix de vente non fixés',
    message: `${nbUnset} produit(s) actifs n'ont pas de prix de vente.`,
    count: nbUnset,
  });

  // 9. Doctrine : distributions déjà calculées dans la boucle unique ci-dessus
  const doctrine = dist;

  if (nbRecoFailed > 0) alerts.push({
    severity: 'info', code: 'reco_failed',
    title: 'Produits non calculés',
    message: `${nbRecoFailed} produit(s) n'ont pas pu être évalués par le moteur (données manquantes).`,
    count: nbRecoFailed,
  });

  return {
    kpis: {
      marge_moyenne_pct:    margeMoyEff,
      marge_cible_pct:      margeCiblePct,
      ecart_cible_pct:      Math.round((margeMoyEff - margeCiblePct) * 10) / 10,
      nb_total:             products.length,
      nb_aligned:           nbAligned,
      nb_underpriced:       nbUnder,
      nb_overpriced:        nbOver,
      nb_unset:             nbUnset,
      nb_destructive:       productsDestructive.length,
      nb_undercovered:      productsUndercovered.length,
      couverture_cost_pct:  couvertureCostPct,
      last_config_change_at: lastChange,
      niveau2_kmf:          niveau2,
      n3_fixed_overhead_allocation_kmf: niveau2,
      source_of_truth:      'pricing-engine',
    },
    alerts,
    doctrine,
    frontiers,
    generated_at: new Date().toISOString(),
  };
}

// ─── listBenchmarks ────────────────────────────────────────────────────────

/**
 * Liste les benchmarks sectoriels pour l'Atelier de composition.
 * @param {{ category?: string, importance?: string }} query
 * @returns {Promise<{ count: number, benchmarks: object[] }>}
 */
async function listBenchmarks(query = {}) {
  const where  = ['is_active = TRUE'];
  const params = [];
  let pi       = 0;

  if (query.category) {
    params.push(query.category);
    where.push(`category = $${++pi}`);
  }
  if (query.importance) {
    params.push(query.importance);
    where.push(`importance = $${++pi}`);
  }

  const { rows } = await db.query(
    `SELECT id, key, label, emoji, category, unit,
            benchmark_median, benchmark_min, benchmark_max,
            importance, why, source_benchmark, applies_to, display_order
       FROM pricing_benchmarks
      WHERE ${where.join(' AND ')}
      ORDER BY category, display_order, label`,
    params
  );
  return { count: rows.length, benchmarks: rows };
}

// ─── computeBenchmarksGap ─────────────────────────────────────────────────

/**
 * Compare la config actuelle avec le catalogue pricing_benchmarks.
 * @param {{ importance?: string, category?: string, include_optional?: boolean }} query
 * @returns {Promise<object>} { summary, by_category, filters, generated_at }
 */
async function computeBenchmarksGap(query = {}) {
  const filterImportance = query.importance || null;
  const filterCategory   = query.category   || null;
  const includeOptional  = query.include_optional === 'true' || query.include_optional === true;

  // 1. Benchmarks
  const benchClauses = ['is_active = TRUE'];
  const benchParams  = [];
  let bi = 1;
  if (filterImportance) { benchClauses.push(`importance = $${bi++}`); benchParams.push(filterImportance); }
  if (filterCategory)   { benchClauses.push(`category   = $${bi++}`); benchParams.push(filterCategory); }
  if (!includeOptional && !filterImportance) benchClauses.push(`importance != 'optional'`);

  const benchRes = await db.query(
    `SELECT * FROM pricing_benchmarks WHERE ${benchClauses.join(' AND ')} ORDER BY category, display_order, label`,
    benchParams
  );

  // 2. Composants et provisions actuels
  const [compRes, provRes] = await Promise.all([
    db.query('SELECT key, label, category, default_value, unit, is_active FROM pricing_components'),
    db.query('SELECT key, label, rate_pct, is_active FROM risk_provisions'),
  ]);

  // 3. Index par clé
  const presentKeys = new Map();
  for (const c of compRes.rows) presentKeys.set(c.key, { ...c, type: 'component' });
  for (const p of provRes.rows) presentKeys.set(p.key, { ...p, type: 'provision', category: 'distribution' });

  // 4. Construire la réponse par catégorie
  const cats = {
    sourcing:     { label: 'Sourcing',     emoji: '🏭', present: [], missing: [] },
    transit:      { label: 'Transit',      emoji: '🚢', present: [], missing: [] },
    douane:       { label: 'Douane',       emoji: '📋', present: [], missing: [] },
    hub:          { label: 'Hub',          emoji: '🏢', present: [], missing: [] },
    distribution: { label: 'Distribution', emoji: '📦', present: [], missing: [] },
    paiement:     { label: 'Paiement',     emoji: '💳', present: [], missing: [] },
  };

  const summary = { critical_missing: 0, recommended_missing: 0, optional_missing: 0, present_count: 0, total_benchmarks: benchRes.rows.length };

  for (const b of benchRes.rows) {
    const cat      = cats[b.category] || cats.sourcing;
    const existing = presentKeys.get(b.key);

    if (existing) {
      cat.present.push({
        key:             b.key,
        label:           b.label,
        current_value:   Number(existing.default_value || existing.rate_pct || 0),
        unit:            existing.unit || (existing.type === 'provision' ? 'pct' : 'kmf'),
        benchmark_median: Number(b.benchmark_median),
        deviation_pct:   Number(b.benchmark_median) > 0
          ? Math.round((Number(existing.default_value || existing.rate_pct || 0) - Number(b.benchmark_median)) / Number(b.benchmark_median) * 100)
          : 0,
        is_active: existing.is_active,
      });
      summary.present_count++;
    } else {
      cat.missing.push({
        key:              b.key,
        label:            b.label,
        emoji:            b.emoji,
        unit:             b.unit,
        importance:       b.importance,
        why:              b.why,
        benchmark_median: Number(b.benchmark_median),
        benchmark_min:    b.benchmark_min !== null ? Number(b.benchmark_min) : null,
        benchmark_max:    b.benchmark_max !== null ? Number(b.benchmark_max) : null,
        source:           b.source_benchmark,
        suggested_applies_to: b.applies_to,
      });
      if (b.importance === 'critical') summary.critical_missing++;
      else if (b.importance === 'recommended') summary.recommended_missing++;
      else summary.optional_missing++;
    }
  }

  return {
    summary,
    filters: { importance: filterImportance, category: filterCategory, include_optional: includeOptional },
    by_category: cats,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { computeDashboard, listBenchmarks, computeBenchmarksGap };
