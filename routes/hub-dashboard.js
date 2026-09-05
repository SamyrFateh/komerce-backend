/**
 * @komerce-arch
 * @role          dashboard-hub-dashboard
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-scope.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       operator_market_scopes, order_items, orders, parcel_items, parcels, products
 * @db-write      order_comments, order_incidents
 * @db-write-via:parcel-item-mutation-service parcel_items
 * @db-write-via:parcel-mutation-service parcels
 * @db-write-via:scan-write-service scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, market_operator_scoping (GAP-1)
 * @impact-areas  dashboard, admin-dashboard, market
 * @version       2026-09
 */

/**
 * KOMERCE — Hub Dashboard API v1.0
 * Centre de contrôle opérateur hub (Dubai)
 *
 * GET  /dashboard       — KPIs temps réel
 * GET  /queue           — File de travail priorisée
 * GET  /orders/:id      — Détail complet commande + colis + paiement + client
 * GET  /validate/:id    — Validations anti-erreur avant action
 * POST /orders/:id/start-prep   — Démarrer préparation
 * POST /orders/:id/create-parcel — Créer colis (complet ou partiel)
 * POST /parcels/:id/add-item    — Ajouter article au colis
 * POST /parcels/:id/remove-item — Retirer article du colis
 * POST /parcels/:id/ready       — Marquer colis prêt
 * POST /parcels/:id/ship        — Expédier colis + transport
 * POST /orders/:id/incident     — Signaler incident
 * POST /orders/:id/escalate     — Escalader admin
 * POST /orders/:id/comment      — Commentaire terrain
 * POST /orders/:id/backorder    — Marquer en attente fournisseur
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachAuthorizedMarketsForOperator, resolveMarketScopeRole, hasMarketScopeRole } = require('../middleware/require-market-scope');
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const { generateParcelRef } = require('../utils/reference');
const { transitionOrderStatus } = require('../services/order-status-machine');
const { recordHubPreparationScan } = require('../services/scan-write-service');
const {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
} = require('../services/parcel-item-mutation-service');
const {
  createHubParcel,
  createAutoPreparedParcel,
  setParcelWeight,
  appendParcelShipmentInfo,
} = require('../services/parcel-mutation-service');
const log = require('../utils/logger').child({ module: 'hub-dashboard' });
const hubQueries = require('../services/hub-dashboard-queries');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── GAP-1 (2026-09) ──────────────────────────────────────────────────────
// hubRead / hubSupervise : ouverts en plus au market_operator, scopé à son
// marché via operator_market_scopes (attachAuthorizedMarketsForOperator ne
// fait rien pour admin/agent_hub — aucune requête DB, aucun changement de
// comportement pour ces deux rôles).
// hubAuth reste EXCLUSIVEMENT admin/agent_hub pour toute opération physique
// sur le colis (scan, pack, seal, create-parcel, ready, ship, backorder) —
// un market_operator ne scanne, n'emballe ni n'expédie jamais.
const hubRead      = [authenticate, requireRole(['admin', 'agent_hub', 'market_operator']), attachAuthorizedMarketsForOperator];
const hubSupervise = [authenticate, requireRole(['admin', 'agent_hub', 'market_operator']), attachAuthorizedMarketsForOperator];

async function ensureMarketOperatorCanSupervise(req, marketId) {
  if (req.user.role !== 'market_operator') return null;
  if (!req.authorizedMarkets || !req.authorizedMarkets.has(marketId)) {
    return { status: 403, body: { error: 'Commande hors de votre périmètre marché', code: 'market_scope_denied' } };
  }
  const actualRole = await resolveMarketScopeRole(req.user.id, marketId);
  if (!hasMarketScopeRole(actualRole, 'manager')) {
    return {
      status: 403,
      body: { error: `Scope ${actualRole || 'aucun'} insuffisant — manager requis`, code: 'market_scope_role_insufficient' },
    };
  }
  return null;
}

// ── DDL géré par migrations/075_hub_shares_collective_schema.sql ────────────

router.get('/dashboard', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getDashboardKPIs({ authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getDashboardKPIs();
    res.json(data);
  } catch(e) { next(e); }
});

router.get('/queue', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getQueue(req.query, { authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getQueue(req.query);
    res.json(data);
  } catch(e) { next(e); }
});

router.get('/orders/:id', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getOrderDetail(req.params.id, { authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getOrderDetail(req.params.id);
    if (!data) return res.status(404).json({ error: 'Commande introuvable' });
    if (data.forbidden) return res.status(403).json({ error: 'Commande hors de votre périmètre marché', code: 'market_scope_denied' });
    res.json(data);
  } catch(e) { next(e); }
});

router.get('/validate/:id', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getValidation(req.params.id, { authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getValidation(req.params.id);
    if (!data) return res.status(404).json({ error: 'Commande introuvable' });
    if (data.forbidden) return res.status(403).json({ error: 'Commande hors de votre périmètre marché', code: 'market_scope_denied' });
    res.json(data);
  } catch(e) { next(e); }
});

router.post('/orders/:id/start-prep', ...hubAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT id, status, reference FROM orders WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    if (!['confirmed', 'ordered'].includes(order.status)) {
      return res.status(400).json({
        error: `Impossible de préparer — statut actuel: ${order.status}`,
        hint: 'La commande doit être confirmée ou commandée'
      });
    }

    const _prepResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'preparation',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'hub_start_prep',
    });
    if (!_prepResult.success) {
      log.warn(`[HUB] transitionOrderStatus failed for ${order.id}: ${_prepResult.error}`);
    }

    const scanCodePrep = `HUB-PREP-${order.id.slice(0, 8).toUpperCase()}`;
    await recordHubPreparationScan(db, {
      orderId: order.id,
      scannedBy: req.user.id,
      notes: `Pr\u00e9paration d\u00e9marr\u00e9e par ${req.user.full_name || 'hub'}`,
      scanCode: scanCodePrep,
    });

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', 'Préparation démarrée')
    `, [order.id, req.user.id]);

    res.json({ message: `Commande ${order.reference} en préparation`, status: 'preparation' });
  } catch(e) { next(e); }
});

router.post('/orders/:id/create-parcel', ...hubAuth, async (req, res, next) => {
  try {
    const { type = 'standard', notes, item_ids } = req.body;
    const { rows } = await db.query('SELECT id, reference FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    const reference = await generateParcelRef(db);
    let external_code = null, seal_code = null;
    try {
      const security = require('../services/parcel-security');
      external_code = security.generateExternalCode();
      seal_code = security.generateSealCode();
    } catch(e) {}

    const parcel = await createHubParcel(db, {
      reference,
      externalCode: external_code,
      sealCode: seal_code,
      orderId: order.id,
      type,
      notes,
    });

    if (item_ids && item_ids.length) {
      for (const itemId of item_ids) {
        await assignWholeOrderItemToParcel(db, {
          parcelId: parcel.id,
          orderItemId: itemId,
          orderId: order.id,
        }).catch(() => {});
      }
    }

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `Colis ${reference} créé (${type})`]);

    res.status(201).json({
      message: `Colis ${reference} créé`,
      parcel,
      items_assigned: item_ids ? item_ids.length : 0
    });
  } catch(e) { next(e); }
});

router.post('/orders/:id/auto-prepare', ...hubAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      `SELECT id, reference, status FROM orders WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Commande introuvable' }); }

    if (!['confirmed', 'ordered', 'preparation'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Auto-prepare impossible — statut: ${order.status}`,
        hint: 'La commande doit être confirmée, commandée ou en préparation'
      });
    }

    const { rows: unassigned } = await client.query(`
      SELECT oi.id, oi.quantity, oi.product_id, p.name AS product_name, p.weight_kg
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM parcel_items pi
          JOIN parcels pa ON pa.id = pi.parcel_id AND pa.status != 'cancelled'
          WHERE pi.order_item_id = oi.id
        )
      ORDER BY oi.created_at ASC
    `, [order.id]);

    if (unassigned.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        message: 'Tous les articles sont déjà assignés à un colis',
        already_complete: true
      });
    }

    if (['confirmed', 'ordered'].includes(order.status)) {
      await transitionOrderStatus({
        orderId: order.id,
        newStatus: 'preparation',
        actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
        source: 'hub_auto_prepare',
        dbClient: client,
      });
    }

    const reference = await generateParcelRef(client);
    let external_code = null, seal_code = null;
    try {
      const security = require('../services/parcel-security');
      external_code = security.generateExternalCode();
      seal_code = security.generateSealCode();
    } catch(e) {}

    const parcel = await createAutoPreparedParcel(client, {
      reference,
      externalCode: external_code,
      sealCode: seal_code,
      orderId: order.id,
      notes: `Auto-cr\u00e9\u00e9 sur scan QR \u2014 ${unassigned.length} article(s)`,
    });

    for (const item of unassigned) {
      await assignParcelItem(client, {
        parcelId: parcel.id,
        orderItemId: item.id,
        productId: item.product_id,
        quantity: item.quantity,
      });
    }

    const totalWeight = unassigned.reduce((s, i) => s + ((i.weight_kg || 0.5) * i.quantity), 0);
    await setParcelWeight(client, {
      parcelId: parcel.id,
      weightKg: Math.round(totalWeight * 100) / 100,
    });

    try {
      await client.query('SAVEPOINT sp_scans_auto_prepare');
      const scanCodeAuto = `HUB-AUTO-${order.id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      await recordHubPreparationScan(client, {
        orderId: order.id,
        scannedBy: req.user.id,
        notes: `Auto-prepare: colis ${reference} cr\u00e9\u00e9, ${unassigned.length} article(s) assign\u00e9(s)`,
        scanCode: scanCodeAuto,
      });
      await client.query('RELEASE SAVEPOINT sp_scans_auto_prepare');
    } catch(e) {
      await client.query('ROLLBACK TO SAVEPOINT sp_scans_auto_prepare').catch(() => {});
      log.warn('[HUB] scan auto-prepare skipped:', e.message);
    }

    await client.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `📦 Auto-prepare: colis ${reference} créé (${unassigned.length} article(s))`]);

    await client.query('COMMIT');
    const { rows: [fullParcel] } = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    res.status(201).json({
      message: `Colis ${reference} créé automatiquement — ${unassigned.length} article(s) assigné(s)`,
      parcel: fullParcel,
      items_assigned: unassigned.length,
      items: unassigned.map(i => ({ id: i.id, product_name: i.product_name, quantity: i.quantity })),
      next_action: 'ready',
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

router.post('/parcels/:id/add-item', ...hubAuth, async (req, res, next) => {
  try {
    const { order_item_id, quantity } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const { rows: [parcel] } = await db.query(
      'SELECT id, order_id, reference FROM parcels WHERE id = $1', [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    const { rows: [item] } = await db.query(
      'SELECT id, quantity, product_id FROM order_items WHERE id = $1 AND order_id = $2',
      [order_item_id, parcel.order_id]
    );
    if (!item) return res.status(400).json({ error: "Article n'appartient pas à cette commande" });

    const qty = quantity || item.quantity;
    const pi = await addParcelItem(db, {
      parcelId: parcel.id,
      orderItemId: order_item_id,
      productId: item.product_id,
      quantity: qty,
    });

    res.json({ message: 'Article ajout\u00e9', item: pi || { already_assigned: true } });
  } catch(e) { next(e); }
});

router.post('/parcels/:id/remove-item', ...hubAuth, async (req, res, next) => {
  try {
    const { order_item_id } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const deleted = await removeParcelItem(db, {
      parcelId: req.params.id,
      orderItemId: order_item_id,
    });

    if (!deleted) return res.status(404).json({ error: 'Article non trouv\u00e9 dans ce colis' });
    res.json({ message: 'Article retir\u00e9', deleted });
  } catch(e) { next(e); }
});

router.post('/parcels/:id/ready', ...hubAuth, async (req, res, next) => {
  try {
    const { rows: [parcel] } = await db.query(
      "SELECT id, order_id, reference, status FROM parcels WHERE id = $1",
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    const { rows: [cov] } = await db.query(`
      SELECT COUNT(oi.id) AS total,
             COUNT(pi.order_item_id) FILTER (WHERE pa.status <> 'cancelled') AS packed
      FROM order_items oi
      LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id
      LEFT JOIN parcels pa ON pa.id = pi.parcel_id
      WHERE oi.order_id = $1
    `, [parcel.order_id]);
    if (parseInt(cov.total) === 0 || parseInt(cov.packed) < parseInt(cov.total)) {
      return res.status(400).json({
        error: 'Colis incomplet',
        hint: `${cov.packed}/${cov.total} article(s) emballé(s) — emballez tout avant de marquer prêt`
      });
    }

    await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'preparation',
      scan_id: null,
      scanned_by: req.user.id,
      notes: `Colis ${parcel.reference} prêt`
    });

    res.json({ message: `Colis ${parcel.reference} prêt`, status: 'preparation' });
  } catch(e) { next(e); }
});

router.post('/parcels/:id/ship', ...hubAuth, async (req, res, next) => {
  try {
    const { transport, batch_id, notes } = req.body;

    const { rows: [parcel] } = await db.query(
      "SELECT id, order_id, reference, status FROM parcels WHERE id = $1",
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });
    if (parcel.status === 'draft') {
      return res.status(400).json({ error: 'Colis non préparé', hint: 'Marquez le colis prêt avant de l’expédier' });
    }

    const { rows: [itemCheck] } = await db.query(
      'SELECT COUNT(*) AS cnt FROM parcel_items WHERE parcel_id = $1',
      [parcel.id]
    );
    if (parseInt(itemCheck.cnt) === 0) {
      return res.status(400).json({
        error: 'Impossible — colis vide',
        hint: 'Ajoutez des articles et marquez prêt avant expédition'
      });
    }

    const { rows: [order] } = await db.query(
      'SELECT payment_mode, payment_status, reference FROM orders WHERE id = $1',
      [parcel.order_id]
    );
    if (order.payment_status !== 'paid' && order.payment_mode !== 'cash_relais') {
      return res.status(400).json({
        error: `⚠️ Commande ${order.reference} non payée`,
        hint: 'Vérifiez le paiement avant expédition'
      });
    }

    await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'shipped',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Expédié par hub — transport: ${transport || 'non spécifié'}`
    });

    await appendParcelShipmentInfo(db, {
      parcelId: parcel.id,
      note: `\n[SHIPPED] ${new Date().toISOString()} | transport: ${transport || '-'} | batch: ${batch_id || '-'}`,
    });

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [parcel.order_id, req.user.id,
       `Colis ${parcel.reference} expédié — ${transport || 'transport non précisé'}`]);

    res.json({
      message: `Colis ${parcel.reference} expédié ✈️`,
      status: 'shipped',
      transport: transport || null
    });
  } catch(e) { next(e); }
});

router.post('/orders/:id/incident', ...hubSupervise, async (req, res, next) => {
  try {
    const { type, description, priority = 'normal' } = req.body;
    if (!type || !description) return res.status(400).json({ error: 'type et description requis' });

    const validTypes = ['retard', 'blocage', 'paiement', 'stock', 'colis_endommage', 'colis_perdu', 'client_absent', 'autre'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
    }

    const { rows: [order] } = await db.query('SELECT id, market_id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const denial = await ensureMarketOperatorCanSupervise(req, order.market_id);
    if (denial) return res.status(denial.status).json(denial.body);

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [order.id, type, description, priority, req.user.id]);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `🚨 Incident ${type}: ${description}`]);

    res.status(201).json({ message: 'Incident signalé', incident });
  } catch(e) { next(e); }
});

router.post('/orders/:id/escalate', ...hubSupervise, async (req, res, next) => {
  try {
    const { reason, priority = 'high' } = req.body;
    if (!reason) return res.status(400).json({ error: 'Raison requise' });

    const { rows: [order] } = await db.query(
      'SELECT id, reference, market_id FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const denial = await ensureMarketOperatorCanSupervise(req, order.market_id);
    if (denial) return res.status(denial.status).json(denial.body);

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'autre', $2, 'urgent', $3)
      RETURNING *
    `, [order.id, `[ESCALADE] ${reason}`, req.user.id]);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `⚠️ ESCALADE: ${reason}`]);

    res.status(201).json({
      message: `Commande ${order.reference} escaladée`,
      incident,
      priority
    });
  } catch(e) { next(e); }
});

router.post('/orders/:id/comment', ...hubSupervise, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenu requis' });

    const { rows: [order] } = await db.query('SELECT id, market_id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const denial = await ensureMarketOperatorCanSupervise(req, order.market_id);
    if (denial) return res.status(denial.status).json(denial.body);

    const { rows: [comment] } = await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
      RETURNING *
    `, [order.id, req.user.id, req.body.content]);

    res.json({ message: 'Commentaire ajouté', comment });
  } catch(e) { next(e); }
});

router.post('/orders/:id/backorder', ...hubAuth, async (req, res, next) => {
  try {
    const { reason, items_waiting } = req.body;

    const { rows: [order] } = await db.query(
      'SELECT id, reference FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'stock', $2, 'normal', $3)
    `, [order.id, reason || 'En attente fournisseur', req.user.id]);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id,
       `📦 Backorder: ${reason || 'En attente fournisseur'}${items_waiting ? ` (${items_waiting.length} articles)` : ''}`]);

    res.json({
      message: `Commande ${order.reference} marquée en attente`,
      status: 'backorder'
    });
  } catch(e) { next(e); }
});

module.exports = router;
