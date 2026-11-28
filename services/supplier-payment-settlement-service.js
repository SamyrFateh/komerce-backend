/**
 * @komerce-arch
 * @role          supplier-payment-settlement-service
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        payment_id, settlement_payload, admin_user_id
 * @outputs       append_only_settlement_fact, settlement_list
 * @depends       services/cost-allocation/canonical-margin-writer.js, services/fx-authority.js (db injecté par l'appelant)
 * @used-by       routes/purchasing.js
 * @db-read       order_items, purchase_lines, purchase_order_authorizations, purchase_orders, suppliers, supplier_execution_payments, supplier_payment_settlements
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

const fx = require('./fx-authority');
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

function normalizePayload(payload, nativeRequired = false) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const kind = typeof p.kind === 'string' ? p.kind.trim() : '';
  if (!KINDS.includes(kind)) throw fail(400, 'SETTLEMENT_KIND_INVALID', `kind doit être l'un de ${KINDS.join('|')}`);
  const currency = typeof p.currency === 'string' ? p.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw fail(400, 'SETTLEMENT_CURRENCY_INVALID', 'currency ISO-3 requise');
  const amountCurrency = cur(p.amount_currency);
  if (amountCurrency == null || amountCurrency <= 0n) throw fail(400, 'SETTLEMENT_AMOUNT_CURRENCY_INVALID', 'amount_currency > 0 fini (4 décimales max) requis');
  const native = nativeRequired ? normalizeNative(p, kind) : null;
  const amountKmf = native ? null : kmfU(p.amount_kmf);
  if (!native && (amountKmf == null || amountKmf <= 0n)) throw fail(400, 'SETTLEMENT_AMOUNT_KMF_INVALID', 'amount_kmf > 0 fini (2 décimales max) requis');
  const feesKmf = native ? 0n : p.fees_kmf == null ? 0n : kmfU(p.fees_kmf);
  if (feesKmf == null) throw fail(400, 'SETTLEMENT_FEES_INVALID', 'fees_kmf >= 0 fini (2 décimales max) requis');
  if (kind !== 'payment' && feesKmf !== 0n) throw fail(400, 'SETTLEMENT_FEES_ONLY_ON_PAYMENT', 'fees_kmf n\'est admis que pour kind=payment');
  const proofRef = typeof p.proof_ref === 'string' ? p.proof_ref.trim() : '';
  if (!proofRef) throw fail(400, 'SETTLEMENT_PROOF_REQUIRED', 'proof_ref non vide requis');
  const key = typeof p.idempotency_key === 'string' ? p.idempotency_key.trim() : '';
  if (!key || key.length > 200) throw fail(400, 'SETTLEMENT_IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key non vide (<= 200) requis');
  const notes = typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : null;
  return { kind, currency, amountCurrency, amountKmf, feesKmf, proofRef, key, notes, native };
}

const fmt = (units, scale) => {
  const s = units.toString().padStart(scale + 1, '0');
  return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
};

// The supplier obligation currency is not necessarily the actual bank/wallet debit currency.
function normalizeNative(p, kind) {
  if (p.amount_kmf != null || p.fees_kmf != null) throw fail(400,'FINANCE_NATIVE_ONLY','Saisir les montants réellement débités, pas une contre-valeur KMF.');
  const currency = String(p.debit_currency || '').trim().toUpperCase();
  const feeCurrency = String(p.fee_currency || currency).trim().toUpperCase();
  if (!Object.hasOwn(fx.MINOR_UNITS,currency) || !Object.hasOwn(fx.MINOR_UNITS,feeCurrency)) throw fail(400,'FINANCE_DEBIT_CURRENCY_INVALID','Devise de débit ou de frais non gouvernée.');
  const amount = toUnits(p.debit_amount,fx.MINOR_UNITS[currency]);
  const fee = toUnits(p.fee_amount == null ? '0' : p.fee_amount,fx.MINOR_UNITS[feeCurrency]);
  if (amount == null || amount <= 0n || fee == null || (kind !== 'payment' && fee !== 0n)) throw fail(400,'FINANCE_DEBIT_AMOUNT_INVALID','Montant natif ou frais invalides.');
  if (typeof p.debit_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(p.debit_at)) throw fail(400,'FINANCE_DEBIT_DATE_INVALID','Date et heure de valeur avec fuseau requises.');
  const at = new Date(p.debit_at);
  if (!Number.isFinite(at.getTime()) || at.getTime() > Date.now()) throw fail(400,'FINANCE_DEBIT_DATE_INVALID','Date de valeur invalide ou future.');
  return {currency, amount: fmt(amount * 10n ** BigInt(4-fx.MINOR_UNITS[currency]),4), feeCurrency, fee:fmt(fee * 10n ** BigInt(4-fx.MINOR_UNITS[feeCurrency]),4), at:at.toISOString()};
}

async function nativeProjection(client, native) {
  async function project(amount, currency) {
    if (cur(amount)===0n) return {kmf:'0.00',eur:null,kmf_legs:[]};
    try {
      const kmf = await fx.convert({amount,from:currency,to:'KMF',at:native.at,client,round:false});
      const eur = await fx.convert({amount,from:currency,to:'EUR',at:native.at,client});
      const rational = fx.parseDecimal(kmf.amount_text);
      const cents = fx.roundHalfEven(rational.n,rational.d,2);
      return {kmf:fmt(cents,2),eur:{amount:eur.amount_text,legs:eur.legs,as_of:native.at},kmf_legs:kmf.legs};
    } catch (error) {
      throw fail(409,'FINANCE_DEBIT_FX_UNAVAILABLE','Conversion historique indisponible : règlement non consigné.');
    }
  }
  const debit = await project(native.amount,native.currency);
  const fees = await project(native.fee,native.feeCurrency);
  if (kmfU(debit.kmf)<=0n) throw fail(409,'FINANCE_DEBIT_FX_UNAVAILABLE','Contre-valeur KMF non positive.');
  return {debit,fees};
}

function sameContent(row, n) {
  return row.kind === n.kind && row.currency === n.currency
    && cur(row.amount_currency) === n.amountCurrency
    && (n.native ? (row.debit_currency === n.native.currency && cur(row.debit_amount) === cur(n.native.amount)
      && row.fee_currency === n.native.feeCurrency && cur(row.fee_amount) === cur(n.native.fee)
      && row.debit_at != null && new Date(row.debit_at).toISOString() === n.native.at)
      : (row.debit_currency == null && kmfU(row.amount_kmf) === n.amountKmf && kmfU(row.fees_kmf) === n.feesKmf))
    && row.proof_ref === n.proofRef
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
    // FA-23 : l'observé ne peut que resserrer le plafond, jamais l'élargir au-delà du montant attendu/autorisé.
    const expected = cur(pay.expected_amount);
    const observed = pay.observed_amount != null ? cur(pay.observed_amount) : null;
    const cap = observed != null && observed < expected ? observed : expected;
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
  ...(r.debit_currency ? { debit_currency:r.debit_currency,debit_amount:String(r.debit_amount),fee_currency:r.fee_currency,fee_amount:String(r.fee_amount),debit_at:r.debit_at,debit_fx_snapshot:r.debit_fx_snapshot } : {}),
});

/**
 * @param {object} database module db (withTransaction) OU client dont l'appelant possède la transaction
 * @returns {Promise<{settlement:object, idempotent_replay:boolean}>}
 */
// B4: a central Finance posting is not a supplier debit instruction. Both
// immutable decisions must concern the exact PO, precede the posting and
// belong to actors distinct from the recording Finance identity.
const B4_JOINS = `
 LEFT JOIN purchase_order_authorizations c ON c.purchase_order_id=p.purchase_order_id AND c.authorization_type='purchase_commitment'
 LEFT JOIN purchase_order_authorizations a ON a.purchase_order_id=p.purchase_order_id AND a.authorization_type='supplier_payment'`;
const B4_VALID = `c.id IS NOT NULL AND a.id IS NOT NULL
 AND c.decided_at < a.decided_at AND a.currency=c.currency AND a.currency=p.currency
 AND a.amount<=c.amount AND GREATEST(p.expected_amount,COALESCE(p.observed_amount,0))<=a.amount`;

async function listFinanceQueue(database,userId,{limit=50,offset=0}={}) {
  const size=Math.min(100,Math.max(1,Number.parseInt(limit,10)||50));
  const start=Math.min(1000000,Math.max(0,Number.parseInt(offset,10)||0));
  const {rows}=await database.query(`
    SELECT p.id,p.purchase_order_id,p.provider,p.payment_ref,p.currency,p.status,p.reconciliation_status,
           p.real_debit_verified,p.expected_amount::text,p.observed_amount::text,
           s.name AS supplier_name,c.proof_ref AS commitment_proof,a.proof_ref AS authorization_proof,
           COALESCE((${B4_VALID} AND c.decided_by<>$1::uuid AND a.decided_by<>$1::uuid
             AND p.status='succeeded' AND p.real_debit_verified AND p.reconciliation_status='matched'),false) AS can_record,
           COALESCE(t.paid,0)::text AS recorded_amount,
           COUNT(*) OVER()::int AS total
      FROM supplier_execution_payments p
      JOIN purchase_orders po ON po.id=p.purchase_order_id
      JOIN suppliers s ON s.id=po.supplier_id
      ${B4_JOINS}
      LEFT JOIN LATERAL (SELECT SUM(amount_currency) FILTER (WHERE kind='payment') AS paid
        FROM supplier_payment_settlements WHERE supplier_execution_payment_id=p.id) t ON true
     WHERE p.status IN ('prepared','requested','succeeded','ambiguous')
     ORDER BY p.created_at DESC,p.id LIMIT $2 OFFSET $3`,[userId,size,start]);
  return {payments:rows.map(({total,...row})=>row),pagination:{limit:size,offset:start,total:rows.length?Number(rows[0].total):null}};
}

async function assertB4Posting(client,paymentId,userId) {
  if(!UUID_RE.test(String(userId||'')))throw fail(403,'FINANCE_ACTOR_REQUIRED','Identité Finance requise');
  const {rows:[row]}=await client.query(`
    SELECT COALESCE((${B4_VALID}),false) AS authorized,
           COALESCE(c.decided_by=$2::uuid OR a.decided_by=$2::uuid,false) AS same_actor,
           p.reconciliation_status
      FROM supplier_execution_payments p ${B4_JOINS} WHERE p.id=$1`,[paymentId,userId]);
  if(!row?.authorized)throw fail(409,'FINANCE_B4_AUTHORIZATION_REQUIRED','Engagement et autorisation Hub ordonnés requis sur cette PO');
  if(row.same_actor)throw fail(403,'FINANCE_B4_SEPARATION_REQUIRED','Le responsable des décisions Hub ne peut pas consigner ce règlement Finance');
  if(row.reconciliation_status!=='matched')throw fail(409,'FINANCE_B4_RECONCILIATION_REQUIRED','Rapprochement fournisseur non confirmé');
}

async function recordSettlement(database, paymentId, payload, userId, options = {}) {
  if (!UUID_RE.test(String(paymentId || ''))) throw fail(400, 'SUPPLIER_PAYMENT_ID_INVALID', 'payment_id (uuid) invalide');
  const n = normalizePayload(payload, options.requireB4===true);
  const run = (fn) => (typeof database.withTransaction === 'function' ? database.withTransaction(fn) : fn(database));
  return run(async (client) => {
    const { rows: [pay] } = await client.query(
      `SELECT id, purchase_order_id, currency, status, real_debit_verified, expected_amount, observed_amount
         FROM supplier_execution_payments WHERE id = $1 FOR UPDATE`, [paymentId]);
    if (!pay) throw fail(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'paiement fournisseur introuvable');

    if(options.requireB4===true) await assertB4Posting(client,paymentId,userId);

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
    if(options.requireB4===true) {
      // Same proof reference cannot identify two separate postings. Keep the
      // proof lock in the transaction; exact idempotent replay returned above.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('finance-settlement-proof:'||$1::text,0))",[n.proofRef]);
      const {rows:duplicate}=await client.query('SELECT id FROM supplier_payment_settlements WHERE proof_ref=$1 LIMIT 1',[n.proofRef]);
      if(duplicate.length)throw fail(409,'FINANCE_SETTLEMENT_PROOF_ALREADY_USED','Référence de règlement déjà utilisée');
      if(!(pay.status==='succeeded'&&pay.real_debit_verified===true))throw fail(409,'SUPPLIER_PAYMENT_NOT_VERIFIED','Débit réel non vérifié');
    }
    const snapshot = n.native ? await nativeProjection(client,n.native) : null;
    if(snapshot){n.amountKmf=kmfU(snapshot.debit.kmf);n.feesKmf=kmfU(snapshot.fees.kmf);}
    _assertCaps(n, pay, await _totals(client, paymentId));

    const nativeColumns = n.native ? ', debit_amount, debit_currency, fee_amount, fee_currency, debit_at, debit_fx_snapshot' : '';
    const nativeValues = n.native ? ',$11,$12,$13,$14,$15,$16::jsonb' : '';
    const { rows: [row] } = await client.query(
      `INSERT INTO supplier_payment_settlements
         (supplier_execution_payment_id, kind, amount_currency, currency, amount_kmf, fees_kmf,
          proof_ref, idempotency_key, notes, recorded_by${nativeColumns})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10${nativeValues}) RETURNING *`,
      [paymentId, n.kind, fmt(n.amountCurrency, 4), n.currency, fmt(n.amountKmf, 2), fmt(n.feesKmf, 2),
        n.proofRef, n.key, n.notes, userId || null, ...(n.native?[n.native.amount,n.native.currency,n.native.fee,n.native.feeCurrency,n.native.at,JSON.stringify(snapshot)]:[])]);
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

module.exports = { recordSettlement, listSettlements, listFinanceQueue, KINDS, _internals: { toUnits, normalizePayload, assertB4Posting, normalizeNative, nativeProjection } };
