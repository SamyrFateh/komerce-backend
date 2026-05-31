/**
 * KOMERCE — Routes Pricing Strategy (Phase 3 — ADR-013)
 *
 * Endpoints pour le 3eme onglet du module Pricing :
 *
 *   GET    /api/pricing/strategy/competitors[?product_id=...|category=...]
 *   POST   /api/pricing/strategy/competitors        — ajouter prix concurrent
 *   DELETE /api/pricing/strategy/competitors/:id    — soft delete
 *
 *   GET    /api/pricing/strategy[?product_id=...|category=...]
 *     Retourne la strategie active + tous les inputs decouverts :
 *       - cdr (cout de revient)
 *       - prix concurrents (mediane / min / max)
 *       - elasticite estimee (sales history)
 *       - prix recommandes pour chaque strategy_type
 *
 *   POST   /api/pricing/strategy/apply              — applique une strategie
 *
 * Note : la propagation au prix de vente se fait via /api/pricing/apply-price
 * deja existant (Phase 2). Ce router ne fait QUE le tracking de strategie.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate } = require('../middleware/auth');

// Admin guard (admin only)
const adminOnly = [
  authenticate,
  (req, res, next) => {
    if (!['admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Reserved to admin' });
    }
    next();
  }
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Arrondi psychologique : 990, 490, 90, etc. */
function arrondiPsycho(x) {
  if (x < 500) return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  const k = Math.ceil(x / 1000) * 1000;
  return k - 10;
}

/**
 * Charge tous les composants pour calculer un CDR.
 * Re-utilise la logique du /recommend mais en mode "donne moi juste les chiffres".
 */
async function computeCDR(product) {
  // Charger config + categorie + composants
  const [fcRes, catRes, compRes, provRes, chargesRes] = await Promise.all([
    db.query('SELECT * FROM finance_config WHERE id = 1'),
    product.category
      ? db.query('SELECT * FROM customs_categories WHERE key = $1 AND is_active = TRUE', [product.category])
      : Promise.resolve({ rows: [] }),
    db.query('SELECT * FROM pricing_components WHERE is_active = TRUE'),
    db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE'),
    db.query('SELECT * FROM charges WHERE is_active = TRUE'),
  ]);

  const fc = fcRes.rows[0] || {};
  const cat = catRes.rows[0];
  const taxAED = Number(fc.taux_aed_kmf) || 138;
  const taxEUR = Number(fc.taux_change_eur_kmf) || 492;
  const fretEur = Number(fc.fret_eur_per_m3) || 180;

  const margeCible = cat?.default_margin_pct
    ? Number(cat.default_margin_pct) / 100
    : (Number(fc.target_marge_brute_pct) || 40) / 100;

  // Niveau 1 — variables par commande
  const prixAchatKmf = Number(product.cost_kmf) || 0;
  const volM3 = 0.005;  // defaut, TODO ajouter dimensions au produit
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

  // Niveau 2 — charges fixes amorties
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

  // Niveau 3 — provisions
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

/**
 * Estime l'elasticite-prix d'un produit a partir de l'historique de vente.
 * Si le produit n'a pas assez de donnees, retourne null (donnee insuffisante).
 *
 * Methode simple : on regarde si le volume mensuel a evolue sur les 90 derniers
 * jours en correlation avec un changement de prix.
 */
async function estimateElasticity(productId) {
  if (!productId) return null;

  // Charger historique de prix (price_history) + ventes mensuelles
  const { rows: priceChanges } = await db.query(
    `SELECT old_price_kmf, new_price_kmf, applied_at
       FROM price_history
      WHERE product_id = $1
      ORDER BY applied_at DESC LIMIT 5`,
    [productId]
  ).catch(() => ({ rows: [] }));

  if (priceChanges.length < 2) return null;

  // Volume sur les 30 jours avant et apres le changement le plus recent
  const lastChange = priceChanges[0];
  const before = await db.query(
    `SELECT COUNT(*) AS nb FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1
        AND o.status NOT IN ('cancelled', 'refunded')
        AND o.created_at BETWEEN $2::timestamptz - INTERVAL '30 days' AND $2::timestamptz`,
    [productId, lastChange.applied_at]
  ).catch(() => ({ rows: [{ nb: 0 }] }));
  const after = await db.query(
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
  // Borner pour eviter les valeurs aberrantes
  const bounded = Math.max(-3, Math.min(3, elasticity));

  return {
    value: Math.round(bounded * 100) / 100,
    interpretation: Math.abs(bounded) < 0.5 ? 'faible' : (Math.abs(bounded) < 1.5 ? 'moyenne' : 'forte'),
    sample_size: v1 + v2,
    is_significant: (v1 + v2) >= 10,  // au moins 10 ventes pour etre fiable
  };
}

// ═══════════════════════════════════════════════════════════════════
// PRIX CONCURRENTS
// ═══════════════════════════════════════════════════════════════════

/** GET /competitors — lister prix concurrents */
router.get('/competitors', authenticate, async (req, res, next) => {
  try {
    const where = ['is_active = TRUE'];
    const params = [];
    let pi = 0;
    if (req.query.product_id) {
      params.push(req.query.product_id);
      where.push(`product_id = $${++pi}`);
    } else if (req.query.category) {
      params.push(req.query.category);
      where.push(`(category = $${++pi} OR product_id IN (SELECT id FROM products WHERE category = $${pi}))`);
    }
    const { rows } = await db.query(
      `SELECT id, product_id, category, competitor_name, price_kmf, observed_at, source, notes
         FROM competitor_prices
        WHERE ${where.join(' AND ')}
        ORDER BY observed_at DESC`,
      params
    );
    res.json({ count: rows.length, competitors: rows });
  } catch (err) { next(err); }
});

/** POST /competitors — ajouter un prix concurrent */
router.post('/competitors', ...adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.competitor_name) return res.status(400).json({ error: 'competitor_name required' });
    if (!b.price_kmf || b.price_kmf <= 0) return res.status(400).json({ error: 'price_kmf invalid' });
    if (!b.product_id && !b.category) return res.status(400).json({ error: 'product_id or category required' });

    const { rows: [r] } = await db.query(
      `INSERT INTO competitor_prices (product_id, category, competitor_name, price_kmf, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.product_id || null, b.category || null, b.competitor_name, b.price_kmf, b.source || 'manual', b.notes || null]
    );
    res.status(201).json(r);
  } catch (err) { next(err); }
});

/** DELETE /competitors/:id — soft delete */
router.delete('/competitors/:id', ...adminOnly, async (req, res, next) => {
  try {
    await db.query(
      'UPDATE competitor_prices SET is_active = FALSE WHERE id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// STRATEGIE COMPLETE (lecture)
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /strategy?product_id=xxx OR /strategy?category=phones
 *
 * Retourne tout ce qu'il faut pour arbitrer le prix :
 *   {
 *     target: { product_id?, category, name },
 *     cdr: { n1, n2, n3, cout_total, prix_mecanique },
 *     competitors: { count, median, min, max, items: [...] },
 *     elasticity: { value, interpretation, is_significant } | null,
 *     current_strategy: { strategy_type, strategy_value, applied_at } | null,
 *     options: {
 *       mechanical: { price, margin_pct },
 *       competitor_aligned: { price, margin_pct },
 *       premium_10: { price, margin_pct },
 *       loss_leader: { price, margin_pct }
 *     }
 *   }
 */
router.get('/strategy', authenticate, async (req, res, next) => {
  try {
    const { product_id, category } = req.query;
    if (!product_id && !category) {
      return res.status(400).json({ error: 'product_id or category required' });
    }

    // 1. Charger le produit OU le produit "moyen" de la categorie
    let product, target;
    if (product_id) {
      const r = await db.query('SELECT * FROM products WHERE id = $1', [product_id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Product not found' });
      product = r.rows[0];
      target = { product_id: product.id, category: product.category, name: product.name, current_price_kmf: product.price_kmf };
    } else {
      // Pour une categorie : on prend le produit median (en prix actuel) comme proxy
      const r = await db.query(
        `SELECT * FROM products WHERE category = $1 AND is_active = TRUE
          ORDER BY price_kmf LIMIT 1 OFFSET (
            SELECT GREATEST(0, COUNT(*)/2 - 1) FROM products WHERE category = $1 AND is_active = TRUE
          )`,
        [category]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'No products in category' });
      product = r.rows[0];
      target = { product_id: null, category, name: 'Produit median categorie ' + category, current_price_kmf: product.price_kmf };
    }

    // 2. Calculer le CDR
    const cdr = await computeCDR(product);

    // 3. Charger prix concurrents
    const compWhere = product_id
      ? 'product_id = $1 OR (product_id IS NULL AND category = $2)'
      : 'category = $1 OR product_id IN (SELECT id FROM products WHERE category = $1)';
    const compParams = product_id ? [product_id, product.category] : [category];
    const { rows: competitorsRows } = await db.query(
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
      competitorStats = {
        count: sorted.length,
        median,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        items: competitorsRows,
      };
    }

    // 4. Estimer elasticite
    const elasticity = product_id ? await estimateElasticity(product_id) : null;

    // 5. Charger strategie active
    const stratWhere = product_id
      ? 'product_id = $1 AND is_active = TRUE'
      : 'product_id IS NULL AND category = $1 AND is_active = TRUE';
    const { rows: stratRows } = await db.query(
      `SELECT * FROM pricing_strategies WHERE ${stratWhere} LIMIT 1`,
      [product_id || category]
    );
    const currentStrategy = stratRows[0] || null;

    // 6. Calculer les options de prix
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

    res.json({
      target,
      cdr,
      competitors: competitorStats,
      elasticity,
      current_strategy: currentStrategy,
      options,
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// APPLIQUER UNE STRATEGIE
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /strategy/apply
 *
 * Body : {
 *   product_id?, category?,            (l'un ou l'autre obligatoire)
 *   strategy_type: 'mechanical'|'competitor_aligned'|'premium'|'loss_leader'|'manual',
 *   strategy_value?: number,            (offset% pour premium/loss_leader, prix pour manual)
 *   final_price_kmf: number,            (prix finalement applique - le moteur l'envoie)
 *   reason?: string
 * }
 *
 * Effets :
 *   1. Desactive l'ancienne strategie active
 *   2. Cree la nouvelle strategie
 *   3. Si product_id : applique le prix au produit + audit price_history
 *   4. Si category : pour chaque produit de la categorie, applique le mecanique
 *      ajuste selon la strategie
 */
router.post('/strategy/apply', ...adminOnly, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const b = req.body || {};
    const { product_id, category, strategy_type, strategy_value, final_price_kmf, reason } = b;

    if (!product_id && !category) {
      return res.status(400).json({ error: 'product_id or category required' });
    }
    if (!strategy_type) return res.status(400).json({ error: 'strategy_type required' });
    if (!final_price_kmf || final_price_kmf <= 0) {
      return res.status(400).json({ error: 'final_price_kmf required' });
    }

    await client.query('BEGIN');

    // 1. Desactiver l'ancienne strategie active si elle existe
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

    // 2. Creer la nouvelle strategie
    await client.query(
      `INSERT INTO pricing_strategies (product_id, category, strategy_type, strategy_value, applied_price_kmf, notes, applied_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [product_id || null, category || null, strategy_type, strategy_value || null, final_price_kmf, reason || null, req.user?.id || null]
    );

    // 3. Appliquer au produit OU a tous les produits de la categorie
    let appliedProducts = [];
    if (product_id) {
      // Recuperer ancien prix
      const { rows: [p] } = await client.query('SELECT price_kmf FROM products WHERE id = $1', [product_id]);
      oldPriceKmf = p ? Number(p.price_kmf) : null;
      // Update prix
      await client.query(
        'UPDATE products SET price_kmf = $1, updated_at = NOW() WHERE id = $2',
        [final_price_kmf, product_id]
      );
      // Audit price_history
      try {
        await client.query(
          `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [product_id, oldPriceKmf, final_price_kmf, 'strategy:' + strategy_type, req.user?.id || null]
        );
      } catch (_) { /* table optionnelle */ }
      appliedProducts.push(product_id);
    } else {
      // Cas categorie : pour chaque produit, recalculer son CDR + appliquer la strategie
      // (simplification : on ne fait que tracer la strategie, l'utilisateur appliquera produit par produit
      //  via le catalogue. Pour le batch, il pourra utiliser /apply-all separement.)
      const { rows: catProducts } = await client.query(
        'SELECT id FROM products WHERE category = $1 AND is_active = TRUE',
        [category]
      );
      appliedProducts = catProducts.map(p => p.id);
    }

    // 4. Audit history
    await client.query(
      `INSERT INTO pricing_strategy_history (product_id, category, old_strategy_type, new_strategy_type,
                                              strategy_value, old_price_kmf, new_price_kmf, reason, applied_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [product_id || null, category || null, oldStrategyType, strategy_type,
       strategy_value || null, oldPriceKmf, final_price_kmf, reason || null, req.user?.id || null]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      strategy_type,
      final_price_kmf,
      products_affected: appliedProducts.length,
      products: appliedProducts,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// HISTORIQUE DES STRATEGIES
// ═══════════════════════════════════════════════════════════════════

/** GET /strategy/history?product_id=...|category=... */
router.get('/strategy/history', authenticate, async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    let pi = 0;
    if (req.query.product_id) {
      params.push(req.query.product_id);
      where.push(`product_id = $${++pi}`);
    } else if (req.query.category) {
      params.push(req.query.category);
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
    const { rows } = await db.query(sql, params);
    res.json({ count: rows.length, history: rows });
  } catch (err) { next(err); }
});

module.exports = router;
