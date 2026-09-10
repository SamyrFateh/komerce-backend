/**
 * @komerce-arch
 * @role          market-delegation-client-case-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, dispute workflow payload
 * @outputs       dispute read model and auditable workflow mutations
 * @depends       middleware/auth.js, services/market-delegation-client-case-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:dispute-mutation-service disputes
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_client_case_workflow, client_market_id_never_authority, refund_authority_never_delegated
 * @impact-areas  market, delegation, orders
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  resolveAuthorization,
  listDisputes,
  updateDisputeWorkflow,
} = require('../services/market-delegation-client-case-service');

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

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

// refund_kmf/refund_eur ne sont jamais lisibles/écrivables ici, même si le
// client les envoie — le service n'a de toute façon aucune voie pour les
// persister, mais on rejette explicitement pour ne pas laisser croire qu'un
// montant envoyé aurait un effet.
function rejectFinancialFields(body) {
  if (body && (body.refund_kmf != null || body.refund_eur != null)) {
    const error = new Error('Le remboursement reste une autorité centrale ; refund_kmf/refund_eur ne sont jamais acceptés ici.');
    error.code = 'REFUND_AUTHORITY_NOT_DELEGATED';
    error.status = 400;
    throw error;
  }
}

function rejectMarketId(body) {
  if (body && (body.market_id != null || body.marketId != null)) {
    const error = new Error('market_id client interdit ; utilisez le code marché de la route.');
    error.code = 'MARKET_ID_FORBIDDEN';
    error.status = 400;
    throw error;
  }
}

router.get('/markets/:marketCode/client-cases/disputes', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const authz = await resolveAuthorization(client, {
        userId: req.user.id, marketCode: req.params.marketCode, requiredCapability: 'client.case.handle',
      });
      const disputes = await listDisputes(client, { marketId: authz.market_id });
      return { authz, disputes };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      disputes: result.disputes,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/client-cases/disputes/:disputeId', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    rejectFinancialFields(req.body);
    const body = req.body || {};
    const dispute = await withTransaction(client => updateDisputeWorkflow(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      disputeId: req.params.disputeId,
      status: body.status,
      resolution: body.resolution,
    }));
    res.json({ success: true, dispute });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
