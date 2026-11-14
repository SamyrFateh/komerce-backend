/**
 * @komerce-arch
 * @role          relay-return-compensation-service
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        admin_actor, product_return_dispute_id, movement, amount, reason, scale_code
 * @outputs       one_immutable_compensation_decision_per_return_request, wallet_credit_in_market_currency
 * @depends       db.js, services/wallet-service.js, services/fx-authority.js, services/sav-ledger-refund.js, services/sav-replacement-order.js, disputes, orders, order_items
 * @used-by       routes/relay-dashboard.js
 * @db-read       disputes, orders, order_items, business_rules, relay_return_compensations, relay_product_return_receipts
 * @db-write      relay_return_compensations
 * @db-write-via:wallet-service wallets, wallet_transactions, wallet_credit_lots
 * @db-txn        owns_transaction_with_dispute_row_lock
 * @doctrine      docs/doctrine/DOCTRINE_NON_CONFORMITE.md, return_is_dispute_not_parallel_object, no_implicit_refund_no_sellable_stock, financial_authority_never_delegated
 * @impact-areas  orders, wallet, refunds, dashboard
 * @version       2026-11
 */
'use strict';

/**
 * Compensation SAV APRÈS REMISE (décision A1) : jamais automatique (ni à la reprise physique, ni à la création du
 * dossier). Elle exige une décision ADMIN motivée, exécute UN seul mouvement canonique et n'émet le reçu qu'après
 * confirmation (commit). Le barème COMPENSATION_* n'est qu'une valeur par défaut PROPOSÉE que l'admin valide ou corrige.
 * Le produit repris reste gelé : ce writer ne touche ni stock ni vendabilité.
 * Mouvement implémenté : crédit wallet du PAYEUR de la commande, dans la devise commerciale du marché.
 * Le remboursement PSP réserve une intention durable avant toute sortie externe.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOVEMENTS = Object.freeze(['wallet_credit', 'ledger_refund', 'reship']);
const DEFAULT_COSMETIC_PCT = 20;

class CompensationError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new CompensationError(code, message, status); };

function requireAdmin(actor) {
  if (!actor || actor.role !== 'admin' || !UUID.test(String(actor.id || ''))) {
    fail('COMPENSATION_ADMIN_REQUIRED', 'Décision de compensation réservée à un administrateur.', 403);
  }
}

async function loadDossier(client, requestId, lock) {
  const { rows: [row] } = await client.query(
    `SELECT d.id, d.status, d.type, d.return_quantity, d.return_order_item_id,
            o.id AS order_id, o.user_id AS payer_user_id, o.market_id, o.total_kmf, o.total_eur, o.fx_snapshot, o.reference,
            o.payment_mode, o.wallet_applied_kmf, o.stripe_payment_id, o.paypal_capture_id,
            oi.price_kmf AS unit_price_kmf, oi.qty_collected
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
       JOIN order_items oi ON oi.id = d.return_order_item_id AND oi.order_id = o.id
      WHERE d.id = $1 AND o.simulation_scope IS NULL
      ${lock ? 'FOR UPDATE OF d, oi' : ''}`, [requestId]);
  if (!row || row.type !== 'product_return') fail('COMPENSATION_DOSSIER_NOT_FOUND', 'Dossier de retour introuvable.', 404);
  return row;
}

/** Valeur de la ligne retournée, dans la devise commerciale du marché (part du montant de marché figé, sans taux du jour). */
async function lineValueInMarketCurrency(client, dossier) {
  const walletService = require('./wallet-service');
  const currency = await walletService.resolveOrderWalletCurrency(client, dossier);
  const lineKmf = Number(dossier.unit_price_kmf) * Number(dossier.return_quantity);
  if (currency === 'KMF') return { currency, lineValue: Math.round(lineKmf) };
  const snap = typeof dossier.fx_snapshot === 'string' ? JSON.parse(dossier.fx_snapshot) : dossier.fx_snapshot;
  const total = Number(snap && snap.market && snap.market.amount);
  if (!snap || !snap.market || String(snap.market.currency).toUpperCase() !== currency || !(total > 0)
      || Number(snap.market.minor_unit) !== 0 || !(Number(dossier.total_kmf) > 0)) {
    fail('COMPENSATION_MARKET_AMOUNT_MISSING', 'Montant de marché figé indisponible : compensation refusée.', 409);
  }
  const lineValue = require('./fx-authority').prorate(String(lineKmf), String(total), String(dossier.total_kmf), 0);
  return { currency, lineValue };
}

async function cosmeticPct(client) {
  try {
    const { rows: [r] } = await client.query(
      "SELECT value FROM business_rules WHERE key = 'COMPENSATION_COSMETIC_PCT' AND is_active = TRUE LIMIT 1");
    const n = Number(r && r.value);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_COSMETIC_PCT;
  } catch (_) { return DEFAULT_COSMETIC_PCT; }
}

/** Proposition par défaut (barème COMPENSATION_COSMETIC_PCT) : lecture seule, l'admin la valide ou la corrige. */
async function proposeCompensation({ actor, requestId, db }) {
  requireAdmin(actor);
  if (!UUID.test(String(requestId || ''))) fail('COMPENSATION_ID_INVALID', 'Dossier invalide.');
  const dossier = await loadDossier(db, requestId, false);
  const { currency, lineValue } = await lineValueInMarketCurrency(db, dossier);
  const pct = await cosmeticPct(db);
  return {
    request_id: dossier.id, order_reference: dossier.reference, movement: 'wallet_credit', currency,
    line_value: lineValue, scale_code: 'COMPENSATION_COSMETIC_PCT', scale_pct: pct,
    suggested_amount: Math.max(1, Math.round((lineValue * pct) / 100)),
  };
}

async function decideCompensation({ actor, requestId, movement, amount, reason, scaleCode, db, env = process.env, stripe, paypal }) {
  requireAdmin(actor);
  if (!UUID.test(String(requestId || ''))) fail('COMPENSATION_ID_INVALID', 'Dossier invalide.');
  if (!MOVEMENTS.includes(movement)) fail('COMPENSATION_MOVEMENT_INVALID', 'Mouvement de compensation invalide.');
  const value = movement === 'reship' ? 0 : Number(amount);
  if (movement === 'reship' && amount != null && Number(amount) !== 0) {
    fail('COMPENSATION_RESHIP_NO_CHARGE', 'Le remplacement ne comporte aucun montant facturé.');
  }
  if (movement !== 'reship' && (!Number.isSafeInteger(value) || value < 1)) fail('COMPENSATION_AMOUNT_INVALID', 'Montant entier > 0 (devise du marché) requis.');
  const why = String(reason || '').trim();
  if (why.length < 10 || why.length > 1000) fail('COMPENSATION_REASON_REQUIRED', 'Décision admin motivée (10 à 1000 caractères) obligatoire.');
  const scale = scaleCode ? String(scaleCode).trim().slice(0, 60) : null;

  const walletService = require('./wallet-service');
  const client = await db.getClient();
  let outcome;
  let ledger;
  let replacement;
  try {
    await client.query('BEGIN');
    const dossier = await loadDossier(client, requestId, true);
    const { rows: [existing] } = await client.query('SELECT * FROM relay_return_compensations WHERE request_id = $1', [requestId]);
    if (existing) {
      if (existing.movement === movement && Number(existing.amount) === value && existing.decided_by === actor.id) {
        await client.query('COMMIT');
        if (movement === 'ledger_refund') {
          return require('./sav-ledger-refund').execute({ compensation: existing, db, env, stripe, paypal, replayed: true });
        }
        if (movement === 'reship') return finishReplacement(existing, true);
        return { compensation: existing, replayed: true };
      }
      fail('COMPENSATION_ALREADY_DECIDED', 'Une compensation a déjà été décidée pour ce dossier.', 409);
    }
    if (!['open', 'processing', 'resolved'].includes(dossier.status)) {
      fail('COMPENSATION_DOSSIER_NOT_ELIGIBLE', 'Dossier clos : compensation impossible.', 409);
    }
    if (Number(dossier.qty_collected) < Number(dossier.return_quantity)) {
      fail('COMPENSATION_NOT_AFTER_HANDOVER', 'Compensation SAV réservée aux articles remis au client.', 409);
    }
    // FA-10 : cumul des unités compensées sur l'article, TOUS dossiers (y compris clos). La ligne d'article est verrouillée
    // par loadDossier : deux opérateurs sur deux dossiers du même article se sérialisent ici.
    const { rows: [prior] } = await client.query(
      `SELECT COALESCE(SUM(d.return_quantity), 0)::int AS units
         FROM relay_return_compensations c JOIN disputes d ON d.id = c.request_id
        WHERE d.type = 'product_return' AND d.return_order_item_id = $1 AND c.request_id <> $2`,
      [dossier.return_order_item_id, requestId]);
    if (Number(prior?.units || 0) + Number(dossier.return_quantity) > Number(dossier.qty_collected)) {
      fail('COMPENSATION_EXCEEDS_DELIVERED_UNITS', 'Les compensations cumulées dépasseraient les unités réellement remises au client.', 409);
    }
    const { currency, lineValue } = movement === 'reship'
      ? { currency: await walletService.resolveOrderWalletCurrency(client, dossier), lineValue: 0 }
      : await lineValueInMarketCurrency(client, dossier);
    if (value > lineValue) {
      fail('COMPENSATION_EXCEEDS_LINE_VALUE', 'La compensation ne peut pas dépasser la valeur de la ligne retournée.', 409, { lineValue });
    }
    const scaleDefault = movement === 'reship' ? null
      : Math.max(1, Math.round((lineValue * await cosmeticPct(client)) / 100));
    const { rows: [receipt] } = await client.query(
      'SELECT id, quantity FROM relay_product_return_receipts WHERE request_id = $1', [requestId]);
    if (movement === 'reship') {
      replacement = await require('./sav-replacement-order').create({ client, dossier, receipt, actor });
    }
    const refund = movement === 'ledger_refund'
      ? await require('./sav-ledger-refund').reserve({ client, dossier, currency, value, actor, env })
      : null;
    const credit = movement !== 'wallet_credit' ? null : await walletService.credit(client, {
      userId: dossier.payer_user_id, amountKmf: value, currency, reason: 'sav_compensation',
      referenceId: dossier.order_id, idempotencyKey: `sav_comp_${requestId}`,
      note: `Compensation SAV — commande ${dossier.reference}`, createdBy: actor.id,
    });
    const { rows: [row] } = await client.query(
      `INSERT INTO relay_return_compensations
         (request_id, order_id, payer_user_id, amount, currency, reason, scale_code, scale_default_amount,
          wallet_transaction_id, decided_by, movement, refund_intent_id, refund_amount_kmf, replacement_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [requestId, dossier.order_id, dossier.payer_user_id, value, currency, why, scale, scaleDefault,
        credit?.transaction.id ?? null, actor.id, movement, refund?.intentId ?? null, refund?.amountKmf ?? null, replacement?.id ?? null]);
    await client.query('COMMIT');
    ledger = refund;
    outcome = { compensation: { ...row, return_receipt_id: receipt ? receipt.id : null }, replayed: false, walletTxId: credit?.transaction.id };
  } catch (err) {
    await client.query('ROLLBACK');
    if (['local_stock_insufficient', 'local_stock_verdict_drift'].includes(err.code) || (err.code === '23514' && err.message.includes('product_catalog_quality_hold'))) {
      fail('COMPENSATION_RESHIP_STOCK_UNAVAILABLE', 'Stock vendable indisponible ou produit sous gel qualité.', 409);
    }
    if (err.status >= 400 && err.status < 500 && err.code && !(err instanceof CompensationError)) {
      fail(err.code, err.message, err.status);
    }
    if (err && err.code === '23505') fail('COMPENSATION_ALREADY_DECIDED', 'Une compensation a déjà été décidée pour ce dossier.', 409);
    throw err;
  } finally {
    client.release();
  }
  if (ledger) return require('./sav-ledger-refund').execute({ compensation: outcome.compensation, db, env, stripe, paypal, replayed: false });
  if (replacement) return finishReplacement(outcome.compensation, false, replacement);
  // Reçu wallet seulement APRÈS confirmation (commit), non bloquant, idempotent.
  walletService.issueReceiptForCredit(outcome.walletTxId, actor.id).catch(() => {});
  return { compensation: outcome.compensation, replayed: false };
}

async function finishReplacement(compensation, replayed, replacement) {
  const replacementStatus = replacement?.fulfillment_source === 'LOCAL_STOCK'
    ? 'replacement_order_created'
    : await require('./sav-replacement-order').startProcurement(compensation.replacement_order_id);
  return { compensation, replayed, replacement_status: replacementStatus };
}

module.exports = { CompensationError, MOVEMENTS, proposeCompensation, decideCompensation };
