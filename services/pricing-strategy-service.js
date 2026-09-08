/**
 * @komerce-arch
 * @role          economic-engine-pricing-strategy-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, explicit_human_price_decision, product_or_category_target
 * @outputs       strategy_read_model, explicit_strategy_mutation, contribution_candidates
 * @depends       db, services/pricing-engine.js, services/catalog-product-mutation-service.js
 * @used-by       routes/pricing-strategy.js, services/pricing-workspace.js
 * @db-read       competitor_prices, order_items, orders, pricing_strategies, products, users
 * @db-write      competitor_prices, price_history, pricing_strategies, pricing_strategy_history
 * @db-write-via:catalog-product-mutation-service products
 * @db-txn        explicit_strategy_mutation_atomic
 * @doctrine      market_or_human_price_decision_explicit, contribution_vs_variable_cost, structural_charges_are_not_sku_debt, no_mechanical_price_authority
 * @impact-areas  economic-engine, pricing, admin-dashboard
 * @version       2026-09
 */

'use strict';

/**
 * KOMERCE — Pricing Strategy Service
 * ══════════════════════════════════
 *
 * Ce service ne possède plus aucun calcul parallèle de coût de revient.
 * La vérité économique vient exclusivement de services/pricing-engine.js.
 *
 * Invariants :
 * - aucun prix final n'est déduit mécaniquement d'une quote-part de charges fixes ;
 * - la contribution d'un SKU = prix explicite - coût variable complet ;
 * - les charges de structure restent une dette collective du portefeuille/période ;
 * - les observations concurrentes globales sont des références, jamais une autorité marché locale ;
 * - une application de stratégie exige toujours un prix explicite fourni par un humain ;
 * - le type historique `mechanical` est lisible, mais il n'est plus créable/appliquable.
 */

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const catalogProductMutationService = require('./catalog-product-mutation-service');

const FORBIDDEN_AUTOMATIC_STRATEGIES = new Set([
  'mechanical',
  'automatic',
  'recommended',
  'engine_recommended',
]);

function arrondiPsycho(x) {
  const value = Number(x);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 500) return Math.ceil(value / 10) * 10;
  if (value < 1000) return Math.ceil(value / 100) * 100 - 10;
  return Math.ceil(value / 1000) * 1000 - 10;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundKmf(value) {
  const number = finite(value);
  return number == null ? null : Math.round(number);
}

function contributionAtPrice(variableCostKmf, priceKmf) {
  const variable = finite(variableCostKmf);
  const price = finite(priceKmf);
  if (variable == null || price == null || price <= 0) {
    return { contribution_kmf: null, contribution_rate_pct: null };
  }
  const contribution = price - variable;
  return {
    contribution_kmf: roundKmf(contribution),
    contribution_rate_pct: Math.round((contribution / price) * 1000) / 10,
  };
}

function projectCanonicalEconomics(doctrine = {}) {
  return {
    variable_cost_complete_kmf: roundKmf(doctrine.variable_cost_complete_kmf),
    flow_variable_cost_kmf: roundKmf(doctrine.flow_variable_cost_kmf),
    business_variable_cost_kmf: roundKmf(doctrine.business_variable_cost_kmf),
    current_price_kmf: roundKmf(doctrine.current_price_kmf),
    current_contribution_kmf: roundKmf(doctrine.contribution_kmf),
    current_contribution_rate_pct: finite(doctrine.contribution_rate_pct),
    minimum_safe_price_kmf: roundKmf(doctrine.minimum_safe_price_kmf),
    economic_reference_price_kmf: roundKmf(
      doctrine.economic_reference_price_kmf != null
        ? doctrine.economic_reference_price_kmf
        : doctrine.recommended_price_kmf
    ),
    economic_reference_authority: doctrine.recommended_price_authority || 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
    structure_allocation_reference_kmf: roundKmf(doctrine.structure_allocation_reference_kmf),
    structure_allocation_authority: doctrine.structure_allocation_authority || 'ANALYTICAL_ONLY_NOT_SKU_DEBT',
    fully_loaded_cost_reference_kmf: roundKmf(doctrine.fully_loaded_cost_reference_kmf),
    price_decision_status: doctrine.price_decision_status || 'MARKET_OR_HUMAN_DECISION_REQUIRED',
    pricing_strategy: doctrine.pricing_strategy || 'market_bounded',
    strategy_risk: doctrine.strategy_risk || null,
  };
}

/**
 * Compatibilité de nom uniquement : `computeCDR` ne recalcule plus un CDR local.
 * Il délègue au moteur canonique et renvoie une projection économique sans N1/N2/N3.
 */
async function computeCDR(_dbOrClient, product = {}) {
  const doctrine = await pricingEngine.recommend({
    category: product.category || 'phones',
    cost_kmf: product.cost_kmf,
    weight_kg: product.weight_kg,
    volume_m3: product.volume_m3,
    current_price_kmf: product.price_kmf,
    channel: 'cash_relais',
    pricing_strategy: 'market_bounded',
  });
  return projectCanonicalEconomics(doctrine);
}

async function estimateElasticity(dbOrClient, productId) {
  if (!productId) return null;
  const q = (sql, p) => dbOrClient.query(sql, p);

  const { rows: priceChanges } = await q(
    `SELECT old_price_kmf, new_price_kmf, applied_at
       FROM price_history
      WHERE product_id = $1
      ORDER BY applied_at DESC LIMIT 5`,
    [productId]
  ).catch(() => ({ rows: [] }));

  if (priceChanges.length < 2) return null;

  const lastChange = priceChanges[0];
  const before = await q(
    `SELECT COUNT(*) AS nb FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1
        AND o.status NOT IN ('cancelled', 'refunded')
        AND o.created_at BETWEEN $2::timestamptz - INTERVAL '30 days' AND $2::timestamptz`,
    [productId, lastChange.applied_at]
  ).catch(() => ({ rows: [{ nb: 0 }] }));

  const after = await q(
    `SELECT COUNT(*) AS nb FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1
        AND o.status NOT IN ('cancelled', 'refunded')
        AND o.created_at BETWEEN $2::timestamptz AND $2::timestamptz + INTERVAL '30 days'`,
    [productId, lastChange.applied_at]
  ).catch(() => ({ rows: [{ nb: 0 }] }));

  const v1 = Number(before.rows[0].nb);
  const v2 = Number(after.rows[0].nb);
  const p1 = Number(lastChange.old_price_kmf);
  const p2 = Number(lastChange.new_price_kmf);

  if (v1 === 0 || p1 === 0) return null;
  const dV = (v2 - v1) / v1;
  const dP = (p2 - p1) / p1;
  if (dP === 0) return null;

  const bounded = Math.max(-3, Math.min(3, dV / dP));
  return {
    value: Math.round(bounded * 100) / 100,
    interpretation: Math.abs(bounded) < 0.5 ? 'faible' : (Math.abs(bounded) < 1.5 ? 'moyenne' : 'forte'),
    sample_size: v1 + v2,
    is_significant: (v1 + v2) >= 10,
  };
}

async function getCompetitors(dbOrClient, { product_id, category } = {}) {
  const where = ['is_active = TRUE'];
  const params = [];
  let pi = 0;
  if (product_id) {
    params.push(product_id);
    where.push(`product_id = $${++pi}`);
  } else if (category) {
    params.push(category);
    where.push(`(category = $${++pi} OR product_id IN (SELECT id FROM products WHERE category = $${pi}))`);
  }
  const { rows } = await dbOrClient.query(
    `SELECT id, competitor_ref, product_id, category, competitor_name, price_kmf, observed_at, source, notes
       FROM competitor_prices
      WHERE ${where.join(' AND ')}
      ORDER BY observed_at DESC`,
    params
  );
  return { count: rows.length, competitors: rows };
}

async function addCompetitor(dbOrClient, body) {
  const b = body || {};
  if (!b.competitor_name) throw Object.assign(new Error('competitor_name required'), { status: 400 });
  if (!b.price_kmf || b.price_kmf <= 0) throw Object.assign(new Error('price_kmf invalid'), { status: 400 });
  if (!b.product_id && !b.category) throw Object.assign(new Error('product_id or category required'), { status: 400 });

  const { rows: [row] } = await dbOrClient.query(
    `INSERT INTO competitor_prices (product_id, category, competitor_name, price_kmf, source, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [b.product_id || null, b.category || null, b.competitor_name, b.price_kmf, b.source || 'manual', b.notes || null]
  );
  return row;
}

async function softDeleteCompetitor(dbOrClient, id) {
  await dbOrClient.query('UPDATE competitor_prices SET is_active = FALSE WHERE id = $1', [id]);
  return { ok: true };
}

function buildReferenceCandidate(id, label, description, price, economics) {
  const unit = contributionAtPrice(economics.variable_cost_complete_kmf, price);
  if (unit.contribution_kmf == null || unit.contribution_kmf <= 0) return null;
  return {
    id,
    label,
    price,
    contribution_kmf: unit.contribution_kmf,
    contribution_rate_pct: unit.contribution_rate_pct,
    description,
    decision_required: true,
    market_authority: 'NONE_GLOBAL_REFERENCE_ONLY',
  };
}

async function getStrategy(dbOrClient, { product_id, category } = {}) {
  if (!product_id && !category) {
    throw Object.assign(new Error('product_id or category required'), { status: 400 });
  }

  let product;
  let target;
  if (product_id) {
    const result = await dbOrClient.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (!result.rows.length) throw Object.assign(new Error('Product not found'), { status: 404 });
    product = result.rows[0];
    target = {
      product_id: product.id,
      category: product.category,
      name: product.name,
      current_price_kmf: product.price_kmf,
    };
  } else {
    const result = await dbOrClient.query(
      `SELECT * FROM products WHERE category = $1 AND is_active = TRUE
        ORDER BY price_kmf LIMIT 1 OFFSET (
          SELECT GREATEST(0, COUNT(*)/2 - 1) FROM products WHERE category = $1 AND is_active = TRUE
        )`,
      [category]
    );
    if (!result.rows.length) throw Object.assign(new Error('No products in category'), { status: 404 });
    product = result.rows[0];
    target = {
      product_id: null,
      category,
      name: 'Produit médian catégorie ' + category,
      current_price_kmf: product.price_kmf,
    };
  }

  const economics = await computeCDR(dbOrClient, product);

  const compWhere = product_id
    ? 'product_id = $1 OR (product_id IS NULL AND category = $2)'
    : 'category = $1 OR product_id IN (SELECT id FROM products WHERE category = $1)';
  const compParams = product_id ? [product_id, product.category] : [category];
  const { rows: competitorsRows } = await dbOrClient.query(
    `SELECT competitor_name, price_kmf, observed_at, source
       FROM competitor_prices
      WHERE is_active = TRUE AND (${compWhere})
      ORDER BY observed_at DESC LIMIT 20`,
    compParams
  );

  let competitorStats = { count: 0, median: null, min: null, max: null, items: [] };
  if (competitorsRows.length) {
    const sorted = competitorsRows.map(item => Number(item.price_kmf)).filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length) {
      competitorStats = {
        count: sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        min: sorted[0],
        max: sorted[sorted.length - 1],
        items: competitorsRows,
      };
    }
  }

  const elasticity = product_id ? await estimateElasticity(dbOrClient, product_id) : null;
  const stratWhere = product_id
    ? 'product_id = $1 AND is_active = TRUE'
    : 'product_id IS NULL AND category = $1 AND is_active = TRUE';
  const { rows: stratRows } = await dbOrClient.query(
    `SELECT * FROM pricing_strategies WHERE ${stratWhere} LIMIT 1`,
    [product_id || category]
  );
  const currentStrategy = stratRows[0] || null;

  // Références globales uniquement. Elles ne remplacent jamais le corridor pays.
  const options = {};
  if (competitorStats.median) {
    const alignedPrice = arrondiPsycho(competitorStats.median);
    const premiumPrice = arrondiPsycho(competitorStats.median * 1.10);
    const acquisitionRawPrice = competitorStats.median * 0.90;
    const acquisitionPrice = arrondiPsycho(acquisitionRawPrice);
    const candidates = [
      buildReferenceCandidate('competitor_aligned', 'Référence concurrence globale', 'Alignement indicatif sur la médiane globale. Décision humaine obligatoire.', alignedPrice, economics),
      buildReferenceCandidate('premium_10', 'Référence premium +10 %', 'Hypothèse globale informative. À confronter au corridor du marché local.', premiumPrice, economics),
      acquisitionRawPrice >= Number(economics.minimum_safe_price_kmf || 0)
        ? buildReferenceCandidate('acquisition_reference', 'Référence acquisition -10 %', 'Hypothèse basse uniquement si elle reste au-dessus du plancher variable sécurisé.', acquisitionPrice, economics)
        : null,
    ].filter(Boolean);
    candidates.forEach(candidate => { options[candidate.id] = candidate; });
  }

  return {
    target,
    economics,
    // Alias de forme temporaire : aucun champ N1/N2/N3 ni prix mécanique.
    cdr: economics,
    competitors: competitorStats,
    competitor_reference_authority: 'GLOBAL_INFORMATIONAL_ONLY_NOT_LOCAL_MARKET_CORRIDOR',
    elasticity,
    current_strategy: currentStrategy,
    options,
    price_decision_required: true,
    generated_at: new Date().toISOString(),
  };
}

function assertExplicitStrategyType(strategyType) {
  const normalized = String(strategyType || '').trim();
  if (!normalized) throw Object.assign(new Error('strategy_type required'), { status: 400 });
  if (FORBIDDEN_AUTOMATIC_STRATEGIES.has(normalized)) {
    throw Object.assign(
      new Error('La stratégie mécanique n’est plus une autorité de prix. Fournir une décision humaine explicite.'),
      { status: 409, code: 'pricing_explicit_price_decision_required' }
    );
  }
  return normalized;
}

async function applyStrategy(dbPool, body, userId) {
  const { product_id, category, strategy_value, final_price_kmf, reason } = body || {};
  const strategyType = assertExplicitStrategyType(body && body.strategy_type);

  if (!product_id && !category) throw Object.assign(new Error('product_id or category required'), { status: 400 });
  const finalPrice = Number(final_price_kmf);
  if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
    throw Object.assign(new Error('final_price_kmf required'), { status: 400 });
  }

  const client = await dbPool.getClient();
  try {
    await client.query('BEGIN');

    let oldStrategyType = null;
    let oldPriceKmf = null;
    let product = null;

    if (product_id) {
      const { rows } = await client.query(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE',
        [product_id]
      );
      product = rows[0] || null;
      if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });

      const economics = await computeCDR(client, product);
      const variableCost = Number(economics.variable_cost_complete_kmf);
      if (Number.isFinite(variableCost) && finalPrice < variableCost) {
        throw Object.assign(
          new Error('Prix inférieur au coût variable complet : décision destructive refusée.'),
          { status: 400, code: 'price_below_variable_cost', variable_cost_complete_kmf: variableCost }
        );
      }

      const current = await client.query(
        'SELECT strategy_type FROM pricing_strategies WHERE product_id = $1 AND is_active = TRUE',
        [product_id]
      );
      if (current.rows.length) oldStrategyType = current.rows[0].strategy_type;
      await client.query(
        'UPDATE pricing_strategies SET is_active = FALSE WHERE product_id = $1 AND is_active = TRUE',
        [product_id]
      );
    } else {
      const current = await client.query(
        'SELECT strategy_type FROM pricing_strategies WHERE product_id IS NULL AND category = $1 AND is_active = TRUE',
        [category]
      );
      if (current.rows.length) oldStrategyType = current.rows[0].strategy_type;
      await client.query(
        'UPDATE pricing_strategies SET is_active = FALSE WHERE product_id IS NULL AND category = $1 AND is_active = TRUE',
        [category]
      );
    }

    await client.query(
      `INSERT INTO pricing_strategies (product_id, category, strategy_type, strategy_value, applied_price_kmf, notes, applied_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [product_id || null, category || null, strategyType, strategy_value || null, finalPrice, reason || null, userId || null]
    );

    let appliedProducts = [];
    if (product_id) {
      oldPriceKmf = Number(product.price_kmf) || 0;
      await catalogProductMutationService.applyPrice(client, product_id, finalPrice);
      try {
        await client.query('SAVEPOINT sp_price_history');
        await client.query(
          `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [product_id, oldPriceKmf, finalPrice, 'strategy:' + strategyType, userId || null]
        );
        await client.query('RELEASE SAVEPOINT sp_price_history');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT sp_price_history').catch(() => {});
        console.warn('[PRICING] price_history skipped:', error.message);
      }
      appliedProducts.push(product_id);
    } else {
      const { rows: catProducts } = await client.query(
        'SELECT id FROM products WHERE category = $1 AND is_active = TRUE',
        [category]
      );
      appliedProducts = catProducts.map(item => item.id);
    }

    await client.query(
      `INSERT INTO pricing_strategy_history (product_id, category, old_strategy_type, new_strategy_type,
                                              strategy_value, old_price_kmf, new_price_kmf, reason, applied_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [product_id || null, category || null, oldStrategyType, strategyType,
       strategy_value || null, oldPriceKmf, finalPrice, reason || null, userId || null]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      strategy_type: strategyType,
      final_price_kmf: finalPrice,
      price_decision_status: 'EXPLICIT_HUMAN_DECISION_APPLIED',
      products_affected: appliedProducts.length,
      products: appliedProducts,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getStrategyHistory(dbOrClient, { product_id, category } = {}) {
  const where = [];
  const params = [];
  let pi = 0;
  if (product_id) {
    params.push(product_id);
    where.push(`product_id = $${++pi}`);
  } else if (category) {
    params.push(category);
    where.push(`category = $${++pi}`);
  }

  const sql = `
    SELECT h.*, u.full_name AS applied_by_name
      FROM pricing_strategy_history h
      LEFT JOIN users u ON u.id = h.applied_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY h.applied_at DESC
     LIMIT 50
  `;
  const { rows } = await dbOrClient.query(sql, params);
  return { count: rows.length, history: rows };
}

module.exports = {
  arrondiPsycho,
  computeCDR,
  contributionAtPrice,
  estimateElasticity,
  getCompetitors,
  addCompetitor,
  softDeleteCompetitor,
  getStrategy,
  applyStrategy,
  getStrategyHistory,
  _projectCanonicalEconomics: projectCanonicalEconomics,
  _assertExplicitStrategyType: assertExplicitStrategyType,
};
