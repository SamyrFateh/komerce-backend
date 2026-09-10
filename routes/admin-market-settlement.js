/**
 * @komerce-arch
 * @role          admin-market-settlement-api
 * @domain        settlement
 * @layer         route
 * @criticality   high
 * @inputs        central finance actor, canonical market code, attested amount, payment reference
 * @outputs       READY creation and central PAID transition
 * @depends       middleware/auth.js, services/market-delegation-service.js, services/market-settlement-service.js
 * @used-by       bootstrap/api-routes.js, central finance workspace
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-settlement-service market_settlements, market_settlement_events
 * @db-txn        explicit
 * @doctrine      ready_is_central_attestation, paid_is_central_only, market_currency_server_derived
 * @impact-areas  settlement, finance, market-delegation
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { resolveActiveAssignmentByMarketCode } = require('../services/market-delegation-service');
const settlement = require('../services/market-settlement-service');

const centralFinance = [authenticate, requireRole(['admin', 'finance'])];

function correlationId(req) {
  const raw = req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

function rejectServerAuthorityFields(body, { allowAmount = false } = {}) {
  if (!body) return;
  const forbidden = ['market_id', 'marketId', 'assignment_id', 'currency', 'status', 'source', 'attested_by'];
  if (!allowAmount) forbidden.push('amount');
  const found = forbidden.find(field => body[field] != null);
  if (!found) return;
  const error = new Error(`Champ ${found} interdit : cette valeur est résolue ou figée côté serveur.`);
  error.code = found === 'market_id' || found === 'marketId' ? 'MARKET_ID_FORBIDDEN' : 'SETTLEMENT_SERVER_AUTHORITY_FIELD_FORBIDDEN';
  error.status = 400;
  throw error;
}

router.get('/markets/:marketCode/settlements', ...centralFinance, async (req, res, next) => {
  try {
    const result = await withTransaction(async client => {
      const authz = await resolveActiveAssignmentByMarketCode(client, req.params.marketCode);
      const rows = await settlement.listForAssignment(client, {
        marketId: authz.market_id,
        assignmentId: authz.assignment_id,
      });
      return { authz, rows };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      settlements: result.rows,
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/settlements/ready', ...centralFinance, async (req, res, next) => {
  try {
    rejectServerAuthorityFields(req.body, { allowAmount: true });
    const body = req.body || {};
    const row = await withTransaction(async client => {
      const authz = await resolveActiveAssignmentByMarketCode(client, req.params.marketCode);
      return settlement.createReadySettlement(client, {
        marketId: authz.market_id,
        assignmentId: authz.assignment_id,
        amount: body.amount,
        sourceReference: body.source_reference,
        periodStart: body.period_start,
        periodEnd: body.period_end,
        attestationNote: body.attestation_note,
        actorUserId: req.user.id,
        correlationId: correlationId(req),
      });
    });
    res.status(201).json({ success: true, settlement: row });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.post('/settlements/:settlementId/paid', ...centralFinance, async (req, res, next) => {
  try {
    rejectServerAuthorityFields(req.body);
    const row = await withTransaction(client => settlement.markPaid(client, {
      settlementId: req.params.settlementId,
      actorUserId: req.user.id,
      paymentReference: req.body && req.body.payment_reference,
      correlationId: correlationId(req),
    }));
    res.json({ success: true, settlement: row.after });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

module.exports = router;
