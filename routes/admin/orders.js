/**
 * @komerce-arch
 * @role          orders-orders
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, order_items, orders, products, recipients, relais, users, incidents, international_shipment_relay_receipts, local_cash_refund_authorizations, local_item_refund_reservations, local_mobile_refund_handoffs, order_item_refund_reservations, refund_execution_intents, refunds, v_purchase_line_progress, purchase_lines, purchase_orders, parcels, parcel_items
 * @db-write      none
 * @db-write-via:local-item-refund-reservation local_item_refund_reservations
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, admin-dashboard
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const log = require('../../utils/logger').child({ module: 'admin/orders' });
const { deleteOrderCascade } = require('./delete-order-cascade');
const { refundCancelledOrder } = require('../../services/admin-order-refund');
const { readVerifiedShortageCandidates, reserveVerifiedShortage } = require('../../services/item-refund-reservation-service');
const { readN27RemnantContext, reserveN27Remnant } = require('../../services/n27-remnant-cancellation-service');
const { reserveLocalShortage } = require('../../services/local-item-refund-reservation');
const { recordManualMobileRefund } = require('../../services/local-mobile-refund-handoff');
const { authorizeCashRefund } = require('../../services/local-cash-refund-handoff');
const { executeReservedItemRefund, reconcileUncertainItemRefund } = require('../../services/item-refund-psp-orchestrator');

const guard = [authenticate, requireRole(['admin'])];

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
      `SELECT DISTINCT ON (o.id)
         o.id, o.reference, o.status, o.total_kmf,
         o.cost_estimated_kmf, o.cost_real_kmf, o.cost_delta_pct,
         o.margin_estimated_pct, o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
         o.payment_mode, o.payment_status,
         o.confection_type, o.confection_instructions, o.confection_delay_days,
         rc.full_name AS recipient_name, rc.phone AS recipient_phone,
         o.created_at, o.ordered_at, o.purchasing_at, o.preparation_at,
         o.shipped_at, o.available_at, o.collected_at, o.cash_paid_at,
         (SELECT p2.name FROM order_items oi2 JOIN products p2 ON p2.id = oi2.product_id WHERE oi2.order_id = o.id LIMIT 1) AS product_name,
         (SELECT p2.category FROM order_items oi2 JOIN products p2 ON p2.id = oi2.product_id WHERE oi2.order_id = o.id LIMIT 1) AS category,
         u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         r.name AS relais_name, r.zone AS relais_zone,
         r.island AS relais_island,
         m.code AS market_code,
         o.destination_island
       FROM orders o
       LEFT JOIN users    u ON u.id = o.user_id
       LEFT JOIN relais   r ON r.id = o.relais_id
       LEFT JOIN markets  m ON m.id = o.market_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE ${where}
       ORDER BY o.id, o.created_at DESC
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

    log.info(`🗑️ Admin deleted order ${order.reference} (${id}) by ${req.user.email}`);
    res.json({
      success: true,
      message: `Commande ${order.reference} supprimée`,
      deleted: { id, reference: order.reference, status: order.status },
    });
  } catch(err) { next(err); }
});

// ─── POST /api/admin/orders/:id/refund ─────────────────────────────
// AUD-05 — extrait de middleware/auth.js (god-middleware)
router.post('/orders/:id/refund', ...guard, async (req, res, next) => {
  try {
    const result = await refundCancelledOrder({
      orderId: req.params.id,
      user: req.user,
      dryRun: req.body?.dry_run !== false,
      reason: req.body?.reason || null,
      cashMode: req.body?.cash_mode || 'manual',
    });
    return res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});


/**
 * G8 F1/F2 — lecture des obligations locales pour l'écran opérateur.
 * Les pièces financières sont produites hors de cet écran ; aucun paiement automatique.
 */
router.get('/orders/local-refunds', ...guard, async (req, res, next) => {
  if (process.env.KOMERCE_ENV !== 'staging' ||
      process.env.FABLE_LOCAL_REFUND_RESERVATIONS_ENABLED !== '1') {
    return res.status(409).json({ code: 'LOCAL_REFUND_NOT_CERTIFIED',
      error: 'Parcours de remboursement non activé en recette' });
  }
  try {
    const { rows } = await db.query(`
      SELECT r.id AS reservation_id, r.order_id, r.order_item_id, r.market_id,
             r.payment_mode, r.currency, r.amount_minor::text, r.amount_kmf::text,
             r.quantity, r.reason, r.created_at, o.reference AS order_reference,
             m.code AS market_code, ca.id AS cash_authorization_id,
             ca.status AS cash_status, ca.holder_id AS cash_holder_id,
             mh.status AS mobile_status, mh.operator_id AS mobile_operator_id,
             mh.approved_by AS mobile_approver_id, mh.confirmed_by AS mobile_reviewer_id
        FROM local_item_refund_reservations r
        JOIN orders o ON o.id = r.order_id
        JOIN markets m ON m.id = r.market_id
        LEFT JOIN local_cash_refund_authorizations ca ON ca.reservation_id = r.id
        LEFT JOIN local_mobile_refund_handoffs mh ON mh.reservation_id = r.id
       WHERE r.status = 'reserved'
       ORDER BY r.created_at DESC LIMIT 100
    `);
    res.set('Cache-Control', 'no-store');
    return res.json({ refunds: rows });
  } catch (error) { return next(error); }
});

// Fable F1/F2 : réserve une DETTE locale pour manquant réellement attesté.
// Aucune sortie caisse, aucun virement Mobile Money, aucun wallet ou refunds.completed.
// Activation staging explicite. L'identité du payeur et la sortie réelle doivent
// être rapprochées dans un futur parcours d'exécution séparé.
router.post('/orders/:id/items/:itemId/local-refund-reservations', ...guard, async (req, res, next) => {
  if (process.env.KOMERCE_ENV !== 'staging' ||
      process.env.FABLE_LOCAL_REFUND_RESERVATIONS_ENABLED !== '1') {
    return res.status(409).json({
      code: 'LOCAL_REFUND_RESERVATION_NOT_CERTIFIED',
      error: 'Réservation locale non certifiée ou hors staging'
    });
  }
  const { incident_id, quantity, operation_key, reason } = req.body || {};
  try {
    const result = await reserveLocalShortage({
      orderId: req.params.id, orderItemId: req.params.itemId,
      incidentId: incident_id, quantity, operationKey: operation_key,
      reason, actor: req.user
    });
    return res.status(result.replayed ? 200 : 202).json(result);
  } catch (err) {
    if (err.status && err.code)
      return res.status(err.status).json({ code: err.code, error: err.message });
    return next(err);
  }
});


// Fable F1 cash: dual human approval and actual physical handoff must stay
// distinct. OFF by default; staging-only. These routes never hand out cash
// themselves: holder confirms an already completed real-world handoff.
const localCashRefundEnabled = () => process.env.KOMERCE_ENV === 'staging' &&
  process.env.FABLE_LOCAL_REFUND_RESERVATIONS_ENABLED === '1' &&
  process.env.FABLE_LOCAL_CASH_REFUND_HANDOFF_ENABLED === '1';
const denyUncertifiedCashRefund = (res) => res.status(409).json({
  code: 'LOCAL_CASH_REFUND_HANDOFF_NOT_CERTIFIED', error: 'Remise cash non activée ou hors staging'
});
const cashRefundError = (err,res,next) => err.status && err.code
  ? res.status(err.status).json({code:err.code,error:err.message}) : next(err);
router.post('/orders/:id/items/:itemId/local-refund-reservations/:reservationId/authorize-cash',
  ...guard, async (req,res,next) => {
    if (!localCashRefundEnabled()) return denyUncertifiedCashRefund(res);
    try {
      const b=req.body||{};
      const result=await authorizeCashRefund({
        orderId:req.params.id,orderItemId:req.params.itemId,reservationId:req.params.reservationId,
        holderId:b.holder_id,originalPayerProofRef:b.original_payer_proof_ref,
        identityCheckProofRef:b.identity_check_proof_ref,actor:req.user
      });
      return res.status(result.replayed?200:201).json(result);
    }catch(err){return cashRefundError(err,res,next);}
  });

router.post('/orders/:id/items/:itemId/local-refund-reservations/:reservationId/manual-mobile/:action',
  ...guard, async (req, res, next) => {
    if (process.env.KOMERCE_ENV !== 'staging' ||
        process.env.FABLE_LOCAL_REFUND_RESERVATIONS_ENABLED !== '1' ||
        process.env.FABLE_LOCAL_MOBILE_REFUND_HANDOFF_ENABLED !== '1') {
      return res.status(409).json({
        code: 'LOCAL_MOBILE_REFUND_NOT_CERTIFIED', error: 'Reversement manuel non activé ou hors staging'
      });
    }
    try {
      const result = await recordManualMobileRefund({
        action: req.params.action,
        orderId: req.params.id,
        orderItemId: req.params.itemId,
        reservationId: req.params.reservationId,
        actor: req.user,
        body: req.body || {},
      });
      return res.status(result.paid || result.replayed ? 200 : 202).json(result);
    } catch (error) {
      return cashRefundError(error, res, next);
    }
  });

// E7 pilote : réserve une indemnisation de manquant article par article.
// Ne déplace JAMAIS l'argent : la résolution PSP indépendante reste obligatoire.
// Désactivé par défaut, aucun produit du legacy n'active implicitement cette route.
router.post('/orders/:id/items/:itemId/refund-reservations', ...guard, async (req, res, next) => {
  if (process.env.E7_ITEM_RESERVATIONS_ENABLED !== '1') {
    return res.status(409).json({ code: 'E7_RESERVATIONS_NOT_CERTIFIED', error: 'Réservation E7 non activée' });
  }
  const { incident_id, quantity, operation_key, reason } = req.body || {};
  try {
    const result = await reserveVerifiedShortage({
      orderId: req.params.id, orderItemId: req.params.itemId,
      incidentId: incident_id, quantity, operationKey: operation_key,
      reason, actor: req.user,
    });
    return res.status(result.replayed ? 200 : 202).json(result);
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ code: err.code, error: err.message });
    return next(err);
  }
});

// N26a: admin-only read projection, shown only when both reservation and
// sandbox execution are explicitly enabled in staging. The writer still
// revalidates the payment, incident and quantity under lock.
router.get('/orders/item-refund-readiness', ...guard, async (_req,res) => {
  const providerSandboxReady=String(process.env.STRIPE_SECRET_KEY||'').startsWith('sk_test_') ||
    (process.env.PAYPAL_ENV==='sandbox'&&Boolean(process.env.PAYPAL_CLIENT_ID)&&Boolean(process.env.PAYPAL_CLIENT_SECRET));
  res.set('Cache-Control','private, no-store');
  return res.json({ enabled:process.env.KOMERCE_ENV === 'staging' &&
    process.env.E7_ITEM_RESERVATIONS_ENABLED === '1' &&
    process.env.E7_SANDBOX_REFUND_EXECUTION_ENABLED === '1' && providerSandboxReady });
});
router.get('/orders/:orderReference/item-refund-context', ...guard, async (req,res,next) => {
  if (process.env.KOMERCE_ENV !== 'staging' ||
      process.env.E7_ITEM_RESERVATIONS_ENABLED !== '1' ||
      process.env.E7_SANDBOX_REFUND_EXECUTION_ENABLED !== '1') {
    return res.status(409).json({ code:'E7_SANDBOX_PSP_DISABLED',
      error:'Décision PSP partielle indisponible hors staging sandbox certifié' });
  }
  try {
    const context = await readVerifiedShortageCandidates({
      orderReference:req.params.orderReference, actor:req.user,
    });
    const providerReady=context.order.payment_mode==='stripe_eur'
      ? String(process.env.STRIPE_SECRET_KEY||'').startsWith('sk_test_')
      : process.env.PAYPAL_ENV==='sandbox'&&Boolean(process.env.PAYPAL_CLIENT_ID)&&Boolean(process.env.PAYPAL_CLIENT_SECRET);
    if(!providerReady)return res.status(409).json({code:'E7_PROVIDER_SANDBOX_NOT_CONFIGURED',
      error:'Le sandbox du PSP d’origine n’est pas configuré pour cette commande'});
    res.set('Cache-Control','private, no-store');
    return res.json(context);
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({code:err.code,error:err.message});
    return next(err);
  }
});

// N27: order-item remainder decision after partial customer collection.
// Readback reports F1/F2/F3 and only exposes F1 quantities with a verified
// physical shortage. The writer rechecks phase, payer, amount and quantity.
router.get('/orders/:orderReference/n27-remnant-context', ...guard, async (req,res,next) => {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.N27_REMNANT_RESERVATIONS_ENABLED !== '1') {
    return res.status(409).json({ code:'N27_RESERVATIONS_NOT_CERTIFIED',
      error:'Décision N27 disponible uniquement sur staging explicitement activé' });
  }
  try {
    const context = await readN27RemnantContext({ orderReference:req.params.orderReference, actor:req.user });
    res.set('Cache-Control','private, no-store');
    return res.json(context);
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ code:err.code, error:err.message });
    return next(err);
  }
});

router.get('/orders/n27-remnant-readiness', ...guard, async (_req,res) => {
  res.set('Cache-Control','private, no-store');
  return res.json({ enabled:process.env.KOMERCE_ENV === 'staging' &&
    process.env.N27_REMNANT_RESERVATIONS_ENABLED === '1' });
});

router.post('/orders/:id/items/:itemId/n27-remnant-reservations', ...guard, async (req,res,next) => {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.N27_REMNANT_RESERVATIONS_ENABLED !== '1') {
    return res.status(409).json({ code:'N27_RESERVATIONS_NOT_CERTIFIED',
      error:'Décision N27 disponible uniquement sur staging explicitement activé' });
  }
  const { incident_id, quantity, operation_key, reason } = req.body || {};
  try {
    const result = await reserveN27Remnant({
      orderId:req.params.id, orderItemId:req.params.itemId, incidentId:incident_id,
      quantity, operationKey:operation_key, reason, actor:req.user,
    });
    return res.status(result.replayed ? 200 : 202).json(result);
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ code:err.code, error:err.message });
    return next(err);
  }
});

// Exécution uniquement sur staging et PSP sandbox, après réservation committée.
// Timeout, refus ou preuve PSP incertaine : 202 UNKNOWN, jamais de retry automatique.
router.post('/orders/:id/items/:itemId/refund-reservations/:reservationId/execute', ...guard, async (req,res,next) => {
  try {
    const result = await executeReservedItemRefund({
      reservationId:req.params.reservationId,orderId:req.params.id,orderItemId:req.params.itemId,actor:req.user
    });
    return res.status(result.paid?200:202).json(result);
  }catch(err){
    if(err.status&&err.code)return res.status(err.status).json({code:err.code,error:err.message});
    return next(err);
  }
});

// Rapprochement GET PSP seulement : aucune deuxième demande de remboursement.
router.post('/orders/:id/items/:itemId/refund-reservations/:reservationId/reconcile', ...guard, async(req,res,next)=>{
  try {
    const result=await reconcileUncertainItemRefund({
      reservationId:req.params.reservationId,orderId:req.params.id,orderItemId:req.params.itemId,
      providerRefundId:req.body?.provider_ref,actor:req.user,
    });
    return res.status(result.status==='unknown'?202:200).json(result);
  }catch(err) {
    if(err.status&&err.code)return res.status(err.status).json({code:err.code,error:err.message});
    return next(err);
  }
});

module.exports = router;
