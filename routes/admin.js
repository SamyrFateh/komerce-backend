/**
 * KOMERCE — Back-office Admin v8.1 (uuid cast fix)
 *
 * Toutes les routes sont protégées : authenticate + requireRole(['admin'])
 *
 * GET    /api/admin/orders            → toutes les commandes + filtres
 * DELETE /api/admin/orders/:id        → supprimer une commande par ID
 * GET    /api/admin/customs           → historique douane
 * GET    /api/admin/partners          → gestion partenaires / relais
 * POST   /api/admin/partners         → créer un partenaire
 * PUT    /api/admin/partners/:id     → modifier un partenaire
 * GET    /api/admin/users             → liste utilisateurs + filtres
 * POST   /api/admin/users             → créer un utilisateur
 * PUT    /api/admin/users/:id/role    → changer le rôle
 * PUT    /api/admin/users/:id/password → réinitialiser MDP
 * DELETE /api/admin/users/:id         → supprimer (soft/hard selon dépendances)
 * GET    /api/admin/counts            → compteurs globaux
 * POST   /api/admin/reset             → reset base (dangereux)
 * POST   /api/admin/seed-test         → seed données test (tous statuts)
 *
 * NOTE: user_role enum DB = ('client', 'admin', 'agent_relais', 'agent_hub')
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { admin } = require('../validators');

const guard = [authenticate, requireRole(['admin'])];

// Valeurs valides du enum user_role en DB
const VALID_ROLES = ['client', 'agent_relais', 'agent_hub', 'admin'];

// Helper : supprime tous les enregistrements liés à une commande
// ⚠️  Tous les $1 sont castés ::uuid — node-postgres passe les UUID comme text,
// PostgreSQL strict refuse uuid = text sans cast explicite.
async function deleteOrderCascade(client_or_db, id) {
  // 1. parcel_items liés aux order_items de cette commande
  await client_or_db.query(
    `DELETE FROM parcel_items
     WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1::uuid)`,
    [id]
  );
  // 2. parcel_items liés aux parcels de cette commande (FK parcel_id)
  await client_or_db.query(
    `DELETE FROM parcel_items
     WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id = $1::uuid)`,
    [id]
  );
  // 3. parcels de cette commande
  await client_or_db.query('DELETE FROM parcels WHERE order_id = $1::uuid', [id]);
  // 4. order_items (plus rien ne les référence)
  await client_or_db.query('DELETE FROM order_items WHERE order_id = $1::uuid', [id]);
  // 5. historiques
  await client_or_db.query('DELETE FROM order_status_history WHERE order_id = $1::uuid', [id]);
  // customs_history.order_id est TEXT (pas UUID) — cast ::text
  await client_or_db.query(
    `DELETE FROM customs_history WHERE order_id = $1::text`,
    [id]
  );
  // 6. commande elle-même
  await client_or_db.query('DELETE FROM orders WHERE id = $1::uuid', [id]);
}


// ─── GET /api/admin/orders ───────────────────────────────────────────────────────────────

router.get('/orders', ...guard, async (req, res) => {
  try {
    const {
      status, payment_mode, confection_type, from_date, to_date,
      search, margin_alert, limit = 50, offset = 0,
    } = req.query;

    const conditions = ['1=1'];
    const params     = [];
    let   pi         = 1;

    if (status)           { conditions.push(`o.status = $${pi++}`); params.push(status); }
    if (payment_mode)     { conditions.push(`o.payment_mode = $${pi++}`); params.push(payment_mode); }
    if (confection_type)  { conditions.push(`o.confection_type = $${pi++}`); params.push(confection_type); }
    if (from_date)        { conditions.push(`o.created_at >= $${pi++}`); params.push(from_date); }
    if (to_date)          { conditions.push(`o.created_at <= $${pi++}`); params.push(to_date); }
    if (margin_alert === 'true') { conditions.push('o.margin_alert = TRUE'); }
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
         rc.full_name AS recipient_name, rc.phone AS recipient_phone,
         o.created_at, o.ordered_at, o.purchasing_at, o.preparation_at,
         o.shipped_at, o.available_at, o.collected_at, o.cash_paid_at,
         p.name AS product_name, p.category,
         u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         r.name AS relais_name, r.zone AS relais_zone
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

// ─── DELETE /api/admin/orders/:id ───────────────────────────────────────────────────────────────

router.delete('/orders/:id', ...guard, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [order] } = await db.query('SELECT id, reference, status FROM orders WHERE id = $1::uuid', [id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    await deleteOrderCascade(db, id);

    console.log(`🗑️ Admin deleted order ${order.reference} (${id}) by ${req.user.email}`);
    res.json({
      success: true,
      message: `Commande ${order.reference} supprimée`,
      deleted: { id, reference: order.reference, status: order.status },
    });
  } catch (err) {
    console.error('Delete order error:', err.message, err.detail);
    res.status(500).json({ error: 'Erreur suppression commande', detail: err.message });
  }
});


// ─── GET /api/admin/customs ───────────────────────────────────────────────────────────────

router.get('/customs', ...guard, async (req, res) => {
  try {
    const { category, anomaly_only } = req.query;
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 90));
    const conditions = [`ch.created_at >= NOW() - ($1 || ' days')::INTERVAL`];
    const params = [days];
    let pi = 2;
    if (category) { conditions.push(`p.category = $${pi++}`); params.push(category); }
    if (anomaly_only === 'true') { conditions.push('ch.is_anomaly = TRUE'); }
    const where = conditions.join(' AND ');
    const [{ rows: history }, { rows: byCategory }, { rows: anomalies }] = await Promise.all([
      db.query(`SELECT ch.id, ch.created_at, o.reference, p.name AS product_name, p.category,
          ch.customs_estimated_kmf, ch.customs_real_kmf, ch.customs_delta_pct, ch.is_anomaly, ch.notes,
          u.full_name AS agent_name
        FROM customs_history ch
        LEFT JOIN orders o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN users u ON u.id = ch.customs_agent_id
        WHERE ${where} ORDER BY ch.created_at DESC LIMIT 100`, params),
      db.query(`SELECT p.category, COUNT(ch.id) AS passages,
          ROUND(AVG(ch.customs_estimated_kmf)) AS avg_estimated,
          ROUND(AVG(ch.customs_real_kmf)) AS avg_real,
          ROUND(AVG(ch.customs_delta_pct), 2) AS avg_delta_pct,
          COUNT(*) FILTER (WHERE ch.is_anomaly = TRUE) AS anomalies
        FROM customs_history ch
        LEFT JOIN orders o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE ch.created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY p.category ORDER BY avg_delta_pct DESC NULLS LAST`, [days]),
      db.query(`SELECT ch.created_at, o.reference, p.category,
          ch.customs_estimated_kmf, ch.customs_real_kmf, ch.customs_delta_pct, ch.notes
        FROM customs_history ch
        LEFT JOIN orders o ON o.id = ch.order_id::uuid
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE ch.is_anomaly = TRUE AND ch.created_at >= NOW() - ($1 || ' days')::INTERVAL
        ORDER BY ch.customs_delta_pct DESC LIMIT 20`, [days]),
    ]);
    res.json({ history, by_category: byCategory, anomalies, period_days: Number(days) });
  } catch (err) {
    console.error('Customs history error:', err.message);
    res.status(500).json({ error: 'Erreur historique douane' });
  }
});


// ─── GET /api/admin/partners ───────────────────────────────────────────────────────────────

router.get('/partners', ...guard, async (req, res) => {
  try {
    const { type, island } = req.query;
    const conditions = ['1=1'];
    const params = [];
    let pi = 1;
    if (type)   { conditions.push(`partner_type = $${pi++}`); params.push(type); }
    if (island) { conditions.push(`island = $${pi++}`); params.push(island); }
    const { rows } = await db.query(
      `SELECT * FROM partners WHERE ${conditions.join(' AND ')} ORDER BY partner_type, name`, params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur partenaires' });
  }
});

// ─── POST /api/admin/partners ────────────────────────────────────────────────────────────────

router.post('/partners', ...guard, validate(admin.createPartner), async (req, res) => {
  try {
    const { name, partner_type, contact_name, contact_phone, contact_email,
      address, island, zone, commission_kmf, notes, is_active = true } = req.body;
    if (!name || !partner_type) return res.status(400).json({ error: 'name et partner_type obligatoires' });
    const { rows: [partner] } = await db.query(
      `INSERT INTO partners (name, partner_type, contact_name, contact_phone, contact_email,
         address, island, zone, commission_kmf, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, partner_type, contact_name, contact_phone, contact_email, address, island, zone, commission_kmf, notes, is_active]
    );
    res.status(201).json(partner);
  } catch (err) {
    console.error('Create partner error:', err.message);
    res.status(500).json({ error: 'Erreur création partenaire' });
  }
});

// ─── PUT /api/admin/partners/:id ────────────────────────────────────────────────────────────────

router.put('/partners/:id', ...guard, validate(admin.updatePartner), async (req, res) => {
  try {
    const fields = ['name','partner_type','contact_name','contact_phone','contact_email','address','island','zone','commission_kmf','notes','is_active'];
    const updates = [], values = [];
    let pi = 1;
    for (const field of fields) {
      if (req.body[field] !== undefined) { updates.push(`${field} = $${pi++}`); values.push(req.body[field]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    values.push(req.params.id);
    const { rows: [partner] } = await db.query(
      `UPDATE partners SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${pi} RETURNING *`, values
    );
    if (!partner) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json(partner);
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour partenaire' });
  }
});

// ─── POST /api/admin/reset ──────────────────────────────────────────────────────────────────

router.post('/reset', ...guard, validate(admin.reset), async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'POST /admin/reset désactivé en production. Contactez le DevOps.' });

  const mode = req.body.mode || 'orders';
  const validModes = ['orders', 'users', 'factory'];
  if (!validModes.includes(mode)) return res.status(400).json({ error: `Mode invalide. Utilisez: ${validModes.join(', ')}` });
  const report = { mode, deleted: {}, reseeded: [], timestamp: new Date().toISOString() };
  try {
    const items = await db.query('DELETE FROM order_items RETURNING id');
    report.deleted.order_items = items.rowCount;
    try { const c = await db.query('DELETE FROM customs_history RETURNING id'); report.deleted.customs_history = c.rowCount; } catch (_) { report.deleted.customs_history = 'table absente'; }
    const orders = await db.query('DELETE FROM orders RETURNING id');
    report.deleted.orders = orders.rowCount;
    try { const r = await db.query('DELETE FROM recipients RETURNING id'); report.deleted.recipients = r.rowCount; } catch (_) { report.deleted.recipients = 'table absente'; }
    if (mode === 'users' || mode === 'factory') {
      const users = await db.query("DELETE FROM users WHERE role != 'admin' RETURNING id");
      report.deleted.users_non_admin = users.rowCount;
    }
    if (mode === 'factory') {
      await db.query('DELETE FROM products');
      await db.query('DELETE FROM relais');
      try { await db.query('DELETE FROM partners'); } catch (_) {}
      report.reseeded.push('factory reset (re-seed manual requis)');
    }
    if (mode !== 'factory') {
      const restocked = await db.query('UPDATE products SET stock = 15 WHERE stock < 5 RETURNING id');
      if (restocked.rowCount > 0) report.restocked = restocked.rowCount;
    }
    console.log(`🧹 Admin reset "${mode}" effectué par ${req.user.email}`);
    res.json({ success: true, message: `Reset "${mode}" effectué avec succès ✅`, ...report });
  } catch (err) {
    console.error('Reset error:', err.message);
    res.status(500).json({ error: 'Erreur reset : ' + err.message });
  }
});

// ─── GET /api/admin/counts ──────────────────────────────────────────────────────────────────

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
      orders: orders.rows[0].c, order_items: items.rows[0].c,
      products: products.rows[0].c, relais: relais.rows[0].c,
      users_non_admin: users.rows[0].c,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur counts' });
  }
});

// ─── POST /api/admin/seed-test ───────────────────────────────────────────────────────────────

router.post('/seed-test', ...guard, async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const { randomBytes } = require('crypto');
  const client = await db.getClient();

  const genPickup = () => {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 6 }, () => {
      let b;
      do { b = randomBytes(1)[0]; } while (b >= 216);
      return CHARS[b % 36];
    }).join('');
  };

  const ts = Date.now();
  let cashRefIdx = 0;
  const genCashRef = () => String(ts + (cashRefIdx++)).slice(-8);

  try {
    const { confirm } = req.body;
    if (!confirm) {
      return res.status(400).json({ error: 'Envoyez { "confirm": true } pour confirmer le seed' });
    }

    await client.query('BEGIN');

    const { rows: products } = await client.query(
      'SELECT id, name, price_kmf FROM products WHERE is_active = TRUE ORDER BY name LIMIT 1'
    );
    const { rows: relaisList } = await client.query(
      'SELECT id, name FROM relais WHERE is_active = TRUE LIMIT 1'
    );

    if (!products.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun produit actif — impossible de seeder' });
    }
    if (!relaisList.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun relais actif — impossible de seeder' });
    }

    const product = products[0];
    const relais  = relaisList[0];
    const adminId = req.user.id;

    const { rows: enumVals } = await client.query(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'order_status'`
    );
    const availableStatuses = new Set(enumVals.map(r => r.enumlabel));

    // Supprimer les commandes test précédentes
    const { rows: prevOrders } = await client.query(
      "SELECT id FROM orders WHERE reference LIKE 'KT-%'"
    );
    let deletedCount = 0;
    for (const po of prevOrders) {
      await deleteOrderCascade(client, po.id);
      deletedCount++;
    }

    const now     = new Date();
    const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();

    const allScenarios = [
      { status: 'confirmed',   ref: 'KT-CONFIRMED',   payment_mode: 'cash_relais', payment_status: 'pending',  ordered_at: null,        preparation_at: null,        shipped_at: null,        available_at: null,       collected_at: null,       cancelled_at: null },
      { status: 'ordered',     ref: 'KT-ORDERED',     payment_mode: 'cash_relais', payment_status: 'paid',     ordered_at: daysAgo(7),  preparation_at: null,        shipped_at: null,        available_at: null,       collected_at: null,       cancelled_at: null },
      { status: 'preparation', ref: 'KT-PREPARATION', payment_mode: 'cash_relais', payment_status: 'paid',     ordered_at: daysAgo(8),  preparation_at: daysAgo(6),  shipped_at: null,        available_at: null,       collected_at: null,       cancelled_at: null },
      { status: 'shipped',     ref: 'KT-SHIPPED',     payment_mode: 'stripe_eur',  payment_status: 'paid',     ordered_at: daysAgo(14), preparation_at: daysAgo(12), shipped_at: daysAgo(10), available_at: null,       collected_at: null,       cancelled_at: null },
      { status: 'in_transit',  ref: 'KT-INTRANSIT',   payment_mode: 'stripe_eur',  payment_status: 'paid',     ordered_at: daysAgo(20), preparation_at: daysAgo(18), shipped_at: daysAgo(15), available_at: null,       collected_at: null,       cancelled_at: null },
      { status: 'available',   ref: 'KT-AVAILABLE',   payment_mode: 'cash_relais', payment_status: 'paid',     ordered_at: daysAgo(30), preparation_at: daysAgo(28), shipped_at: daysAgo(25), available_at: daysAgo(2), collected_at: null,       cancelled_at: null },
      { status: 'collected',   ref: 'KT-COLLECTED',   payment_mode: 'cash_relais', payment_status: 'paid',     ordered_at: daysAgo(35), preparation_at: daysAgo(33), shipped_at: daysAgo(30), available_at: daysAgo(5), collected_at: daysAgo(1), cancelled_at: null },
      { status: 'cancelled',   ref: 'KT-CANCELLED',   payment_mode: 'cash_relais', payment_status: 'pending',  ordered_at: null,        preparation_at: null,        shipped_at: null,        available_at: null,       collected_at: null,       cancelled_at: daysAgo(3) },
    ];

    const testScenarios = allScenarios.filter(t => availableStatuses.has(t.status));
    const skippedStatuses = allScenarios.filter(t => !availableStatuses.has(t.status)).map(t => t.status);

    const created = [];
    for (const t of testScenarios) {
      const id = uuidv4();
      const cashRef = t.payment_mode === 'cash_relais' ? genCashRef() : null;

      await client.query(
        `INSERT INTO orders (
           id, reference, user_id, relais_id,
           total_kmf, total_eur, payment_mode, payment_status,
           cash_ref_code, pickup_code, status, confection_type,
           ordered_at, preparation_at, shipped_at, available_at, collected_at, cancelled_at
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4::uuid,
           $5, $6, $7, $8,
           $9, $10, $11, 'aucun',
           $12, $13, $14, $15, $16, $17
         )`,
        [
          id, t.ref, adminId, relais.id,
          5000, 10.16, t.payment_mode, t.payment_status,
          cashRef,
          genPickup(),
          t.status,
          t.ordered_at, t.preparation_at, t.shipped_at,
          t.available_at, t.collected_at, t.cancelled_at,
        ]
      );
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_kmf)
         VALUES ($1::uuid, $2::uuid, $3, $4)`,
        [id, product.id, 1, product.price_kmf]
      );
      await client.query(
        `INSERT INTO order_status_history (order_id, status, note, changed_by)
         VALUES ($1::uuid, $2, $3, $4::uuid)`,
        [id, t.status, 'Seed test data', adminId]
      );
      created.push({ id, reference: t.ref, status: t.status });
    }

    await client.query('COMMIT');

    console.log(`🌱 Seed-test: ${created.length} commandes créées par ${req.user.email} (${deletedCount} anciennes supprimées)`);
    res.json({
      success:          true,
      message:          `${created.length} commandes test créées — statuts couverts`,
      deleted_previous: deletedCount,
      product_used:     product.name,
      relais_used:      relais.name || relais.id,
      skipped_statuses: skippedStatuses,
      orders:           created,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed-test error:', err.message, err.detail);
    res.status(500).json({ error: 'Erreur seed-test : ' + err.message, detail: err.detail || null });
  } finally {
    client.release();
  }
});

// ─── GET /api/admin/users ────────────────────────────────────────────────────────────────────

router.get('/users', ...guard, async (req, res) => {
  try {
    const { role, search, limit = 100, offset = 0 } = req.query;
    const conditions = ['1=1'];
    const params     = [];
    let   pi         = 1;
    if (role && VALID_ROLES.includes(role)) { conditions.push(`u.role = $${pi++}`); params.push(role); }
    if (search) {
      conditions.push(`(u.full_name ILIKE $${pi} OR u.email ILIKE $${pi} OR u.phone ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }
    const where = conditions.join(' AND ');
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at, u.updated_at, u.last_login_at,
         COALESCE(u.currency_pref, 'KMF') AS currency_pref,
         COALESCE(u.country, 'KM') AS country
       FROM users u WHERE ${where} ORDER BY u.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );
    const { rows: [countRow] } = await db.query(
      `SELECT COUNT(*) AS count FROM users u WHERE ${where}`, params
    );
    res.json({ users: rows, total: Number(countRow.count) });
  } catch (err) {
    console.error('Admin users list error:', err.message);
    res.status(500).json({ error: 'Erreur liste utilisateurs : ' + err.message });
  }
});

// ─── POST /api/admin/users ───────────────────────────────────────────────────────────────────

router.post('/users', ...guard, async (req, res) => {
  const bcrypt = require('bcryptjs');
  try {
    const { full_name, email, phone, password, role = 'client', currency_pref = 'KMF' } = req.body;
    if (!full_name || !email || !password) return res.status(400).json({ error: 'full_name, email et password sont obligatoires' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length) return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });
    const password_hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await db.query(
      `INSERT INTO users (full_name, email, phone, role, currency_pref, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, full_name, email, phone, role, currency_pref, created_at`,
      [full_name, email.toLowerCase().trim(), phone || null, role, currency_pref, password_hash]
    );
    console.log(`👤 Admin created user ${user.email} (${role}) by ${req.user.email}`);
    res.status(201).json(user);
  } catch (err) {
    console.error('Admin create user error:', err.message);
    res.status(500).json({ error: 'Erreur création utilisateur : ' + err.message });
  }
});

// ─── PUT /api/admin/users/:id/role ────────────────────────────────────────────────────────────────

router.put('/users/:id/role', ...guard, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    if (id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle' });
    const { rows: [user] } = await db.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING id, full_name, email, role`,
      [role, id]
    );
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    console.log(`🔑 Admin changed role of ${user.email} to ${role} by ${req.user.email}`);
    res.json({ success: true, user });
  } catch (err) {
    console.error('Admin change role error:', err.message);
    res.status(500).json({ error: 'Erreur changement de rôle : ' + err.message });
  }
});

// ─── PUT /api/admin/users/:id/password ────────────────────────────────────────────────────────────

router.put('/users/:id/password', ...guard, async (req, res) => {
  const bcrypt = require('bcryptjs');
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    const { rows: [existing] } = await db.query('SELECT id, full_name, email FROM users WHERE id = $1::uuid', [id]);
    if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const password_hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2::uuid', [password_hash, id]);
    console.log(`🔒 Admin reset password for ${existing.email} by ${req.user.email}`);
    res.json({ success: true, message: `Mot de passe réinitialisé pour ${existing.full_name}` });
  } catch (err) {
    console.error('Admin reset password error:', err.message);
    res.status(500).json({ error: 'Erreur réinitialisation mot de passe' });
  }
});

// ─── DELETE /api/admin/users/:id ────────────────────────────────────────────────────────────────

router.delete('/users/:id', ...guard, async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    const { rows: [user] } = await db.query('SELECT id, full_name, email, role FROM users WHERE id = $1::uuid', [id]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { rows: [{ count: orderCount }] } = await db.query('SELECT COUNT(*) FROM orders WHERE user_id = $1::uuid', [id]);
    if (Number(orderCount) > 0) {
      await db.query(
        `UPDATE users SET email = 'deleted_' || id || '@komerce.deleted', full_name = '[Compte supprimé]',
           phone = NULL, password_hash = '', updated_at = NOW() WHERE id = $1::uuid`, [id]
      );
      console.log(`🗑️ Admin soft-deleted user ${user.email} by ${req.user.email}`);
      res.json({ success: true, message: `Utilisateur anonymisé (${orderCount} commande(s) conservée(s))`, type: 'soft_delete', deleted: { id, email: user.email, full_name: user.full_name } });
    } else {
      await db.query('DELETE FROM users WHERE id = $1::uuid', [id]);
      console.log(`🗑️ Admin hard-deleted user ${user.email} by ${req.user.email}`);
      res.json({ success: true, message: `Utilisateur ${user.full_name} supprimé définitivement`, type: 'hard_delete', deleted: { id, email: user.email, full_name: user.full_name } });
    }
  } catch (err) {
    console.error('Admin delete user error:', err.message);
    res.status(500).json({ error: 'Erreur suppression utilisateur' });
  }
});


// ── Redirections rétro-compatibles ────────────────────
router.get('/dashboard', ...guard, (req, res) => {
  res.status(301).json({ error: 'Endpoint déplacé', redirect: '/api/dashboard/ops', message: 'Utilisez GET /api/dashboard/ops à la place' });
});
router.get('/margins', ...guard, (req, res) => {
  res.status(301).json({ error: 'Endpoint déplacé', redirect: '/api/dashboard/finance', message: 'Utilisez GET /api/dashboard/finance à la place' });
});
router.get('/alerts', ...guard, (req, res) => {
  res.status(301).json({ error: 'Endpoint déplacé', redirect: '/api/dashboard/ops', message: 'Les alertes sont maintenant dans GET /api/dashboard/ops (section alertes)' });
});

module.exports = router;
