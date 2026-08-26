/**
 * @komerce-arch
 * @role          economic-engine-pricing-strategy-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/catalog-product-mutation-service.js
 * @used-by       routes/pricing-strategy.js, services/pricing-workspace.js
 * @db-read       charges, competitor_prices, customs_categories, finance_config, order_items, orders, pricing_components, pricing_strategies, products, risk_provisions, users
 * @db-write      competitor_prices, price_history, pricing_strategies, pricing_strategy_history
 * @db-write-via:catalog-product-mutation-service products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * pricing-strategy-service.js
 *
 * Logique métier extraite de routes/pricing-strategy.js (R8).
 *
 * Exports :
 *   arrondiPsycho(x)                               — arrondi psychologique pur
 *   computeCDR(db, product)                        — calcul coût de revient
 *   estimateElasticity(db, productId)              — élasticité-prix
 *   getCompetitors(db, { product_id?, category? }) — liste concurrents
 *   addCompetitor(db, body)                        — INSERT concurrent
 *   softDeleteCompetitor(db, id)                   — soft delete concurrent
 *   getStrategy(db, { product_id?, category? })    — stratégie complète
 *   applyStrategy(db, body, userId)                — applique stratégie (tx)
 *   getStrategyHistory(db, { product_id?, category? }) — historique
 */

const db = require('../db');
const catalogProductMutationService = require('./catalog-product-mutation-service');

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Arrondi psychologique : 990, 490, 90, etc. */
function arrondiPsycho(x) {
  if (x < 500)  return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  const k = Math.ceil(x / 1000) * 1000;
  return k - 10;
}

// ── CDR ───────────────────────────────────────────────────────────────────────

/**
 * Calcule le coût de revient d'un produit.
 * @param {object} dbOrClient — db pool ou client pg (supporte .query())
 * @param {object} product    — { id, category, cost_kmf, weight_kg }
 */
async function computeCDR(dbOrClient, product) {
  const q = (sql, p) => dbOrClient.query(sql, p);

  const [fcRes, catRes, compRes, provRes, chargesRes] = await Promise.all([
    q('SELECT * FROM finance_config WHERE id = 1'),
    product.category
      ? q('SELECT * FROM customs_categories WHERE key = $1 AND is_active = TRUE', [product.category])
      : Promise.resolve({ rows: [] }),
    q('SELECT * FROM pricing_components WHERE is_active = TRUE'),
    q('SELECT * FROM risk_provisions WHERE is_active = TRUE'),
    q('SELECT * FROM charges WHERE is_active = TRUE'),
  ]);

  const fc = fcRes.rows[0] || {};
  const cat = catRes.rows[0];
  const taxAED = Number(fc.taux_aed_kmf) || 138;
  const taxEUR = Number(fc.taux_change_eur_kmf) || 492;
  const fretEur = Number(fc.fret_eur_per_m3) || 180;

  const margeCible = cat?.default_margin_pct
    ? Number(cat.default_margin_pct) / 100
    : (Number(fc.target_marge_brute_pct) || 40) / 100;

  const prixAchatKmf = Number(product.cost_kmf) || 0;
  const volM3 = 0.005;
  const fretKmf = volM3 * fretEur * taxEUR;
  let n1 = prixAchatKmf + fretKmf;

  for (const c of compRes.rows) {
    const v = Number(c.default_value);
    const a = c.applies_to || 'all';
    if (a !== 'all' && !a.startsWith('category:' + product.category)) continue;
    switch (c.unit) {
      case 'pct':         n1 += n1 * (v / 100); break;
      case 'kmf':         n1 += v; break;
      case 'kmf_per_kg':  n1 += v * (Number(product.weight_kg) || 1); break;
      case 'kmf_per_m3':  n1 += v * volM3; break;
      case 'aed':         n1 += v * taxAED; break;
      case 'eur':         n1 += v * taxEUR; break;
    }
  }
  if (cat) {
    const base = prixAchatKmf + fretKmf;
    n1 += base * Number(cat.douane_pct) / 100;
    n1 += base * Number(cat.tva_pct) / 100;
    n1 += base * Number(cat.taxe_add_pct) / 100;
  }

  const totalMensuel = chargesRes.rows
    .filter(c => c.recurrence_period === 'monthly')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);
  const totalHebdo = chargesRes.rows
    .filter(c => c.recurrence_period === 'weekly')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);
  const totalPerOrder = chargesRes.rows
    .filter(c => c.recurrence_period === 'per_order')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);
  const volume = Number(fc.objectif_commandes_mois) || 100;
  const n2 = Math.round((totalMensuel + totalHebdo * 4.33) / volume + totalPerOrder);

  const baseProv = n1 + n2;
  let n3 = 0;
  for (const p of provRes.rows) {
    n3 += baseProv * (Number(p.rate_pct) / 100);
  }
  n3 = Math.round(n3);

  const coutTotal = Math.round(n1) + n2 + n3;
  const prixMecanique = arrondiPsycho(coutTotal / (1 - margeCible));

  return {
    n1: Math.round(n1),
    n2,
    n3,
    cout_total_kmf: coutTotal,
    marge_cible_pct: Math.round(margeCible * 1000) / 10,
    prix_mecanique_kmf: prixMecanique,
  };
}

// ── Élasticité ────────────────────────────────────────────────────────────────

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

  const elasticity = dV / dP;
  const bounded = Math.max(-3, Math.min(3, elasticity));

  return {
    value: Math.round(bounded * 100) / 100,
    interpretation: Math.abs(bounded) < 0.5 ? 'faible' : (Math.abs(bounded) < 1.5 ? 'moyenne' : 'forte'),
    sample_size: v1 + v2,
    is_significant: (v1 + v2) >= 10,
  };
}

// ── Concurrents ───────────────────────────────────────────────────────────────

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

  const { rows: [r] } = await dbOrClient.query(
    `INSERT INTO competitor_prices (product_id, category, competitor_name, price_kmf, source, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [b.product_id || null, b.category || null, b.competitor_name, b.price_kmf, b.source || 'manual', b.notes || null]
  );
  return r;
}

async function softDeleteCompetitor(dbOrClient, id) {
  await dbOrClient.query(
    'UPDATE competitor_prices SET is_active = FALSE WHERE id = $1',
    [id]
  );
  return { ok: true };
}

// ── Stratégie lecture ─────────────────────────────────────────────────────────

async function getStrategy(dbOrClient, { product_id, category } = {}) {
  if (!product_id && !category) {
    throw Object.assign(new Error('product_id or category required'), { status: 400 });
  }

  let product, target;
  if (product_id) {
    const r = await dbOrClient.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (!r.rows.length) throw Object.assign(new Error('Product not found'), { status: 404 });
    product = r.rows[0];
    target = { product_id: product.id, category: product.category, name: product.name, current_price_kmf: product.price_kmf };
  } else {
    const r = await dbOrClient.query(
      `SELECT * FROM products WHERE category = $1 AND is_active = TRUE
        ORDER BY price_kmf LIMIT 1 OFFSET (
          SELECT GREATEST(0, COUNT(*)/2 - 1) FROM products WHERE category = $1 AND is_active = TRUE
        )`,
      [category]
    );
    if (!r.rows.length) throw Object.assign(new Error('No products in category'), { status: 404 });
    product = r.rows[0];
    target = { product_id: null, category, name: 'Produit median categorie ' + category, current_price_kmf: product.price_kmf };
  }

  const cdr = await computeCDR(dbOrClient, product);

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
    const sorted = [...competitorsRows].map(c => Number(c.price_kmf)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    competitorStats = { count: sorted.length, median, min: sorted[0], max: sorted[sorted.length - 1], items: competitorsRows };
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

  const options = {
    mechanical: {
      price: cdr.prix_mecanique_kmf,
      margin_kmf: cdr.prix_mecanique_kmf - cdr.cout_total_kmf,
      margin_pct: Math.round((1 - cdr.cout_total_kmf / cdr.prix_mecanique_kmf) * 1000) / 10,
      description: 'Suit la formule (CDR + marge cible)',
    },
  };
  if (competitorStats.median) {
    options.competitor_aligned = {
      price: arrondiPsycho(competitorStats.median),
      margin_kmf: arrondiPsycho(competitorStats.median) - cdr.cout_total_kmf,
      margin_pct: Math.round((1 - cdr.cout_total_kmf / arrondiPsycho(competitorStats.median)) * 1000) / 10,
      description: 'Aligne sur la mediane concurrence',
    };
    options.premium_10 = {
      price: arrondiPsycho(competitorStats.median * 1.10),
      margin_kmf: arrondiPsycho(competitorStats.median * 1.10) - cdr.cout_total_kmf,
      margin_pct: Math.round((1 - cdr.cout_total_kmf / arrondiPsycho(competitorStats.median * 1.10)) * 1000) / 10,
      description: 'Premium +10% vs concurrence',
    };
    options.loss_leader = {
      price: arrondiPsycho(competitorStats.median * 0.90),
      margin_kmf: arrondiPsycho(competitorStats.median * 0.90) - cdr.cout_total_kmf,
      margin_pct: Math.round((1 - cdr.cout_total_kmf / arrondiPsycho(competitorStats.median * 0.90)) * 1000) / 10,
      description: 'Loss leader -10% pour acquisition',
    };
  }

  return { target, cdr, competitors: competitorStats, elasticity, current_strategy: currentStrategy, options, generated_at: new Date().toISOString() };
}

// ── Appliquer stratégie (tx) ──────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} dbPool
 * @param {object} body — { product_id?, category?, strategy_type, strategy_value?, final_price_kmf, reason? }
 * @param {string|null} userId
 */
async function applyStrategy(dbPool, body, userId) {
  const { product_id, category, strategy_type, strategy_value, final_price_kmf, reason } = body || {};

  if (!product_id && !category) throw Object.assign(new Error('product_id or category required'), { status: 400 });
  if (!strategy_type) throw Object.assign(new Error('strategy_type required'), { status: 400 });
  if (!final_price_kmf || final_price_kmf <= 0) throw Object.assign(new Error('final_price_kmf required'), { status: 400 });

  const client = await dbPool.getClient();
  try {
    await client.query('BEGIN');

    let oldStrategyType = null;
    let oldPriceKmf = null;

    if (product_id) {
      const { rows } = await client.query(
        'SELECT strategy_type FROM pricing_strategies WHERE product_id = $1 AND is_active = TRUE',
        [product_id]
      );
      if (rows.length) oldStrategyType = rows[0].strategy_type;
      await client.query(
        'UPDATE pricing_strategies SET is_active = FALSE WHERE product_id = $1 AND is_active = TRUE',
        [product_id]
      );
    } else {
      const { rows } = await client.query(
        'SELECT strategy_type FROM pricing_strategies WHERE product_id IS NULL AND category = $1 AND is_active = TRUE',
        [category]
      );
      if (rows.length) oldStrategyType = rows[0].strategy_type;
      await client.query(
        'UPDATE pricing_strategies SET is_active = FALSE WHERE product_id IS NULL AND category = $1 AND is_active = TRUE',
        [category]
      );
    }

    await client.query(
      `INSERT INTO pricing_strategies (product_id, category, strategy_type, strategy_value, applied_price_kmf, notes, applied_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [product_id || null, category || null, strategy_type, strategy_value || null, final_price_kmf, reason || null, userId || null]
    );

    let appliedProducts = [];
    if (product_id) {
      const { rows: [p] } = await client.query('SELECT price_kmf FROM products WHERE id = $1', [product_id]);
      oldPriceKmf = p ? Number(p.price_kmf) : null;
      await catalogProductMutationService.applyPrice(client, product_id, final_price_kmf);
      try {
        await client.query('SAVEPOINT sp_price_history');
        await client.query(
          `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [product_id, oldPriceKmf, final_price_kmf, 'strategy:' + strategy_type, userId || null]
        );
        await client.query('RELEASE SAVEPOINT sp_price_history');
      } catch (e) {
        // table optionnelle — sans SAVEPOINT, l'échec aborte le client et
        // l'INSERT pricing_strategy_history suivant échoue à son tour
        // (UPDATE prix annulé silencieusement au COMMIT, RED-2/RED-2b).
        await client.query('ROLLBACK TO SAVEPOINT sp_price_history').catch(() => {});
        console.warn('[PRICING] price_history skipped:', e.message);
      }
      appliedProducts.push(product_id);
    } else {
      const { rows: catProducts } = await client.query(
        'SELECT id FROM products WHERE category = $1 AND is_active = TRUE',
        [category]
      );
      appliedProducts = catProducts.map(p => p.id);
    }

    await client.query(
      `INSERT INTO pricing_strategy_history (product_id, category, old_strategy_type, new_strategy_type,
                                              strategy_value, old_price_kmf, new_price_kmf, reason, applied_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [product_id || null, category || null, oldStrategyType, strategy_type,
       strategy_value || null, oldPriceKmf, final_price_kmf, reason || null, userId || null]
    );

    await client.query('COMMIT');
    return { ok: true, strategy_type, final_price_kmf, products_affected: appliedProducts.length, products: appliedProducts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Historique ────────────────────────────────────────────────────────────────

async function getStrategyHistory(dbOrClient, { product_id, category } = {}) {
  const where = [];
  const params = [];
  let pi = 0;
  if (product_id) { params.push(product_id); where.push(`product_id = $${++pi}`); }
  else if (category) { params.push(category); where.push(`category = $${++pi}`); }

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
  estimateElasticity,
  getCompetitors,
  addCompetitor,
  softDeleteCompetitor,
  getStrategy,
  applyStrategy,
  getStrategyHistory,
};
