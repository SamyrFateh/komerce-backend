/**
 * KOMERCE — Collective Ready-To-Order Orchestrator
 *
 * Couche doctrinale au-dessus de collective-payment-orchestrator.js.
 *
 * Doctrine :
 *   100% sécurisé → ready_to_order
 *   clôture organisateur → commande
 */

'use strict';

const db = require('../db');
const engine = require('./collective-workspace-engine');
const legacy = require('./collective-payment-orchestrator');
const closeOrderService = require('./collective-close-order-service');

async function markSessionReadyToOrder(sessionId, actor = {}) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const session = (await client.query(
      `SELECT * FROM collective_payment_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId]
    )).rows[0];

    if (!session) {
      await client.query('ROLLBACK');
      throw new Error('session_not_found');
    }

    const ws = (await client.query(
      `SELECT * FROM collective_workspaces WHERE id = $1 FOR UPDATE`,
      [session.workspace_id]
    )).rows[0];

    if (!ws) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }

    if (ws.order_id) {
      await client.query('COMMIT');
      return {
        ok: true,
        idempotent: true,
        ready_to_order: false,
        already_ordered: true,
        order_id: ws.order_id,
        session_status: session.status,
        workspace_status: ws.status,
      };
    }

    const secured = parseInt(session.amount_secured_kmf, 10) || 0;
    const total = parseInt(session.total_to_pay_kmf, 10) || 0;

    if (secured < total) {
      await client.query('ROLLBACK');
      throw new Error('session_not_funded');
    }

    const nextSessionStatus = session.status === 'paid' ? 'paid' : 'ready_to_order';
    const nextWorkspaceStatus = ws.status === 'order_created' ? 'order_created' : 'ready_to_order';

    await client.query(
      `UPDATE collective_payment_sessions
          SET status = CASE
                WHEN status IN ('open','ready_to_capture','ready_to_order') THEN $2
                ELSE status
              END
        WHERE id = $1`,
      [session.id, nextSessionStatus]
    );

    await client.query(
      `UPDATE collective_workspaces
          SET status = CASE
                WHEN status IN ('payment_pending','conception','ready_to_order') THEN $2
                ELSE status
              END
        WHERE id = $1`,
      [ws.id, nextWorkspaceStatus]
    );

    await engine.logEvent(client, ws.id, 'ready_to_order', actor.role || 'system', actor.id || actor.phone || null, {
      session_id: session.id,
      amount_secured_kmf: secured,
      total_to_pay_kmf: total,
      source: actor.source || 'collective_ready_to_order_orchestrator',
    });

    await client.query('COMMIT');

    return {
      ok: true,
      ready_to_order: true,
      workspace_id: ws.id,
      session_id: session.id,
      amount_secured_kmf: secured,
      total_to_pay_kmf: total,
      session_status: nextSessionStatus,
      workspace_status: nextWorkspaceStatus,
      order_id: null,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function onPaymentAuthorized(stripePaymentIntentId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const token = (await client.query(
      `SELECT * FROM collective_payment_tokens
       WHERE stripe_payment_intent_id = $1
       FOR UPDATE`,
      [stripePaymentIntentId]
    )).rows[0];

    if (!token) {
      await client.query('ROLLBACK');
      console.warn('[CollectiveReady] PI', stripePaymentIntentId, 'not linked to a token');
      return { ignored: true };
    }

    if (token.status === 'authorized' || token.status === 'paid') {
      await client.query('ROLLBACK');
      return { idempotent: true, token_status: token.status };
    }

    if (token.status !== 'active') {
      await client.query('ROLLBACK');
      return { ignored: true, reason: 'unexpected_status', token_status: token.status };
    }

    await client.query(
      `UPDATE collective_payment_tokens
          SET status = 'authorized', authorized_at = NOW()
        WHERE id = $1`,
      [token.id]
    );

    const session = (await client.query(
      `UPDATE collective_payment_sessions
          SET amount_secured_kmf = amount_secured_kmf + $1
        WHERE id = $2
          AND status IN ('open','ready_to_order','ready_to_capture')
        RETURNING *`,
      [token.amount_kmf, token.session_id]
    )).rows[0];

    if (!session) {
      await client.query('COMMIT');
      return { ignored: true, reason: 'session_no_longer_open' };
    }

    await engine.logEvent(client, session.workspace_id, 'payment_authorized', 'system', token.contributor_email || token.contributor_phone, {
      token_id: token.id,
      session_id: token.session_id,
      payment_intent_id: stripePaymentIntentId,
      amount_kmf: token.amount_kmf,
    });

    const reached100 = (parseInt(session.amount_secured_kmf, 10) || 0) >= (parseInt(session.total_to_pay_kmf, 10) || 0);

    await client.query('COMMIT');

    if (reached100) {
      await markSessionReadyToOrder(session.id, { role: 'system', source: 'stripe_authorized_100' });
    }

    return { ok: true, token_status: 'authorized', reached_100: reached100, ready_to_order: reached100 };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function confirmCashContribution(rawToken, actor = {}, note = null) {
  const tokenInfo = await engine.getTokenInfo(rawToken);
  if (!tokenInfo) throw new Error('token_not_found');

  const client = await db.pool.connect();
  let reached100 = false;
  let securedSession = null;

  try {
    await client.query('BEGIN');

    const token = (await client.query(
      `SELECT * FROM collective_payment_tokens WHERE id = $1 FOR UPDATE`,
      [tokenInfo.id]
    )).rows[0];

    if (!token) throw new Error('token_not_found');

    const session = (await client.query(
      `SELECT * FROM collective_payment_sessions WHERE id = $1 FOR UPDATE`,
      [token.session_id]
    )).rows[0];

    if (!session) throw new Error('session_not_found');

    const ws = (await client.query(
      `SELECT * FROM collective_workspaces WHERE id = $1 FOR UPDATE`,
      [session.workspace_id]
    )).rows[0];

    if (!ws) throw new Error('workspace_not_found');

    if (token.status === 'paid') {
      await client.query('COMMIT');
      return {
        ok: true,
        idempotent: true,
        token_status: 'paid',
        reached_100: (parseInt(session.amount_secured_kmf, 10) || 0) >= (parseInt(session.total_to_pay_kmf, 10) || 0),
        ready_to_order: ws.status === 'ready_to_order',
        order_id: ws.order_id || null,
      };
    }

    if (token.status === 'authorized') throw new Error('token_already_authorized');
    if (token.status === 'expired') throw new Error('token_expired');
    if (token.status === 'cancelled') throw new Error('token_cancelled');
    if (token.status !== 'active') throw new Error('token_not_active');

    if (new Date(token.expires_at) < new Date() || new Date(session.expires_at) < new Date()) {
      throw new Error('token_expired');
    }

    if (session.status === 'ended') throw new Error('session_ended');
    if (session.status === 'failed') throw new Error('session_failed');
    if (!['open','ready_to_order','ready_to_capture'].includes(session.status)) throw new Error('session_not_open');

    if (!['payment_pending','ready_to_order'].includes(ws.status)) {
      throw new Error('workspace_not_payment_pending');
    }

    if (actor.role === 'agent_relais') {
      if (!actor.relais_id) throw new Error('agent_relais_not_configured');
      if (!ws.relais_id || String(actor.relais_id) !== String(ws.relais_id)) {
        throw new Error('cross_relais_forbidden');
      }
    }

    await client.query(
      `UPDATE collective_payment_tokens
          SET status = 'paid', paid_at = NOW()
        WHERE id = $1 AND status = 'active'`,
      [token.id]
    );

    securedSession = (await client.query(
      `UPDATE collective_payment_sessions
          SET amount_secured_kmf = amount_secured_kmf + $1
        WHERE id = $2
          AND status IN ('open','ready_to_order','ready_to_capture')
        RETURNING *`,
      [token.amount_kmf, session.id]
    )).rows[0];

    if (!securedSession) throw new Error('session_not_open');

    reached100 = (parseInt(securedSession.amount_secured_kmf, 10) || 0) >= (parseInt(securedSession.total_to_pay_kmf, 10) || 0);

    await engine.logEvent(client, ws.id, 'cash_contribution_confirmed', actor.role || 'system', actor.id || actor.phone || null, {
      token_id: token.id,
      session_id: session.id,
      amount_kmf: token.amount_kmf,
      actor_role: actor.role || null,
      note: note || null,
    });

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }

  let ready = null;
  if (reached100) {
    ready = await markSessionReadyToOrder(securedSession.id, {
      role: actor.role || 'system',
      id: actor.id || actor.phone || null,
      source: 'cash_collected_100',
    });
  }

  return {
    ok: true,
    token_status: 'paid',
    reached_100: reached100,
    ready_to_order: reached100,
    amount_secured_kmf: securedSession.amount_secured_kmf,
    total_to_pay_kmf: securedSession.total_to_pay_kmf,
    order_id: null,
    order_reference: null,
    ready,
  };
}

async function closeReadyToOrderByCreator(creatorToken, actor = {}) {
  return closeOrderService.createOrderFromReadyWorkspace(creatorToken, actor);
}

module.exports = {
  ...legacy,
  onPaymentAuthorized,
  confirmCashContribution,
  markSessionReadyToOrder,
  closeReadyToOrderByCreator,
};
