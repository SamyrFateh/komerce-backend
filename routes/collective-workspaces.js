/**
 * KOMERCE — Routes Panier Evenement Collectif (V1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Endpoints :
 *
 *   ── Workspace (créateur via creator_token) ──
 *   POST   /api/collective-workspaces                              Créer
 *   GET    /api/collective-workspaces/me/:creatorToken             Lecture créateur
 *   PATCH  /api/collective-workspaces/:creatorToken/items          Add/update/remove items
 *   POST   /api/collective-workspaces/:creatorToken/finalization-review
 *   POST   /api/collective-workspaces/:creatorToken/finalize
 *   POST   /api/collective-workspaces/:creatorToken/resume
 *   POST   /api/collective-workspaces/:creatorToken/close          Clôture explicite
 *
 *   ── Workspace (public via public_token) ──
 *   GET    /api/collective-workspaces/public/:publicToken          Lecture publique
 *   POST   /api/collective-workspaces/public/:publicToken/contributions
 *   DELETE /api/collective-workspaces/public/:publicToken/contributions/:id
 *
 *   ── Paiement (par token individuel) ──
 *   GET    /api/collective-payments/:token                         Info token
 *   POST   /api/collective-payments/:token/pay-card                Crée PaymentIntent
 *
 *   ── Webhook Stripe (mounté à part dans server.js, raw body) ──
 *   POST   /api/collective-payments/stripe/webhook
 */

'use strict';

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { authenticate, requireRole } = require('../middleware/auth');
const engine  = require('../services/collective-workspace-engine');
const orchestrator = require('../services/collective-ready-to-order-orchestrator');

const router = express.Router();
const paymentsRouter = express.Router();

// ─── Helpers réponses ──────────────────────────────────────────────────
function _err(res, code, error_code, message) {
  return res.status(code).json({ error: error_code, message });
}

// ═══════════════════════════════════════════════════════════════════════
// WORKSPACE — CRÉATEUR (creator_token)
// ═══════════════════════════════════════════════════════════════════════

// POST /api/collective-workspaces
router.post('/', async (req, res) => {
  try {
    const result = await engine.createWorkspace(req.body || {});
    const publicUrlPath = '/g/' + result.public_token;
    res.status(201).json({
      workspace_id: result.workspace.id,
      event_name: result.workspace.event_name,
      status: result.workspace.status,
      creator_token: result.creator_token,
      public_token: result.public_token,
      public_url_path: publicUrlPath,
      public_url: publicUrlPath,
      legacy_public_url_path: '/event/w/' + result.public_token,
      message: 'Espace créé. Le lien public peut être partagé librement (WhatsApp, SMS).',
    });
  } catch (err) {
    if (err.message.includes('requis')) return _err(res, 400, 'validation', err.message);
    console.error('[CollectiveWS] create error:', err);
    _err(res, 500, 'server_error', 'Création impossible');
  }
});

// GET /api/collective-workspaces/me/:creatorToken — lecture créateur
router.get('/me/:creatorToken', async (req, res) => {
  try {
    const ws = await engine.getWorkspaceByCreatorToken(req.params.creatorToken);
    if (!ws) return _err(res, 404, 'not_found', 'Espace introuvable');

    const db = require('../db');
    const items = (await db.query(
      `SELECT * FROM collective_workspace_items WHERE workspace_id = $1 ORDER BY created_at`, [ws.id]
    )).rows;
    const contributions = (await db.query(
      `SELECT * FROM collective_workspace_contributions WHERE workspace_id = $1 ORDER BY created_at`, [ws.id]
    )).rows;
    const session = (await db.query(
      `SELECT id, total_to_pay_kmf, amount_secured_kmf, status, expires_at, created_at, ended_at
       FROM collective_payment_sessions WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`, [ws.id]
    )).rows[0] || null;
    const tokensCount = session ? (await db.query(
      `SELECT status, COUNT(*) as n FROM collective_payment_tokens WHERE session_id = $1 GROUP BY status`, [session.id]
    )).rows : [];

    const phase = engine.deriveWorkspacePhase(ws, { items, contributions, session });

    res.json({
      workspace: { ...ws, phase },
      items,
      contributions,
      session,
      tokens_summary: tokensCount,
      phase,
    });
  } catch (err) {
    console.error('[CollectiveWS] me error:', err);
    _err(res, 500, 'server_error', 'Lecture impossible');
  }
});

// PATCH /api/collective-workspaces/:creatorToken/items
router.patch('/:creatorToken/items', async (req, res) => {
  try {
    const { action, item_id, product_id, quantity } = req.body || {};
    let result;
    if (action === 'add') {
      result = await engine.addItem(req.params.creatorToken, { product_id, quantity });
    } else if (action === 'update') {
      result = await engine.updateItem(req.params.creatorToken, item_id, { quantity });
    } else if (action === 'remove') {
      result = await engine.removeItem(req.params.creatorToken, item_id);
    } else {
      return _err(res, 400, 'invalid_action', 'action doit être add/update/remove');
    }
    res.json(result);
  } catch (err) {
    const map = {
      workspace_not_found: [404, 'not_found', 'Espace introuvable'],
      workspace_not_modifiable: [409, 'not_modifiable', 'Cet espace ne peut plus être modifié'],
      product_not_found: [404, 'product_not_found', 'Produit introuvable'],
      item_not_found: [404, 'item_not_found', 'Article introuvable'],
    };
    const m = map[err.message];
    if (m) return _err(res, m[0], m[1], m[2]);
    console.error('[CollectiveWS] items error:', err);
    _err(res, 500, 'server_error', 'Action impossible');
  }
});

// POST /api/collective-workspaces/:creatorToken/finalization-review
router.post('/:creatorToken/finalization-review', async (req, res) => {
  try {
    const review = await engine.finalizationReview(req.params.creatorToken);
    res.json({
      ...review,
      phase: 'reviewing',
      next_phase: review.can_finalize ? 'finalized' : 'reviewing',
    });
  } catch (err) {
    const map = {
      workspace_not_found: [404, 'not_found', 'Espace introuvable'],
      workspace_not_in_conception: [409, 'wrong_state', 'Cet espace n\'est plus en conception'],
      no_items: [400, 'empty_cart', 'Aucun article dans le panier'],
    };
    const m = map[err.message];
    if (m) return _err(res, m[0], m[1], m[2]);
    console.error('[CollectiveWS] review error:', err);
    _err(res, 500, 'server_error', 'Calcul impossible');
  }
});

// POST /api/collective-workspaces/:creatorToken/finalize
router.post('/:creatorToken/finalize', async (req, res) => {
  try {
    const { duration_hours } = req.body || {};
    const result = await engine.finalizeWorkspace(req.params.creatorToken, { duration_hours });
    res.status(201).json({
      ...result,
      phase: 'payment_pending',
      message: 'Le panier est figé. Les contributeurs peuvent maintenant payer leur part.',
    });
  } catch (err) {
    const m = err.message || '';
    if (m === 'workspace_not_found') return _err(res, 404, 'not_found', 'Espace introuvable');
    if (m === 'workspace_not_in_conception') return _err(res, 409, 'wrong_state', 'Cet espace n\'est plus en conception');
    if (m === 'no_items') return _err(res, 400, 'empty_cart', 'Aucun article dans le panier');
    if (m === 'no_contributions') return _err(res, 400, 'no_contributions', 'Aucune intention de contribution');
    if (m.startsWith('product_inactive:')) return _err(res, 409, 'product_inactive', 'Un produit n\'est plus disponible');
    if (m.startsWith('insufficient_intentions:')) return _err(res, 409, 'insufficient_intentions', 'Les intentions ne couvrent pas le total');
    if (m === 'total_invalid') return _err(res, 400, 'total_invalid', 'Total incorrect');
    console.error('[CollectiveWS] finalize error:', err);
    _err(res, 500, 'server_error', 'Finalisation impossible');
  }
});

// POST /api/collective-workspaces/:creatorToken/resume
router.post('/:creatorToken/resume', async (req, res) => {
  try {
    const r = await engine.resumeWorkspace(req.params.creatorToken);
    res.json({
      ...r,
      phase: 'reviewing',
      message: 'Le panier peut être repris. Vous pouvez ajuster les parts et relancer une session.',
    });
  } catch (err) {
    if (err.message === 'workspace_not_found') return _err(res, 404, 'not_found', 'Espace introuvable');
    if (err.message === 'workspace_locked_by_order') return _err(res, 409, 'locked_by_order', 'Une commande a déjà été créée pour cet espace. La reprise n\'est plus possible.');
    if (err.message.startsWith('workspace_not_resumable')) return _err(res, 409, 'not_resumable', 'Cet espace n\'est pas reprenable');
    console.error('[CollectiveWS] resume error:', err);
    _err(res, 500, 'server_error', 'Reprise impossible');
  }
});

// POST /api/collective-workspaces/:creatorToken/close
router.post('/:creatorToken/close', async (req, res) => {
  try {
    const result = await orchestrator.closeReadyToOrderByCreator(req.params.creatorToken, {
      role: 'creator',
      source: 'creator_close',
    });
    res.status(result.ok ? 200 : 202).json(result);
  } catch (err) {
    const m = err.message || '';
    if (m === 'workspace_not_found') return _err(res, 404, 'not_found', 'Espace introuvable');
    if (m === 'workspace_not_ready_to_order') return _err(res, 409, 'not_ready_to_order', 'Ce panier collectif n\'est pas encore prêt à commander');
    console.error('[CollectiveWS] close error:', err);
    _err(res, 500, 'server_error', 'Clôture impossible');
  }
});

// ═══════════════════════════════════════════════════════════════════════
// WORKSPACE — PUBLIC (public_token) — pas d'auth
// ═══════════════════════════════════════════════════════════════════════

router.get('/public/:publicToken', async (req, res) => {
  try {
    const data = await engine.getWorkspaceByPublicToken(req.params.publicToken);
    if (!data) return _err(res, 404, 'not_found', 'Espace introuvable');
    const phase = engine.deriveWorkspacePhase(data.workspace, {
      items: data.items,
      contributions: data.contributions,
      session: data.session,
    });
    res.json({
      ...data,
      workspace: { ...(data.workspace || {}), phase },
      phase,
    });
  } catch (err) {
    console.error('[CollectiveWS] public read error:', err);
    _err(res, 500, 'server_error', 'Lecture impossible');
  }
});

router.post('/public/:publicToken/contributions', async (req, res) => {
  try {
    const body = Object.assign({}, req.body || {});
    if (body.amount_kmf !== undefined && body.intended_amount_kmf === undefined) {
      body.intended_amount_kmf = body.amount_kmf;
    }
    const c = await engine.addContribution(req.params.publicToken, body);
    res.status(201).json({
      contribution: c,
      phase: 'reviewing',
      message: 'Votre intention a été enregistrée. Aucun paiement n\'est effectué maintenant.',
    });
  } catch (err) {
    const m = err.message;
    if (m === 'contributor_name_required') return _err(res, 400, 'name_required', 'Nom requis');
    if (m === 'content_required') return _err(res, 400, 'content_required', 'Indiquez au moins un montant, une idée ou un message');
    if (m === 'amount_invalid') return _err(res, 400, 'amount_invalid', 'Montant invalide');
    if (m === 'workspace_not_found') return _err(res, 404, 'not_found', 'Espace introuvable');
    if (m === 'workspace_not_open') return _err(res, 409, 'closed', 'Cet espace n\'accepte plus d\'intentions');
    console.error('[CollectiveWS] add contribution error:', err);
    _err(res, 500, 'server_error', 'Ajout impossible');
  }
});

router.delete('/:creatorToken/contributions/:id', async (req, res) => {
  try {
    const r = await engine.cancelContributionByCreator(req.params.creatorToken, req.params.id);
    res.json({ ...r, message: 'Intention annulée par le créateur.' });
  } catch (err) {
    const m = err.message;
    if (m === 'workspace_not_found') return _err(res, 404, 'not_found', 'Espace introuvable');
    if (m === 'workspace_not_open') return _err(res, 409, 'closed', 'Cet espace n\'accepte plus de modifications');
    if (m === 'contribution_not_found_or_already_handled') return _err(res, 404, 'not_found', 'Intention introuvable');
    console.error('[CollectiveWS] creator cancel contribution error:', err);
    _err(res, 500, 'server_error', 'Action impossible');
  }
});

router.delete('/public/:publicToken/contributions/:id', async (req, res) => {
  return _err(res, 403, 'creator_token_required', 'La suppression publique est désactivée. Seul le créateur peut annuler une intention.');
});

// ═══════════════════════════════════════════════════════════════════════
// PAIEMENT — PAR TOKEN INDIVIDUEL
// ═══════════════════════════════════════════════════════════════════════

paymentsRouter.get('/:token', async (req, res) => {
  try {
    const t = await engine.getTokenInfo(req.params.token);
    if (!t) return _err(res, 404, 'not_found', 'Lien de paiement introuvable');
    const db = require('../db');
    const totals = (await db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('authorized','paid')) as confirmed_count, COUNT(*) as total_count
       FROM collective_payment_tokens WHERE session_id = $1`,
      [t.session_id]
    )).rows[0];

    res.json({
      contributor_name: t.contributor_name,
      amount_kmf: t.amount_kmf,
      event_name: t.event_name,
      recipient_name: t.recipient_name,
      session_status: t.session_status,
      session_expires_at: t.session_expires_at,
      token_status: t.status,
      paiements_confirmes: totals.confirmed_count + ' / ' + totals.total_count,
      paid_at: t.paid_at,
      message: t.status === 'paid' ? 'Merci pour votre participation.' :
               t.status === 'expired' ? 'Cette session de paiement est terminée.' :
               t.status === 'authorized' ? 'Votre carte a été préautorisée. Le panier sera commandé après clôture.' :
               'Vous pouvez confirmer votre part de ' + t.amount_kmf + ' KMF.',
    });
  } catch (err) {
    console.error('[CollectivePay] read error:', err);
    _err(res, 500, 'server_error', 'Lecture impossible');
  }
});

paymentsRouter.post('/:token/confirm-cash', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
  try {
    const actor = { id: req.user.id, role: req.user.role, phone: req.user.phone || null, relais_id: null };

    if (req.user.role === 'agent_relais') {
      try {
        const db = require('../db');
        const agent = (await db.query('SELECT relais_id FROM users WHERE id = $1', [req.user.id])).rows[0];
        if (!agent || !agent.relais_id) return _err(res, 403, 'agent_relais_not_configured', 'Agent relais sans relais configuré');
        actor.relais_id = agent.relais_id;
      } catch (e) {
        console.warn('[CollectivePay] agent relais config check failed:', e.message);
        return _err(res, 403, 'agent_relais_not_configured', 'Configuration agent relais incomplète');
      }
    }

    const result = await orchestrator.confirmCashContribution(req.params.token, actor, req.body?.note || null);

    res.json({
      ...result,
      message: result.reached_100
        ? 'Toutes les parts sont confirmées — panier prêt à commander.'
        : 'Part cash confirmée.',
    });
  } catch (err) {
    const m = err.message;
    if (m === 'token_not_found') return _err(res, 404, 'not_found', 'Lien de paiement introuvable');
    if (m === 'token_already_paid') return _err(res, 409, 'already_paid', 'Cette part est déjà confirmée');
    if (m === 'token_already_authorized') return _err(res, 409, 'already_authorized', 'Cette part est déjà préautorisée par carte');
    if (m === 'token_expired') return _err(res, 410, 'expired', 'Cette session de paiement est terminée');
    if (m === 'token_cancelled') return _err(res, 410, 'cancelled', 'Ce paiement a été annulé');
    if (m === 'session_ended') return _err(res, 410, 'session_ended', 'Cette session est terminée');
    if (m === 'session_failed') return _err(res, 410, 'session_failed', 'Cette session ne peut plus aboutir');
    if (m === 'session_not_open') return _err(res, 409, 'session_not_open', 'Cette session n\'est plus ouverte');
    if (m === 'workspace_not_payment_pending') return _err(res, 409, 'wrong_state', 'Cet espace n\'est pas en attente de paiement');
    if (m === 'cross_relais_forbidden') return _err(res, 403, 'cross_relais_forbidden', 'Cette part appartient à un autre relais');
    if (m === 'agent_relais_not_configured') return _err(res, 403, 'agent_relais_not_configured', 'Agent relais sans relais configuré');

    console.error('[CollectivePay] confirm-cash error:', err);
    _err(res, 500, 'server_error', 'Confirmation cash impossible');
  }
});

paymentsRouter.post('/:token/pay-card', async (req, res) => {
  try {
    const result = await orchestrator.createOrGetPaymentIntent(req.params.token);
    res.json({
      client_secret: result.client_secret,
      amount_eur_cents: result.amount_eur_cents,
      payment_intent_id: result.payment_intent_id,
      stripe_status: result.status,
      message: 'Authorisez le paiement. Le panier sera commandé après clôture.',
    });
  } catch (err) {
    const m = err.message;
    if (m === 'token_not_found') return _err(res, 404, 'not_found', 'Lien de paiement introuvable');
    if (m === 'token_already_paid') return _err(res, 409, 'already_paid', 'Ce paiement est déjà confirmé');
    if (m === 'token_expired') return _err(res, 410, 'expired', 'Cette session de paiement est terminée');
    if (m === 'token_cancelled') return _err(res, 410, 'cancelled', 'Ce paiement a été annulé');
    if (m === 'session_ended') return _err(res, 410, 'session_ended', 'Cette session est terminée');
    if (m === 'session_failed') return _err(res, 410, 'session_failed', 'Cette session ne peut plus aboutir');
    console.error('[CollectivePay] pay error:', err);
    _err(res, 500, 'server_error', 'Initialisation paiement impossible');
  }
});

async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_COLLECTIVE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[CollectivePay webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  try {
    if (await orchestrator.isStripeEventProcessed(event.id)) {
      return res.json({ received: true, idempotent: true });
    }

    const t = event.type;
    const obj = event.data.object;

    if (t === 'payment_intent.amount_capturable_updated' || t === 'payment_intent.requires_capture') {
      if (obj.metadata && obj.metadata.collective_token_id) {
        await orchestrator.onPaymentAuthorized(obj.id);
      }
    } else if (t === 'payment_intent.canceled') {
      if (obj.metadata && obj.metadata.collective_token_id) {
        const db = require('../db');
        await db.query(
          `UPDATE collective_payment_tokens
             SET status = CASE WHEN status IN ('paid') THEN status ELSE 'cancelled' END,
                 cancelled_at = COALESCE(cancelled_at, NOW())
           WHERE stripe_payment_intent_id = $1`,
          [obj.id]
        );
      }
    } else if (t === 'payment_intent.payment_failed') {
      if (obj.metadata && obj.metadata.collective_token_id) {
        const db = require('../db');
        await db.query(
          `UPDATE collective_payment_tokens SET status = 'failed' WHERE stripe_payment_intent_id = $1 AND status = 'active'`,
          [obj.id]
        );
      }
    }

    await orchestrator.markStripeEventProcessed(event.id, event.type, { payment_intent_id: obj.id || null });
    return res.json({ received: true });
  } catch (err) {
    console.error('[CollectivePay webhook] handler error:', err);
    return res.status(500).json({ error: 'handler_error' });
  }
}

module.exports = { router, paymentsRouter, stripeWebhookHandler };
