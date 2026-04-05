/**
 * KOMERCE — Back-office Admin v7.1
 *
 * Toutes les routes sont protégées : authenticate + requireRole(['admin'])
 *
 * GET    /api/admin/dashboard         → KPIs globaux
 * GET    /api/admin/orders            → toutes les commandes + filtres
 * DELETE /api/admin/orders/:id        → supprimer une commande par ID
 * GET    /api/admin/margins           → dashboard marge réelle
 * GET    /api/admin/customs           → historique douane
 * GET    /api/admin/partners          → gestion partenaires / relais
 * POST   /api/admin/partners         → créer un partenaire
 * PUT    /api/admin/partners/:id     → modifier un partenaire
 * GET    /api/admin/alerts            → alertes marge négative + anomalies douane
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { admin } = require('../validators');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/dashboard ────────────────────────────────────────────────

router.get('/dashboard', ...guard, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));

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

      // Top produits — pivoté depuis order_items pour éviter de compter
      // les commandes sans articles (LEFT JOIN → résultats faussés)
      db.query(`
        SELECT
          p.name,
          p.category,
          COUNT(DISTINCT oi.order_id)      AS order_count,
          SUM(oi.quantity)                 AS units_sold,
          SUM(oi.price_kmf * oi.quantity)  AS revenue_kmf
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o   ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - ($1 || ' days')::INTERVAL
          AND o.status != 'cancelled'
        GROUP BY p.id, p.name, p.category
        ORDER BY units_sold DESC
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
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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
         rc.full_name AS recipient_name,
         rc.phone     AS recipient_phone,
         o.created_at, o.ordered_at, o.purchasing_at, o.preparation_at,
         o.shipped_at, o.available_at, o.collected_at, o.cash_paid_at,
         p.name   AS product_name, p.category,
         u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         r.name   AS relais_name, r.zone AS relais_zone
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN users    u ON u.id = o.user_id
       LEFT JOIN relais   r ON r.id = o.relais_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
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

// ─── DELETE /api/admin/orders/:id — Supprimer une commande ───────────────────

router.delete('/orders/:id', ...guard, async (req, res) => {
  const { id } = req.params;

  try {
    // Vérifier que la commande existe
    const { rows: [order] } = await db.query(
      'SELECT id, reference, status FROM orders WHERE id = $1',
      [id]
    );

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Supprimer dans l'ordre des dépendances
    await db.query('DELETE FROM order_items WHERE order_id = $1', [id]);

    try {
      await db.query('DELETE FROM order_status_history WHERE order_id = $1', [id]);
    } catch (_) { /* table may not exist */ }

    try {
      await db.query('DELETE FROM customs_history WHERE order_id = $1::text', [id]);
    } catch (_) { /* table may not exist */ }

    await db.query('DELETE FROM orders WHERE id = $1', [id]);

    console.log(`🗑️ Admin deleted order ${order.reference} (${id}) by ${req.user.email}`);
    res.json({
      success: true,
      message: `Commande ${order.reference} supprimée`,
      deleted: { id, reference: order.reference, status: order.status },
    });

  } catch (err) {
    console.error('Delete order error:', err.message);
    res.status(500).json({ error: 'Erreur suppression commande' });
  }
});

// ─── GET /api/admin/margins — dashboard marge réelle ─────────────────────────

router.get('/margins', ...guard, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));

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
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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
    const { category, anomaly_only } = req.query;
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 90));

    const conditions = [`ch.created_at >= NOW() - ($1 || ' days')::INTERVAL`];
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
        LEFT JOIN orders   o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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
        LEFT JOIN orders   o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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
        LEFT JOIN orders   o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.margin_alert = TRUE AND o.status NOT IN ('cancelled','collected')
        ORDER BY o.margin_real_pct ASC NULLS LAST
        LIMIT 20
      `),
      db.query(`
        SELECT ch.created_at, o.reference, p.category,
               ch.customs_real_kmf, ch.customs_delta_pct
        FROM customs_history ch
        LEFT JOIN orders   o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE ch.is_anomaly = TRUE
          AND ch.created_at >= NOW() - INTERVAL '30 days'
        ORDER BY ch.created_at DESC
        LIMIT 10
      `),
      db.query(`
        SELECT o.reference, o.status, o.total_kmf, o.margin_real_pct,
               p.name AS product_name
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
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

router.post('/partners', ...guard, validate(admin.createPartner), async (req, res) => {
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

router.put('/partners/:id', ...guard, validate(admin.updatePartner), async (req, res) => {
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


// ─── POST /api/admin/reset — Nettoyage données (3 modes) ────────────────────
// mode = "orders"  → supprime commandes + items + douane + recipients (défaut)
// mode = "users"   → idem + supprime clients (sauf admin)
// mode = "factory" → tout reset + re-seed produits & relais depuis zéro

router.post('/reset', ...guard, validate(admin.reset), async (req, res) => {
  const mode = req.body.mode || 'orders';
  const validModes = ['orders', 'users', 'factory'];

  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: `Mode invalide. Utilisez: ${validModes.join(', ')}` });
  }

  const report = { mode, deleted: {}, reseeded: [], timestamp: new Date().toISOString() };

  try {
    // ── Étape 1 : Toujours supprimer commandes + dépendances ──
    const items   = await db.query('DELETE FROM order_items RETURNING id');
    report.deleted.order_items = items.rowCount;

    try {
      const customs = await db.query('DELETE FROM customs_history RETURNING id');
      report.deleted.customs_history = customs.rowCount;
    } catch (_) { report.deleted.customs_history = 'table absente'; }

    const orders  = await db.query('DELETE FROM orders RETURNING id');
    report.deleted.orders = orders.rowCount;

    try {
      const recip = await db.query('DELETE FROM recipients RETURNING id');
      report.deleted.recipients = recip.rowCount;
    } catch (_) { report.deleted.recipients = 'table absente'; }

    // ── Étape 2 : Mode users/factory → supprimer clients non-admin ──
    if (mode === 'users' || mode === 'factory') {
      const users = await db.query("DELETE FROM users WHERE role != 'admin' RETURNING id");
      report.deleted.users_non_admin = users.rowCount;
    }

    // ── Étape 3 : Mode factory → vider + re-seed complet ──
    if (mode === 'factory') {
      const prods = await db.query('DELETE FROM products RETURNING id');
      report.deleted.products = prods.rowCount;

      const rels = await db.query('DELETE FROM relais RETURNING id');
      report.deleted.relais = rels.rowCount;

      try {
        const parts = await db.query('DELETE FROM partners RETURNING id');
        report.deleted.partners = parts.rowCount;
      } catch (_) { /* table may not exist */ }

      // Re-seed 20 produits
      const seedProducts = [
        ['Samsung Galaxy A35 (128Go)', 99000, 200, 'electronics', 15, '📱', 'Populaire', 'Écran AMOLED 6.6", 50MP, double SIM, batterie 5000mAh.'],
        ['Écouteurs Samsung Galaxy Buds2', 39600, 80, 'electronics', 20, '🎧', null, 'Réduction de bruit active, 5h autonomie.'],
        ['Pack coques + accessoires (5 pièces)', 14850, 30, 'electronics', 30, '📱', 'Nouveau', 'Coque + verre + chargeur 25W + câble + support.'],
        ['Chargeur rapide 65W GaN (multi-ports)', 19800, 40, 'electronics', 25, '🔌', null, '3 ports, compact.'],
        ['Ventilateur sur pied 16"', 24750, 50, 'home', 25, '🌀', 'Best-seller', 'Oscillant 3 vitesses, silencieux.'],
        ['Fer à repasser vapeur 2400W', 17325, 35, 'home', 18, '👕', null, 'Semelle céramique, réservoir 300ml.'],
        ['Multiprise 6 prises + 2 USB', 9900, 20, 'home', 35, '🔌', null, 'Câble 2m, disjoncteur sécurité.'],
        ['Bouilloire électrique 1.7L inox', 12375, 25, 'home', 22, '☕', null, 'Arrêt auto, protection anti-surchauffe.'],
        ['Montre homme acier brossé', 99000, 200, 'wedding', 8, '⌚', 'Exclusif', 'Boîtier 42mm, étanchéité 50m.'],
        ['Collier or 18K (8g)', 277200, 560, 'wedding', 5, '📿', 'Premium', 'Or 18 carats certifié Dubai.'],
        ['Parfum Oud Al Shuyukh 100ml', 59400, 120, 'wedding', 12, '🌹', null, 'Notes de oud, ambre et rose. 12h+.'],
        ['Coffret cadeau mariage (4 pièces)', 49500, 100, 'wedding', 15, '🎁', 'Populaire', 'Parfum + crème + savon + bracelet.'],
        ['Djellaba homme brodée (L/XL/XXL)', 34650, 70, 'fashion', 20, '🧥', 'Best-seller', 'Tissu Bazin premium.'],
        ['Abaya femme dentelle Dubai (M/L/XL)', 39600, 80, 'fashion', 15, '👗', 'Populaire', 'Tissu crêpe fluide.'],
        ['Boubou enfant 3-12 ans', 19800, 40, 'fashion', 18, '👕', null, 'Tissu wax africain.'],
        ['Caftan femme soiree (S/M/L/XL)', 54450, 110, 'fashion', 10, '🥻', 'Nouveau', 'Tissu satiné, perles.'],
        ['Crème visage éclat au safran', 24750, 50, 'services', 20, '✨', null, 'Safran + vitamine C. 50ml.'],
        ['Parfum Oud Rose (50ml)', 34650, 70, 'services', 18, '🌸', 'Best-seller', 'Concentrée 20%, oud boisé.'],
        ['Huile argan pure Maroc (100ml)', 17325, 35, 'services', 25, '💧', null, 'Argan bio, pressée à froid.'],
        ['Coffret soins corps luxe (5 pièces)', 44550, 90, 'services', 12, '🧴', 'Nouveau', 'Gommage + lait + huile + karité + savon.'],
      ];

      for (const p of seedProducts) {
        await db.query(
          `INSERT INTO products (name, price_kmf, price_eur, category, stock, emoji, badge, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          p
        );
      }
      report.reseeded.push('products (20)');

      // Re-seed 5 relais
      const seedRelais = [
        ['Relais Moroni Centre', 'Avenue de la République, Moroni', 'Moroni centre', 'Grande Comore', '0321001001'],
        ['Relais Mutsamudu Centre', 'Rue du Port, Mutsamudu', 'Mutsamudu centre', 'Anjouan', '0321002002'],
        ['Relais Fomboni', 'Place du Marché, Fomboni', 'Fomboni centre', 'Mohéli', '0321003003'],
        ['Relais Domoni', 'Centre-ville, Domoni', 'Domoni', 'Anjouan', '0321004004'],
        ['Relais Sima', 'Route principale, Sima', 'Sima', 'Anjouan', '0321005005'],
      ];

      for (const r of seedRelais) {
        await db.query(
          'INSERT INTO relais (name, address, zone, island, phone, is_active) VALUES ($1,$2,$3,$4,$5,TRUE)',
          r
        );
      }
      report.reseeded.push('relais (5)');
    }

    // Mode orders/users : remonter les stocks faibles
    if (mode !== 'factory') {
      const restocked = await db.query('UPDATE products SET stock = 15 WHERE stock < 5 RETURNING id');
      if (restocked.rowCount > 0) {
        report.restocked = restocked.rowCount;
      }
    }

    console.log(`🧹 Admin reset "${mode}" effectué par ${req.user.email}`);
    res.json({ success: true, message: `Reset "${mode}" effectué avec succès ✅`, ...report });

  } catch (err) {
    console.error('Reset error:', err.message);
    res.status(500).json({ error: 'Erreur reset : ' + err.message });
  }
});

// ─── GET /api/admin/counts — Vue rapide avant reset ──────────────────────────

router.get('/counts', ...guard, async (req, res) => {
  try {
    const [orders, items, products, relais, users] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS c FROM orders'),
      db.query('SELECT COUNT(*)::int AS c FROM order_items'),
      db.query('SELECT COUNT(*)::int AS c FROM products'),
      db.query('SELECT COUNT(*)::int AS c FROM relais'),
      db.query("SELECT COUNT(*)::int AS c FROM users WHERE role != 'admin'"),
    ]);

    res.json({
      orders:     orders.rows[0].c,
      order_items: items.rows[0].c,
      products:   products.rows[0].c,
      relais:     relais.rows[0].c,
      users_non_admin: users.rows[0].c,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur counts' });
  }
});


// ─── POST /api/admin/seed-test — Jeu de données réaliste (28 commandes / 3 mois) ───

router.post('/seed-test', ...guard, validate(admin.seedTest), async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');

  try {
    const { confirm, months = 3 } = req.body;
    if (!confirm) return res.status(400).json({
      error: 'Envoyez { "confirm": true } pour confirmer le seed'
    });

    // ── 1. Charger produits & relais existants ────────────────────────────
    const { rows: products } = await db.query(
      'SELECT id, name, sku, price_kmf, cost_kmf, weight_kg, price_aed, customs_risk_coeff FROM products WHERE is_active = TRUE ORDER BY sku'
    );
    const { rows: relaisList } = await db.query(
      'SELECT id, name FROM relais WHERE is_active = TRUE ORDER BY name'
    );

    if (!products.length || !relaisList.length) {
      return res.status(400).json({ error: 'Aucun produit ou relais — lancez le seed initial d\'abord' });
    }

    const testHash = await bcrypt.hash('Test123!', 10);

    // ── 2. Créer 5 clients test (diaspora + locaux) ──────────────────────
    const testClients = [
      { full_name: 'Amina Soilihi',      email: 'amina.test@komerce.km',    phone: '+33699001001', country: 'FR', cur: 'EUR' },
      { full_name: 'Youssouf Abdallah',  email: 'youssouf.test@komerce.km', phone: '+97155001001', country: 'AE', cur: 'AED' },
      { full_name: 'Mariama Combo',      email: 'mariama.test@komerce.km',  phone: '+269321901',   country: 'KM', cur: 'KMF' },
      { full_name: 'Hassan Mchangama',   email: 'hassan.test@komerce.km',   phone: '+33699002002', country: 'FR', cur: 'EUR' },
      { full_name: 'Zainaba Toihir',     email: 'zainaba.test@komerce.km',  phone: '+269321902',   country: 'KM', cur: 'KMF' },
    ];

    const userIds = [];
    for (const tc of testClients) {
      const { rows } = await db.query(
        `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
         VALUES ($1, $2, $3, 'client', $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [tc.full_name, tc.email, tc.phone, tc.cur, tc.country, testHash]
      );
      userIds.push(rows[0].id);
    }

    // ── 3. Créer recipients (un par client, relais tournant) ─────────────
    const recipientIds = [];
    for (let i = 0; i < testClients.length; i++) {
      const rl = relaisList[i % relaisList.length];
      // Upsert: on cherche d'abord un existant
      const { rows: existing } = await db.query(
        'SELECT id FROM recipients WHERE user_id = $1 AND relais_id = $2 LIMIT 1',
        [userIds[i], rl.id]
      );
      if (existing.length) {
        recipientIds.push(existing[0].id);
      } else {
        const { rows } = await db.query(
          `INSERT INTO recipients (user_id, full_name, phone, relais_id, is_default)
           VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
          [userIds[i], testClients[i].full_name, testClients[i].phone, rl.id]
        );
        recipientIds.push(rows[0].id);
      }
    }

    // ── 4. Définir les 28 scénarios de commande ──────────────────────────
    // clientIdx → index dans userIds
    // pItems → [{pidx, qty}] → pidx = index dans products[]
    // transport/douane en KMF (renseignés pour shipped+)
    const P = Math.min(products.length, 4);  // max 4 produits
    const scenarios = [
      // Anciennes → collected (5)
      { days: 85, ci: 0, items: [{p:0,q:1}],           st:'collected',       pay:'stripe_eur',  tr:8000,  dou:12000 },
      { days: 82, ci: 1, items: [{p:2%P,q:2}],         st:'collected',       pay:'stripe_eur',  tr:5000,  dou:8000  },
      { days: 80, ci: 2, items: [{p:3%P,q:1}],         st:'collected',       pay:'cash_relais', tr:12000, dou:18000 },
      { days: 75, ci: 3, items: [{p:0,q:1},{p:2%P,q:1}], st:'collected',     pay:'stripe_eur',  tr:10000, dou:15000 },
      { days: 70, ci: 4, items: [{p:1%P,q:2}],         st:'collected',       pay:'cash_relais', tr:7000,  dou:10000 },
      // Available au relais (4)
      { days: 65, ci: 0, items: [{p:1%P,q:1},{p:3%P,q:1}], st:'available',   pay:'stripe_eur',  tr:10000, dou:16000 },
      { days: 60, ci: 2, items: [{p:0,q:1}],           st:'available',       pay:'cash_relais', tr:8000,  dou:12000 },
      { days: 55, ci: 1, items: [{p:3%P,q:1}],         st:'available',       pay:'stripe_eur',  tr:12000, dou:18000 },
      { days: 52, ci: 3, items: [{p:2%P,q:3}],         st:'available',       pay:'stripe_eur',  tr:6000,  dou:9000  },
      // Transit / Shipped (4)
      { days: 48, ci: 4, items: [{p:0,q:1},{p:1%P,q:1}], st:'transit_comores', pay:'cash_relais', tr:9000, dou:14000 },
      { days: 45, ci: 0, items: [{p:2%P,q:1}],         st:'shipped',         pay:'stripe_eur',  tr:5000,  dou:0     },
      { days: 42, ci: 2, items: [{p:1%P,q:3}],         st:'shipped',         pay:'cash_relais', tr:8000,  dou:0     },
      { days: 38, ci: 1, items: [{p:0,q:2}],           st:'hub_preparation', pay:'stripe_eur',  tr:0,     dou:0     },
      // Preparation (2)
      { days: 35, ci: 3, items: [{p:3%P,q:1},{p:1%P,q:1}], st:'preparation', pay:'stripe_eur', tr:0, dou:0 },
      { days: 32, ci: 4, items: [{p:2%P,q:2}],         st:'preparation',     pay:'cash_relais', tr:0, dou:0 },
      // Purchasing (3)
      { days: 28, ci: 0, items: [{p:3%P,q:1}],         st:'purchasing',      pay:'stripe_eur',  tr:0, dou:0 },
      { days: 25, ci: 2, items: [{p:0,q:1},{p:2%P,q:1}], st:'purchasing',    pay:'cash_relais', tr:0, dou:0 },
      { days: 22, ci: 1, items: [{p:1%P,q:1}],         st:'purchasing',      pay:'stripe_eur',  tr:0, dou:0 },
      // Ordered / Paid (4)
      { days: 18, ci: 3, items: [{p:2%P,q:1},{p:3%P,q:1}], st:'ordered',     pay:'stripe_eur',  tr:0, dou:0 },
      { days: 15, ci: 4, items: [{p:0,q:1}],           st:'ordered',         pay:'cash_relais', tr:0, dou:0 },
      { days: 12, ci: 0, items: [{p:1%P,q:2}],         st:'paid',            pay:'stripe_eur',  tr:0, dou:0 },
      { days: 10, ci: 2, items: [{p:3%P,q:1}],         st:'paid',            pay:'cash_relais', tr:0, dou:0 },
      // Confirmed (4)
      { days: 8,  ci: 1, items: [{p:0,q:1},{p:1%P,q:1}], st:'confirmed',     pay:'stripe_eur',  tr:0, dou:0 },
      { days: 5,  ci: 3, items: [{p:2%P,q:2}],         st:'confirmed',       pay:'stripe_eur',  tr:0, dou:0 },
      { days: 2,  ci: 0, items: [{p:0,q:3}],           st:'confirmed',       pay:'stripe_eur',  tr:0, dou:0 },
      { days: 1,  ci: 2, items: [{p:1%P,q:1},{p:2%P,q:1}], st:'confirmed',   pay:'cash_relais', tr:0, dou:0 },
      { days: 0,  ci: 1, items: [{p:3%P,q:2}],         st:'confirmed',       pay:'stripe_eur',  tr:0, dou:0 },
      // Cancelled (1)
      { days: 3,  ci: 4, items: [{p:3%P,q:1}],         st:'cancelled',       pay:'cash_relais', tr:0, dou:0 },
    ];

    // ── 5. Créer les commandes ───────────────────────────────────────────
    let ordersCreated = 0;
    let totalRevenue = 0;
    const EUR_KMF = 492;

    // Helper: generate ref
    const genRef = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      return 'KT' + Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    };

    // Status → payment_status mapping
    const payStatusMap = {
      confirmed: 'pending', paid: 'paid', ordered: 'paid',
      purchasing: 'paid', preparation: 'paid', hub_preparation: 'paid',
      shipped: 'paid', transit_comores: 'paid', available: 'paid',
      collected: 'paid', cancelled: 'failed',
    };

    for (const sc of scenarios) {
      const userId = userIds[sc.ci];
      const recipientId = recipientIds[sc.ci];
      const relaisId = relaisList[sc.ci % relaisList.length].id;

      // Calculate total
      let total_kmf = 0;
      let cost_est = 0;
      const orderItems = [];

      for (const itm of sc.items) {
        const prod = products[itm.p % products.length];
        const subtotal = prod.price_kmf * itm.q;
        total_kmf += subtotal;
        const baseCost = prod.cost_kmf || Math.round(prod.price_kmf * 0.65);
        cost_est += baseCost * itm.q;
        orderItems.push({ product_id: prod.id, qty: itm.q, price_kmf: prod.price_kmf });
      }

      const margin_est = total_kmf > 0
        ? parseFloat(((total_kmf - cost_est) / total_kmf * 100).toFixed(2))
        : 0;

      // Cost real for advanced statuses (add some variance)
      const advancedStatuses = ['shipped','transit_comores','available','collected'];
      const costReal = advancedStatuses.includes(sc.st)
        ? Math.round(cost_est * (0.85 + Math.random() * 0.3))  // ±15% variance
        : null;

      const ref = genRef();
      const orderId = uuidv4();
      const createdAt = `NOW() - INTERVAL '${sc.days} days'`;
      const payStatus = payStatusMap[sc.st] || 'pending';

      // Timestamp fields based on status progression
      let shippedAt   = 'NULL';
      let availableAt = 'NULL';
      let collectedAt = 'NULL';
      let cancelledAt = 'NULL';

      if (['shipped','transit_comores','available','collected'].includes(sc.st)) {
        shippedAt = `NOW() - INTERVAL '${sc.days - 5} days'`;
      }
      if (['available','collected'].includes(sc.st)) {
        availableAt = `NOW() - INTERVAL '${sc.days - 20} days'`;
      }
      if (sc.st === 'collected') {
        collectedAt = `NOW() - INTERVAL '${sc.days - 25} days'`;
      }
      if (sc.st === 'cancelled') {
        cancelledAt = `NOW() - INTERVAL '${sc.days - 1} days'`;
      }

      // Insert order
      await db.query(
        `INSERT INTO orders (
           id, reference, user_id, recipient_id, relais_id,
           total_kmf, total_eur,
           payment_mode, payment_status, status,
           cost_transport_kmf, cost_douane_kmf,
           cost_estimated_kmf, margin_estimated_pct,
           ${costReal !== null ? 'cost_real_kmf,' : ''}
           shipped_at, available_at, collected_at, cancelled_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7,
           $8, $9, $10,
           $11, $12,
           $13, $14,
           ${costReal !== null ? '$15,' : ''}
           ${shippedAt}, ${availableAt}, ${collectedAt}, ${cancelledAt},
           ${createdAt}, ${createdAt}
         )`,
        [
          orderId, ref, userId, recipientId, relaisId,
          total_kmf, parseFloat((total_kmf / EUR_KMF).toFixed(2)),
          sc.pay, payStatus, sc.st,
          sc.tr, sc.dou,
          cost_est, margin_est,
          ...(costReal !== null ? [costReal] : []),
        ]
      );

      // Insert order items
      for (const oi of orderItems) {
        await db.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price_kmf, created_at)
           VALUES ($1, $2, $3, $4, ${createdAt})`,
          [orderId, oi.product_id, oi.qty, oi.price_kmf]
        );
      }

      // Insert status history
      await db.query(
        `INSERT INTO order_status_history (order_id, status, note, created_at)
         VALUES ($1, $2, $3, ${createdAt})`,
        [orderId, sc.st, 'Seed test — donnée générée automatiquement']
      );

      ordersCreated++;
      totalRevenue += total_kmf;
    }

    // ── 6. Summary ───────────────────────────────────────────────────────
    const { rows: counts } = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'collected')::int AS collected,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status IN ('shipped','transit_comores'))::int AS in_transit,
        COUNT(*) FILTER (WHERE status IN ('preparation','hub_preparation'))::int AS in_prep,
        COUNT(*) FILTER (WHERE status IN ('purchasing','ordered','paid','confirmed'))::int AS early,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        SUM(total_kmf)::int AS revenue_kmf,
        ROUND(AVG(margin_estimated_pct), 2) AS avg_margin
      FROM orders
      WHERE reference LIKE 'KT%'
    `);

    res.json({
      success: true,
      message: `${ordersCreated} commandes test créées sur ${months} mois`,
      clients_created: testClients.map(c => c.full_name),
      password: 'Test123!',
      summary: counts.rows ? counts.rows[0] : counts[0],
    });

  } catch (err) {
    console.error('Seed-test error:', err.message);
    res.status(500).json({ error: 'Erreur seed-test : ' + err.message });
  }
});

module.exports = router;
