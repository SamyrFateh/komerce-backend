/**
 * @komerce-arch
 * @role          refund-service
 * @domain        refunds
 * @layer         service
 * @criticality   medium
 * @inputs        client, order, amountKmf, amountEur, refundType, reason, userId
 * @outputs       refund row, stripe/wallet refund result
 * @depends       db.js, stripe, services/wallet-service.js, services/order-fx-snapshot.js
 * @used-by       routes/orders/cancel.js, services/admin-order-refund.js, services/cancel-shared-cart-with-refunds.js
 * @db-read       orders, refunds, wallets, wallet_transactions, markets
 * @db-write      refunds
 * @db-txn        resolve_before_behavior_change
 * @doctrine      refund_confirmed_only, idempotent_stripe_refund, resolve_before_behavior_change
 * @impact-areas  orders, refunds, wallet
 * @version       2026-06
 */

/**
 * KOMERCE — Refund Service v2.1
 *
 * Wrapper Stripe + Wallet pour les remboursements/annulations.
 * v2.0 : remplace store_credits par wallet-service.
 * v2.1 (P0) :
 *   - Idempotency key stable sur stripe.refunds.create (BUG critique fixé)
 *   - Idempotency key stable sur fallback wallet (plus de Date.now())
 *   - Format clé stable : refund_${order.id}_${refundType}_${parcelId || 'full'}
 *
 * IMPORTANT : la clé d'idempotence DOIT être stable d'un retry à l'autre.
 * Date.now() change à chaque appel = jamais idempotent = double remboursement possible.
 */

'use strict';

const stripe        = require('stripe')(process.env.STRIPE_SECRET_KEY);
const walletService = require('./wallet-service');
const { assertRefundWithinCaptured, assertRefundRecordCompatible, prorateMarketAmount } = require('./order-fx-snapshot');
const refundReceiptService = require('./documents/refund-receipt');
const log = require('../utils/logger').child({ module: 'refund-service' });

/**
 * Construit une clé d'idempotence stable.
 * Format : refund_<orderId>_<refundType>_<parcelId|'full'>
 */
function _buildIdempotencyKey(orderId, refundType, parcelId) {
  return `refund_${orderId}_${refundType}_${parcelId || 'full'}`;
}

// A8 : un remboursement change le CA net → marge canonique recalculée dans la transaction du caller
// (no-op si le writer est désactivé ; échec isolé par SAVEPOINT, jamais bloquant).
async function _refreshCanonicalMargin(dbClient, orderId) {
  await require('./cost-allocation/canonical-margin-writer').refreshCanonicalMarginForOrders([orderId], { client: dbClient });
}

/**
 * Wallet multi-devise (migration 405) : le remboursement wallet est crédité dans la devise commerciale du marché de la
 * commande, jamais converti vers un autre solde. Montant = part exacte du montant de marché figé à la commande
 * (`fx_snapshot.market`, prorata sur le KMF d'origine, aucun taux du jour) ; le dernier remboursement solde exactement.
 * Commande sans market_id (historique pré-Markets) ou marché KMF : montant KMF inchangé.
 */
async function resolveWalletRefundCredit(dbClient, order, amountKmf, refundType) {
  if (!order || !order.market_id) return { currency: 'KMF', amount: amountKmf };
  const { rows: [market] } = await dbClient.query('SELECT currency FROM markets WHERE id = $1', [order.market_id]);
  const currency = String(market?.currency ?? '').trim().toUpperCase();
  if (!currency) {
    const err = new Error('Devise du marché inconnue : remboursement wallet refusé.');
    err.code = 'REFUND_WALLET_CURRENCY_UNKNOWN';
    err.statusCode = 409;
    throw err;
  }
  if (currency === 'KMF') return { currency, amount: amountKmf };

  const snap = typeof order.fx_snapshot === 'string' ? JSON.parse(order.fx_snapshot) : order.fx_snapshot;
  const marketTotal = Number(snap?.market?.amount);
  if (!snap?.market || String(snap.market.currency).toUpperCase() !== currency || !(marketTotal > 0)
      || Number(snap.market.minor_unit) !== 0 || !(Number(order.total_kmf) > 0)) {
    const err = new Error('Montant de marché figé indisponible : remboursement wallet refusé.');
    err.code = 'REFUND_WALLET_MARKET_AMOUNT_MISSING';
    err.statusCode = 409;
    throw err;
  }
  const { rows: [prior] } = await dbClient.query(
    `SELECT COALESCE(SUM(amount_kmf), 0)::text AS kmf FROM refunds
      WHERE order_id = $1 AND status IN ('completed','pending') AND refund_type <> $2`, [order.id, refundType]);
  const remainingKmf = Number(order.total_kmf) - Number(prior.kmf);
  let amount;
  if (Number(amountKmf) >= remainingKmf - 1e-9) {
    // Reste complet : solde exact du montant de marché, déduction faite des crédits wallet déjà émis pour la commande.
    const { rows: [paid] } = await dbClient.query(
      `SELECT COALESCE(SUM(wt.amount_kmf), 0)::text AS amt
         FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
        WHERE wt.reference_id = $1 AND wt.type = 'credit' AND wt.reason = 'order_cancel' AND w.currency = $2
          AND (wt.idempotency_key IS NULL OR (wt.idempotency_key NOT LIKE $3 AND wt.idempotency_key NOT LIKE $4))`,
      [order.id, currency, `refund_${order.id}_${refundType}_%`, `refund_fb_${order.id}_${refundType}_%`]);
    amount = Math.max(0, Math.round(marketTotal - Number(paid.amt)));
  } else {
    amount = prorateMarketAmount(String(amountKmf), String(marketTotal), String(order.total_kmf), 0);
  }
  if (!(amount >= 1)) {
    const err = new Error('Montant wallet nul dans la devise du marché : remboursement refusé.');
    err.code = 'REFUND_WALLET_AMOUNT_BELOW_MINOR_UNIT';
    err.statusCode = 409;
    throw err;
  }
  return { currency, amount };
}

/**
 * Traite un remboursement (Stripe ou wallet).
 * Doit être appelé dans une transaction DB existante.
 */
async function processRefund(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId = null) {
  // Une seule vérité monétaire : jamais plus que le capturé, jamais un doublon silencieux de montant différent.
  await assertRefundWithinCaptured(dbClient, order, amountKmf, amountEur, refundType);
  await assertRefundRecordCompatible(dbClient, order, amountKmf, amountEur, refundType);

  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

  // PATCH P2-2 : INSERT refund en 'pending' AVANT l'appel Stripe.
  // Avant : INSERT après Stripe → si crash DB post-refund, argent remboursé sans trace.
  // Maintenant : INSERT pending → Stripe → UPDATE completed. Idempotence garantie.
  // ON CONFLICT sur (order_id, refund_type) — contrainte ajoutée en migration 014.
  const { rows: [pendingRefund] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status)
     VALUES ($1,$2,$3,$4,'pending_stripe',NULL,NULL,$5,$6,'pending')
     ON CONFLICT (order_id, refund_type) DO NOTHING
     RETURNING id`,
    [order.id, amountKmf, amountEur, refundType, reason || 'Annulation client', initiatedBy]
  );
  // Fallback SELECT si conflict (retry) — toujours résoudre refundRowId
  let refundRowId = pendingRefund?.id;
  if (!refundRowId) {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1`,
      [order.id, refundType]
    );
    refundRowId = existing?.id || null;
  }

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    refundMethod    = 'stripe';
    const amountCents  = Math.round(amountEur * 100);
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_id,
      amount:         amountCents,
      reason:         'requested_by_customer',
      metadata: {
        order_reference: order.reference,
        refund_type:     refundType,
        ...(parcelId ? { parcel_id: parcelId } : {}),
        komerce:         'true',
      },
    }, {
      idempotencyKey,  // ← P0 FIX : empêche double remboursement Stripe sur retry
    });
    stripeRefundId = stripeRefund.id;
    log.info(`[CANCEL] Stripe refund OK: ${stripeRefundId} — ${amountEur}€ pour ${order.reference}`);
  } else {
    refundMethod = 'wallet_credit';
    const walletCredit = await resolveWalletRefundCredit(dbClient, order, amountKmf, refundType);
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf:      walletCredit.amount,
      currency:       walletCredit.currency,
      reason:         'order_cancel',
      referenceId:    order.id,
      idempotencyKey,
      note:           `Remboursement ${refundType} — commande ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Mettre à jour l'enregistrement refund avec les IDs réels + statut 'completed'
  if (refundRowId) {
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = $2, store_credit_id = $3,
              status = 'completed', completed_at = NOW()
        WHERE id = $4`,
      [refundMethod, stripeRefundId, walletTxId, refundRowId]
    );
  }

  // Reçu de remboursement — émis par le caller post-commit (non bloquant).
  // processRefund s'exécute dans la transaction du caller : le reçu doit être
  // déclenché après COMMIT. On expose refundRowId pour que le caller le fasse.
  // Exemple dans cancel.js : db.query SELECT id FROM refunds … .then(row => refundReceiptService.issue(row.id))
  // Pour les callers qui ne gèrent pas eux-mêmes le post-commit, on attache
  // une fonction helper non bloquante sur le résultat.

  await _refreshCanonicalMargin(dbClient, order.id);
  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf, refundRowId };
}

/**
 * Remboursement colis : Stripe prioritaire, wallet uniquement lorsque la
 * commande n'a pas de capture Stripe à rembourser.
 *
 * FA-04 : une erreur de POST Stripe ne prouve PAS un refus PSP. Le remboursement
 * peut avoir été exécuté avant un timeout. Ne jamais créditer le wallet dans
 * ce cas : sinon carte et wallet peuvent rembourser la même valeur.
 *
 * Cette protection empêche le double versement, mais le caller conserve une
 * transaction SQL ouverte pendant le POST externe : si la transaction échoue,
 * une exécution Stripe peut rester non rapprochée (FA-08). Le futur raccordement
 * à refund-intent-ledger est nécessaire pour une reprise automatisée durable.
 */
async function processRefundWithFallback(dbClient, order, amountKmf, amountEur, refundType, reason, initiatedBy, parcelId) {
  // Garde montant zéro : aucun appel DB/Stripe/wallet pour un remboursement nul
  // (évite une ligne `refunds` fantôme + un appel Stripe amount:0 inutile).
  if (!amountKmf && !amountEur) {
    return { method: 'none', skipped: true, reason: 'zero_amount', amountEur, amountKmf };
  }

  // FA-04 : une commande Stripe payée sans identifiant de capture vérifiable
  // ne doit pas être convertie silencieusement en avoir wallet.
  if (order.payment_mode === 'stripe_eur' && !order.stripe_payment_id) {
    const error = new Error('Capture Stripe manquante : rapprochement du paiement requis.');
    error.code = 'REFUND_STRIPE_CAPTURE_MISSING';
    error.statusCode = 409;
    throw error;
  }

  // Une seule vérité monétaire : jamais plus que le capturé, jamais un doublon silencieux de montant différent.
  await assertRefundWithinCaptured(dbClient, order, amountKmf, amountEur, refundType);
  await assertRefundRecordCompatible(dbClient, order, amountKmf, amountEur, refundType);

  let refundMethod, stripeRefundId = null, walletTxId = null;
  const idempotencyKey = _buildIdempotencyKey(order.id, refundType, parcelId);

  // A-BE-06 : INSERT refund en 'pending' AVANT tout appel Stripe ou wallet.
  // ON CONFLICT sur (order_id, refund_type) — contrainte ajoutée en migration 014.
  const { rows: [pendingRefund] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status)
     VALUES ($1,$2,$3,$4,'pending_stripe',NULL,NULL,$5,$6,'pending')
     ON CONFLICT (order_id, refund_type) DO NOTHING
     RETURNING id`,
    [order.id, amountKmf, amountEur, refundType, reason || 'Annulation', initiatedBy]
  );
  // Fallback SELECT si conflict (retry)
  let refundRowId = pendingRefund?.id;
  if (!refundRowId) {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1`,
      [order.id, refundType]
    );
    refundRowId = existing?.id || null;
  }

  if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
    const amountCents = Math.round(amountEur * 100);
    try {
      const stripeRefund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_id,
        amount: amountCents,
        reason: 'requested_by_customer',
        metadata: {
          order_reference: order.reference,
          refund_type:     refundType,
          ...(parcelId ? { parcel_id: parcelId } : {}),
          komerce:         'true',
        },
      }, {
        idempotencyKey,  // ← P0 FIX
      });
      stripeRefundId = stripeRefund.id;
      refundMethod   = 'stripe';
    } catch (stripeErr) {
      // Une réponse HTTP négative, une coupure réseau ou un timeout ne donnent
      // pas une preuve suffisante de non-exécution du remboursement. L'absence
      // de succès n'autorise donc AUCUN crédit wallet automatique.
      // Le caller rollback le colis et doit faire rapprocher le PSP avant
      // une nouvelle tentative ; aucune réponse success n'est émise.
      log.error({ err: stripeErr, order_id: order.id, parcel_id: parcelId,
        provider_request_key: idempotencyKey },
      '[refund-service] Résultat Stripe incertain : aucun fallback wallet, rapprochement requis');
      const error = new Error('Résultat du remboursement Stripe non confirmé : rapprochement requis.');
      error.code = 'REFUND_STRIPE_OUTCOME_UNKNOWN';
      error.statusCode = 409;
      error.providerRequestKey = idempotencyKey;
      error.cause = stripeErr;
      throw error;
    }
  }

  // La branche wallet ne concerne plus jamais une commande Stripe avec
  // référence de capture, même si Stripe est indisponible (FA-04).
  if (!refundMethod) {
    refundMethod = 'wallet_credit';
    const walletCredit = await resolveWalletRefundCredit(dbClient, order, amountKmf, refundType);
    const result = await walletService.credit(dbClient, {
      userId:         order.user_id,
      amountKmf:      walletCredit.amount,
      currency:       walletCredit.currency,
      reason:         'order_cancel',
      referenceId:    order.id,
      // ← P0 FIX : clé stable (avant : Date.now() = jamais idempotent !)
      idempotencyKey: `refund_fb_${order.id}_${refundType}_${parcelId || 'full'}`,
      note:           `Remboursement fallback — ${order.reference}`,
      createdBy:      initiatedBy,
    });
    walletTxId = result.transaction.id;
  }

  // Mettre à jour l'enregistrement refund avec les IDs réels + statut 'completed'
  if (refundRowId) {
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = $2, store_credit_id = $3,
              status = 'completed', completed_at = NOW()
        WHERE id = $4`,
      [refundMethod, stripeRefundId, walletTxId, refundRowId]
    );
  } else {
    // Ligne déjà créée par un retry précédent (ON CONFLICT DO NOTHING) —
    // mettre à jour si elle est encore en 'pending'
    await dbClient.query(
      `UPDATE refunds
          SET refund_method = $1, stripe_refund_id = COALESCE($2, stripe_refund_id),
              store_credit_id = COALESCE($3, store_credit_id),
              status = 'completed', completed_at = COALESCE(completed_at, NOW())
        WHERE order_id = $4 AND refund_type = $5 AND status = 'pending'`,
      [refundMethod, stripeRefundId, walletTxId, order.id, refundType]
    );
  }

  await _refreshCanonicalMargin(dbClient, order.id);
  return { method: refundMethod, stripeRefundId, walletTxId, amountEur, amountKmf, refundRowId };
}

// ─────────────────────────────────────────────────────────────────────────────
// recordExternalRefund — trace comptable d'un remboursement déjà effectué
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insère une ligne `refunds` avec status='completed' pour un remboursement
 * dont l'appel externe (PayPal, Stripe) a déjà abouti.
 *
 * Contrairement à processRefund (pending→completed), cette fonction enregistre
 * directement l'état final. Elle est le SEUL chemin d'écriture directe sur
 * `refunds` pour les features payments et shared-cart.
 *
 * @param {object} dbClient   Client de transaction actif (ou pool global)
 * @param {object} opts
 * @param {string}  opts.orderId           UUID de la commande
 * @param {number}  opts.amountKmf         Montant en KMF
 * @param {number}  opts.amountEur         Montant en EUR (peut être null)
 * @param {string}  opts.refundType        'full' | 'partial'
 * @param {string}  opts.method            'paypal' | 'stripe' | 'wallet_credit' | …
 * @param {string}  opts.externalRefundId  ID externe (stripe_refund_id, ref PayPal) ou null
 * @param {string}  opts.reason            Motif lisible
 * @param {string}  opts.initiatedBy       UUID de l'acteur (null = système)
 * @param {string}  opts.conflictOn        Clé d'idempotence :
 *                    'order_refund_type' → ON CONFLICT (order_id, refund_type)
 *                    'stripe_refund_id'  → ON CONFLICT (stripe_refund_id)
 *                    'any'               → ON CONFLICT DO NOTHING
 * @param {Date}   [opts.completedAt]      Date de completion (défaut : NOW())
 * @returns {Promise<string|null>}         UUID de la ligne insérée, ou celle
 *                                         retrouvée via la clé d'idempotence en cas de conflit
 */
async function recordExternalRefund(dbClient, {
  orderId, amountKmf, amountEur, refundType, method,
  externalRefundId = null, reason, initiatedBy = null,
  conflictOn = 'any', completedAt = null,
}) {
  const conflictClause =
    conflictOn === 'order_refund_type' ? 'ON CONFLICT (order_id, refund_type) DO NOTHING' :
    conflictOn === 'stripe_refund_id'  ? 'ON CONFLICT (stripe_refund_id) DO NOTHING' :
                                         'ON CONFLICT DO NOTHING';

  const { rows: [row] } = await dbClient.query(
    `INSERT INTO refunds
       (order_id, amount_kmf, amount_eur, refund_type, refund_method,
        stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, 'completed', $9)
     ${conflictClause}
     RETURNING id`,
    [
      orderId, amountKmf, amountEur ?? null, refundType, method,
      externalRefundId, reason, initiatedBy,
      completedAt ?? new Date(),
    ]
  );

  if (row) {
    await _refreshCanonicalMargin(dbClient, orderId);
    return row.id;
  }

  // Conflit (retry) — retrouver l'existant via la clé d'idempotence
  if (conflictOn === 'stripe_refund_id' && externalRefundId) {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE stripe_refund_id = $1 LIMIT 1`,
      [externalRefundId]
    );
    return existing?.id ?? null;
  }
  if (conflictOn === 'order_refund_type') {
    const { rows: [existing] } = await dbClient.query(
      `SELECT id FROM refunds WHERE order_id = $1 AND refund_type = $2 LIMIT 1`,
      [orderId, refundType]
    );
    return existing?.id ?? null;
  }
  return null;
}

module.exports = { processRefund, processRefundWithFallback, recordExternalRefund, _buildIdempotencyKey };
