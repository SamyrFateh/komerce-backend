/**
 * @komerce-arch
 * @role          canonical-finance-accounting-workspace-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, authenticated_actor, accounting_filters, deposit_business_reference
 * @outputs       market_scoped_accounting_projection, delegated_cash_deposit_mutations
 * @depends       db, services/cash-deposit-service.js
 * @used-by       routes/admin-finance-accounting-workspace.js
 * @db-read       orders, cash_collections, cash_deposits, users, relais, invoices
 * @db-write      none
 * @db-write-via:cash-deposit-service cash_deposits
 * @db-txn        delegated_to_domain_authority
 * @doctrine      workspace_acts_dashboard_observes, server_market_scope_is_authority, no_global_workspace_mutation, stable_business_reference_at_browser_boundary
 * @impact-areas  admin-dashboard, payment, accounting, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const deposits = require('./cash-deposit-service');

class FinanceAccountingWorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'FinanceAccountingWorkspaceError';
    this.code = code;
    this.status = status;
  }
}

function requireMarket(market) {
  if (!market || !market.id || !market.code) {
    throw new FinanceAccountingWorkspaceError(
      'workspace_market_required',
      'Le Workspace Finance / Comptabilité exige un marché serveur explicite',
      400
    );
  }
  return market;
}

function publicMarket(market) {
  const resolved = requireMarket(market);
  return Object.freeze({
    code: resolved.code,
    name: resolved.name || resolved.code,
    currency: resolved.currency || null,
  });
}

function normalizeDate(value, fallback) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function normalizeFilters({ from, to, hours } = {}) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const threshold = Math.max(1, Math.min(720, Number(hours) || 48));
  return {
    from: normalizeDate(from, weekAgo),
    to: normalizeDate(to, today),
    hours: threshold,
  };
}

async function queryCollections(marketId, filters) {
  const { rows } = await db.query(`
    SELECT o.reference AS order_ref,
           cc.amount_kmf,
           cc.confirmed_at,
           u.full_name AS agent_name,
           r.name AS relais_name
      FROM cash_collections cc
      JOIN orders o ON o.id = cc.order_id
      LEFT JOIN users u ON u.id = cc.collected_by
      LEFT JOIN relais r ON r.id = cc.relais_id
     WHERE o.market_id = $1
       AND cc.confirmed_at::date BETWEEN $2 AND $3
       AND (r.id IS NULL OR r.market_id = $1)
     ORDER BY cc.confirmed_at DESC
     LIMIT 100
  `, [marketId, filters.from, filters.to]);
  return rows;
}

async function queryDeposits(marketId) {
  const { rows } = await db.query(`
    SELECT cd.deposit_ref,
           cd.amount_kmf,
           cd.deposit_method,
           cd.reference,
           cd.proof_url,
           cd.period_start,
           cd.period_end,
           cd.status,
           cd.notes,
           cd.deposited_at,
           cd.verified_at,
           u.full_name AS agent_name,
           u.phone AS agent_phone,
           r.name AS relais_name,
           v.full_name AS verified_by_name
      FROM cash_deposits cd
      JOIN users u ON u.id = cd.agent_id
      JOIN relais r ON r.id = u.relais_id AND r.market_id = $1
      LEFT JOIN users v ON v.id = cd.verified_by
     ORDER BY CASE cd.status WHEN 'pending' THEN 0 WHEN 'disputed' THEN 1 ELSE 2 END,
              cd.deposited_at DESC
     LIMIT 200
  `, [marketId]);
  return rows;
}

async function queryUncollected(marketId, filters) {
  const { rows } = await db.query(`
    SELECT o.reference AS order_ref,
           o.total_kmf,
           o.status,
           o.created_at,
           u.full_name AS client_name,
           u.phone AS client_phone,
           r.name AS relais_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
     WHERE o.market_id = $1
       AND o.payment_mode = 'cash_relais'
       AND o.status IN ('available', 'collected')
       AND o.created_at < NOW() - ($2 * INTERVAL '1 hour')
       AND (r.id IS NULL OR r.market_id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM cash_collections cc WHERE cc.order_id = o.id
       )
     ORDER BY o.created_at ASC
     LIMIT 100
  `, [marketId, filters.hours]);
  return rows;
}

async function queryInvoices(marketId) {
  const { rows } = await db.query(`
    SELECT i.invoice_number,
           o.reference AS order_ref,
           i.total_kmf,
           i.total_eur,
           i.payment_mode,
           i.payment_status,
           i.created_at,
           i.pdf_generated_at
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
     WHERE o.market_id = $1
     ORDER BY i.created_at DESC
     LIMIT 100
  `, [marketId]);
  return rows;
}

async function queryReconciliation(marketId, filters) {
  const [expectedRes, collectedRes, depositedRes] = await Promise.all([
    db.query(`
      SELECT COALESCE(SUM(o.total_kmf), 0)::numeric AS expected_kmf,
             COUNT(*)::int AS expected_count
        FROM orders o
        LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.market_id = $1
         AND o.payment_mode = 'cash_relais'
         AND o.status IN ('available', 'collected')
         AND o.created_at::date BETWEEN $2 AND $3
         AND (r.id IS NULL OR r.market_id = $1)
    `, [marketId, filters.from, filters.to]),
    db.query(`
      SELECT COALESCE(SUM(cc.amount_kmf), 0)::numeric AS collected_kmf,
             COUNT(*)::int AS collection_count
        FROM cash_collections cc
        JOIN orders o ON o.id = cc.order_id
        LEFT JOIN relais r ON r.id = cc.relais_id
       WHERE o.market_id = $1
         AND cc.confirmed_at::date BETWEEN $2 AND $3
         AND (r.id IS NULL OR r.market_id = $1)
    `, [marketId, filters.from, filters.to]),
    db.query(`
      SELECT COALESCE(SUM(cd.amount_kmf), 0)::numeric AS deposited_kmf,
             COALESCE(SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'verified'), 0)::numeric AS verified_kmf,
             COALESCE(SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'pending'), 0)::numeric AS pending_kmf,
             COALESCE(SUM(cd.amount_kmf) FILTER (WHERE cd.status = 'disputed'), 0)::numeric AS disputed_kmf,
             COUNT(*)::int AS deposit_count
        FROM cash_deposits cd
        JOIN users u ON u.id = cd.agent_id
        JOIN relais r ON r.id = u.relais_id AND r.market_id = $1
       WHERE cd.period_start >= $2
         AND cd.period_end <= $3
    `, [marketId, filters.from, filters.to]),
  ]);

  const expected = expectedRes.rows[0] || {};
  const collected = collectedRes.rows[0] || {};
  const deposited = depositedRes.rows[0] || {};
  const expectedKmf = Number(expected.expected_kmf || 0);
  const collectedKmf = Number(collected.collected_kmf || 0);
  const depositedKmf = Number(deposited.deposited_kmf || 0);
  return {
    period: { from: filters.from, to: filters.to },
    expected_kmf: expectedKmf,
    expected_count: Number(expected.expected_count || 0),
    collected_kmf: collectedKmf,
    collection_count: Number(collected.collection_count || 0),
    deposited_kmf: depositedKmf,
    verified_kmf: Number(deposited.verified_kmf || 0),
    pending_kmf: Number(deposited.pending_kmf || 0),
    disputed_kmf: Number(deposited.disputed_kmf || 0),
    deposit_count: Number(deposited.deposit_count || 0),
    gap_collection_kmf: expectedKmf - collectedKmf,
    gap_deposit_kmf: collectedKmf - depositedKmf,
  };
}

async function buildWorkspace({ market, from, to, hours } = {}) {
  const resolved = requireMarket(market);
  const filters = normalizeFilters({ from, to, hours });
  const [reconciliation, collections, depositRows, uncollected, invoices] = await Promise.all([
    queryReconciliation(resolved.id, filters),
    queryCollections(resolved.id, filters),
    queryDeposits(resolved.id),
    queryUncollected(resolved.id, filters),
    queryInvoices(resolved.id),
  ]);
  const missingKmf = uncollected.reduce((sum, row) => sum + Number(row.total_kmf || 0), 0);
  return {
    scope: publicMarket(resolved),
    filters,
    summary: {
      expected_kmf: reconciliation.expected_kmf,
      collected_kmf: reconciliation.collected_kmf,
      deposited_kmf: reconciliation.deposited_kmf,
      verified_kmf: reconciliation.verified_kmf,
      pending_deposits: depositRows.filter(row => row.status === 'pending').length,
      disputed_deposits: depositRows.filter(row => row.status === 'disputed').length,
      uncollected_orders: uncollected.length,
      uncollected_kmf: missingKmf,
      invoices: invoices.length,
    },
    reconciliation,
    deposits: depositRows,
    uncollected,
    collections,
    invoices,
  };
}

async function resolveActorRelaisInMarket(actorId, marketId) {
  const { rows } = await db.query(`
    SELECT u.id AS user_id, r.id AS relais_id, r.name AS relais_name
      FROM users u
      JOIN relais r ON r.id = u.relais_id
     WHERE u.id = $1
       AND r.market_id = $2
     LIMIT 1
  `, [actorId, marketId]);
  if (!rows.length) {
    throw new FinanceAccountingWorkspaceError(
      'deposit_actor_market_mismatch',
      'Le déclarant doit être affecté à un relais du marché sélectionné',
      403
    );
  }
  return rows[0];
}

async function resolveDeposit(reference, marketId) {
  const ref = String(reference || '').trim().toUpperCase();
  if (!/^KDP-\d{6,}$/.test(ref)) {
    throw new FinanceAccountingWorkspaceError('deposit_reference_invalid', 'Référence dépôt invalide', 400);
  }
  const { rows } = await db.query(`
    SELECT cd.id, cd.deposit_ref, cd.status
      FROM cash_deposits cd
      JOIN users u ON u.id = cd.agent_id
      JOIN relais r ON r.id = u.relais_id
     WHERE cd.deposit_ref = $1
       AND r.market_id = $2
     LIMIT 1
  `, [ref, marketId]);
  if (!rows.length) {
    throw new FinanceAccountingWorkspaceError(
      'deposit_not_found',
      'Dépôt introuvable dans le marché sélectionné',
      404
    );
  }
  return rows[0];
}

async function createDeposit(payload, market, actor = {}) {
  const resolved = requireMarket(market);
  await resolveActorRelaisInMarket(actor.id, resolved.id);
  try {
    const deposit = await deposits.createDeposit({ agentId: actor.id, payload });
    return {
      deposit_ref: deposit.deposit_ref,
      amount_kmf: Number(deposit.amount_kmf || 0),
      status: deposit.status,
    };
  } catch (err) {
    if (err instanceof deposits.CashDepositError) {
      throw new FinanceAccountingWorkspaceError(err.code, err.message, err.status);
    }
    throw err;
  }
}

async function verifyDeposit(reference, body, market, actor = {}) {
  const resolved = requireMarket(market);
  const deposit = await resolveDeposit(reference, resolved.id);
  try {
    const updated = await deposits.verifyDeposit({
      depositId: deposit.id,
      verifierId: actor.id,
      notes: body && body.notes,
    });
    return { deposit_ref: updated.deposit_ref, status: updated.status, verified_at: updated.verified_at };
  } catch (err) {
    if (err instanceof deposits.CashDepositError) {
      throw new FinanceAccountingWorkspaceError(err.code, err.message, err.status);
    }
    throw err;
  }
}

async function disputeDeposit(reference, body, market, actor = {}) {
  const resolved = requireMarket(market);
  const deposit = await resolveDeposit(reference, resolved.id);
  try {
    const updated = await deposits.disputeDeposit({
      depositId: deposit.id,
      verifierId: actor.id,
      reason: body && body.reason,
    });
    return { deposit_ref: updated.deposit_ref, status: updated.status, verified_at: updated.verified_at };
  } catch (err) {
    if (err instanceof deposits.CashDepositError) {
      throw new FinanceAccountingWorkspaceError(err.code, err.message, err.status);
    }
    throw err;
  }
}

module.exports = {
  FinanceAccountingWorkspaceError,
  normalizeFilters,
  buildWorkspace,
  resolveActorRelaisInMarket,
  resolveDeposit,
  createDeposit,
  verifyDeposit,
  disputeDeposit,
};
