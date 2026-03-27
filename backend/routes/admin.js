/**
 * KOMERCE — Back-office Admin v7.1
 *
 * Toutes les routes sont protégées : authenticate + requireRole(['admin'])
 *
 * GET /api/admin/dashboard         → KPIs globaux
 * GET /api/admin/orders            → toutes les commandes + filtres
 * GET /api/admin/margins           → dashboard marge réelle
 * GET /api/admin/customs           → historique douane
 * GET /api/admin/partners          → gestion partenaires / relais
 * POST /api/admin/partners         → créer un partenaire
 * PUT  /api/admin/partners/:id     → modifier un partenaire
 * GET /api/admin/alerts            → alertes marge négative + anomalies douane
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/dashboard ────────────────────────────────────────────────

router.get('/dashboard', ...guard, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [
      { rows: [kpi] },
      { rows: statusDist },
      { rows: topProducts },
      { rows: marginKpi },
      { rows: recentOrders },
    ] = await Promise.all([
      // KPIs globaux
      db.query(`
        SELECT
          COUNT(*)                                  AS total_orders,
          COUNT(*) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL) AS orders_period,
          SUM(total_kmf) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL) AS revenue_kmf,
          ROUND(AVG(total_kmf) FILTER (WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL)) AS avg_basket_kmf,
          COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_total,
          COUNT(*) FILTER (WHERE confection_type != 'aucun') AS couture_orders
        FROM orders
      `, [days]),

      // Distribution par statut
      db.query(`
        SELECT status, COUNT(*) AS count
        FROM orders
        GROUP BY status
        ORDER BY count DESC
      `),

      // Top produits
      db.query(`
        SELECT
          p.name,
          p.category,
          COUNT(o.id) AS order_count,
          SUM(o.total_kmf) AS revenue_kmf
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY p.id, p.name, p.category
        ORDER BY order_count DESC
        LIMIT 10
      `, [days]),

      // KPIs marge réelle
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE margin_real_pct IS NOT NULL) AS orders_costed,
          ROUND(AVG(margin_real_pct) FILTER (WHERE margin_real_pct IS NOT NULL), 2) AS avg_margin_pct,
          COUNT(*) FILTER (WHERE margin_alert = TRUE) AS margin_alerts,
          COUNT(*) FILTER (WHERE sourcing_blocked = TRUE) AS sourcing_blocked,
          COUNT(*) FILTER (WHERE margin_real_pct >= 10) AS healthy_margin_count,
          COUNT(*) FILTER (WHERE margin_real_pct < 0)  AS negative_margin_count
        FROM orders
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
      `, [days]),

      // 10 dernières commandes
      db.query(`
        SELECT
          o.reference, o.status, o.total_kmf, o.margin_real_pct,
          o.confection_type, o.payment_mode, o.created_at,
          p.name AS product_name,
          u.full_name AS customer_name
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN users    u ON u.id = o.user_id
        ORDER BY o.created_at DESC
        LIMIT 10
      `),
    ]);

    res.json({
      kpi:           kpi,
      status_dist:   statusDist,
      top_products:  topProducts,
      margin_kpi:    marginKpi,
      recent_orders: recentOrders,
      period_days:   Number(days),
    });

  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).json({ error: 'Erreur dashboard' });
  }
});

// ─── GET /api/admin/orders ───────────────────────────────────────────────────

router.get('/orders', ...guard, async (req, res) => {
  try {
    const {
      status,
      payment_mode,
      confection_type,
      from_date,
      to_date,
      search,
      margin_alert,
      limit  = 50,
      offset = 0,
    } = req.query;

    const conditions = ['1=1'];
    const params     = [];
    let   pi         = 1;

    if (status) {
      conditions.push(`o.status = $${pi++}`);
      params.push(status);
    }
    if (payment_mode) {
      conditions.push(`o.payment_mode = $${pi++}`);
      params.push(payment_mode);
    }
    if (confection_type) {
      conditions.push(`o.confection_type = $${pi++}`);
      params.push(confection_type);
    }
    if (from_date) {
      conditions.push(`o.created_at >= $${pi++}`);
      params.push(from_date);
    }
    if (to_date) {
      conditions.push(`o.created_at <= $${pi++}`);
      params.push(to_date);
    }
    if (margin_alert === 'true') {
      conditions.push('o.margin_alert = TRUE');
    }
    if (search) {
      conditions.push(`(o.reference ILIKE $${pi} OR u.full_name ILIKE $${pi} OR u.phone ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = conditions.join(' AND ');

    const { rows } = await db.query(
      `SELECT
         o.id, o.reference, o.status, o.total_kmf,
         o.cost_estimated_kmf, o.cost_real_kmf, o.cost_delta_pct,
         o.margin_estimated_pct, o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
         o.payment_mode, o.payment_status,
         o.confection_type, o.confection_instructions, o.confection_delay_days,
         o.recipient_name, o.recipient_phone,
         o.sender_name, o.sender_phone,
         o.created_at, o.ordered_at, o.shipped_at, o.available_at, o.collected_at,
         p.name   AS product_name, p.category,
         u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         r.name   AS relais_name, r.zone AS relais_zone
       FROM orders o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users    u ON u.id = o.user_id
       LEFT JOIN relais   r ON r.id = o.relais_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE ${where}`,
      params
    );

    res.json({ orders: rows, total: Number(count) });

  } catch (err) {
    console.error('Admin orders error:', err.message);
    res.status(500).json({ error: 'Erreur liste commandes' });
  }
});

// ─── GET /api/admin/margins — dashboard marge réelle ─────────────────────────

router.get('/margins', ...guard, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [
      { rows: byCategory },
      { rows: alerts },
      { rows: timeline },
    ] = await Promise.all([
      // Marge par catégorie produit
      db.query(`
        SELECT
          p.category,
          COUNT(o.id)                                             AS order_count,
          ROUND(AVG(o.margin_estimated_pct), 2)                  AS avg_margin_estimated,
          ROUND(AVG(o.margin_real_pct) FILTER (WHERE o.margin_real_pct IS NOT NULL), 2) AS avg_margin_real,
          COUNT(*) FILTER (WHERE o.margin_alert = TRUE)          AS alert_count,
          COUNT(*) FILTER (WHERE o.margin_real_pct < 0)          AS negative_count,
          COUNT(*) FILTER (WHERE o.margin_real_pct >= 10)        AS healthy_count
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY p.category
        ORDER BY avg_margin_real ASC NULLS LAST
      `, [days]),

      // Commandes en alerte
      db.query(`
        SELECT
          o.reference, o.status, o.total_kmf,
          o.cost_estimated_kmf, o.cost_real_kmf, o.cost_delta_pct,
          o.margin_estimated_pct, o.margin_real_pct,
          o.sourcing_blocked,
          p.name AS product_name, p.category
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.margin_alert = TRUE
          AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
        ORDER BY o.margin_real_pct ASC NULLS LAST
        LIMIT 50
      `, [days]),

      // Évolution marge dans le temps (par semaine)
      db.query(`
        SELECT
          DATE_TRUNC('week', o.cost_closed_at) AS week,
          ROUND(AVG(o.margin_real_pct), 2)     AS avg_margin_real,
          COUNT(*)                              AS orders_costed
        FROM orders o
        WHERE o.cost_closed_at IS NOT NULL
          AND o.cost_closed_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY week
        ORDER BY week ASC
      `, [days]),
    ]);

    res.json({
      by_category: byCategory,
      alerts,
      timeline,
      period_days: Number(days),
    });

  } catch (err) {
    console.error('Margins error:', err.message);
    res.status(500).json({ error: 'Erreur dashboard marges' });
  }
});

// ─── GET /api/admin/customs — historique douane ───────────────────────────────

router.get('/customs', ...guard, async (req, res) => {
  try {
    const { days = 90, category, anomaly_only } = req.query;

    const conditions = ['ch.created_at >= NOW() - ($1 || \' days\')::INTERVAL'];
    const params     = [days];
    let   pi         = 2;

    if (category) {
      conditions.push(`p.category = $${pi++}`);
      params.push(category);
    }
    if (anomaly_only === 'true') {
      conditions.push('ch.is_anomaly = TRUE');
    }

    const where = conditions.join(' AND ');

    const [
      { rows: history },
      { rows: byCategory },
      { rows: anomalies },
    ] = await Promise.all([
      // Historique détaillé
      db.query(`
        SELECT
          ch.id,
          ch.created_at,
          o.reference,
          p.name     AS product_name,
          p.category,
          ch.customs_estimated_kmf,
          ch.customs_real_kmf,
          ch.customs_delta_pct,
          ch.is_anomaly,
          ch.notes,
          u.full_name AS agent_name
        FROM customs_history ch
        LEFT JOIN orders   o ON o.id = ch.order_id
        LEFT JOIN products p ON p.id = o.product_id
        LEFT JOIN users    u ON u.id = ch.customs_agent_id
        WHERE ${where}
        ORDER BY ch.created_at DESC
        LIMIT 100
      `, params),

      // Statistiques par catégorie
      db.query(`
        SELECT
          p.category,
          COUNT(ch.id)                                    AS passages,
          ROUND(AVG(ch.customs_estimated_kmf))            AS avg_estimated,
          ROUND(AVG(ch.customs_real_kmf))                 AS avg_real,
          ROUND(AVG(ch.customs_delta_pct), 2)             AS avg_delta_pct,
          COUNT(*) FILTER (WHERE ch.is_anomaly = TRUE)    AS anomalies
        FROM customs_history ch
        LEFT JOIN orders   o ON o.id = ch.order_id
        LEFT JOIN products p ON p.id = o.product_id
        WHERE ch.created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY p.category
        ORDER BY avg_delta_pct DESC NULLS LAST
      `, [days]),

      // Anomalies récentes
      db.query(`
        SELECT
          ch.created_at, o.reference, p.category,
          ch.customs_estimated_kmf, ch.customs_real_kmf, ch.customs_delta_pct,
          ch.notes
        FROM customs_history ch
        LEFT JOIN orders   o ON o.id = ch.order_id
        LEFT JOIN products p ON p.id = o.product_id
        WHERE ch.is_anomaly = TRUE
          AND ch.created_at >= NOW() - ($1 || ' days')::INTERVAL
        ORDER BY ch.customs_delta_pct DESC
        LIMIT 20
      `, [days]),
    ]);

    res.json({
      history,
      by_category:   byCategory,
      anomalies,
      period_days:   Number(days),
    });

  } catch (err) {
    console.error('Customs history error:', err.message);
    res.status(500).json({ error: 'Erreur historique douane' });
  }
});

// ─── GET /api/admin/alerts ───────────────────────────────────────────────────

router.get('/alerts', ...guard, async (req, res) => {
  try {
    const [
      { rows: marginAlerts },
      { rows: customsAnomalies },
      { rows: sourcingBlocked },
    ] = await Promise.all([
      db.query(`
        SELECT o.reference, o.status, o.total_kmf, o.margin_real_pct,
               p.name AS product_name
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.margin_alert = TRUE AND o.status NOT IN ('cancelled','collected')
        ORDER BY o.margin_real_pct ASC NULLS LAST
        LIMIT 20
      `),
      db.query(`
        SELECT ch.created_at, o.reference, p.category,
               ch.customs_real_kmf, ch.customs_delta_pct
        FROM customs_history ch
        LEFT JOIN orders   o ON o.id = ch.order_id
        LEFT JOIN products p ON p.id = o.product_id
        WHERE ch.is_anomaly = TRUE
          AND ch.created_at >= NOW() - INTERVAL '30 days'
        ORDER BY ch.created_at DESC
        LIMIT 10
      `),
      db.query(`
        SELECT o.reference, o.status, o.total_kmf, o.margin_real_pct,
               p.name AS product_name
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.sourcing_blocked = TRUE
          AND o.status NOT IN ('cancelled','collected')
        ORDER BY o.created_at DESC
        LIMIT 10
      `),
    ]);

    res.json({
      margin_alerts:      marginAlerts,
      customs_anomalies:  customsAnomalies,
      sourcing_blocked:   sourcingBlocked,
      total_alerts:       marginAlerts.length + customsAnomalies.length + sourcingBlocked.length,
    });

  } catch (err) {
    console.error('Alerts error:', err.message);
    res.status(500).json({ error: 'Erreur alertes' });
  }
});

// ─── GET /api/admin/partners ─────────────────────────────────────────────────

router.get('/partners', ...guard, async (req, res) => {
  try {
    const { type, island } = req.query;

    const conditions = ['1=1'];
    const params     = [];
    let   pi         = 1;

    if (type) {
      conditions.push(`partner_type = $${pi++}`);
      params.push(type);
    }
    if (island) {
      conditions.push(`island = $${pi++}`);
      params.push(island);
    }

    const { rows } = await db.query(
      `SELECT * FROM partners WHERE ${conditions.join(' AND ')} ORDER BY partner_type, name`,
      params
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur partenaires' });
  }
});

// ─── POST /api/admin/partners ────────────────────────────────────────────────

router.post('/partners', ...guard, async (req, res) => {
  try {
    const {
      name, partner_type, contact_name, contact_phone, contact_email,
      address, island, zone, commission_kmf, notes, is_active = true,
    } = req.body;

    if (!name || !partner_type) {
      return res.status(400).json({ error: 'name et partner_type obligatoires' });
    }

    const { rows: [partner] } = await db.query(
      `INSERT INTO partners
         (name, partner_type, contact_name, contact_phone, contact_email,
          address, island, zone, commission_kmf, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [name, partner_type, contact_name, contact_phone, contact_email,
       address, island, zone, commission_kmf, notes, is_active]
    );

    res.status(201).json(partner);
  } catch (err) {
    console.error('Create partner error:', err.message);
    res.status(500).json({ error: 'Erreur création partenaire' });
  }
});

// ─── PUT /api/admin/partners/:id ─────────────────────────────────────────────

router.put('/partners/:id', ...guard, async (req, res) => {
  try {
    const fields = [
      'name', 'partner_type', 'contact_name', 'contact_phone', 'contact_email',
      'address', 'island', 'zone', 'commission_kmf', 'notes', 'is_active',
    ];

    const updates = [];
    const values  = [];
    let   pi      = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${pi++}`);
        values.push(req.body[field]);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    values.push(req.params.id);
    const { rows: [partner] } = await db.query(
      `UPDATE partners SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${pi} RETURNING *`,
      values
    );

    if (!partner) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json(partner);
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour partenaire' });
  }
});

module.exports = router;
