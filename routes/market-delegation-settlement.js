/**
 * @komerce-arch
 * @role          market-delegation-settlement-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated operator, canonical market code, settlement action
 * @outputs       settlement read model, request, receipt acknowledgement
 * @depends       middleware/auth.js, services/market-delegation-settlement-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-settlement-service market_settlements, market_settlement_events
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      client_market_id_never_authority, amount_currency_never_delegated_input, operator_never_marks_paid
 * @impact-areas  market, delegation, settlement, finance
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const settlement = require('../services/market-delegation-settlement-service');

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

function rejectDelegatedAuthorityFields(body) {
  if (!body) return;
  const forbidden = [
    'market_id', 'marketId', 'assignment_id', 'amount', 'currency', 'status',
    'payment_reference', 'paid_at', 'paid_by', 'attested_by', 'source',
  ];
  const found = forbidden.find(field => body[field] != null);
  if (!found) return;
  const error = new Error(`Champ ${found} interdit sur une action settlement déléguée.`);
  error.code = found === 'market_id' || found === 'marketId' ? 'MARKET_ID_FORBIDDEN' : 'SETTLEMENT_FINANCIAL_AUTHORITY_NOT_DELEGATED';
  error.status = 400;
  throw error;
}

router.get('/markets/:marketCode/settlements', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(client => settlement.listSettlements(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
    }));
    res.json({
      market: {
        code: result.authz.market_code,
        name: result.authz.market_name,
        currency: result.authz.currency,
      },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      settlements: result.settlements,
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/settlements/:settlementId/request', authenticate, async (req, res, next) => {
  try {
    rejectDelegatedAuthorityFields(req.body);
    const row = await withTransaction(client => settlement.requestSettlement(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      settlementId: req.params.settlementId,
      correlationId: correlationId(req),
    }));
    res.json({ success: true, settlement: row });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/settlements/:settlementId/receive', authenticate, async (req, res, next) => {
  try {
    rejectDelegatedAuthorityFields(req.body);
    const row = await withTransaction(client => settlement.confirmSettlementReceived(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      settlementId: req.params.settlementId,
      receiptNote: req.body && req.body.receipt_note,
      correlationId: correlationId(req),
    }));
    res.json({ success: true, settlement: row });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

module.exports = router;
