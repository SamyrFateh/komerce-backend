/**
 * @komerce-arch
 * @role          dashboard-system
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, partners, products, relais, users
 * @db-write      basket_items, baskets, incidents, invoices, order_items, order_status_history, orders, parcel_items, parcels, partners, products, relais, scan_events, sms_log, users, wallet_consumptions, wallet_credit_lots, wallet_transactions, wallets
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { appendOrderHistoryNote } = require('../../services/order-status-machine');
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { admin } = require('../../validators');
const log = require('../../utils/logger').child({ module: 'admin/system' });
const { deleteOrderCascade } = require('./delete-order-cascade');
const { repairOrderedWithoutPurchaseOrders } = require('../../services/repair-ordered-without-purchase-orders');

const guard = [authenticate, requireRole(['admin'])];

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

// ─── POST /api/admin/reset ─────────────────────────────────────────
// CRIT-04 FIX: Disabled in production to prevent accidental data destruction.
router.post('/reset', ...guard, validate(admin.reset), async (req, res, next) => {
  // ══════════════════════════════════════════════════════════════════
  // CRIT-04 FIX: Block in production — this endpoint is dev/staging only.
  // R4 FIX: ALLOW_FLUSH distinct de ALLOW_SEED — activer ALLOW_SEED en prod
  //         pour un seed de démo ne doit pas débloquer le flush destructif.
  // ══════════════════════════════════════════════════════════════════
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_FLUSH !== 'true') {
    return res.status(403).json({
      error: 'Endpoint désactivé en production',
      hint: 'Ajoutez ALLOW_FLUSH=true (distinct de ALLOW_SEED) dans les variables Railway pour activer',
    });
  }

  const mode = req.body.mode || 'orders';
  const validModes = ['orders', 'users', 'factory'];
  if (!validModes.includes(mode)) return res.status(400).json({ error: `Mode invalide. Utilisez: ${validModes.join(', ')}` });

  if (!req.body.confirm) {
    return res.status(400).json({
      error: 'Confirmation obligatoire',
      hint: 'Envoyez { "confirm": true, "mode": "orders" } — cette action est irréversible',
    });
  }

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
    const CLEAN_TABLES_ALLOWLIST = ['basket_items', 'baskets', 'recipients']; // AUD-07
    for (const tbl of CLEAN_TABLES_ALLOWLIST) {
      if (!CLEAN_TABLES_ALLOWLIST.includes(tbl)) throw new Error(`Table non autorisée: ${tbl}`); // AUD-07 safety net
      try {
        await client.query(`SAVEPOINT sp_clean_${tbl}`);
        const r = await client.query(`DELETE FROM ${tbl}`); // arch-safe: whitelist literal — tbl provient exclusivement de CLEAN_TABLES_ALLOWLIST ci-dessus (AUD-07)
        report.deleted[tbl] = r.rowCount;
        await client.query(`RELEASE SAVEPOINT sp_clean_${tbl}`);
      } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_clean_${tbl}`);
        report.deleted[tbl] = 'table absente';
      }
    }

    if (mode === 'users' || mode === 'factory') {
      const userDepTables = [
        "UPDATE sms_log SET user_id = NULL WHERE user_id IS NOT NULL",
        "DELETE FROM wallet_consumptions WHERE credit_lot_id IN (SELECT id FROM wallet_credit_lots WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')))",
        "DELETE FROM wallet_credit_lots WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id IN (SELECT id FROM users WHERE role != 'admin'))",
        "DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id IN (SELECT id FROM users WHERE role != 'admin'))",
        "DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM loyalty_points WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM loyalty_history WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM wishlists WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM user_addresses WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
        "DELETE FROM basket_items WHERE basket_id IN (SELECT id FROM baskets WHERE user_id IN (SELECT id FROM users WHERE role != 'admin'))",
        "DELETE FROM baskets WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')",
      ];
      report.deleted.user_deps_cleaned = 0;
      for (let i = 0; i < userDepTables.length; i++) {
        try {
          await client.query('SAVEPOINT sp_udep_' + i);
          await client.query(userDepTables[i]);
          report.deleted.user_deps_cleaned++;
          await client.query('RELEASE SAVEPOINT sp_udep_' + i);
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_udep_' + i);
        }
      }

      const users = await client.query("DELETE FROM users WHERE role != 'admin'");
      report.deleted.users_non_admin = users.rowCount;
    }

    if (mode === 'factory') {
      await client.query('DELETE FROM products');
      await client.query('DELETE FROM relais');
      try {
        await client.query('SAVEPOINT sp_factory_partners');
        await client.query('DELETE FROM partners');
        await client.query('RELEASE SAVEPOINT sp_factory_partners');
      } catch (_) {
        // table optionnelle — sans SAVEPOINT, cette erreur aborterait le
        // client et annulerait silencieusement le reste du factory reset
        // (DELETE products/relais déjà exécutés, RED-2/RED-2b).
        await client.query('ROLLBACK TO SAVEPOINT sp_factory_partners').catch(() => {});
      }
      report.reseeded.push('factory reset (re-seed manual requis)');
    }

    if (mode !== 'factory') {
      // PDC-7 (Lot 7) — Le restock global ne concerne que les produits
      // LEGACY_VARIANTS. Un produit inventory_model='SKU' n'est jamais géré
      // via products.stock (voir product-admin-service.adjustStock) ; ce
      // restock ne doit donc jamais réécrire sa colonne stock, même si elle
      // est < 5 pour une raison quelconque (résidu historique, non gérée).
      const restocked = await client.query(
        `UPDATE products
            SET stock = 15
          WHERE stock < 5
            AND inventory_model = 'LEGACY_VARIANTS'
          RETURNING id`
      );
      if (restocked.rowCount > 0) report.restocked = restocked.rowCount;
    }

    await client.query('COMMIT');

    log.info(`🧹 Admin reset "${mode}" effectué par ${req.user.email}`);
    res.json({ success: true, message: `Reset "${mode}" effectué avec succès ✅`, ...report });
  } catch(err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
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
      'SELECT id, name, price_kmf, category FROM products WHERE is_active = TRUE ORDER BY name LIMIT 10'
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
    const T = (o, pr, sh, av, co, ca) => ({
      ordered_at:     o  != null ? daysAgo(o)  : null,
      preparation_at: pr != null ? daysAgo(pr) : null,
      shipped_at:     sh != null ? daysAgo(sh) : null,
      available_at:   av != null ? daysAgo(av) : null,
      collected_at:   co != null ? daysAgo(co) : null,
      cancelled_at:   ca != null ? daysAgo(ca) : null,
    });

    const scenarios = [
      { n:1,  ref:'KT-001', ci:0, rid:R.volo_volo,  st:'pending',     pm:'cash_relais', ps:'pending', age:0,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:0,q:2}],                       ...T(null,null,null,null,null,null) },
      { n:2,  ref:'KT-002', ci:1, rid:R.mutsamudu,  st:'confirmed',   pm:'stripe_eur',  ps:'paid',    age:1,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:1,q:1},{pi:0,q:1}],            ...T(null,null,null,null,null,null) },
      { n:3,  ref:'KT-003', ci:2, rid:R.domoni,     st:'confirmed',   pm:'cash_relais', ps:'paid',    age:5,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:2,q:3}],                       ...T(5,null,null,null,null,null) },
      { n:4,  ref:'KT-004', ci:3, rid:R.fomboni,    st:'preparation', pm:'cash_relais', ps:'paid',    age:8,   pcl:true,  pst:'preparation', inc:[],                                inv:false, iq:[{pi:3,q:1}],                       ...T(8,6,null,null,null,null) },
      { n:5,  ref:'KT-005', ci:4, rid:R.volo_volo,  st:'preparation', pm:'stripe_eur',  ps:'paid',    age:10,  pcl:true,  pst:'preparation', inc:[],                                inv:false, iq:[{pi:4,q:2},{pi:0,q:1}],            ...T(10,8,null,null,null,null) },
      { n:6,  ref:'KT-006', ci:5, rid:R.mutsamudu,  st:'shipped',     pm:'cash_relais', ps:'paid',    age:14,  pcl:true,  pst:'shipped',     inc:[],                                inv:false, iq:[{pi:5,q:1}],                       ...T(14,12,10,null,null,null) },
      { n:7,  ref:'KT-007', ci:0, rid:R.domoni,     st:'shipped',     pm:'stripe_eur',  ps:'paid',    age:12,  pcl:true,  pst:'shipped',     inc:[],                                inv:false, iq:[{pi:1,q:2}],                       ...T(12,10,8,null,null,null) },
      { n:8,  ref:'KT-008', ci:1, rid:R.volo_volo,  st:'in_transit',  pm:'cash_relais', ps:'paid',    age:20,  pcl:true,  pst:'in_transit',  inc:[],                                inv:false, iq:[{pi:2,q:1},{pi:3,q:2}],            ...T(20,18,15,null,null,null) },
      { n:9,  ref:'KT-009', ci:2, rid:R.mutsamudu,  st:'in_transit',  pm:'stripe_eur',  ps:'paid',    age:18,  pcl:true,  pst:'in_transit',  inc:['weight_mismatch'],               inv:false, iq:[{pi:4,q:3}],                       ...T(18,16,13,null,null,null) },
      { n:10, ref:'KT-010', ci:3, rid:R.fomboni,    st:'in_transit',  pm:'cash_relais', ps:'paid',    age:25,  pcl:true,  pst:'in_transit',  inc:[],                                inv:false, iq:[{pi:0,q:2}],         stuck:true,   ...T(25,23,20,null,null,null) },
      { n:11, ref:'KT-011', ci:4, rid:R.volo_volo,  st:'available',   pm:'cash_relais', ps:'paid',    age:30,  pcl:true,  pst:'available',   inc:['missing_item'],                  inv:false, iq:[{pi:1,q:1},{pi:5,q:2}],            ...T(30,28,25,22,null,null) },
      { n:12, ref:'KT-012', ci:5, rid:R.domoni,     st:'available',   pm:'stripe_eur',  ps:'paid',    age:28,  pcl:true,  pst:'available',   inc:[],                                inv:false, iq:[{pi:2,q:2}],                       ...T(28,26,23,20,null,null) },
      { n:13, ref:'KT-013', ci:0, rid:R.mutsamudu,  st:'available',   pm:'cash_relais', ps:'paid',    age:3,   pcl:true,  pst:'available',   inc:[],                                inv:false, iq:[{pi:3,q:1}],                       ...T(3,2.5,2,0.5,null,null) },
      { n:14, ref:'KT-014', ci:1, rid:R.volo_volo,  st:'collected',   pm:'cash_relais', ps:'paid',    age:35,  pcl:true,  pst:'collected',   inc:[],                                inv:true,  iq:[{pi:4,q:1},{pi:0,q:2}],            ...T(35,33,30,27,25,null) },
      { n:15, ref:'KT-015', ci:2, rid:R.fomboni,    st:'collected',   pm:'stripe_eur',  ps:'paid',    age:32,  pcl:true,  pst:'collected',   inc:['damaged_item'],                  inv:true,  iq:[{pi:5,q:2}],                       ...T(32,30,27,24,22,null) },
      { n:16, ref:'KT-016', ci:3, rid:R.domoni,     st:'collected',   pm:'cash_relais', ps:'paid',    age:40,  pcl:true,  pst:'collected',   inc:[],                                inv:true,  iq:[{pi:1,q:3}],                       ...T(40,38,35,32,30,null) },
      { n:17, ref:'KT-017', ci:4, rid:R.mutsamudu,  st:'cancelled',   pm:'cash_relais', ps:'pending', age:5,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:2,q:1}],                       ...T(null,null,null,null,null,3) },
      { n:18, ref:'KT-018', ci:5, rid:R.volo_volo,  st:'in_transit',  pm:'cash_relais', ps:'paid',    age:4,   pcl:true,  pst:'in_transit',  inc:['unexpected_item'],               inv:false, iq:[{pi:3,q:2}],                       ...T(4,3,2,null,null,null) },
      { n:19, ref:'KT-019', ci:0, rid:R.domoni,     st:'pending',     pm:'cash_relais', ps:'pending', age:2,   pcl:false, pst:null,          inc:[],                                inv:false, iq:[{pi:4,q:1}],                       ...T(2,null,null,null,null,null) },
      { n:20, ref:'KT-020', ci:1, rid:R.fomboni,    st:'available',   pm:'cash_relais', ps:'paid',    age:5,   pcl:true,  pst:'available',   inc:['sequence_violation'],             inv:false, iq:[{pi:5,q:1},{pi:0,q:1}],            ...T(5,4,3,1,null,null) },
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

    const TRUNC_TABLES_ALLOWLIST = ['scan_events', 'incidents', 'invoices', 'parcel_items', 'parcels']; // AUD-07
    for (const tbl of TRUNC_TABLES_ALLOWLIST) {
      if (!TRUNC_TABLES_ALLOWLIST.includes(tbl)) throw new Error(`Table non autorisée: ${tbl}`); // AUD-07 safety net
      try {
        await client.query(`SAVEPOINT sp_trunc_${tbl}`);
        await client.query(`TRUNCATE ${tbl} CASCADE`);
        await client.query(`RELEASE SAVEPOINT sp_trunc_${tbl}`);
      } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_trunc_${tbl}`);
      }
    }

    // ── Fix relais encoding (Mohéli → Mohéli) ────────────────────
    await client.query("UPDATE relais SET island = 'Mohéli' WHERE island != 'Mohéli' AND island LIKE '%oh%li%'");

    // ── Create data ────────────────────────────────────────────────
    const summary = {
      orders: [], parcels: [], scan_events: 0, incidents: [], invoices: [],
    };

    for (const s of scenarios) {
      const orderId = crypto.randomUUID();
      const cl = C[s.ci];
      const totalKmf = s.iq.reduce((sum, item) => sum + pickProduct(item.pi).price_kmf * item.q, 0);
      const totalEur = +(totalKmf / 492).toFixed(2);
      const cashRef = s.pm === 'cash_relais' ? genCashRef() : null;
      const createdAt = daysAgo(s.age);

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
          cashRef, genPickup(), s.st, 'aucun', crypto.randomUUID(),
          createdAt, s.ordered_at, s.preparation_at, s.shipped_at,
          s.available_at, s.collected_at, s.cancelled_at,
        ]
      );

      const orderItemIds = [];
      const { resolveFrozenClassification } = require('../../services/customs-classification');

      for (const item of s.iq) {
        const prod = pickProduct(item.pi);
        const oiId = crypto.randomUUID();
        const clf = await resolveFrozenClassification(client, prod.category);

        await client.query(
          `INSERT INTO order_items (
             id, order_id, product_id, quantity, price_kmf, scan_code,
             customs_category_key, sh_code, douane_pct, tva_pct, taxe_add_pct,
             classification_defaulted
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            oiId, orderId, prod.id, item.q, prod.price_kmf, genScanCode(),
            clf.customs_category_key,
            clf.sh_code,
            clf.douane_pct,
            clf.tva_pct,
            clf.taxe_add_pct,
            clf.classification_defaulted,
          ]
        );
        orderItemIds.push({ id: oiId, productId: prod.id, productName: prod.name, qty: item.q });
      }

      try {
        await client.query('SAVEPOINT sp_osh');
        await appendOrderHistoryNote(client, orderId, s.st,
          'Seed test data v2', cl.id);
        await client.query('RELEASE SAVEPOINT sp_osh');
      } catch (_) {
        await client.query('ROLLBACK TO SAVEPOINT sp_osh');
      }

      summary.orders.push({ id: orderId, ref: s.ref, status: s.st, total_kmf: totalKmf });

      if (!s.pcl) continue;

      const parcelId = crypto.randomUUID();
      const parcelRef = genParcelRef();
      const totalItems = orderItemIds.length;
      const totalQty = orderItemIds.reduce((sum, oi) => sum + oi.qty, 0);
      const weightKg = +(totalQty * 0.8 + Math.random() * 2).toFixed(2);

      const pTs = {
        prepared_at:  s.preparation_at,
        shipped_at:   s.shipped_at,
        in_transit_at: null,
        arrived_at:   null,
        available_at: null,
        collected_at: null,
      };

      if (['in_transit', 'arrived', 'available', 'collected'].includes(s.pst)) {
        if (s.shipped_at) {
          if (s.stuck) {
            pTs.in_transit_at = new Date(new Date(s.shipped_at).getTime() + 1 * 86400000).toISOString();
          } else {
            pTs.in_transit_at = new Date(new Date(s.shipped_at).getTime() + 1.5 * 86400000).toISOString();
          }
        }
      }

      if (['available', 'collected'].includes(s.pst)) {
        if (s.available_at) {
          pTs.arrived_at = new Date(new Date(s.available_at).getTime() - 6 * 3600000).toISOString();
          pTs.available_at = s.available_at;
        }
      }

      if (s.pst === 'collected') {
        pTs.collected_at = s.collected_at;
      }

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
        log.warn(`⚠️ Parcel insert failed for ${s.ref}: ${pErr.message}`);
        continue;
      }

      summary.parcels.push({ id: parcelId, ref: parcelRef, order: s.ref, status: s.pst });

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
              crypto.randomUUID(), parcelId, oi.id, oi.productId, oi.qty,
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

      const scanStages = [];
      const statusProgression = ['shipped', 'in_transit', 'available', 'collected'];
      const statusIdx = statusProgression.indexOf(s.pst);

      if (pTs.prepared_at) {
        scanStages.push({ event_type: 'preparation', created_at: pTs.prepared_at, actor_id: HUB.id, actor_name: HUB.name, actor_role: 'hub_agent', location: 'Hub Dubai', notes: `Colis ${parcelRef} préparé` });
      }
      if (pTs.shipped_at) {
        scanStages.push({ event_type: 'shipped', created_at: pTs.shipped_at, actor_id: HUB.id, actor_name: HUB.name, actor_role: 'hub_agent', location: 'Hub Dubai', notes: `Colis ${parcelRef} expédié vers ${islandOf[s.rid] || 'Comores'}` });
      }
      if (statusIdx >= 1 && pTs.in_transit_at) {
        scanStages.push({ event_type: 'in_transit', created_at: pTs.in_transit_at, actor_id: HUB.id, actor_name: HUB.name, actor_role: 'hub_agent', location: 'En transit', notes: `Colis ${parcelRef} en transit vers ${relaisNameOf[s.rid] || 'relais'}` });
      }
      if (statusIdx >= 2 && pTs.arrived_at) {
        const ra = relaisAgentOf[s.rid] || { id: HUB.id, name: HUB.name };
        scanStages.push({ event_type: 'arrived', created_at: pTs.arrived_at, actor_id: ra.id, actor_name: ra.name, actor_role: 'relay_agent', location: relaisNameOf[s.rid] || 'Relais', notes: `Colis ${parcelRef} arrivé au ${relaisNameOf[s.rid] || 'relais'}` });
      }
      if (statusIdx >= 2 && pTs.available_at) {
        const ra = relaisAgentOf[s.rid] || { id: HUB.id, name: HUB.name };
        scanStages.push({ event_type: 'available', created_at: pTs.available_at, actor_id: ra.id, actor_name: ra.name, actor_role: 'relay_agent', location: relaisNameOf[s.rid] || 'Relais', notes: `Colis ${parcelRef} disponible pour retrait` });
      }
      if (statusIdx >= 3 && pTs.collected_at) {
        const ra = relaisAgentOf[s.rid] || { id: HUB.id, name: HUB.name };
        scanStages.push({ event_type: 'collected', created_at: pTs.collected_at, actor_id: ra.id, actor_name: ra.name, actor_role: 'relay_agent', location: relaisNameOf[s.rid] || 'Relais', notes: `Colis ${parcelRef} récupéré par ${cl.name}` });
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
              crypto.randomUUID(), parcelId, orderId, scan.event_type,
              parcelRef, scan.actor_id, scan.actor_name, scan.actor_role,
              scan.location, scan.notes,
              JSON.stringify({ source: 'seed', device: 'system' }),
              'applied', scan.created_at,
            ]
          );
          await client.query('RELEASE SAVEPOINT sp_scan');
          summary.scan_events++;
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_scan');
        }
      }

      const incidentDefs = {
        weight_mismatch: { severity: 'high', status: 'open', title: 'Écart de poids détecté', description: `Le colis ${parcelRef} présente un écart de poids significatif : déclaré 1.5kg, mesuré ${weightKg}kg`, details: { declared_kg: 1.5, measured_kg: weightKg, delta_pct: Math.round(Math.abs(weightKg - 1.5) / 1.5 * 100) }, client_impact: 'delayed', detected_source: 'hub_agent' },
        missing_item: { severity: 'critical', status: 'investigating', title: 'Article manquant dans le colis', description: `Un article commandé est absent du colis ${parcelRef} lors du scan de réception`, details: { expected_items: totalQty, received_items: totalQty - 1, missing: orderItemIds[0]?.productName || 'inconnu' }, client_impact: 'partial_delivery', detected_source: 'relay_agent' },
        damaged_item: { severity: 'high', status: 'resolved', title: 'Article endommagé à la réception', description: `Un article du colis ${parcelRef} est arrivé endommagé (emballage écrasé)`, details: { item: orderItemIds[0]?.productName || 'inconnu', damage_type: 'crushed_packaging', photos: 1 }, client_impact: 'wrong_item', detected_source: 'relay_agent', resolved: true, resolution: { action: 'replacement_sent', resolved_note: 'Article remplacé et réexpédié' } },
        unexpected_item: { severity: 'medium', status: 'open', title: 'Article non attendu dans le colis', description: `Le colis ${parcelRef} contient un article qui ne correspond pas à la commande`, details: { unexpected_product: 'Article inconnu', order_ref: s.ref }, client_impact: 'wrong_item', detected_source: 'hub_agent' },
        sequence_violation: { severity: 'low', status: 'open', title: 'Violation de séquence de scan', description: `Le colis ${parcelRef} a été scanné "disponible" avant d'être scanné "arrivé"`, details: { expected_sequence: 'arrived → available', actual_sequence: 'available (arrived skipped)' }, client_impact: 'none', detected_source: 'system' },
      };

      for (const incType of s.inc) {
        const def = incidentDefs[incType];
        if (!def) continue;
        const detectedBy = ['relay_agent', 'customer'].includes(def.detected_source) ? (relaisAgentOf[s.rid] || HUB).id : HUB.id;
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
              crypto.randomUUID(), parcelId, orderId, incType, def.severity,
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
              crypto.randomUUID(), invNum, orderId, parcelId,
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
    }

    await client.query('COMMIT');

    const caTotal = summary.orders.reduce((s, o) => s + o.total_kmf, 0);
    log.info(`🌱 Rich seed v2: ${summary.orders.length} orders, ${summary.parcels.length} parcels, ${summary.scan_events} scans, ${summary.incidents.length} incidents, ${summary.invoices.length} invoices — by ${req.user.email}`);

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

// ─── POST /api/admin/purchasing/repair-ordered-without-pos ─────────
// AUD-05 — extrait de middleware/auth.js (god-middleware)
// Monté sous /api/admin via routes/admin/index.js → app.use('/api/admin', adminRouter)
router.post('/purchasing/repair-ordered-without-pos', ...guard, async (req, res, next) => {
  try {
    const result = await repairOrderedWithoutPurchaseOrders({
      dryRun: req.body?.dry_run !== false,
      limit: req.body?.limit || 25,
      user: req.user,
    });
    return res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

module.exports = router;
