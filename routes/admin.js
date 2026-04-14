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
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    return res.status(403).json({
      error: 'Endpoint désactivé en production',
      hint: 'Ajoutez ALLOW_SEED=true dans les variables Railway pour activer',
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
// Rich seed v2: populates entire Control Tower dashboard with realistic data
router.post('/seed-test', ...guard, async (req, res, next) => {
  // ══════════════════════════════════════════════════════════════════
  // CRIT-04 FIX: Block in production — seed-test is dev/staging only.
  // ══════════════════════════════════════════════════════════════════
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    return res.status(403).json({
      error: 'Endpoint désactivé en production',
      hint: 'Ajoutez ALLOW_SEED=true dans les variables Railway pour activer',
    });
  }

  const { v4: uuidv4 } = require('uuid');
  const { randomBytes } = require('crypto');
  const client = await db.getClient();

  // ── Helpers ──────────────────────────────────────────────────────
  const now = new Date();
  const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();
  const YEAR = now.getFullYear();

  const genPickup = () => {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 6 }, () => {
      let b;
      do { b = randomBytes(1)[0]; } while (b >= 216);
      return CHARS[b % 36];
    }).join('');
  };

  let cashRefIdx = 0;
  const genCashRef = () => String(Date.now() + (cashRefIdx++)).slice(-8);
  let parcelSeq = 0;
  const genParcelRef = () => `PCL-${YEAR}-${String(++parcelSeq).padStart(4, '0')}`;
  let invoiceSeq = 0;
  const genInvoiceNum = () => `INV-${YEAR}-${String(++invoiceSeq).padStart(4, '0')}`;
  let scanCodeSeq = 0;
  const genScanCode = () => `SC-${YEAR}-${String(++scanCodeSeq).padStart(4, '0')}`;

  try {
    const { confirm } = req.body;
    if (!confirm) {
      return res.status(400).json({ error: 'Envoyez { "confirm": true } pour confirmer le seed' });
    }

    await client.query('BEGIN');

    // ── Fetch existing data ────────────────────────────────────────
    const { rows: products } = await client.query(
      'SELECT id, name, price_kmf FROM products WHERE is_active = TRUE ORDER BY name LIMIT 10'
    );
    if (!products.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun produit actif — impossible de seeder' });
    }

    const pickProduct = (i) => products[i % products.length];

    // ── Known IDs ──────────────────────────────────────────────────
    const R = {
      volo_volo:  '02c78574-0086-5905-a5cd-e0f48a4d134c',
      mutsamudu:  '326a56cd-4efe-5721-a6a2-f5f4fa30d176',
      domoni:     '7c19dde1-9142-5045-83eb-1c1162adb1b9',
      fomboni:    '48224a8f-5f3f-509a-8a38-5bb153f69a59',
    };
    const islandOf = {
      [R.volo_volo]: 'Grande Comore',
      [R.mutsamudu]: 'Anjouan',
      [R.domoni]:    'Anjouan',
      [R.fomboni]:   'Mohéli',
    };
    const relaisNameOf = {
      [R.volo_volo]: 'Relais Moroni Volo-Volo',
      [R.mutsamudu]: 'Relais Mutsamudu Centre',
      [R.domoni]:    'Relais Domoni',
      [R.fomboni]:   'Relais Fomboni',
    };

    const C = [
      { id: '874cf1a5-a449-412d-a3ee-5b5381802338', name: 'Fatima Abdou',     phone: '+2693210001' },
      { id: '096352ba-a113-4bf7-880d-4d20de28392e', name: 'Ahmed Salim',      phone: '+2693210002' },
      { id: 'de13928f-85e4-45c9-b9ca-4635c933a76a', name: 'Mariam Hassan',    phone: '+2693210003' },
      { id: '37ce3571-d050-4d6f-8897-d1a23117a93a', name: 'Ibrahim Youssouf', phone: '+2693210004' },
      { id: '52ca53a6-60e2-4ea7-b84c-e78e92a037c1', name: 'Zaïna Mohamed',    phone: '+2693210005' },
      { id: '5ab3d044-68e7-4e69-b139-1b435223339b', name: 'Ali Combo',        phone: '+2693210006' },
    ];

    const HUB = { id: '79ef88b1-d7a0-47b7-bf39-8d379f2e5a1c', name: 'Moussa Hub Dubai' };
    const relaisAgentOf = {
      [R.mutsamudu]: { id: '631b2cf7-1341-4cda-96f0-d3de53d75370', name: 'Agent Relais Mutsamudu Centre' },
      [R.domoni]:    { id: '631b2cf7-1341-4cda-96f0-d3de53d75370', name: 'Agent Relais Mutsamudu Centre' },
      [R.volo_volo]: { id: 'ba785225-eedf-43b8-a3a1-981b575bcb55', name: 'Agent Relais Moroni Volo-Volo' },
      [R.fomboni]:   { id: 'ba785225-eedf-43b8-a3a1-981b575bcb55', name: 'Agent Relais Moroni Volo-Volo' },
    };

    // ── 20 Scenarios ───────────────────────────────────────────────
    // Helper: compute order timestamps from days-ago values
    const T = (o, pr, sh, av, co, ca) => ({
      ordered_at:     o  != null ? daysAgo(o)  : null,
      preparation_at: pr != null ? daysAgo(pr) : null,
      shipped_at:     sh != null ? daysAgo(sh) : null,
      available_at:   av != null ? daysAgo(av) : null,
      collected_at:   co != null ? daysAgo(co) : null,
      cancelled_at:   ca != null ? daysAgo(ca) : null,
    });

    const scenarios = [
      // #  ref       client  relais       status        payMode       payStatus  age  hasPcl  pclSt         incidents                      invoice  itemQtys
      { n:1,  ref:'KT-001', ci:0, rid:R.volo_volo,  st:'confirmed',   pm:'cash_relais', ps:'pending', age:0,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:0,q:2}],                       ...T(null,null,null,null,null,null) },
      { n:2,  ref:'KT-002', ci:1, rid:R.mutsamudu,  st:'confirmed',   pm:'stripe_eur',  ps:'paid',    age:1,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:1,q:1},{pi:0,q:1}],            ...T(null,null,null,null,null,null) },
      { n:3,  ref:'KT-003', ci:2, rid:R.domoni,     st:'ordered',     pm:'cash_relais', ps:'paid',    age:5,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:2,q:3}],                       ...T(5,null,null,null,null,null) },
      { n:4,  ref:'KT-004', ci:3, rid:R.fomboni,    st:'preparation', pm:'cash_relais', ps:'paid',    age:8,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:3,q:1}],                       ...T(8,6,null,null,null,null) },
      { n:5,  ref:'KT-005', ci:4, rid:R.volo_volo,  st:'preparation', pm:'stripe_eur',  ps:'paid',    age:10,  pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:4,q:2},{pi:0,q:1}],            ...T(10,8,null,null,null,null) },
      { n:6,  ref:'KT-006', ci:5, rid:R.mutsamudu,  st:'shipped',     pm:'cash_relais', ps:'paid',    age:14,  pcl:true,  pst:'shipped',     inc:[],                                inv:false, iq:[{pi:5,q:1}],                       ...T(14,12,10,null,null,null) },
      { n:7,  ref:'KT-007', ci:0, rid:R.domoni,     st:'shipped',     pm:'stripe_eur',  ps:'paid',    age:12,  pcl:true,  pst:'shipped',     inc:[],                                inv:false, iq:[{pi:1,q:2}],                       ...T(12,10,8,null,null,null) },
      { n:8,  ref:'KT-008', ci:1, rid:R.volo_volo,  st:'in_transit',  pm:'cash_relais', ps:'paid',    age:20,  pcl:true,  pst:'in_transit',  inc:[],                                inv:false, iq:[{pi:2,q:1},{pi:3,q:2}],            ...T(20,18,15,null,null,null) },
      { n:9,  ref:'KT-009', ci:2, rid:R.mutsamudu,  st:'in_transit',  pm:'stripe_eur',  ps:'paid',    age:18,  pcl:true,  pst:'in_transit',  inc:['weight_mismatch'],               inv:false, iq:[{pi:4,q:3}],                       ...T(18,16,13,null,null,null) },
      { n:10, ref:'KT-010', ci:3, rid:R.fomboni,    st:'in_transit',  pm:'cash_relais', ps:'paid',    age:25,  pcl:true,  pst:'in_transit',  inc:[],                                inv:false, iq:[{pi:0,q:2}],         stuck:true,   ...T(25,23,20,null,null,null) },
      { n:11, ref:'KT-011', ci:4, rid:R.volo_volo,  st:'available',   pm:'cash_relais', ps:'pending', age:30,  pcl:true,  pst:'available',   inc:['missing_item'],                  inv:false, iq:[{pi:1,q:1},{pi:5,q:2}],            ...T(30,28,25,22,null,null) },
      { n:12, ref:'KT-012', ci:5, rid:R.domoni,     st:'available',   pm:'stripe_eur',  ps:'paid',    age:28,  pcl:true,  pst:'available',   inc:[],                                inv:false, iq:[{pi:2,q:2}],                       ...T(28,26,23,20,null,null) },
      { n:13, ref:'KT-013', ci:0, rid:R.mutsamudu,  st:'available',   pm:'cash_relais', ps:'paid',    age:3,   pcl:true,  pst:'available',   inc:[],                                inv:false, iq:[{pi:3,q:1}],                       ...T(3,2.5,2,0.5,null,null) },
      { n:14, ref:'KT-014', ci:1, rid:R.volo_volo,  st:'collected',   pm:'cash_relais', ps:'paid',    age:35,  pcl:true,  pst:'collected',   inc:[],                                inv:true,  iq:[{pi:4,q:1},{pi:0,q:2}],            ...T(35,33,30,27,25,null) },
      { n:15, ref:'KT-015', ci:2, rid:R.fomboni,    st:'collected',   pm:'stripe_eur',  ps:'paid',    age:32,  pcl:true,  pst:'collected',   inc:['damaged_item'],                  inv:true,  iq:[{pi:5,q:2}],                       ...T(32,30,27,24,22,null) },
      { n:16, ref:'KT-016', ci:3, rid:R.domoni,     st:'collected',   pm:'cash_relais', ps:'paid',    age:40,  pcl:true,  pst:'collected',   inc:[],                                inv:true,  iq:[{pi:1,q:3}],                       ...T(40,38,35,32,30,null) },
      { n:17, ref:'KT-017', ci:4, rid:R.mutsamudu,  st:'cancelled',   pm:'cash_relais', ps:'pending', age:5,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:2,q:1}],                       ...T(null,null,null,null,null,3) },
      { n:18, ref:'KT-018', ci:5, rid:R.volo_volo,  st:'in_transit',  pm:'cash_relais', ps:'pending', age:4,   pcl:true,  pst:'in_transit',  inc:['unexpected_item'],               inv:false, iq:[{pi:3,q:2}],                       ...T(4,3,2,null,null,null) },
      { n:19, ref:'KT-019', ci:0, rid:R.domoni,     st:'shipped',     pm:'cash_relais', ps:'pending', age:4,   pcl:true,  pst:'shipped',     inc:[],                                inv:false, iq:[{pi:4,q:1}],                       ...T(4,3,2,null,null,null) },
      { n:20, ref:'KT-020', ci:1, rid:R.fomboni,    st:'available',   pm:'cash_relais', ps:'pending', age:5,   pcl:true,  pst:'available',   inc:['sequence_violation'],             inv:false, iq:[{pi:5,q:1},{pi:0,q:1}],            ...T(5,4,3,1,null,null) },
    ];

    // ── Cleanup ────────────────────────────────────────────────────
    const { rows: prevOrders } = await client.query(
      "SELECT id FROM orders WHERE reference LIKE 'KT-%'"
    );
    let deletedCount = 0;
    for (const po of prevOrders) {
      await deleteOrderCascade(client, po.id);
      deletedCount++;
    }

    // Truncate new tables safely
    for (const tbl of ['scan_events', 'incidents', 'invoices', 'parcel_items', 'parcels']) {
      try {
        await client.query(`SAVEPOINT sp_trunc_${tbl}`);
        await client.query(`TRUNCATE ${tbl} CASCADE`);
        await client.query(`RELEASE SAVEPOINT sp_trunc_${tbl}`);
      } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_trunc_${tbl}`);
      }
    }

    // ── Create data ────────────────────────────────────────────────
    const summary = {
      orders: [], parcels: [], scan_events: 0, incidents: [], invoices: [],
    };

    for (const s of scenarios) {
      const orderId = uuidv4();
      const cl = C[s.ci];
      const totalKmf = s.iq.reduce((sum, item) => sum + pickProduct(item.pi).price_kmf * item.q, 0);
      const totalEur = +(totalKmf / 492).toFixed(2);
      const cashRef = s.pm === 'cash_relais' ? genCashRef() : null;
      const createdAt = daysAgo(s.age);

      // ── INSERT order ─────────────────────────────────────────────
      await client.query(
        `INSERT INTO orders (
           id, reference, user_id, relais_id,
           total_kmf, total_eur, payment_mode, payment_status,
           cash_ref_code, pickup_code, status, confection_type, qr_token,
           created_at, ordered_at, preparation_at, shipped_at,
           available_at, collected_at, cancelled_at
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4::uuid,
           $5, $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14, $15, $16, $17,
           $18, $19, $20
         )`,
        [
          orderId, s.ref, cl.id, s.rid,
          totalKmf, totalEur, s.pm, s.ps,
          cashRef, genPickup(), s.st, 'aucun', uuidv4(),
          createdAt, s.ordered_at, s.preparation_at, s.shipped_at,
          s.available_at, s.collected_at, s.cancelled_at,
        ]
      );

      // ── INSERT order_items ───────────────────────────────────────
      const orderItemIds = [];
      for (const item of s.iq) {
        const prod = pickProduct(item.pi);
        const oiId = uuidv4();
        await client.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, scan_code)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
          [oiId, orderId, prod.id, item.q, prod.price_kmf, genScanCode()]
        );
        orderItemIds.push({ id: oiId, productId: prod.id, productName: prod.name, qty: item.q });
      }

      // ── INSERT order_status_history (optional table) ─────────────
      try {
        await client.query('SAVEPOINT sp_osh');
        await client.query(
          `INSERT INTO order_status_history (order_id, status, note, changed_by)
           VALUES ($1::uuid, $2, $3, $4::uuid)`,
          [orderId, s.st, 'Seed test data v2', cl.id]
        );
        await client.query('RELEASE SAVEPOINT sp_osh');
      } catch (_) {
        await client.query('ROLLBACK TO SAVEPOINT sp_osh');
      }

      summary.orders.push({ id: orderId, ref: s.ref, status: s.st, total_kmf: totalKmf });

      // ── CREATE PARCEL ────────────────────────────────────────────
      if (!s.pcl) continue;

      const parcelId = uuidv4();
      const parcelRef = genParcelRef();
      const totalItems = orderItemIds.length;
      const totalQty = orderItemIds.reduce((sum, oi) => sum + oi.qty, 0);
      const weightKg = +(totalQty * 0.8 + Math.random() * 2).toFixed(2);

      // Compute parcel timestamps from order timestamps
      const pTs = {
        prepared_at:  s.preparation_at,
        shipped_at:   s.shipped_at,
        in_transit_at: null,
        arrived_at:   null,
        available_at: null,
        collected_at: null,
      };

      // in_transit+ gets in_transit_at
      if (['in_transit', 'arrived', 'available', 'collected'].includes(s.pst)) {
        if (s.shipped_at) {
          if (s.stuck) {
            // Stuck: in_transit very early for >7 day alert
            pTs.in_transit_at = new Date(new Date(s.shipped_at).getTime() + 1 * 86400000).toISOString();
          } else {
            pTs.in_transit_at = new Date(new Date(s.shipped_at).getTime() + 1.5 * 86400000).toISOString();
          }
        }
      }

      // available+ gets arrived_at and available_at
      if (['available', 'collected'].includes(s.pst)) {
        if (s.available_at) {
          pTs.arrived_at = new Date(new Date(s.available_at).getTime() - 6 * 3600000).toISOString();
          pTs.available_at = s.available_at;
        }
      }

      // collected gets collected_at
      if (s.pst === 'collected') {
        pTs.collected_at = s.collected_at;
      }

      // ── INSERT parcel ────────────────────────────────────────────
      try {
        await client.query('SAVEPOINT sp_parcel');
        await client.query(
          `INSERT INTO parcels (
             id, order_id, reference, type, status, relais_id,
             weight_kg, prepared_at, shipped_at, in_transit_at,
             arrived_at, available_at, collected_at,
             destination_island, recipient_name, recipient_phone,
             items_count, total_qty
           ) VALUES (
             $1::uuid, $2::uuid, $3, $4, $5, $6::uuid,
             $7, $8, $9, $10,
             $11, $12, $13,
             $14, $15, $16,
             $17, $18
           )`,
          [
            parcelId, orderId, parcelRef, 'standard', s.pst, s.rid,
            weightKg, pTs.prepared_at, pTs.shipped_at, pTs.in_transit_at,
            pTs.arrived_at, pTs.available_at, pTs.collected_at,
            islandOf[s.rid] || 'Comores', cl.name, cl.phone,
            totalItems, totalQty,
          ]
        );
        await client.query('RELEASE SAVEPOINT sp_parcel');
      } catch (pErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_parcel');
        console.warn(`⚠️ Parcel insert failed for ${s.ref}: ${pErr.message}`);
        continue; // Skip parcel_items, scans, incidents for this order
      }

      summary.parcels.push({ id: parcelId, ref: parcelRef, order: s.ref, status: s.pst });

      // ── INSERT parcel_items ──────────────────────────────────────
      const isReceived = ['available', 'collected'].includes(s.pst);
      const isCollected = s.pst === 'collected';

      for (const oi of orderItemIds) {
        try {
          await client.query('SAVEPOINT sp_pi');
          await client.query(
            `INSERT INTO parcel_items (
               id, parcel_id, order_item_id, product_id, quantity,
               qty_allocated, qty_packed, qty_shipped, qty_received, qty_collected,
               verified, verified_at, verified_by, product_name
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
               $6, $7, $8, $9, $10,
               $11, $12, $13, $14
             )`,
            [
              uuidv4(), parcelId, oi.id, oi.productId, oi.qty,
              oi.qty, oi.qty, oi.qty,
              isReceived  ? oi.qty : 0,
              isCollected ? oi.qty : 0,
              isCollected, isCollected ? pTs.collected_at : null,
              isCollected ? (relaisAgentOf[s.rid] || {}).id || null : null,
              oi.productName,
            ]
          );
          await client.query('RELEASE SAVEPOINT sp_pi');
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_pi');
        }
      }

      // ── INSERT scan_events ───────────────────────────────────────
      // Build scan chain based on parcel status progression
      const scanStages = [];
      const statusProgression = ['shipped', 'in_transit', 'available', 'collected'];
      const statusIdx = statusProgression.indexOf(s.pst);

      // Preparation scan
      if (pTs.prepared_at) {
        scanStages.push({
          event_type: 'preparation',
          created_at: pTs.prepared_at,
          actor_id: HUB.id,
          actor_name: HUB.name,
          actor_role: 'hub_agent',
          location: 'Hub Dubai',
          notes: `Colis ${parcelRef} préparé`,
        });
      }

      // Shipped scan
      if (pTs.shipped_at) {
        scanStages.push({
          event_type: 'shipped',
          created_at: pTs.shipped_at,
          actor_id: HUB.id,
          actor_name: HUB.name,
          actor_role: 'hub_agent',
          location: 'Hub Dubai',
          notes: `Colis ${parcelRef} expédié vers ${islandOf[s.rid] || 'Comores'}`,
        });
      }

      // In-transit scan
      if (statusIdx >= 1 && pTs.in_transit_at) {
        scanStages.push({
          event_type: 'in_transit',
          created_at: pTs.in_transit_at,
          actor_id: HUB.id,
          actor_name: HUB.name,
          actor_role: 'hub_agent',
          location: 'En transit',
          notes: `Colis ${parcelRef} en transit vers ${relaisNameOf[s.rid] || 'relais'}`,
        });
      }

      // Arrived scan
      if (statusIdx >= 2 && pTs.arrived_at) {
        const ra = relaisAgentOf[s.rid] || { id: HUB.id, name: HUB.name };
        scanStages.push({
          event_type: 'arrived',
          created_at: pTs.arrived_at,
          actor_id: ra.id,
          actor_name: ra.name,
          actor_role: 'relay_agent',
          location: relaisNameOf[s.rid] || 'Relais',
          notes: `Colis ${parcelRef} arrivé au ${relaisNameOf[s.rid] || 'relais'}`,
        });
      }

      // Available scan
      if (statusIdx >= 2 && pTs.available_at) {
        const ra = relaisAgentOf[s.rid] || { id: HUB.id, name: HUB.name };
        scanStages.push({
          event_type: 'available',
          created_at: pTs.available_at,
          actor_id: ra.id,
          actor_name: ra.name,
          actor_role: 'relay_agent',
          location: relaisNameOf[s.rid] || 'Relais',
          notes: `Colis ${parcelRef} disponible pour retrait`,
        });
      }

      // Collected scan
      if (statusIdx >= 3 && pTs.collected_at) {
        const ra = relaisAgentOf[s.rid] || { id: HUB.id, name: HUB.name };
        scanStages.push({
          event_type: 'collected',
          created_at: pTs.collected_at,
          actor_id: ra.id,
          actor_name: ra.name,
          actor_role: 'relay_agent',
          location: relaisNameOf[s.rid] || 'Relais',
          notes: `Colis ${parcelRef} récupéré par ${cl.name}`,
        });
      }

      for (const scan of scanStages) {
        try {
          await client.query('SAVEPOINT sp_scan');
          await client.query(
            `INSERT INTO scan_events (
               id, parcel_id, order_id, event_type,
               scan_code, scanned_by, actor_name, actor_role,
               location, notes, metadata, status, created_at
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4,
               $5, $6::uuid, $7, $8,
               $9, $10, $11::jsonb, $12, $13
             )`,
            [
              uuidv4(), parcelId, orderId, scan.event_type,
              parcelRef, scan.actor_id, scan.actor_name, scan.actor_role,
              scan.location, scan.notes,
              JSON.stringify({ source: 'seed', device: 'system' }),
              'ok', scan.created_at,
            ]
          );
          await client.query('RELEASE SAVEPOINT sp_scan');
          summary.scan_events++;
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_scan');
        }
      }

      // ── INSERT incidents ─────────────────────────────────────────
      const incidentDefs = {
        weight_mismatch: {
          severity: 'high', status: 'open',
          title: 'Écart de poids détecté',
          description: `Le colis ${parcelRef} présente un écart de poids significatif : déclaré 1.5kg, mesuré ${weightKg}kg`,
          details: { declared_kg: 1.5, measured_kg: weightKg, delta_pct: Math.round(Math.abs(weightKg - 1.5) / 1.5 * 100) },
          client_impact: 'Possible erreur de contenu — vérification requise',
          detected_source: 'scan',
        },
        missing_item: {
          severity: 'critical', status: 'investigating',
          title: 'Article manquant dans le colis',
          description: `Un article commandé est absent du colis ${parcelRef} lors du scan de réception`,
          details: { expected_items: totalQty, received_items: totalQty - 1, missing: orderItemIds[0]?.productName || 'inconnu' },
          client_impact: 'Client ne recevra pas tous ses articles — réclamation probable',
          detected_source: 'scan',
        },
        damaged_item: {
          severity: 'high', status: 'resolved',
          title: 'Article endommagé à la réception',
          description: `Un article du colis ${parcelRef} est arrivé endommagé (emballage écrasé)`,
          details: { item: orderItemIds[0]?.productName || 'inconnu', damage_type: 'crushed_packaging', photos: 1 },
          client_impact: 'Remplacement ou remboursement nécessaire',
          detected_source: 'manual',
          resolved: true,
          resolution: { action: 'replacement_sent', resolved_note: 'Article remplacé et réexpédié' },
        },
        unexpected_item: {
          severity: 'medium', status: 'open',
          title: 'Article non attendu dans le colis',
          description: `Le colis ${parcelRef} contient un article qui ne correspond pas à la commande`,
          details: { unexpected_product: 'Article inconnu', order_ref: s.ref },
          client_impact: 'Échange nécessaire — confusion possible avec un autre colis',
          detected_source: 'scan',
        },
        sequence_violation: {
          severity: 'low', status: 'open',
          title: 'Violation de séquence de scan',
          description: `Le colis ${parcelRef} a été scanné "disponible" avant d'être scanné "arrivé"`,
          details: { expected_sequence: 'arrived → available', actual_sequence: 'available (arrived skipped)' },
          client_impact: 'Aucun impact direct — anomalie de traçabilité',
          detected_source: 'auto',
        },
      };

      for (const incType of s.inc) {
        const def = incidentDefs[incType];
        if (!def) continue;

        const detectedBy = def.detected_source === 'scan'
          ? (relaisAgentOf[s.rid] || HUB).id
          : HUB.id;

        try {
          await client.query('SAVEPOINT sp_inc');
          await client.query(
            `INSERT INTO incidents (
               id, parcel_id, order_id, incident_type, severity,
               status, title, description, details,
               client_impact, client_notified, detected_by,
               detected_source, resolution, resolved_at, resolved_by
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4, $5,
               $6, $7, $8, $9::jsonb,
               $10, $11, $12::uuid,
               $13, $14::jsonb, $15, $16
             )`,
            [
              uuidv4(), parcelId, orderId, incType, def.severity,
              def.status, def.title, def.description, JSON.stringify(def.details),
              def.client_impact, false, detectedBy,
              def.detected_source,
              def.resolved ? JSON.stringify(def.resolution) : null,
              def.resolved ? daysAgo(Math.max(s.age - 5, 1)) : null,
              def.resolved ? detectedBy : null,
            ]
          );
          await client.query('RELEASE SAVEPOINT sp_inc');
          summary.incidents.push({ order: s.ref, type: incType, severity: def.severity, status: def.status });
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_inc');
        }
      }

      // ── INSERT invoice (collected orders only) ───────────────────
      if (s.inv && s.pst === 'collected') {
        const invNum = genInvoiceNum();
        const itemsSnapshot = orderItemIds.map(oi => ({
          product_name: oi.productName,
          quantity: oi.qty,
          price_kmf: pickProduct(s.iq.find(x => x.pi !== undefined)?.pi || 0).price_kmf,
        }));

        try {
          await client.query('SAVEPOINT sp_inv');
          await client.query(
            `INSERT INTO invoices (
               id, invoice_number, order_id, parcel_id,
               client_name, client_phone, relay_name,
               items_snapshot, subtotal_kmf, shipping_kmf, total_kmf,
               payment_mode, payment_status, delivered_via, delivered_at, created_at
             ) VALUES (
               $1::uuid, $2, $3::uuid, $4::uuid,
               $5, $6, $7,
               $8::jsonb, $9, $10, $11,
               $12, $13, $14, $15, $16
             )`,
          [
              uuidv4(), invNum, orderId, parcelId,
              cl.name, cl.phone, relaisNameOf[s.rid] || 'Relais',
              JSON.stringify(itemsSnapshot), totalKmf, 0, totalKmf,
              s.pm, s.ps, relaisNameOf[s.rid] || 'Relais', pTs.collected_at, pTs.collected_at,
            ]
          );
          await client.query('RELEASE SAVEPOINT sp_inv');
          summary.invoices.push({ number: invNum, order: s.ref, total_kmf: totalKmf });
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_inv');
        }
      }
    } // end scenario loop

    await client.query('COMMIT');

    const caTotal = summary.orders.reduce((s, o) => s + o.total_kmf, 0);
    console.log(`🌱 Rich seed v2: ${summary.orders.length} orders, ${summary.parcels.length} parcels, ${summary.scan_events} scans, ${summary.incidents.length} incidents, ${summary.invoices.length} invoices — by ${req.user.email}`);

    res.json({
      success: true,
      message: `Rich seed v2 — ${summary.orders.length} commandes, ${summary.parcels.length} colis, ${summary.scan_events} scans, ${summary.incidents.length} incidents, ${summary.invoices.length} factures`,
      deleted_previous: deletedCount,
      products_available: products.length,
      ca_total_kmf: caTotal,
      summary,
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
