/**
 * @komerce-arch
 * @role          purchasing
 * @domain        purchasing
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, product_suppliers, purchase_orders, suppliers, supplier_execution_payments, supplier_payment_settlements
 * @db-write      product_suppliers, suppliers, supplier_payment_settlements
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Purchasing Routes v8.2
 *
 * Routes HTTP admin uniquement — logique métier déléguée aux services :
 *   • triggerPurchasing   → services/purchasing-trigger-service.js
 *
 * module.exports.triggerPurchasing est ré-exporté pour la compatibilité
 * avec payments.js, pickup-secret.js, repair-ordered-without-purchase-orders.js.
 *
 * Routes exposées :
 *   GET  /api/purchasing                              → pipeline sourcing en cours
 *   GET  /api/purchasing/suppliers                    → liste fournisseurs actifs
 *   POST /api/purchasing/suppliers                    → créer un fournisseur
 *   POST /api/purchasing/suppliers/:id/map            → mapper un produit → fournisseur
 *   DELETE /api/purchasing/suppliers/:id              → supprimer un fournisseur
 *   GET  /api/purchasing/order/:order_id/completeness → état de réception d'une commande [v8.2]
 *   GET  /api/purchasing/:order_id                    → achats liés à une commande
 *   POST /api/purchasing/:order_id/confirm            → confirmer manuellement un achat
 *   POST /api/purchasing/:id/receive                  → 410 DECLARATIVE_RECEIVE_CLOSED (réception = POST /api/scans/hub/receive)
 *   DELETE /api/purchasing/po/:po_id                  → annuler une purchase order
 *
 * Forme regroupée (PR 4, KOMERCE_GROUPED_PURCHASING=1 ; sinon 409 GROUPED_PURCHASING_DISABLED) :
 *   GET  /api/purchasing/open-lines[?market_id=]      → lignes ouvertes par (fournisseur, hub, marché), filtre opérateur
 *   GET  /api/purchasing/po/:po_id                    → lecture d'une PO regroupée (lignes + marchés)
 *   POST /api/purchasing/po/prepare                   → PO regroupée draft + rattachement des lignes
 *   POST /api/purchasing/po/:po_id/attach             → ajouter des lignes ouvertes à une PO draft (même marché)
 *   POST /api/purchasing/po/:po_id/detach             → détacher des lignes d'une PO draft
 *   POST /api/purchasing/po/:po_id/discard            → abandonner une PO draft
 *   POST /api/purchasing/lines/:id/cancel             → annuler une ligne ouverte ou en brouillon
 * Engagement (PR 5) :
 *   POST /api/purchasing/po/:po_id/submit             → soumettre une PO draft (préparation par groupe, message agrégé)
 *   POST /api/purchasing/po/:po_id/sent               → enregistrer l'envoi réellement effectué (canal, auteur, heure ; immuable)
 *   POST /api/purchasing/po/:po_id/confirm            → confirmer une PO notified ligne par ligne (reliquat en ligne ouverte)
 *   POST /api/purchasing/lines                        → créer une ligne ouverte manuellement (ex. reliquat chez un autre fournisseur)
 *   POST /api/purchasing/lines/:id/settle             → clôturer une ligne confirmée (reliquat en ligne ouverte)
 * Coût d'achat réel (migration 294) :
 *   POST /api/purchasing/supplier-payments/:payment_id/settlements → saisir un règlement/remboursement réellement débité (KMF, preuve, idempotent)
 *   GET  /api/purchasing/supplier-payments/:payment_id/settlements → lister les règlements du paiement
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'purchasing' });

const { triggerPurchasing } = require('../services/purchasing-trigger-service');
const { resolveCanonicalMappingMoney } = require('../services/purchasing-canonical-money');
const { deleteSupplier, confirmPurchaseOrder, cancelPurchaseOrder } = require('../services/purchasing-admin-service');
const grouped = require('../services/purchasing-grouped-service');
const { getPurchaseOrderDetail } = require('../services/purchasing-order-detail');
const engagement = require('../services/purchasing-engagement-service');
const settlements = require('../services/supplier-payment-settlement-service');

const guard = [authenticate, requireRole(['admin'])];
// Le Hub constitue et suit ses PO regroupées (mission #3247) ; le reste des achats reste réservé à l'admin.
const groupedGuard = [authenticate, requireRole(['admin', 'agent_hub'])];

// ─── GET /api/purchasing — pipeline sourcing en cours ────────────────────────

router.get('/', ...guard, async (req, res, next) => {
  try {
    const { status } = req.query;
    const conditions = ['1=1'];
    const params     = [];
    if (status) { conditions.push(`po.status = $${params.length + 1}`); params.push(status); }

    const { rows } = await db.query(`
      SELECT
        po.*,
        o.reference AS order_ref,
        o.status    AS order_status,
        s.name      AS supplier_name,
        s.platform,
        s.auto_order,
        s.contact_phone
      FROM purchase_orders po
      LEFT JOIN orders o ON o.id  = po.order_id
      JOIN suppliers s ON s.id  = po.supplier_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY po.created_at DESC
      LIMIT 100
    `, params);

    res.json({ purchase_orders: rows, total: rows.length });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   FORME REGROUPÉE (PR 4) — déclarées avant /:order_id pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

// Champs de diagnostic relayés tels quels (verdicts de soumission, écarts de lignes de confirmation…).
const GROUPED_ERROR_EXTRAS = ['cap_currency', 'already_settled_currency', 'settled_currency', 'fees_kmf', 'verdicts', 'missing', 'extra', 'received_quantity', 'confirmed_quantity', 'quantity', 'purchase_line_id', 'provider', 'details', 'requested', 'attached', 'detached'];

function groupedError(err, res, next) {
  if (err && err.status) {
    const body = { error: err.message, code: err.code, current_status: err.current_status };
    for (const key of GROUPED_ERROR_EXTRAS) if (err[key] !== undefined) body[key] = err[key];
    return res.status(err.status).json(body);
  }
  return next(err);
}

router.get('/open-lines', ...groupedGuard, async (req, res, next) => {
  try { res.json(await grouped.listOpenLines({ market_id: req.query.market_id })); } catch (err) { groupedError(err, res, next); }
});

router.get('/po/:po_id', ...groupedGuard, async (req, res, next) => {
  try { res.json(await getPurchaseOrderDetail(req.params.po_id)); } catch (err) { groupedError(err, res, next); }
});

router.post('/po/prepare', ...groupedGuard, async (req, res, next) => {
  try {
    res.status(201).json(await grouped.preparePurchaseOrder(req.body || {}, { actor: req.user }));
  } catch (err) { groupedError(err, res, next); }
});

router.post('/po/:po_id/attach', ...groupedGuard, async (req, res, next) => {
  try { res.json(await grouped.attachDraftLines(req.params.po_id, (req.body || {}).line_ids)); }
  catch (err) { groupedError(err, res, next); }
});

router.post('/po/:po_id/detach', ...groupedGuard, async (req, res, next) => {
  try { res.json(await grouped.detachLines(req.params.po_id, (req.body || {}).line_ids)); } catch (err) { groupedError(err, res, next); }
});

router.post('/po/:po_id/discard', ...groupedGuard, async (req, res, next) => {
  try { res.json(await grouped.discardPurchaseOrder(req.params.po_id)); } catch (err) { groupedError(err, res, next); }
});

router.post('/lines/:id/cancel', ...groupedGuard, async (req, res, next) => {
  try { res.json(await grouped.cancelLine(req.params.id, (req.body || {}).reason)); } catch (err) { groupedError(err, res, next); }
});

// PR 5 — engagement : soumission, confirmation par PO (reliquat), clôture de ligne, création manuelle de ligne.
router.post('/po/:po_id/submit', ...groupedGuard, async (req, res, next) => {
  try { res.json(await engagement.submitPurchaseOrder(req.params.po_id, { actor: req.user })); } catch (err) { groupedError(err, res, next); }
});

router.post('/po/:po_id/sent', ...groupedGuard, async (req, res, next) => {
  try {
    res.json(await engagement.recordPurchaseOrderSent(req.params.po_id, req.body || {}, { actor: req.user }));
  } catch (err) { groupedError(err, res, next); }
});

router.post('/po/:po_id/confirm', ...groupedGuard, async (req, res, next) => {
  try {
    res.json(await engagement.confirmGroupedPurchaseOrder(req.params.po_id, req.body || {}, { actor: req.user }));
  } catch (err) { groupedError(err, res, next); }
});

router.post('/lines', ...groupedGuard, async (req, res, next) => {
  try { res.status(201).json(await engagement.createManualLine(req.body || {}, { actor: req.user })); } catch (err) { groupedError(err, res, next); }
});

router.post('/lines/:id/settle', ...groupedGuard, async (req, res, next) => {
  try { res.json(await engagement.settleLine(req.params.id, req.body || {}, { actor: req.user })); } catch (err) { groupedError(err, res, next); }
});

// Coût d'achat réel — règlements fournisseur en KMF (admin ; le marché n'est jamais lu du body :
// la portée est celle du paiement fournisseur, aucun champ market_id n'est accepté).
router.post('/supplier-payments/:payment_id/settlements', ...guard, async (req, res, next) => {
  try {
    const out = await settlements.recordSettlement(db, req.params.payment_id, req.body || {}, req.user && req.user.id);
    res.status(out.idempotent_replay ? 200 : 201).json(out);
  } catch (err) { groupedError(err, res, next); }
});

router.get('/supplier-payments/:payment_id/settlements', ...guard, async (req, res, next) => {
  try { res.json(await settlements.listSettlements(db, req.params.payment_id)); } catch (err) { groupedError(err, res, next); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   GESTION FOURNISSEURS — déclarées avant /:order_id pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing/suppliers ───────────────────────────────────────────

router.get('/suppliers', ...guard, async (req, res, next) => {
  try {
    const { platform, active } = req.query;
    const conditions = ['1=1'];
    const params     = [];

    if (platform) { conditions.push(`platform = $${params.length + 1}`); params.push(platform); }
    if (active !== undefined) { conditions.push(`is_active = $${params.length + 1}`); params.push(active === 'true'); }
    conditions.push('s.deleted_at IS NULL');

    const { rows } = await db.query(`
      SELECT
        s.*,
        COUNT(DISTINCT ps.product_id) AS products_mapped,
        COUNT(DISTINCT po.id)         AS purchase_orders_total
      FROM suppliers s
      LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.is_active = TRUE AND ps.deleted_at IS NULL
      LEFT JOIN purchase_orders   po ON po.supplier_id = s.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id
      ORDER BY s.name
    `, params);

    const safe = rows.map(({ api_key_enc, api_secret_enc, ...s }) => ({
      ...s,
      has_api_key: !!api_key_enc,
    }));

    res.json(safe);
  } catch(err) { next(err); }
});

// ─── POST /api/purchasing/suppliers — créer un fournisseur ───────────────────

router.post('/suppliers', ...guard, async (req, res, next) => {
  try {
    const {
      name, platform, contact_name, contact_phone, contact_email,
      api_key_enc, api_secret_enc, account_id,
      auto_order = false, lead_time_days = 2, notes,
    } = req.body;

    if (!name || !platform) {
      return res.status(400).json({ error: 'name et platform obligatoires' });
    }

    const { rows: [supplier] } = await db.query(`
      INSERT INTO suppliers
        (name, platform, contact_name, contact_phone, contact_email,
         api_key_enc, api_secret_enc, account_id,
         auto_order, lead_time_days, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, name, platform, auto_order, lead_time_days, is_active, created_at
    `, [name, platform, contact_name, contact_phone, contact_email,
        api_key_enc, api_secret_enc, account_id,
        auto_order, lead_time_days, notes]);

    res.status(201).json(supplier);
  } catch(err) { next(err); }
});

// ─── POST /api/purchasing/suppliers/:id/map — mapper produit → fournisseur ───

router.post('/suppliers/:id/map', ...guard, async (req, res, next) => {
  try {
    const {
      product_id,
      supplier_sku,
      supplier_url,
      supplier_price_aed = null,
      min_order_qty = 1,
      priority = 1,
      notes,
    } = req.body;

    if (!product_id || !supplier_sku) {
      return res.status(400).json({ error: 'product_id et supplier_sku obligatoires' });
    }

    if (supplier_price_aed !== null && !(Number(supplier_price_aed) > 0)) {
      return res.status(400).json({ error: 'supplier_price_aed doit être strictement positif lorsqu’il est fourni' });
    }

    if (supplier_price_aed === null) {
      const canonicalMoney = await resolveCanonicalMappingMoney(db, product_id, supplier_sku);
      if (!canonicalMoney) {
        return res.status(400).json({
          error: 'supplier_price_aed obligatoire pour un mapping legacy sans prix canonique SKU/SOI résolu',
        });
      }
    }

    const { rows: [mapping] } = await db.query(`
      INSERT INTO product_suppliers
        (product_id, supplier_id, supplier_sku, supplier_url,
         supplier_price_aed, min_order_qty, priority, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        supplier_sku       = EXCLUDED.supplier_sku,
        supplier_url       = EXCLUDED.supplier_url,
        supplier_price_aed = EXCLUDED.supplier_price_aed,
        min_order_qty      = EXCLUDED.min_order_qty,
        priority           = EXCLUDED.priority,
        notes              = EXCLUDED.notes,
        is_active          = TRUE,
        updated_at         = NOW()
      RETURNING *
    `, [product_id, req.params.id, supplier_sku, supplier_url,
        supplier_price_aed, min_order_qty, priority, notes]);

    res.status(201).json(mapping);
  } catch(err) { next(err); }
});

// ─── DELETE /api/purchasing/suppliers/:id — supprimer un fournisseur ──────────

router.delete('/suppliers/:id', ...guard, async (req, res, next) => {
  try {
    const forceDelete = req.headers['x-force-delete'] === 'true';
    const result = await deleteSupplier(req.params.id, forceDelete);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   COMMANDES PAR ORDER_ID — déclaré après /suppliers pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing/order/:order_id/completeness [v8.2] ─────────────────

router.get('/order/:order_id/completeness', ...guard, async (req, res, next) => {
  try {
    const { order_id } = req.params;

    // Lecture par la vue de progression : l'engagé et le reçu viennent des lignes, pas de purchase_orders.qty.
    const { rows: pos } = await db.query(`
      SELECT
        po.id, po.status, po.supplier_id,
        SUM(v.quantity)::int          AS qty,
        SUM(v.received_quantity)::int AS received_qty,
        s.name AS supplier_name,
        SUM(v.received_quantity)::int AS received,
        SUM(v.quantity)::int          AS ordered,
        (SUM(v.quantity) - SUM(v.received_quantity))::int AS remaining
      FROM v_purchase_line_progress v
      JOIN purchase_orders po ON po.id = v.purchase_order_id
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE v.order_id = $1
      GROUP BY po.id, po.status, po.supplier_id, s.name
      ORDER BY MIN(po.created_at) ASC
    `, [order_id]);

    if (!pos.length) {
      return res.status(404).json({ error: 'Aucune purchase order pour cette commande' });
    }

    const totalOrdered  = pos.reduce((s, p) => s + (p.ordered  || 0), 0);
    const totalReceived = pos.reduce((s, p) => s + (p.received || 0), 0);
    const allReceived   = pos.every(p => p.status === 'hub_received' || p.status === 'cancelled');
    const anyPending    = pos.some(p => ['pending', 'notified', 'confirmed', 'shipped'].includes(p.status));

    res.json({
      order_id,
      complete:        allReceived,
      any_pending:     anyPending,
      total_ordered:   totalOrdered,
      total_received:  totalReceived,
      total_remaining: totalOrdered - totalReceived,
      purchase_orders: pos,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/purchasing/:order_id ───────────────────────────────────────────

router.get('/:order_id', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT po.*, s.name AS supplier_name, s.platform, s.contact_phone, s.auto_order
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id IN (SELECT v.purchase_order_id FROM v_purchase_line_progress v
                       WHERE v.order_id = $1 AND v.purchase_order_id IS NOT NULL)
      ORDER BY po.created_at ASC
    `, [req.params.order_id]);

    res.json(rows);
  } catch(err) { next(err); }
});

// ─── POST /api/purchasing/:order_id/confirm ───────────────────────────────────

router.post('/:order_id/confirm', ...guard, async (req, res, next) => {
  try {
    if (!req.body.purchase_order_id) {
      return res.status(400).json({ error: 'purchase_order_id obligatoire' });
    }
    const result = await confirmPurchaseOrder(
      req.body.purchase_order_id,
      req.params.order_id,
      req.body
    );
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, current_status: err.current_status, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
});

// ─── POST /api/purchasing/:id/receive — FERMÉ (C2) ───────────────────────────
// La réception déclarative (incrément de purchase_orders.received_qty) n'est plus une preuve : la seule
// réception valable est physique (POST /api/scans/hub/receive → placement RECEIVE, quarantaine, idempotence).
// Aucune écriture received_qty de remplacement : 410 contrôlé avec le chemin canonique.
router.post('/:id/receive', ...guard, (req, res) => {
  res.status(410).json({
    error: 'Réception déclarative fermée : réceptionner le colis fournisseur via le parcours hub physique.',
    code: 'DECLARATIVE_RECEIVE_CLOSED',
    canonical: 'POST /api/scans/hub/receive',
  });
});

// ─── DELETE /api/purchasing/po/:po_id — annuler une purchase order ────────────

router.delete('/po/:po_id', ...guard, async (req, res, next) => {
  try {
    const forceDelete = req.headers['x-force-delete'] === 'true';
    const result = await cancelPurchaseOrder(req.params.po_id, forceDelete);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, current_status: err.current_status, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   EXPORTS — façade publique inchangée (compatibilité payments.js, pickup-secret.js)
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.triggerPurchasing = triggerPurchasing;
