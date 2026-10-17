/**
 * @komerce-arch
 * @role          supplier-payment-settlement-service
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        payment_id, settlement_payload, admin_user_id
 * @outputs       append_only_settlement_fact, settlement_list
 * @depends       services/cost-allocation/canonical-margin-writer.js (db injecté par l'appelant)
 * @used-by       routes/purchasing.js
 * @db-read       order_items, purchase_lines, supplier_execution_payments, supplier_payment_settlements
 * @db-write      supplier_payment_settlements
 * @db-txn        recordSettlement (FOR UPDATE sur le paiement)
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  purchasing, economic-engine
 * @version       2026-10
 */

/**
 * KOMERCE — Règlements fournisseur réellement débités en KMF (saisie admin)
 * ════════════════════════════════════════════════════════════════════════
 * Seul endroit qui écrit supplier_payment_settlements. Ne déclenche aucun débit,
 * n'écrit aucune allocation de coût, n'utilise aucun taux de référence : le KMF et
 * les frais sont des FAITS saisis avec preuve ; le taux effectif est calculé en lecture.
 *
 * Kinds : payment (KMF hors frais + fees_kmf de l'opération), goods_refund (réduit
 * l'achat), fee_refund (réduit `payment`), other_refund (journal sans effet).
 * Exactitude : comparaisons en unités entières (BigInt), jamais en flottant.
 */

'use strict';

const KINDS = ['payment', 'goods_refund', 'fee_refund', 'other_refund'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return Object.assign(err, extra);
}

/** "123.4500" | number -> unités entières à `scale` décimales ; null si invalide / trop précis. */
function toUnits(value, scale) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] || '';
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) return null;
  return BigInt(m[1]) * 10n ** BigInt(scale) + BigInt((frac + '0'.repeat(scale)).slice(0, scale) || '0');
}
const cur = (v) => toUnits(v, 4);
const kmfU = (v) => toUnits(v, 2);

function normalizePayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const kind = typeof p.kind === 'string' ? p.kind.trim() : '';
  if (!KINDS.includes(kind)) throw fail(400, 'SETTLEMENT_KIND_INVALID', `kind doit être l'un de ${KINDS.join('|')}`);
  const currency = typeof p.currency === 'string' ? p.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw fail(400, 'SETTLEMENT_CURRENCY_INVALID', 'currency ISO-3 requise');
  const amountCurrency = cur(p.amount_currency);
  if (amountCurrency == null || amountCurrency <= 0n) throw fail(400, 'SETTLEMENT_AMOUNT_CURRENCY_INVALID', 'amount_currency > 0 fini (4 décimales max) requis');
  const amountKmf = kmfU(p.amount_kmf);
  if (amountKmf == null || amountKmf <= 0n) throw fail(400, 'SETTLEMENT_AMOUNT_KMF_INVALID', 'amount_kmf > 0 fini (2 décimales max) requis');
  const feesKmf = p.fees_kmf == null ? 0n : kmfU(p.fees_kmf);
  if (feesKmf == null) throw fail(400, 'SETTLEMENT_FEES_INVALID', 'fees_kmf >= 0 fini (2 décimales max) requis');
  if (kind !== 'payment' && feesKmf !== 0n) throw fail(400, 'SETTLEMENT_FEES_ONLY_ON_PAYMENT', 'fees_kmf n\'est admis que pour kind=payment');
  const proofRef = typeof p.proof_ref === 'string' ? p.proof_ref.trim() : '';
  if (!proofRef) throw fail(400, 'SETTLEMENT_PROOF_REQUIRED', 'proof_ref non vide requis');
  const key = typeof p.idempotency_key === 'string' ? p.idempotency_key.trim() : '';
  if (!key || key.length > 200) throw fail(400, 'SETTLEMENT_IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key non vide (<= 200) requis');
  const notes = typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : null;
  return { kind, currency, amountCurrency, amountKmf, feesKmf, proofRef, key, notes };
}

const fmt = (units, scale) => {
  const s = units.toString().padStart(scale + 1, '0');
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
};

function sameContent(row, n) {
  return row.kind === n.kind && row.currency === n.currency
    && cur(row.amount_currency) === n.amountCurrency && kmfU(row.amount_kmf) === n.amountKmf
    && kmfU(row.fees_kmf) === n.feesKmf && row.proof_ref === n.proofRef
    && (row.notes || null) === n.notes;
}

async function _totals(client, paymentId) {
  const { rows: [t] } = await client.query(
    `SELECT
       COALESCE(SUM(amount_currency) FILTER (WHERE kind='payment'),0)::text      AS paid_c,
       COALESCE(SUM(amount_kmf)      FILTER (WHERE kind='payment'),0)::text      AS paid_k,
       COALESCE(SUM(fees_kmf)        FILTER (WHERE kind='payment'),0)::text      AS fees_k,
       COALESCE(SUM(amount_currency) FILTER (WHERE kind='goods_refund'),0)::text AS goods_c,
       COALESCE(SUM(amount_kmf)      FILTER (WHERE kind='goods_refund'),0)::text AS goods_k,
       COALESCE(SUM(amount_kmf)      FILTER (WHERE kind='fee_refund'),0)::text   AS feeref_k,
       COALESCE(SUM(amount_currency) FILTER (WHERE kind='other_refund'),0)::text AS other_c
     FROM supplier_payment_settlements WHERE supplier_execution_payment_id = $1`,
    [paymentId]
  );
  return {
    paidC: cur(t.paid_c), paidK: kmfU(t.paid_k), feesK: kmfU(t.fees_k),
    goodsC: cur(t.goods_c), goodsK: kmfU(t.goods_k), feeRefK: kmfU(t.feeref_k), otherC: cur(t.other_c),
  };
}

function _assertCaps(n, pay, t) {
  if (n.kind === 'payment') {
    const cap = cur(pay.observed_amount != null ? pay.observed_amount : pay.expected_amount);
    if (t.paidC + n.amountCurrency > cap) {
      throw fail(409, 'SETTLEMENT_EXCEEDS_PAYMENT_AMOUNT', 'Σ des règlements dépasserait le montant du paiement fournisseur', {
        cap_currency: fmt(cap, 4), already_settled_currency: fmt(t.paidC, 4),
      });
    }
  } else if (n.kind === 'goods_refund' || n.kind === 'other_refund') {
    const already = n.kind === 'goods_refund' ? t.goodsC : t.otherC;
    if (already + n.amountCurrency > t.paidC
      || (n.kind === 'goods_refund' && t.goodsK + n.amountKmf > t.paidK)) {
      throw fail(409, 'SETTLEMENT_REFUND_EXCEEDS_SETTLED', 'remboursement supérieur au montant réglé net', {
        settled_currency: fmt(t.paidC, 4),
      });
    }
  } else if (t.feeRefK + n.amountKmf > t.feesK) {
    throw fail(409, 'SETTLEMENT_FEE_REFUND_EXCEEDS_FEES', 'remboursement de frais supérieur aux frais enregistrés', {
      fees_kmf: fmt(t.feesK, 2),
    });
  }
}

const shape = (r) => ({
  id: r.id, supplier_execution_payment_id: r.supplier_execution_payment_id, kind: r.kind,
  amount_currency: String(r.amount_currency), currency: r.currency, amount_kmf: String(r.amount_kmf),
  fees_kmf: String(r.fees_kmf), proof_ref: r.proof_ref, idempotency_key: r.idempotency_key,
  notes: r.notes, recorded_by: r.recorded_by, recorded_at: r.recorded_at,
});

/**
 * @param {object} database module db (withTransaction) OU client dont l'appelant possède la transaction
 * @returns {Promise<{settlement:object, idempotent_replay:boolean}>}
 */
async function recordSettlement(database, paymentId, payload, userId) {
  if (!UUID_RE.test(String(paymentId || ''))) throw fail(400, 'SUPPLIER_PAYMENT_ID_INVALID', 'payment_id (uuid) invalide');
  const n = normalizePayload(payload);
  const run = (fn) => (typeof database.withTransaction === 'function' ? database.withTransaction(fn) : fn(database));
  return run(async (client) => {
    const { rows: [pay] } = await client.query(
      `SELECT id, purchase_order_id, currency, status, real_debit_verified, expected_amount, observed_amount
         FROM supplier_execution_payments WHERE id = $1 FOR UPDATE`, [paymentId]);
    if (!pay) throw fail(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'paiement fournisseur introuvable');

    const { rows: [existing] } = await client.query(
      `SELECT * FROM supplier_payment_settlements WHERE supplier_execution_payment_id = $1 AND idempotency_key = $2`,
      [paymentId, n.key]);
    if (existing) {
      if (!sameContent(existing, n)) throw fail(409, 'SETTLEMENT_IDEMPOTENCY_CONFLICT', 'idempotency_key déjà utilisée avec un contenu différent');
      return { settlement: shape(existing), idempotent_replay: true };
    }

    if (n.currency !== pay.currency) {
      throw fail(409, 'SETTLEMENT_CURRENCY_MISMATCH', `devise ${n.currency} ≠ devise du paiement ${pay.currency}`);
    }
    if (n.kind === 'payment' && !(pay.status === 'succeeded' && pay.real_debit_verified === true)) {
      throw fail(409, 'SUPPLIER_PAYMENT_NOT_VERIFIED', 'règlement refusé : paiement non succeeded avec débit réel vérifié', {
        current_status: pay.status,
      });
    }
    _assertCaps(n, pay, await _totals(client, paymentId));

    const { rows: [row] } = await client.query(
      `INSERT INTO supplier_payment_settlements
         (supplier_execution_payment_id, kind, amount_currency, currency, amount_kmf, fees_kmf,
          proof_ref, idempotency_key, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [paymentId, n.kind, fmt(n.amountCurrency, 4), n.currency, fmt(n.amountKmf, 2), fmt(n.feesKmf, 2),
        n.proofRef, n.key, n.notes, userId || null]);
    // A8 : le règlement change l'achat réel des commandes de la PO → marge canonique (no-op si désactivé).
    const canonical = require('./cost-allocation/canonical-margin-writer');
    if (await canonical.isEnabled()) {
      const { rows: affected } = await client.query(
        `SELECT DISTINCT oi.order_id FROM purchase_lines pl JOIN order_items oi ON oi.id = pl.order_item_id
          WHERE pl.purchase_order_id = $1 AND pl.cancelled_at IS NULL`, [pay.purchase_order_id]);
      await canonical.refreshCanonicalMarginForOrders(affected.map((r) => r.order_id), { client });
    }
    return { settlement: shape(row), idempotent_replay: false };
  });
}

async function listSettlements(database, paymentId) {
  if (!UUID_RE.test(String(paymentId || ''))) throw fail(400, 'SUPPLIER_PAYMENT_ID_INVALID', 'payment_id (uuid) invalide');
  const { rows: [pay] } = await database.query('SELECT id FROM supplier_execution_payments WHERE id = $1', [paymentId]);
  if (!pay) throw fail(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'paiement fournisseur introuvable');
  const { rows } = await database.query(
    'SELECT * FROM supplier_payment_settlements WHERE supplier_execution_payment_id = $1 ORDER BY recorded_at, id', [paymentId]);
  return { payment_id: paymentId, settlements: rows.map(shape) };
}

module.exports = { recordSettlement, listSettlements, KINDS, _internals: { toUnits, normalizePayload } };
