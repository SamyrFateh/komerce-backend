/**
 * KOMERCE — Back-office Admin v8.2 (fixed cascade + reset) — V2.1 Password Security
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { admin } = require('../validators');

const guard = [authenticate, requireRole(['admin'])];
const VALID_ROLES = ['client', 'agent_relais', 'agent_hub', 'admin'];

// Helper: supprime une commande et toutes ses dépendances
// Tables enfants avec FK vers orders: order_items, scans, order_status_history, sms_log, disputes, ceremony_order_items
async function deleteOrderCascade(client_or_db, id) {
  // Supprimer les tables enfants dans l'ordre correct
  // Use SAVEPOINT to survive missing tables (PG aborts TX on error)
  const childOps = [
    ['DELETE FROM scans WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM order_status_history WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM ceremony_order_items WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM disputes WHERE order_id = $1::uuid', [id]],
    ['UPDATE sms_log SET order_id = NULL WHERE order_id = $1::uuid', [id]],
    ['DELETE FROM order_items WHERE order_id = $1::uuid', [id]],
  ];
  for (let i = 0; i < childOps.length; i++) {
    try {
      await client_or_db.query(`SAVEPOINT sp_del_${i}`);
      await client_or_db.query(childOps[i][0], childOps[i][1]);
      await client_or_db.query(`RELEASE SAVEPOINT sp_del_${i}`);
    } catch (_) {
      await client_or_db.query(`ROLLBACK TO SAVEPOINT sp_del_${i}`);
    }
  }
  await client_or_db.query('DELETE FROM orders WHERE id = $1::uuid', [id]);
}


// ─── GET /api/admin/orders ─────────────────────────────────────────
router.get('/orders', ...guard, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ─── DELETE /api/admin/orders/:id ──────────────────────────────────
router.delete('/orders/:id', ...guard, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ─── GET /api/admin/customs ────────────────────────────────────────
router.get('/customs', ...guard, async (req, res, next) => {
  try {
    // customs_history table may not exist yet
    res.json({ history: [], by_category: [], anomalies: [], period_days: 90, note: 'customs_history non implémenté' });
  } catch(err) { next(err); }
});

// ─── GET /api/admin/partners ───────────────────────────────────────
router.get('/partners', ...guard, async (req, res, next) => {
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
    // partners table may not exist
    res.json([]);
  }
});

// ─── POST /api/admin/partners ──────────────────────────────────────
router.post('/partners', ...guard, validate(admin.createPartner), async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ─── PUT /api/admin/partners/:id ───────────────────────────────────
router.put('/partners/:id', ...guard, validate(admin.updatePartner), async (req, res, next) => {
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
  } catch (err) { next(err); }
});

// ─── POST /api/admin/reset ─────────────────────────────────────────
// CRIT-04 FIX: Disabled in production to prevent accidental data destruction.
router.post('/reset', ...guard, validate(admin.reset), async (req, res, next) => {
  // ══════════════════════════════════════════════════════════════════
  // CRIT-04 FIX: Block in production — this endpoint is dev/staging only.
  // ══════════════════════════════════════════════════════════════════
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Endpoint désactivé en production',
      hint: 'POST /admin/reset est uniquement disponible en dev/staging',
    });
  }

  const mode = req.body.mode || 'orders';
  const validModes = ['orders', 'users', 'factory'];
  if (!validModes.includes(mode)) return res.status(400).json({ error: `Mode invalide. Utilisez: ${validModes.join(', ')}` });
  
  const report = { mode, deleted: {}, reseeded: [], timestamp: new Date().toISOString() };
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Count orders before truncate (TRUNCATE doesn't support RETURNING)
    const { rows: [{ count: orderCount }] } = await client.query('SELECT COUNT(*)::int AS count FROM orders');
    report.deleted.orders = orderCount;
    
    // TRUNCATE CASCADE — the nuclear option that actually works.
    // PostgreSQL automatically removes all rows in any table with FK to orders
    // (order_items, scans, parcels, parcel_items, disputes, order_status_history, etc.)
    // No need to manually enumerate child tables — CASCADE handles everything.
    await client.query('TRUNCATE orders CASCADE');
    
    // Also clean sms_log references (SET NULL FK — not CASCADE'd by TRUNCATE)
    try {
      await client.query('SAVEPOINT sp_sms');
      const sms = await client.query('UPDATE sms_log SET order_id = NULL WHERE order_id IS NOT NULL');
      report.deleted.sms_log_nullified = sms.rowCount;
      await client.query('RELEASE SAVEPOINT sp_sms');
    } catch (_) {
      await client.query('ROLLBACK TO SAVEPOINT sp_sms');
    }
    
    // Clean baskets and recipients (no FK to orders, but related session data)
    for (const tbl of ['basket_items', 'baskets', 'recipients']) {
      try {
        await client.query(`SAVEPOINT sp_clean_${tbl}`);
        const r = await client.query(`DELETE FROM ${tbl}`);
        report.deleted[tbl] = r.rowCount;
        await client.query(`RELEASE SAVEPOINT sp_clean_${tbl}`);
      } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_clean_${tbl}`);
        report.deleted[tbl] = 'table absente';
      }
    }
    
    if (mode === 'users' || mode === 'factory') {
      const users = await client.query("DELETE FROM users WHERE role != 'admin'");
      report.deleted.users_non_admin = users.rowCount;
    }
    
    if (mode === 'factory') {
      await client.query('DELETE FROM products');
      await client.query('DELETE FROM relais');
      try { await client.query('DELETE FROM partners'); } catch (_) {}
      report.reseeded.push('factory reset (re-seed manual requis)');
    }
    
    if (mode !== 'factory') {
      const restocked = await client.query('UPDATE products SET stock = 15 WHERE stock < 5 RETURNING id');
      if (restocked.rowCount > 0) report.restocked = restocked.rowCount;
    }
    
    await client.query('COMMIT');
    
    console.log(`🧹 Admin reset "${mode}" effectué par ${req.user.email}`);
    res.json({ success: true, message: `Reset "${mode}" effectué avec succès ✅`, ...report });
  } catch(err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /api/admin/counts ─────────────────────────────────────────
router.get('/counts', ...guard, async (req, res, next) => {
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
  } catch (err) { next(err); }
});

// ─── POST /api/admin/seed-test ─────────────────────────────────────
// CRIT-04 FIX: Also disabled in production.
router.post('/seed-test', ...guard, async (req, res, next) => {
  // ══════════════════════════════════════════════════════════════════
  // CRIT-04 FIX: Block in production — seed-test is dev/staging only.
  // ══════════════════════════════════════════════════════════════════
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Endpoint désactivé en production',
      hint: 'POST /admin/seed-test est uniquement disponible en dev/staging',
    });
  }

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
          cashRef, genPickup(), t.status,
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
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /api/admin/users ──────────────────────────────────────────
router.get('/users', ...guard, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ─── POST /api/admin/users ─────────────────────────────────────────
router.post('/users', ...guard, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ─── PUT /api/admin/users/:id/role ─────────────────────────────────
router.put('/users/:id/role', ...guard, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ─── PUT /api/admin/users/:id/password ─────────────────────────────
// V2.1: Password strength + self-change verification + same-password check
router.put('/users/:id/password', ...guard, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { id } = req.params;
    const { password, current_password } = req.body;

    // V2.1: Password strength validation
    if (!password || password.length < 8) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 8 caractères',
        code: 'WEAK_PASSWORD',
      });
    }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 1 majuscule et 1 chiffre',
        code: 'WEAK_PASSWORD',
      });
    }

    const { rows: [existing] } = await db.query(
      'SELECT id, full_name, email, password_hash FROM users WHERE id = $1::uuid',
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // V2.1: Self-change requires current_password verification
    if (id === req.user.id) {
      if (!current_password) {
        return res.status(400).json({
          error: 'current_password requis pour modifier votre propre mot de passe',
          code: 'CURRENT_PASSWORD_REQUIRED',
        });
      }
      const isValid = await bcrypt.compare(current_password, existing.password_hash);
      if (!isValid) {
        console.warn(`🔒 Failed self-password-change attempt for ${existing.email} from ${req.ip}`);
        return res.status(403).json({
          error: 'Mot de passe actuel incorrect',
          code: 'INVALID_CURRENT_PASSWORD',
        });
      }
    }

    // V2.1: Prevent reusing same password
    const isSame = await bcrypt.compare(password, existing.password_hash);
    if (isSame) {
      return res.status(400).json({
        error: 'Le nouveau mot de passe doit être différent de l\'ancien',
        code: 'SAME_PASSWORD',
      });
    }

    const password_hash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2::uuid',
      [password_hash, id]
    );

    const action = id === req.user.id ? 'self-changed' : 'admin-reset';
    console.log(`🔒 Password ${action} for ${existing.email} by ${req.user.email} (IP: ${req.ip})`);
    res.json({
      success: true,
      message: `Mot de passe ${id === req.user.id ? 'modifié' : 'réinitialisé'} pour ${existing.full_name}`,
    });
  } catch(err) { next(err); }
});

// ─── DELETE /api/admin/users/:id ───────────────────────────────────
router.delete('/users/:id', ...guard, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ── Redirections rétro-compatibles ─────────────────────
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
