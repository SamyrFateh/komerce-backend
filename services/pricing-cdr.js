/**
 * @komerce-arch
 * @role          economic-engine-pricing-cdr
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/rates.js
 * @used-by       services/pricing-engine.js
 * @db-read       charges, cost_benchmarks, cost_components, customs_categories, boutique_categories, boutique_subcategories, finance_config, pricing_components, risk_provisions, markets
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-09
 */

/**
 * KOMERCE — Pricing CDR (Coût De Revient)
 * ════════════════════════════════════════
 *
 * Calculs de coût de revient extraits de pricing-engine.js.
 * Responsabilité :
 *   - Charger la config globale depuis la DB (loadGlobalConfig)
 *   - Calculer l'allocation des charges fixes (computeFixedCostAllocation)
 *   - Calculer le CDR complet d'un produit (computeCDR)
 *   - Helpers legacy de mapping catégories
 *
 * Consommé uniquement par services/pricing-engine.js.
 */

'use strict';

const db = require('../db');
const { resolveFxRates } = require('../utils/rates');
const { withAuthorityRates } = require('./fx-engine-rates');
const marketCostComponents = require('./cost-component-market-service');

const DEFAULT_TARGET_ORDERS_PER_MONTH = 100;

function r(n) { return Math.round(Number(n) || 0); }

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function categoryDefaultVolumeM3(category = {}) {
  const l = positiveNumberOrNull(category.default_dim_l_cm);
  const w = positiveNumberOrNull(category.default_dim_w_cm);
  const h = positiveNumberOrNull(category.default_dim_h_cm);
  return l && w && h ? (l * w * h) / 1_000_000 : null;
}

// ── Helpers legacy ────────────────────────────────────────────────
function _legacyFamilyFromCategory(oldCat) {
  if (oldCat === 'paiement') return 'business';
  return 'landed_relay';
}

function _legacyCategoryToNew(oldCat, key) {
  const k = (key || '').toLowerCase();
  if (oldCat === 'sourcing') return 'sourcing';
  if (oldCat === 'transit') return 'freight';
  if (oldCat === 'douane') {
    if (k.includes('transitaire') || k.includes('portuaire')) return 'port_transitary';
    return 'customs';
  }
  if (oldCat === 'hub') {
    if (k.includes('packaging') || k.includes('emballage')) return 'packaging';
    return 'hub';
  }
  if (oldCat === 'distribution') {
    if (k.includes('commission') || (k.includes('relais') && !k.includes('transport'))) return 'relay';
    return 'local_distribution';
  }
  if (oldCat === 'paiement') return 'payment';
  return 'sourcing';
}

// ── Config globale ────────────────────────────────────────────────
async function loadGlobalConfig(options = {}) {
  let components = [];
  let componentsSource = 'cost_components';
  let marketCode = null;
  try {
    const ccRes = await db.query(`
      SELECT id, key, label, emoji, description, family, category,
             default_value, unit, currency, scope, scope_value, allocation_method,
             source, confidence, channel, island, is_active, is_exceptional,
             active_from, active_until, display_order
      FROM cost_components
      WHERE is_active = TRUE AND is_exceptional = FALSE
        AND (active_from IS NULL OR active_from <= CURRENT_DATE)
        AND (active_until IS NULL OR active_until >= CURRENT_DATE)
      ORDER BY display_order, key
    `);
    components = ccRes.rows;
    if (options.marketId) {
      const today = new Date();
      components = (await marketCostComponents.listEffectiveComponents(options.marketId)).filter(component => {
        if (!component.is_active || component.is_exceptional) return false;
        if (component.active_from && new Date(component.active_from) > today) return false;
        if (component.active_until && new Date(component.active_until) < today) return false;
        return true;
      });
      componentsSource = 'cost_components_market_override';
      try {
        const mk = await db.query('SELECT code FROM markets WHERE id = $1', [options.marketId]);
        marketCode = mk?.rows?.[0]?.code || null;
      } catch (_) { marketCode = null; }
    }
  } catch (err) {
    components = [];
  }

  if (!components.length) {
    try {
      const pcRes = await db.query('SELECT * FROM pricing_components WHERE is_active = TRUE');
      components = pcRes.rows.map(c => ({
        ...c,
        family: _legacyFamilyFromCategory(c.category),
        category: _legacyCategoryToNew(c.category, c.key),
        scope: 'global',
        is_exceptional: false,
      }));
      componentsSource = 'pricing_components_legacy';
    } catch (errFallback) {
      components = [];
    }
  }

  const [fcRes, catsRes, provRes, chargesRes, affinityRes] = await Promise.all([
    db.query('SELECT * FROM finance_config WHERE id = 1'),
    db.query('SELECT * FROM customs_categories WHERE is_active = TRUE'),
    db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE'),
    db.query('SELECT * FROM charges WHERE is_active = TRUE'),
    db.query(`
      SELECT bs.category_key,
             bs.key AS subcategory_key,
             bs.customs_category_key
        FROM boutique_subcategories bs
        JOIN boutique_categories bc
          ON bc.key=bs.category_key
         AND bc.is_active=TRUE
        JOIN customs_categories cc
          ON cc.key=bs.customs_category_key
         AND cc.is_active=TRUE
       WHERE bs.is_active=TRUE
         AND bs.customs_category_key IS NOT NULL
    `),
  ]);

  const categories = {};
  catsRes.rows.forEach(c => { categories[c.key] = c; });

  // Benchmarks de surcharge par famille (optionnel — calibration). Table absente → [].
  let costBenchmarks = [];
  try {
    const bmRes = await db.query('SELECT category, cost_family, expected_share_pct, warn_ratio, alert_ratio FROM cost_benchmarks WHERE is_active = TRUE');
    costBenchmarks = bmRes.rows;
  } catch (err) {
    costBenchmarks = [];
  }

  return {
    finance: await withAuthorityRates(fcRes.rows[0] || {}),
    categories,
    boutique_customs_affinities: affinityRes.rows,
    components,
    components_source: componentsSource,
    market_id: options.marketId || null,
    market_code: marketCode,
    provisions: provRes.rows,
    charges: chargesRes.rows,
    cost_benchmarks: costBenchmarks,
  };
}

// ── Charges fixes par commande ─────────────────────────────────────
function computeFixedCostAllocation(charges, finance) {
  const warnings = [];
  const totalMonthly  = charges.filter(c => c.recurrence_period === 'monthly').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalWeekly   = charges.filter(c => c.recurrence_period === 'weekly').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalYearly   = charges.filter(c => c.recurrence_period === 'yearly').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalPerOrder = charges.filter(c => c.recurrence_period === 'per_order').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const monthlyFixedCosts = totalMonthly + (totalWeekly * 4.33) + (totalYearly / 12);

  let targetOrdersPerMonth = Number(finance.objectif_commandes_mois) || 0;
  if (!targetOrdersPerMonth) {
    targetOrdersPerMonth = DEFAULT_TARGET_ORDERS_PER_MONTH;
    warnings.push(`objectif_commandes_mois absent dans finance_config — utilisation valeur par défaut ${DEFAULT_TARGET_ORDERS_PER_MONTH}.`);
  }

  // Doctrine §9/§10 : N3 est imputé PAR ARTICLE, pas par commande. La chaîne entière
  // (N1, N2, contribution, prix) est par article — N3 doit l'être aussi, sinon le CDR
  // mélange deux unités et se retrouve gonflé.
  //   charges mensuelles / commandes cibles / articles par commande
  // Avant : (monthly / orders) + perOrder  → quote-part PAR COMMANDE (incohérent).
  const avgArticlesPerOrder = Number(finance.avg_articles_per_order) || 2.5;
  const fixedPerOrder   = (monthlyFixedCosts / targetOrdersPerMonth) + totalPerOrder;
  const fixedPerArticle = fixedPerOrder / avgArticlesPerOrder;

  return {
    fixed_cost_allocation_kmf: r(fixedPerArticle),
    monthly_fixed_costs_kmf: r(monthlyFixedCosts),
    target_orders_per_month: targetOrdersPerMonth,
    articles_per_order: avgArticlesPerOrder,
    warnings,
  };
}

// ── Assiettes des composants en pourcentage (P0-1, #3830) ──────────
// Chaque `pct` s'applique à une assiette déclarée et stable, jamais au sous-total
// cumulé (qui rendait le résultat dépendant de l'ordre de chargement) :
//   purchase : prix d'achat                (product_purchase, défaut)
//   cif      : achat + fret au volume      (assurance, transitaire %, droits)
//   price    : prix encaissé               (paiement, non-collecte)
//   (casse / perte en transport = risque sur la valeur exposée → CIF)
const PRICE_BASED_CATEGORIES = new Set(['payment', 'paiement']);
const CIF_BASED_CATEGORIES = new Set(['freight', 'transit', 'port_transitary', 'customs', 'douane']);
const MEASURED_SOURCES = new Set(['real', 'measured', 'quoted', 'observed', 'contract', 'manual']);
// Listes fermées (aucune classification par nom de clé) : tout composant douane absent de
// CUSTOMS_INSPECTION_KEYS compte comme DROITS ; tout risque absent de PRICE_BASED_RISK_KEYS
// est assis sur la valeur exposée (CIF), pas sur l'encaissement.
const CUSTOMS_INSPECTION_KEYS = new Set(['frais_inspection_douane_kmf']);
const PRICE_BASED_RISK_KEYS = new Set(['provision_non_collecte_pct']);
const isCustomsInspection = (c) => CUSTOMS_INSPECTION_KEYS.has(c.key);
// ── Périmètre des composants (P0-2, #3830) ──────────────────────────
// Les composants marqués Comores (port → relais, surcoûts inter-îles) ne valent que
// pour le marché KM (ou une surcharge marché explicite). Un surcoût inter-îles ne
// s'applique que si l'île de destination (relais / zone) est connue ET correspond.
// Inconnu ≠ zéro : le composant n'est pas appliqué et il est signalé (UNKNOWN).
const COMORES_MARKET_CODE = 'KM';
const COMORES_MARKED_KEYS = new Set(['transport_port_relais_kmf']);
const INTER_ISLAND_KEY = /inter[_-]?iles?[_-](moheli|anjouan)/i;
const LOCAL_STOCK_EXCLUDED_CATEGORIES = new Set(['hub', 'packaging', 'sourcing', 'product_purchase']);
const LOCAL_STOCK_EXCLUDED_KEYS = new Set(['transport_port_relais_kmf']);

function normalizeIsland(value) {
  if (!value) return null;
  const s = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  if (/moheli|mwali/.test(s)) return 'moheli';
  if (/anjouan|ndzuani/.test(s)) return 'anjouan';
  if (/grande_comore|ngazidja/.test(s)) return 'grande_comore';
  if (/mayotte|maore/.test(s)) return 'mayotte';
  return s || null;
}

function componentTerritory(c) {
  const key = c.key || '';
  const keyIsland = (key.match(INTER_ISLAND_KEY) || [])[1] || null;
  const island = normalizeIsland(c.island) || keyIsland;
  return { island, comoresMarked: COMORES_MARKED_KEYS.has(key) || !!island };
}

const CUSTOMS_INSPECTION_KEY = /inspection|expertise|controle|contr[oô]le|frais/i;

function pctBasisFor(category, key) {
  if (PRICE_BASED_CATEGORIES.has(category)) return 'price';
  if (category === 'risk_provision') return PRICE_BASED_RISK_KEYS.has(key) ? 'price' : 'cif';
  if (CIF_BASED_CATEGORIES.has(category)) return 'cif';
  return 'purchase';
}

// Un fret physique explicite (au volume OU au poids) remplace le fret estimé
// par défaut. Un simple pourcentage d'assurance en catégorie freight ne suffit
// pas : en son absence, le fret demeure inconnu et l'estimation est signalée.
function isPhysicalFreightComponent(c) {
  return (c.category === 'freight' || c.category === 'transit')
    && (c.allocation_method === 'by_volume' || c.allocation_method === 'by_weight'
      || c.unit === 'kmf_per_m3' || c.unit === 'kmf_per_kg');
}

// Qualité des entrées (distincte de la santé économique) : part du coût variable
// issue de lignes estimées + replis poids / volume / catégorie / fret.
// Règle sans seuil numérique, fondée sur la confiance portée par les composants :
//   high : aucune ligne estimée et aucun repli ; low : achat/catégorie inconnus, repli `default`
//   ou ligne de confiance `low` ; medium : le reste. La part estimée est informative seulement.
function buildInputQuality({ allocations, meta, categoryKnown, purchaseKnown, dutiesKnown, scopeUnknown = [] }) {
  const lines = (allocations || []).filter(a => a.economic_nature !== 'fixed' && a.allocated_cost_kmf > 0);
  const total = lines.reduce((s, a) => s + a.allocated_cost_kmf, 0);
  const estimatedLines = lines.filter(a => !MEASURED_SOURCES.has(a.source) || a.component_confidence === 'low');
  const estimatedKmf = estimatedLines.reduce((s, a) => s + a.allocated_cost_kmf, 0);
  const share = total > 0 ? Math.round((estimatedKmf / total) * 1000) / 10 : 0;
  const fallbacks = [];
  if (meta.weight_source !== 'product') fallbacks.push({ field: 'weight', source: meta.weight_source });
  if (meta.volume_source !== 'product') fallbacks.push({ field: 'volume', source: meta.volume_source });
  if (!categoryKnown) fallbacks.push({ field: 'category', source: 'default' });
  if (meta.freight_source === 'fallback_estimate') fallbacks.push({ field: 'freight', source: 'fallback_estimate' });
  const unknown = [];
  if (!purchaseKnown) unknown.push('purchase_price');
  if (!dutiesKnown) unknown.push('customs_duties');
  for (const u of scopeUnknown) unknown.push(`scope:${u.component_key}`);
  let level = 'medium';
  if (!estimatedLines.length && !fallbacks.length) level = 'high';
  if (!purchaseKnown || !categoryKnown || fallbacks.some(f => f.source === 'default')
    || lines.some(a => a.component_confidence === 'low')) level = 'low';
  return {
    level,
    estimated_cost_share_pct: share,
    estimated_lines: estimatedLines.map(a => a.component_key),
    fallbacks,
    unknown,
  };
}

// ── CDR complet ────────────────────────────────────────────────────
function computeCDR(product, ctx = {}) {
  const cfg = ctx.config;
  const fc = cfg.finance;
  const warnings = [];

  const fx = resolveFxRates(fc);
  // AED/USD : lus seulement à l'usage (fx.aed_kmf lève fx_rate_unavailable sans observation approuvée).
  const taxEUR  = fx.eur_kmf;
  const fxOut  = fx.toJSON();
  const taxAED  = fxOut.aed_kmf;
  const fretEUR = Number(fc.fret_eur_per_m3) || 180;

  // Catégorie absente ≠ « phones » : plus de bascule silencieuse (P0-2).
  const categoryKey    = product.category || null;
  const cat            = categoryKey ? cfg.categories[categoryKey] : undefined;
  const categoryStatus = cat ? 'KNOWN' : 'UNKNOWN';
  if (!categoryKey) warnings.push('Catégorie absente (category_status UNKNOWN) — poids, volume et marge cible par défaut utilisés.');
  else if (!cat) warnings.push(`Catégorie "${categoryKey}" inconnue — poids, volume et marge cible par défaut utilisés.`);

  const productCostKmf = Number(product.cost_kmf) || 0;
  const productWeightKg = positiveNumberOrNull(product.weight_kg);
  const categoryWeightKg = positiveNumberOrNull(cat?.default_weight_kg);
  const requestedVolumeM3 = positiveNumberOrNull(ctx.volume_m3);
  const categoryVolumeM3 = categoryDefaultVolumeM3(cat);
  const weightKg = productWeightKg ?? categoryWeightKg ?? 1;
  const volM3 = requestedVolumeM3 ?? categoryVolumeM3 ?? 0.005;
  const channel = ctx.channel || 'cash_relais';

  if (productCostKmf <= 0) warnings.push('cost_kmf absent ou nul sur le produit — CDR non significatif.');
  if (productWeightKg == null && categoryWeightKg == null) {
    warnings.push('weight_kg absent — utilisation du défaut générique 1 kg.');
  }
  if (requestedVolumeM3 == null && categoryVolumeM3 == null) {
    warnings.push('volume_m3 absent — utilisation du défaut générique 0,005 m³.');
  }

  const details = {
    product_cost: r(productCostKmf),
    sourcing: 0, hub: 0, packaging: 0,
    freight: 0, customs: 0, port_transitaire: 0,
    distribution: 0, local_distribution: 0, relay: 0,
    payment: 0, risks: 0, fixed_costs: 0,
  };
  details._allocations = [];

  // L2 : chaîne import (fret/douane/port) NON APPLICABLE quand le produit est servi
  // depuis un stock local exposé (provenance LOCAL_STOCK). Inapplicable ≠ zéro d'un
  // inconnu : sans signal de provenance, la chaîne import reste estimée.
  const localStock = ctx.provenance === 'LOCAL_STOCK';
  const IMPORT_CHAIN = new Set(['freight', 'transit', 'customs', 'douane', 'port_transitary']);

  const avgArticlesPerOrder    = Number(fc.avg_articles_per_order)    || 2.5;
  const avgArticlesPerParcel   = Number(fc.avg_articles_per_parcel)   || 4.0;
  const avgArticlesPerShipment = Number(fc.avg_articles_per_shipment) || 200.0;

  const marketCode = cfg.market_code || ctx.market_code || null;
  const destinationIsland = normalizeIsland(ctx.destination_island);
  const scopeUnknown = [];
  const scopeNotApplicable = [];
  const flagUnknown = (c, reason, message) => {
    scopeUnknown.push({ component_key: c.key || null, label: c.label || c.key || '', status: 'UNKNOWN', reason });
    warnings.push(message);
  };

  const applicable = [];
  for (const c of cfg.components) {
    if (localStock && (IMPORT_CHAIN.has(c.category) || LOCAL_STOCK_EXCLUDED_CATEGORIES.has(c.category) || LOCAL_STOCK_EXCLUDED_KEYS.has(c.key))) {
      scopeNotApplicable.push({ component_key: c.key || null, label: c.label || c.key || '', status: 'NOT_APPLICABLE', reason: 'LOCAL_STOCK' });
      continue;
    }
    const a = c.applies_to || 'all';
    if (a !== 'all' && !a.startsWith('category:' + categoryKey) && !a.startsWith('channel:' + channel)) continue;
    if (c.scope === 'category' && c.scope_value && c.scope_value !== categoryKey) continue;
    if (c.channel && c.channel !== channel) continue;
    if ((c.category === 'paiement' || c.category === 'payment') && !c.channel) {
      if (channel === 'cash_relais' && (c.key || '').startsWith('stripe_')) continue;
      if (channel === 'diaspora' && !(c.key || '').startsWith('stripe_') && (c.key || '').includes('cash')) continue;
    }
    const territory = componentTerritory(c);
    if (territory.comoresMarked) {
      if (marketCode !== COMORES_MARKET_CODE && c.source !== 'market_override') {
        flagUnknown(c, marketCode ? 'comores_component_outside_km' : 'market_unknown',
          `Composant Comores "${c.key}" non appliqué hors marché KM (UNKNOWN) : aucune surcharge marché${marketCode ? '' : ' / marché non déterminé'}.`);
        continue;
      }
      if (territory.island) {
        if (!destinationIsland) {
          flagUnknown(c, 'destination_island_unknown',
            `Surcoût destination non déterminé : "${c.key}" non appliqué (UNKNOWN) — île de destination inconnue.`);
          continue;
        }
        if (destinationIsland !== territory.island) {
          scopeNotApplicable.push({ component_key: c.key || null, label: c.label || c.key || '', status: 'NOT_APPLICABLE', reason: 'destination_island_differs' });
          continue;
        }
      }
    }
    applicable.push(c);
  }

  const lineBasis = (c) => c.allocation_method === 'by_volume'
    ? 'volume'
    : c.allocation_method === 'by_weight'
      ? 'weight'
      : ({ kmf_per_kg: 'weight', kmf_per_m3: 'volume', pct: 'value' })[c.unit] || 'quantity';

  // Ajoute une ligne au détail ET aux allocations (une seule fois par composant).
  const pushLine = (c, amount, engagedAmount, level, divisor, basis, extra = {}) => {
    switch (c.category) {
      case 'product_purchase':   details.product_cost += amount; break;
      case 'sourcing':           details.sourcing += amount; break;
      case 'hub':                details.hub += amount; break;
      case 'packaging':          details.packaging += amount; break;
      case 'freight': case 'transit':      details.freight += amount; break;
      case 'customs': case 'douane':       details.customs += amount; break;
      case 'port_transitary':    details.port_transitaire += amount; break;
      case 'local_distribution': case 'distribution': details.local_distribution += amount; details.distribution += amount; break;
      case 'relay':              details.relay += amount; details.distribution += amount; break;
      case 'payment': case 'paiement':     details.payment += amount; break;
      case 'risk_provision':     details.risks += amount; break;
      case 'fixed_overhead':     details.fixed_costs += amount; break;
      default:                   details.sourcing += amount;
    }
    if (!(amount > 0)) return;
    const lineConfidence = level === 'article' ? 'high' : (fc.allocation_confidence || 'low');
    details._allocations.push({
      component_key: c.key || null, component_label: c.label || c.key || '',
      category: c.category || null, unit: c.unit,
      // ── noms doctrinaux (contrat §8) ──
      allocation_level: level,        // article | parcel | order | shipment | month
      allocation_basis: basis,        // quantity | weight | volume | value | price | manual
      engaged_cost_kmf: r(engagedAmount),
      allocation_divisor: r(divisor * 100) / 100,
      allocated_cost_kmf: r(amount),
      confidence: lineConfidence,
      source: c.source || null,
      component_confidence: c.confidence || null,
      // ── alias historiques (compatibilité) ──
      engaged_amount_kmf: r(engagedAmount), engaged_level: level,
      imputed_amount_kmf: r(amount),
      ...extra,
    });
  };

  // Passe 1 : montants indépendants du prix et des assiettes % (ordre sans effet).
  const hasPhysicalFreight = !localStock && applicable.some(isPhysicalFreightComponent);
  let freightSource = 'component';
  let nonPctFreight = 0;
  let fixedOverheadAmount = 0;
  let priceIndependent = productCostKmf;
  const pending = [];

  if (!localStock && !hasPhysicalFreight) {
    freightSource = 'fallback_estimate';
    const estimate = volM3 * fretEUR * taxEUR;
    nonPctFreight += estimate;
    priceIndependent += estimate;
    pushLine({ key: 'freight_default_estimate', label: 'Fret (estimation par défaut)', category: 'freight', unit: 'eur', source: 'estimate', confidence: 'low' },
      estimate, estimate, 'article', 1, 'volume');
    warnings.push('Fret estimé par repli (aucun composant de fret physique actif) : valeur à valider.');
  } else if (localStock) {
    freightSource = 'not_applicable';
  }

  for (const c of applicable) {
    const v = Number(c.default_value || 0);
    let amount = 0, engagedAmount = 0, level = 'article', divisor = 1;

    // Les unités monétaires (EUR/AED/USD) décrivent la devise de la valeur,
    // pas sa base d'allocation : la quantité physique s'applique APRES conversion.
    const applyPhysicalBasis = (baseKmf) => {
      if (c.allocation_method === 'by_volume') return baseKmf * volM3;
      if (c.allocation_method === 'by_weight') return baseKmf * weightKg;
      return baseKmf;
    };

    if (c.unit === 'pct') {
      pending.push({ c, rate: v / 100, basis: pctBasisFor(c.category, c.key) });
      continue;
    }
    switch (c.unit) {
      case 'kmf':           amount = v; engagedAmount = amount; break;
      case 'kmf_per_kg':    amount = v * weightKg; engagedAmount = amount; break;
      case 'kmf_per_m3':    amount = v * volM3; engagedAmount = amount; break;
      case 'kmf_per_order':
        engagedAmount = v; divisor = avgArticlesPerOrder; amount = v / divisor; level = 'order'; break;
      case 'kmf_per_parcel':
        engagedAmount = v; divisor = avgArticlesPerParcel; amount = v / divisor; level = 'parcel'; break;
      case 'kmf_per_shipment':
        engagedAmount = v; divisor = avgArticlesPerShipment; amount = v / divisor; level = 'shipment'; break;
      case 'aed': amount = applyPhysicalBasis(v * fx.aed_kmf); engagedAmount = amount; break;
      case 'eur': amount = applyPhysicalBasis(v * taxEUR); engagedAmount = amount; break;
      case 'usd': amount = applyPhysicalBasis(v * fx.usd_kmf); engagedAmount = amount; break;
    }
    const isFixed = c.category === 'fixed_overhead';
    if (isFixed) fixedOverheadAmount += amount;
    else {
      priceIndependent += amount;
      if (c.category === 'freight' || c.category === 'transit') nonPctFreight += amount;
    }
    pushLine(c, amount, engagedAmount, level, divisor, lineBasis(c), isFixed ? { economic_nature: 'fixed', cost_type: 'fixed_overhead' } : {});
  }

  // Passe 2 : pourcentages sur assiette déclarée (achat, CIF) ; ceux sur le prix sont résolus ensuite.
  const cifBase = productCostKmf + nonPctFreight;
  let priceRate = 0;
  const pricePending = [];
  for (const p of pending) {
    if (p.basis === 'price') { priceRate += p.rate; pricePending.push(p); continue; }
    const base = p.basis === 'cif' ? cifBase : productCostKmf;
    const amount = base * p.rate;
    priceIndependent += amount;
    pushLine(p.c, amount, amount, 'article', 1, 'value', { pct_basis: p.basis });
  }
  const provisionRates = (cfg.provisions || []).map(p => ({ p, rate: Number(p.rate_pct) / 100 }));
  for (const x of provisionRates) priceRate += x.rate;

  // Résolution du plancher sans itération : P = V·(1+s) avec V = V0 + Σ%prix · P
  //   ⇒ P = V0·(1+s) / (1 − Σ%prix·(1+s)). Les lignes sur le prix sont évaluées à ce P ;
  //   le plancher de computePrices (= variable × (1+s)) reste donc inchangé dans sa forme.
  const safety = (Number(fc.minimum_safety_margin_pct) || 10) / 100;
  const denom = 1 - priceRate * (1 + safety);
  let priceBasis = null;
  if (priceRate > 0) {
    if (denom > 0) priceBasis = (priceIndependent * (1 + safety)) / denom;
    else warnings.push('Taux sur le prix ≥ 100 % après marge de sécurité : plancher non résoluble, frais sur le prix non imputés.');
  }
  for (const p of pricePending) {
    const amount = priceBasis == null ? 0 : priceBasis * p.rate;
    pushLine(p.c, amount, amount, 'article', 1, 'price', { pct_basis: 'price' });
  }
  for (const { p, rate } of provisionRates) {
    const amount = priceBasis == null ? 0 : priceBasis * rate;
    pushLine({ key: p.key || `risk_provision_${p.id ?? ''}`.replace(/_$/, ''), label: p.label || p.key || 'Provision de risque', category: 'risk_provision', unit: 'pct', source: p.source || null, confidence: p.confidence || null },
      amount, amount, 'article', 1, 'price', { pct_basis: 'price' });
  }

  // Doctrine douane (2026-10) : la douane réelle est un montant par expédition Komerce,
  // ventilé après coup (customs_shipments → allocations). Les taux de catégorie
  // ne sont jamais un coût économique. Un composant d'INSPECTION n'est pas un droit :
  // les droits restent `not_estimated` tant qu'aucun composant de DROITS n'existe.
  const customsComponents = applicable.filter(c => c.category === 'customs' || c.category === 'douane');
  const customsInspectionKmf = r(customsComponents
    .filter(c => isCustomsInspection(c))
    .reduce((s, c) => s + details._allocations.filter(a => a.component_key === c.key).reduce((t, a) => t + a.allocated_cost_kmf, 0), 0));
  const dutiesComponents = customsComponents.filter(c => !isCustomsInspection(c));
  const customsDutiesKmf = r(dutiesComponents
    .reduce((s, c) => s + details._allocations.filter(a => a.component_key === c.key).reduce((t, a) => t + a.allocated_cost_kmf, 0), 0));
  const customsEstimateStatus = dutiesComponents.length > 0 ? 'cost_component' : 'not_estimated';
  if (customsEstimateStatus === 'not_estimated' && !localStock) {
    warnings.push('Douane non estimée : coût réel connu après ventilation de l\'expédition (aucun taux théorique appliqué).');
  }

  const fixedAlloc = computeFixedCostAllocation(cfg.charges, fc);
  if (fixedAlloc.warnings.length) warnings.push(...fixedAlloc.warnings);
  // Structure = quote-part des charges + composants fixed_overhead (jamais dans le variable).
  details.fixed_costs += fixedAlloc.fixed_cost_allocation_kmf;

  if (!fc.allocation_calibrated_at && (fc.allocation_confidence || 'low') === 'low') {
    if (details._allocations.some(a => a.engaged_level !== 'article')) {
      warnings.push('Moyennes d\'allocation non calibrées (hypothèses initiales). Les coûts par shipment/colis/commande sont divisés par des valeurs estimées. À recalibrer dans finance_config dès que vous aurez du volume réel.');
    }
  }

  for (const k of Object.keys(details)) {
    if (k === '_allocations') continue;
    details[k] = r(details[k]);
  }

  // Invariant : total variable = Σ des lignes affichées (`distribution` = local + relay, non recompté).
  const variableTotal = details.product_cost + details.sourcing + details.hub + details.packaging
    + details.freight + details.customs + details.port_transitaire
    + details.local_distribution + details.relay + details.payment + details.risks;
  const fixedTotal = details.fixed_costs;

  const meta = {
    taxAED, taxEUR, fretEUR, category: categoryKey, channel,
    weight_kg: weightKg,
    volume_m3: volM3,
    weight_source: productWeightKg != null ? 'product' : (categoryWeightKg != null ? 'category' : 'default'),
    volume_source: requestedVolumeM3 != null ? 'product' : (categoryVolumeM3 != null ? 'category' : 'default'),
    freight_source: freightSource,
    category_status: categoryStatus,
    price_basis_kmf: priceBasis == null ? null : r(priceBasis),
  };
  const inputQuality = buildInputQuality({
    allocations: details._allocations,
    meta,
    categoryKnown: !!cat,
    scopeUnknown,
    purchaseKnown: productCostKmf > 0,
    dutiesKnown: customsEstimateStatus === 'cost_component' || localStock,
  });

  return {
    variable_cost_estimated_kmf:  variableTotal,
    fixed_cost_allocation_kmf:    fixedTotal,
    risk_provision_estimated_kmf: details.risks,
    cost_complete_estimated_kmf:  variableTotal + fixedTotal,
    monthly_fixed_costs_kmf:      fixedAlloc.monthly_fixed_costs_kmf,
    target_orders_per_month:      fixedAlloc.target_orders_per_month,
    // Résolution du plancher / de la référence (consommée par computePrices).
    price_independent_cost_kmf:   Math.round(priceIndependent * 100) / 100,
    price_based_cost_rate:        priceRate,
    details,
    customs_estimate_status: customsEstimateStatus,
    customs_inspection_kmf: customsInspectionKmf,
    customs_duties_kmf: customsDutiesKmf,
    input_quality: inputQuality,
    category_status: categoryStatus,
    cost_scope: {
      market_code: marketCode,
      destination_island: destinationIsland,
      unknown_components: scopeUnknown,
      not_applicable_components: scopeNotApplicable,
    },
    import_chain_not_applicable: localStock,
    warnings,
    _meta: meta,
  };
}

/**
 * Conservative one-article reference for audit and price discussion only.
 *
 * The operational pricing engine continues to call computeCDR() unchanged:
 * no historical mean or commercial activation gate is silently rewritten.
 * A single article bears the full modeled per-order/parcel/shipment charge;
 * actual post-sale allocation still uses observed physical quantities.
 *
 * This is NOT a certified floor. Missing customs evidence, unresolved
 * market/corridor provenance or relay commission unit differences are
 * explicitly recorded so that a consumer cannot mistake the reference for
 * a reconciled cost or a published selling price.
 */
function computeSingleArticleReferenceCDR(product, ctx = {}) {
  if (!ctx.config || !ctx.config.finance) {
    throw new TypeError('Configuration économique et finance requises pour la référence mono-article.');
  }

  const original = ctx.config;
  const historicalDivisors = {
    order: Number(original.finance.avg_articles_per_order) || 2.5,
    parcel: Number(original.finance.avg_articles_per_parcel) || 4,
    shipment: Number(original.finance.avg_articles_per_shipment) || 200,
  };
  const config = {
    ...original,
    finance: {
      ...original.finance,
      avg_articles_per_order: 1,
      avg_articles_per_parcel: 1,
      avg_articles_per_shipment: 1,
    },
  };
  const result = computeCDR(product, { ...ctx, config });
  const marketCode = result.cost_scope.market_code;
  const blockers = [];

  if (!marketCode) blockers.push('MARKET_NOT_RESOLVED');
  if (result.input_quality.unknown.length) blockers.push('MANDATORY_COST_OR_SCOPE_UNKNOWN');

  // Remise client : le writer traite désormais la commission canonique une
  // seule fois PAR COMMANDE. Un composant dont l'unité est différente reste
  // NON_DECISIONNEL ; les allocations héritées per_item ne sont pas corrigées
  // rétroactivement et ne constituent pas une preuve de marge réelle.
  const relayUnits = (original.components || [])
    .filter(c => c.category === 'relay' && c.is_active !== false)
    .map(c => ({ key: c.key, unit: c.unit, allocation_method: c.allocation_method || null }));
  if (relayUnits.some(c => c.key === 'commission_relais_kmf'
    && (c.unit !== 'kmf_per_order' || c.allocation_method !== 'per_order'))) {
    blockers.push('RELAY_COMMISSION_UNIT_NOT_RECONCILED');
  }

  // A base component may be portable, but we cannot certify that a
  // supplier/transport quote inherited by CM/CG is a genuine local corridor.
  // Record missing evidence without modifying active market pricing.
  const corridorCategories = new Set([
    'freight', 'transit', 'port_transitary', 'customs', 'douane', 'local_distribution',
  ]);
  const corridorUnverified = (original.components || [])
    .filter(c => c.is_active !== false && corridorCategories.has(c.category))
    .filter(c => marketCode === 'CM' || marketCode === 'CG')
    .filter(c => c.source !== 'market_override'
      && !(c.scope === 'market' && c.scope_value === marketCode)
      && c.market_code !== marketCode && c.corridor_market_code !== marketCode)
    .map(c => c.key || c.category);
  if (corridorUnverified.length) blockers.push('CORRIDOR_COST_PROVENANCE_UNVERIFIED');

  const warnings = result.warnings.filter(w => !w.startsWith('Moyennes d\'allocation non calibrées'));
  warnings.push('Référence mono-article prudente (q=1) : simulation uniquement, jamais une allocation physique réelle ni un prix actif.');
  if (relayUnits.length && blockers.includes('RELAY_COMMISSION_UNIT_NOT_RECONCILED')) {
    warnings.push('Commission relais canonique hors unité par commande : une décision contractuelle est requise.');
  }
  if (corridorUnverified.length) {
    warnings.push('Coûts hérités sans preuve de corridor CM/CG : valider les devis et surcharges marché.');
  }

  return {
    ...result,
    warnings,
    single_article_reference: {
      mode: 'SHADOW_REFERENCE_ONLY',
      status: blockers.length ? 'NON_DECISIONNEL' : 'PROVISOIRE',
      canonical_currency: 'KMF',
      quantity_assumption: { order: 1, parcel: 1, shipment: 1 },
      operational_average_divisors: historicalDivisors,
      no_price_activation: true,
      blockers,
      relay_units_observed: relayUnits,
      corridor_components_unverified: corridorUnverified,
    },
  };
}

module.exports = {
  loadGlobalConfig,
  computeFixedCostAllocation,
  computeCDR,
  computeSingleArticleReferenceCDR,
  _legacyFamilyFromCategory,
  _legacyCategoryToNew,
  _positiveNumberOrNull: positiveNumberOrNull,
  _categoryDefaultVolumeM3: categoryDefaultVolumeM3,
};