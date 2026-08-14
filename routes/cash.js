/**
 * @komerce-arch
 * @role          payment-cash
 * @domain        payment
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       cash_collections, cash_deposits, orders, users
 * @db-write      cash_deposits
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment
 * @version       2026-06
 */

/**
 * KOMERCE — Cash Reconciliation API v1
 *
 * Option C : l'agent relais confirme "cash reçu" → montant auto = order.total_kmf
 * Pas de saisie montant → élimine 80% des fraudes (non-déclaration)
 *
 * Tables : cash_collections, cash_deposits, cash_reconciliation
 *
 * Routes :
 *   POST /api/cash/collect/:orderId       — Agent relais confirme encaissement
 *   GET  /api/cash/collections             — Liste collections (admin/agent)
 *   POST /api/cash/deposit                 — Agent déclare un dépôt
 *   GET  /api/cash/deposits                — Liste dépôts (admin/agent)
 *   GET  /api/cash/reconciliation          — Lancer réconciliation (admin)
 *   GET  /api/cash/reconciliation/agents   — Résumé par agent (admin)
 *   POST /api/cash/deposits/:id/verify     — Admin valide un dépôt
 *   POST /api/cash/deposits/:id/dispute    — Admin conteste un dépôt
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { collectCash } = require('../services/cash-operations'); // [R5]
const { cacheCodeForReveal } = require('../services/pickup-secret-service');
const notifSvc = require('../services/notification-service');
const log = require('../utils/logger').child({ module: 'cash-route' });

// ── Helper : is admin or relay agent ────────────────────────────────────────
function isRelaisOrAdmin(req) {
  const role = req.user?.role;
  return role === 'admin' || role === 'agent_relais';
}

function requireRelaisOrAdmin(req, res, next) {
  if (!isRelaisOrAdmin(req)) {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. POST /collect/:orderId — Agent relais confirme "cash reçu"
// ══════════════════════════════════════════════════════════════════════════════
// Option C : montant = order.total_kmf, pas de saisie manuelle
router.post('/collect/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { orderId } = req.params;

    const result = await collectCash({ orderId, agentUser: req.user, dbClient: client });

    if (result.order_not_found) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (result.invalid_payment_mode) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cette commande n\'est pas en paiement cash relais' });
    }
    if (result.invalid_payment_status) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Encaissement impossible — commande déjà en statut paiement '${result.payment_status}'`,
        current_payment_status: result.payment_status,
      });
    }
    if (result.invalid_status) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Collecte impossible — commande en statut '${result.status}'`,
        current_status: result.status,
      });
    }
    if (result.agent_config_error) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Configuration agent incomplète — contactez un admin' });
    }
    if (result.cross_relais_blocked) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cette commande appartient à un autre relais — vous ne pouvez pas l\'encaisser' });
    }
    if (result.already_collected) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cash déjà déclaré pour cette commande', collection_id: result.collection_id });
    }
    if (result.stock_blocked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Stock insuffisant — encaissement annulé',
        insufficient_items: result.insufficient_items,
      });
    }

    await client.query('COMMIT');

    if (result.pickupCodeToCache) {
      cacheCodeForReveal(result.collection.order_id, result.pickupCodeToCache)
        .catch(e => log.error({ err: e }, '[CASH-COLLECT] cacheCodeForReveal error:'));
    }

    // CASH-01 — Hooks post-paiement communs (notification + sourcing),
    // alignés sur /api/payments/cash/confirm et /api/pickup/pay-cash.
    // LOY-01 — Hook fidélité gros panier
    try {
      const loyaltyService = require('../services/loyalty-service');
      loyaltyService.handleOrderConfirmed({ orderId: result.collection.order_id })
        .then(r => { if (r && !r.skipped) log.info({ orderId: result.collection.order_id }, '[loyalty] hook OK:', r); })
        .catch(e => log.warn({ err: e }, '[loyalty] hook error:'));
    } catch (_) { /* non-bloquant */ }

    try {
      const { triggerPurchasing } = require('../services/purchasing-trigger-service');
      const orderId = result.collection.order_id;
      db.query('SELECT reference FROM orders WHERE id = $1', [orderId])
        .then(({ rows: [o] }) => {
          const orderRef = o?.reference;
          notifSvc.notifyPaymentConfirmed(orderId, orderRef)
            .catch(e => log.error({ err: e }, '[CASH-COLLECT-NOTIF] notification failed'));
          require('../services/invoice-service').issueInvoice(orderId)
            .catch(e => log.error({ err: e }, '[CASH-COLLECT-INVOICE] private PDF generation failed'));
          triggerPurchasing(orderId)
            .then(() => log.info({ order_id: orderId }, '[PURCHASING] Cash collect trigger OK'))
            .catch(e => log.error({ err: e, order_id: orderId }, '[PURCHASING] Cash collect trigger error'));
        })
        .catch(e => log.error({ err: e }, '[CASH-COLLECT-POSTCOMMIT] lookup reference failed'));
    } catch (e) {
      log.error({ err: e }, '[CASH-COLLECT-POSTCOMMIT] Non-fatal hook error');
    }

    res.status(201).json({
      success: true,
      message: `Cash confirmé : ${result.amount_kmf.toLocaleString('fr-FR')} KMF`,
      collection: result.collection,
      payment_cycle: { noop: result.noop },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /collections — Liste des encaissements
// ══════════════════════════════════════════════════════════════════════════════
// Admin : voit tout | Agent relais : voit ses propres collections
router.get('/collections', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { agent_id, from, to, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE 1=1';
    const params = [];
    let paramIdx = 0;

    if (!isAdmin) {
      paramIdx++;
      where += ` AND cc.collected_by = $${paramIdx}`;
      params.push(req.user.id);
    } else if (agent_id) {
      paramIdx++;
      where += ` AND cc.collected_by = $${paramIdx}`;
      params.push(agent_id);
    }

    if (from) {
      paramIdx++;
      where += ` AND cc.confirmed_at >= $${paramIdx}`;
      params.push(from);
    }
    if (to) {
      paramIdx++;
      where += ` AND cc.confirmed_at <= $${paramIdx}`;
      params.push(to);
    }

    const { rows } = await db.query(`
      SELECT cc.*,
             o.reference AS order_reference,
             o.total_kmf AS order_total_kmf,
             o.status AS order_status,
             u.full_name AS agent_name,
             u.phone AS agent_phone
      FROM cash_collections cc
      JOIN orders o ON o.id = cc.order_id
      LEFT JOIN users u ON u.id = cc.collected_by
      ${where}
      ORDER BY cc.confirmed_at DESC
      LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}
    `, [...params, Number(limit), offset]);

    const { rows: [{ cnt }] } = await db.query(`
      SELECT COUNT(*) AS cnt FROM cash_collections cc ${where}
    `, params);

    res.json({
      collections: rows,
      total: Number(cnt),
      page: Number(page),
      pages: Math.ceil(Number(cnt) / Number(limit)),
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. POST /deposit — Agent déclare un dépôt
// ══════════════════════════════════════════════════════════════════════════════
router.post('/deposit', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const agentId = req.user.id;
    const {
      amount_kmf,
      deposit_method,  // 'mobile_money' | 'bank' | 'physical'
      reference,       // n° transaction / reçu
      proof_url,       // photo du justificatif (optionnel)
      period_start,    // date début période couverte
      period_end,      // date fin période couverte
      notes,
    } = req.body;

    // Validation
    if (!amount_kmf || amount_kmf <= 0) {
      return res.status(400).json({ error: 'Montant requis et > 0' });
    }
    const METHODS = ['mobile_money', 'bank', 'physical'];
    if (!METHODS.includes(deposit_method)) {
      return res.status(400).json({ error: `Méthode invalide. Options: ${METHODS.join(', ')}` });
    }
    if (!period_start || !period_end) {
      return res.status(400).json({ error: 'Période (period_start, period_end) requise' });
    }

    const { rows: [deposit] } = await db.query(`
      INSERT INTO cash_deposits
        (agent_id, amount_kmf, deposit_method, reference, proof_url,
         period_start, period_end, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [agentId, amount_kmf, deposit_method, reference || null,
        proof_url || null, period_start, period_end, notes || null]);

    res.status(201).json({
      success: true,
      message: `Dépôt de ${Number(amount_kmf).toLocaleString('fr-FR')} KMF enregistré`,
      deposit,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /deposits — Liste des dépôts
// ══════════════════════════════════════════════════════════════════════════════
router.get('/deposits', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { agent_id, status: filterStatus, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE 1=1';
    const params = [];
    let paramIdx = 0;

    if (!isAdmin) {
      paramIdx++;
      where += ` AND cd.agent_id = $${paramIdx}`;
      params.push(req.user.id);
    } else if (agent_id) {
      paramIdx++;
      where += ` AND cd.agent_id = $${paramIdx}`;
      params.push(agent_id);
    }

    if (filterStatus) {
      paramIdx++;
      where += ` AND cd.status = $${paramIdx}`;
      params.push(filterStatus);
    }

    const { rows } = await db.query(`
      SELECT cd.*,
             u.full_name AS agent_name,
             u.phone AS agent_phone,
             v.full_name AS verified_by_name
      FROM cash_deposits cd
      LEFT JOIN users u ON u.id = cd.agent_id
      LEFT JOIN users v ON v.id = cd.verified_by
      ${where}
      ORDER BY cd.deposited_at DESC
      LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}
    `, [...params, Number(limit), offset]);

    const { rows: [{ cnt }] } = await db.query(`
      SELECT COUNT(*) AS cnt FROM cash_deposits cd ${where}
    `, params);

    res.json({
      deposits: rows,
      total: Number(cnt),
      page: Number(page),
      pages: Math.ceil(Number(cnt) / Number(limit)),
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. POST /deposits/:id/verify — Admin valide un dépôt
// ══════════════════════════════════════════════════════════════════════════════
router.post('/deposits/:id/verify', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const { rows: [deposit] } = await db.query(`
      UPDATE cash_deposits
      SET status = 'verified',
          verified_by = $1,
          verified_at = NOW(),
          notes = COALESCE($3, notes)
      WHERE id = $2
      RETURNING *
    `, [req.user.id, id, notes || null]);

    if (!deposit) {
      return res.status(404).json({ error: 'Dépôt introuvable' });
    }

    res.json({ success: true, message: 'Dépôt vérifié', deposit });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. POST /deposits/:id/dispute — Admin conteste un dépôt
// ══════════════════════════════════════════════════════════════════════════════
router.post('/deposits/:id/dispute', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Raison requise' });
    }

    const { rows: [deposit] } = await db.query(`
      UPDATE cash_deposits
      SET status = 'disputed',
          verified_by = $1,
          verified_at = NOW(),
          notes = $3
      WHERE id = $2
      RETURNING *
    `, [req.user.id, id, reason]);

    if (!deposit) {
      return res.status(404).json({ error: 'Dépôt introuvable' });
    }

    res.json({ success: true, message: 'Dépôt contesté', deposit });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GET /reconciliation — Calcul réconciliation pour une période
// ══════════════════════════════════════════════════════════════════════════════
// ?agent_id=xxx&from=2025-04-01&to=2025-04-20
// Ou sans params → tous les agents, semaine courante
router.get('/reconciliation', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      agent_id,
      from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      to   = new Date().toISOString().slice(0, 10),
    } = req.query;

    let agentFilter = '';
    const params = [from, to];

    if (agent_id) {
      agentFilter = 'AND agent_id_filter = $3';
      params.push(agent_id);
    }

    // ── Attendu : commandes cash livrées/collectées dans la période ──
    // Expected: total cash orders delivered in period
    // We don't track which relay agent is assigned to which order,
    // so we aggregate all cash orders and compare globally.
    // Per-agent breakdown comes from cash_collections (who actually collected).
    const expectedQuery = `
      SELECT
        '00000000-0000-0000-0000-000000000000'::uuid AS agent_id,
        'Tous agents' AS agent_name,
        NULL AS agent_phone,
        COALESCE(SUM(o.total_kmf), 0) AS expected_kmf,
        COUNT(*) AS expected_count
      FROM orders o
      WHERE o.payment_mode = 'cash_relais'
        AND o.status IN ('available', 'collected')
        AND o.created_at::date BETWEEN $1 AND $2
    `;

    // ── Déclaré : cash_collections dans la période ──
    const declaredQuery = `
      SELECT
        cc.collected_by AS agent_id,
        SUM(cc.amount_kmf) AS declared_kmf,
        COUNT(*) AS declared_count
      FROM cash_collections cc
      WHERE cc.confirmed_at::date BETWEEN $1 AND $2
      ${agent_id ? 'AND cc.collected_by = $3' : ''}
      GROUP BY cc.collected_by
    `;

    // ── Déposé : cash_deposits dans la période ──
    const depositedQuery = `
      SELECT
        cd.agent_id,
        SUM(cd.amount_kmf) AS deposited_kmf,
        COUNT(*) AS deposit_count,
        SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'verified') AS verified_kmf,
        SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'pending') AS pending_kmf,
        SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'disputed') AS disputed_kmf
      FROM cash_deposits cd
      WHERE cd.period_start >= $1 AND cd.period_end <= $2
      ${agent_id ? 'AND cd.agent_id = $3' : ''}
      GROUP BY cd.agent_id
    `;

    const [expectedRes, declaredRes, depositedRes] = await Promise.all([
      db.query(expectedQuery, params),
      db.query(declaredQuery, params),
      db.query(depositedQuery, params),
    ]);

    // Merge par agent
    const agentMap = new Map();

    for (const row of expectedRes.rows) {
      agentMap.set(row.agent_id, {
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        agent_phone: row.agent_phone,
        expected_kmf: Number(row.expected_kmf),
        expected_count: Number(row.expected_count),
        declared_kmf: 0,
        declared_count: 0,
        deposited_kmf: 0,
        deposit_count: 0,
        verified_kmf: 0,
        pending_kmf: 0,
        disputed_kmf: 0,
      });
    }

    for (const row of declaredRes.rows) {
      const entry = agentMap.get(row.agent_id) || {
        agent_id: row.agent_id,
        expected_kmf: 0, expected_count: 0,
        deposited_kmf: 0, deposit_count: 0,
        verified_kmf: 0, pending_kmf: 0, disputed_kmf: 0,
      };
      entry.declared_kmf = Number(row.declared_kmf);
      entry.declared_count = Number(row.declared_count);
      agentMap.set(row.agent_id, entry);
    }

    for (const row of depositedRes.rows) {
      const entry = agentMap.get(row.agent_id) || {
        agent_id: row.agent_id,
        expected_kmf: 0, expected_count: 0,
        declared_kmf: 0, declared_count: 0,
      };
      entry.deposited_kmf = Number(row.deposited_kmf);
      entry.deposit_count = Number(row.deposit_count);
      entry.verified_kmf = Number(row.verified_kmf || 0);
      entry.pending_kmf = Number(row.pending_kmf || 0);
      entry.disputed_kmf = Number(row.disputed_kmf || 0);
      agentMap.set(row.agent_id, entry);
    }

    // Calcul gaps + status
    const agents = [];
    for (const a of agentMap.values()) {
      a.gap_collection = a.expected_kmf - a.declared_kmf;
      a.gap_deposit = a.declared_kmf - a.deposited_kmf;

      // Status
      if (a.gap_collection === 0 && a.gap_deposit === 0) {
        a.status = 'clean';
      } else if (a.gap_collection > 0 && a.gap_collection < a.expected_kmf * 0.1) {
        a.status = 'warning';
      } else if (a.gap_collection >= a.expected_kmf * 0.1 || a.gap_deposit > a.expected_kmf * 0.2) {
        a.status = 'alert';
      } else {
        a.status = 'warning';
      }

      agents.push(a);
    }

    // Totaux
    const totals = agents.reduce((acc, a) => ({
      expected_kmf: acc.expected_kmf + a.expected_kmf,
      declared_kmf: acc.declared_kmf + a.declared_kmf,
      deposited_kmf: acc.deposited_kmf + a.deposited_kmf,
      gap_collection: acc.gap_collection + a.gap_collection,
      gap_deposit: acc.gap_deposit + a.gap_deposit,
    }), { expected_kmf: 0, declared_kmf: 0, deposited_kmf: 0, gap_collection: 0, gap_deposit: 0 });

    res.json({
      period: { from, to },
      generated_at: new Date().toISOString(),
      totals,
      agents: agents.sort((a, b) => b.gap_collection - a.gap_collection),
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. GET /reconciliation/agents — Résumé rapide par agent (widget radar)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/reconciliation/agents', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: agents } = await db.query(`
      WITH agent_collections AS (
        SELECT
          cc.collected_by AS agent_id,
          SUM(cc.amount_kmf) AS total_declared_kmf,
          COUNT(*) AS total_collections,
          MAX(cc.confirmed_at) AS last_collection
        FROM cash_collections cc
        GROUP BY cc.collected_by
      ),
      agent_deposits AS (
        SELECT
          cd.agent_id,
          SUM(cd.amount_kmf) AS total_deposited_kmf,
          SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'verified') AS verified_kmf,
          SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'pending') AS pending_kmf,
          COUNT(*) AS total_deposits,
          MAX(cd.deposited_at) AS last_deposit
        FROM cash_deposits cd
        GROUP BY cd.agent_id
      )
      SELECT
        u.id AS agent_id,
        u.full_name AS agent_name,
        u.phone AS agent_phone,
        COALESCE(ac.total_declared_kmf, 0) AS total_declared_kmf,
        COALESCE(ac.total_collections, 0) AS total_collections,
        ac.last_collection,
        COALESCE(ad.total_deposited_kmf, 0) AS total_deposited_kmf,
        COALESCE(ad.verified_kmf, 0) AS verified_kmf,
        COALESCE(ad.pending_kmf, 0) AS pending_deposit_kmf,
        COALESCE(ad.total_deposits, 0) AS total_deposits,
        ad.last_deposit,
        COALESCE(ac.total_declared_kmf, 0) - COALESCE(ad.total_deposited_kmf, 0) AS balance_kmf
      FROM users u
      LEFT JOIN agent_collections ac ON ac.agent_id = u.id
      LEFT JOIN agent_deposits ad ON ad.agent_id = u.id
      WHERE u.role = 'agent_relais'
      ORDER BY balance_kmf DESC
    `);

    res.json({
      generated_at: new Date().toISOString(),
      agents,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. GET /uncollected — Commandes cash livrées sans déclaration (alerte)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/uncollected', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const hours = Number(req.query.hours || 48);

    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.total_kmf, o.status, o.created_at,
             o.payment_mode,
             u.full_name AS client_name,
             u.phone AS client_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_mode = 'cash_relais'
        AND o.status IN ('available', 'collected')
        AND o.created_at < NOW() - ($1 * INTERVAL '1 hour')
        AND NOT EXISTS (
          SELECT 1 FROM cash_collections cc WHERE cc.order_id = o.id
        )
      ORDER BY o.created_at ASC
    `, [hours]);

    const totalMissing = rows.reduce((s, r) => s + Number(r.total_kmf), 0);

    res.json({
      hours_threshold: hours,
      count: rows.length,
      total_missing_kmf: totalMissing,
      orders: rows,
    });
  } catch (err) { next(err); }
});

module.exports = router;
