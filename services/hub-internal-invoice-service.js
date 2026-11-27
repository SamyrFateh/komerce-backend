/**
 * @komerce-arch
 * @role          hub-internal-invoice-lifecycle
 * @domain        settlement
 * @layer         service
 * @criticality   high
 * @inputs        market code, period, reviewed evidence hash, explicit payment attestation
 * @outputs       frozen Hub invoice and traceable settlement
 * @depends       services/market-delegation-cost-statement-service.js
 * @used-by       routes/admin-market-settlement.js
 * @db-read       markets, hub_internal_invoices
 * @db-write      hub_internal_invoices
 * @db-txn        caller-owned, serializable on issue
 * @doctrine      hub_charges_separate_from_relay_cash, no_payment_execution
 * @impact-areas  settlement, finance, economic-engine
 */
'use strict';

const { createHash } = require('node:crypto');
const { parseDecimal } = require('./fx-authority');
const { readHubStatement, statementPeriod, projectHubInvoiceBalance, hubInvoiceAdjustmentRequired, projectHubAdjustment } = require('./market-delegation-cost-statement-service');

function failure(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

async function loadMarket(db, marketCode, lock = false) {
  const code = String(marketCode || '').trim().toUpperCase();
  const { rows: [market] } = await db.query(
    `SELECT id, code, lifecycle_status FROM markets WHERE code = $1${lock ? ' FOR UPDATE' : ''}`, [code]
  );
  if (!market) throw failure('HUB_INVOICE_MARKET_UNKNOWN', 'Marché introuvable.', 404);
  return market;
}

function present(invoice) {
  return invoice ? { ...invoice, status: invoice.paid_at ? 'PAID' : 'ISSUED', balance:projectHubInvoiceBalance(invoice) } : null;
}

async function review(db, { market, from, to }) {
  const { fromIso, toIso } = statementPeriod(from, to, 'hub');
  const { rows: [invoice] } = await db.query(
    `SELECT * FROM hub_internal_invoices
      WHERE market_id=$1 AND period_from < $3::date AND period_to > $2::date
      ORDER BY period_from, id LIMIT 1`, [market.id, from, to]
  );
  if (invoice) {
    const exact = await db.query(
      'SELECT * FROM hub_internal_invoices WHERE market_id=$1 AND period_from=$2::date AND period_to=$3::date',
      [market.id, from, to]
    );
    if (exact.rows[0]) return { invoice: present(exact.rows[0]), can_issue: false };
    return { can_issue: false, invoice: null, overlapping_invoice_id: invoice.id };
  }
  const statement = await readHubStatement(db, { marketId: market.id, marketCode: market.code, fromIso, toIso });
  const evidence_hash = createHash('sha256').update(JSON.stringify(statement)).digest('hex');
  const positive = statement.total_kmf!==null && parseDecimal(statement.total_kmf).n>0n;
  const can_issue = market.lifecycle_status === 'ACTIVE' && !statement.truncated && positive
    && statement.coverage?.status==='NO_CROSS_PERIOD_ATTRIBUTIONS'
    && statement.informational_totals?.status === 'AVAILABLE';
  return { statement, evidence_hash, can_issue, invoice: null };
}

async function preview(db, { marketCode, from, to }) {
  const market = await loadMarket(db, marketCode);
  const reviewed=await review(db, { market, from, to });
  if(!reviewed.invoice)return reviewed;
  const {fromIso,toIso}=statementPeriod(from,to,'hub');
  const current=await readHubStatement(db,{marketId:market.id,marketCode:market.code,fromIso,toIso});
  // The invoice and settlement stay immutable. Differences require a separate regularization.
  const adjustment_required=hubInvoiceAdjustmentRequired(reviewed.invoice,current);
  return {...reviewed,adjustment_required,adjustment:projectHubAdjustment(reviewed.invoice,current)};
}

async function issue(db, { marketCode, from, to, evidenceHash, actorId }) {
  if (typeof evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidenceHash)) {
    throw failure('HUB_INVOICE_EVIDENCE_REQUIRED', 'Rechargez et vérifiez le relevé.', 400);
  }
  const market = await loadMarket(db, marketCode, true);
  const checked = await review(db, { market, from, to });
  if (checked.invoice?.evidence_hash === evidenceHash) return checked.invoice;
  if (!checked.can_issue || checked.evidence_hash !== evidenceHash) {
    throw failure('HUB_INVOICE_REVIEW_REQUIRED', 'Le relevé a changé ou la période est indisponible. Rechargez le relevé.');
  }
  const { rows: [invoice] } = await db.query(
    `INSERT INTO hub_internal_invoices
       (market_id, period_from, period_to, amount_kmf, evidence_hash, statement_snapshot, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
    [market.id, from, to, checked.statement.total_kmf, evidenceHash, JSON.stringify(checked.statement), actorId]
  );
  return present(invoice);
}

async function recordPayment(db, { marketCode, invoiceId, amountKmf, reference, actorId }) {
  if (typeof invoiceId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(invoiceId)
      || typeof amountKmf !== 'string' || !/^\d{1,22}(?:\.\d{1,2})?$/.test(amountKmf)
      || typeof reference !== 'string' || !/^.{3,200}$/.test(reference.trim())) {
    throw failure('HUB_INVOICE_PAYMENT_INVALID', 'Montant KMF et référence de règlement requis.', 400);
  }
  const market = await loadMarket(db, marketCode);
  const { rows: [invoice] } = await db.query(
    'SELECT * FROM hub_internal_invoices WHERE id=$1 AND market_id=$2 FOR UPDATE', [invoiceId, market.id]
  );
  if (!invoice) throw failure('HUB_INVOICE_UNKNOWN', 'Facture Hub introuvable.', 404);
  const received = parseDecimal(amountKmf);
  const expected = parseDecimal(invoice.amount_kmf);
  if (received.n * expected.d !== expected.n * received.d) {
    throw failure('HUB_INVOICE_PAYMENT_MISMATCH', 'Le montant reçu doit correspondre au total KMF de la facture.');
  }
  if (invoice.paid_at) {
    if (invoice.payment_reference === reference.trim()) return present(invoice);
    throw failure('HUB_INVOICE_ALREADY_PAID', 'La facture a déjà été réglée.');
  }
  const { rows: [paid] } = await db.query(
    `UPDATE hub_internal_invoices SET payment_reference=$2, paid_by=$3, paid_at=now()
      WHERE id=$1 RETURNING *`, [invoiceId, reference.trim(), actorId]
  );
  return present(paid);
}

module.exports = { preview, issue, recordPayment };
