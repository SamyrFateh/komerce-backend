/**
 * KOMERCE — Collective Payment Orchestrator (V1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Orchestration Stripe pour le Panier Evenement Collectif.
 *
 * Flux :
 *   1. Contributeur ouvre /api/collective-payments/:token
 *   2. Backend crée un PaymentIntent (capture_method=manual) -> renvoie client_secret
 *   3. Stripe autorise la carte -> webhook 'payment_intent.amount_capturable_updated'
 *   4. On marque le token 'authorized', on incremente amount_secured_kmf
 *   5. Si amount_secured_kmf == total_to_pay_kmf : capture atomique + creation commande
 *   6. Sinon : on attend les autres tokens
 *
 * Si la session expire : cron annule tous les PaymentIntents actifs.
 *
 * Idempotence :
 *   - stripe_events_processed empeche le double traitement webhook
 *   - SELECT FOR UPDATE sur la session lors des transitions critiques
 *   - Idempotency key Stripe utilisee a la creation des PI
 */

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const engine = require('./collective-workspace-engine');

// Le moteur ordre Komerce — on s'en sert pour creer la commande proprement.
// Si le service order-service est dispo, on l'utilise. Sinon SQL direct.
let orderService = null;
try { orderService = require('./order-service'); } catch (e) { /* optionnel */ }

const KMF_PER_EUR_FALLBACK = 492;

function _kmfToEur(amountKmf, fxRate) {
  const rate = fxRate || parseFloat(process.env.EUR_KMF_RATE || KMF_PER_EUR_FALLBACK);
  // Stripe attend des centimes EUR
  return Math.max(50, Math.round((amountKmf / rate) * 100)); // 50 centimes mini
}

// ═══════════════════════════════════════════════════════════════════════
// CRÉATION PAYMENT INTENT POUR UN TOKEN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Crée (ou retourne) un PaymentIntent pour un token de paiement.
 * Utilise capture_method=manual pour autoriser sans capturer.
 *
 * Renvoie :
 *   { client_secret, amount_eur_cents, payment_intent_id, status }
 */
async function createOrGetPaymentIntent(rawToken) {
  const tokenInfo = await engine.getTokenInfo(rawToken);
  if (!tokenInfo) throw new Error('token_not_found');

  // Vérifications état
  if (tokenInfo.status === 'paid')        throw new Error('token_already_paid');
  if (tokenInfo.status === 'expired')     throw new Error('token_expired');
  if (tokenInfo.status === 'cancelled')   throw new Error('token_cancelled');
  if (tokenInfo.session_status === 'ended')  throw new Error('session_ended');
  if (tokenInfo.session_status === 'failed') throw new Error('session_failed');
  if (new Date(tokenInfo.expires_at) < new Date()) throw new Error('token_expired');

  // Si un PaymentIntent existe deja, on le renvoie
  if (tokenInfo.stripe_payment_intent_id) {
    try {
      const pi = await stripe.paymentIntents.retrieve(tokenInfo.stripe_payment_intent_id);
      if (pi.status !== 'canceled') {
        return {
          client_secret: pi.client_secret,
          amount_eur_cents: pi.amount,
          payment_intent_id: pi.id,
          status: pi.status,
        };
      }
    } catch (err) {
      console.warn('[CollectivePay] PaymentIntent retrieve failed, recreating:', err.message);
    }
  }

  // Créer un nouveau PaymentIntent
  const amountEurCents = _kmfToEur(tokenInfo.amount_kmf);

  const idempotencyKey = 'cpt_' + tokenInfo.id;
  const pi = await stripe.paymentIntents.create({
    amount: amountEurCents,
    currency: 'eur',
    capture_method: 'manual',  // ← CRUCIAL : autorise mais ne capture pas
    description: 'Komerce — ' + (tokenInfo.event_name || 'panier collectif'),
    metadata: {
      collective_token_id: tokenInfo.id,
      session_id: tokenInfo.session_id,
      workspace_id: tokenInfo.workspace_id,
      contributor_name: tokenInfo.contributor_name,
      amount_kmf: String(tokenInfo.amount_kmf),
    },
    receipt_email: tokenInfo.contributor_email || undefined,
  }, { idempotencyKey });

  // Stocker le PaymentIntent ID
  await db.query(
    `UPDATE collective_payment_tokens
       SET stripe_payment_intent_id = $1
     WHERE id = $2 AND stripe_payment_intent_id IS NULL`,
    [pi.id, tokenInfo.id]
  );

  await engine.logEvent(null, tokenInfo.workspace_id, 'payment_intent_created', 'system',
    tokenInfo.contributor_email || tokenInfo.contributor_phone,
    { token_id: tokenInfo.id, payment_intent_id: pi.id, amount_eur_cents: amountEurCents });

  return {
    client_secret: pi.client_secret,
    amount_eur_cents: amountEurCents,
    payment_intent_id: pi.id,
    status: pi.status,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// WEBHOOK : carte autorisée → token authorized → vérif 100%
// ═══════════════════════════════════════════════════════════════════════

/**
 * Appelé par le webhook quand une carte est autorisée.
 * Marque le token authorized + incrémente amount_secured_kmf.
 * Si 100% atteint → déclenche capture atomique.
 *
 * Idempotent : si le token est déjà authorized, ne fait rien.
 */
async function onPaymentAuthorized(stripePaymentIntentId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Trouver le token
    const tokenRes = await client.query(
      `SELECT * FROM collective_payment_tokens
       WHERE stripe_payment_intent_id = $1
       FOR UPDATE`,
      [stripePaymentIntentId]
    );
    if (!tokenRes.rows.length) {
      await client.query('ROLLBACK');
      console.warn('[CollectivePay] PI', stripePaymentIntentId, 'not linked to a token');
      return { ignored: true };
    }
    const token = tokenRes.rows[0];

    // Idempotence : si deja authorized/paid, on ne fait rien
    if (token.status === 'authorized' || token.status === 'paid') {
      await client.query('ROLLBACK');
      return { idempotent: true, token_status: token.status };
    }

    if (token.status !== 'active') {
      await client.query('ROLLBACK');
      console.warn('[CollectivePay] token', token.id, 'in unexpected status:', token.status);
      return { ignored: true, reason: 'unexpected_status' };
    }

    // Marquer le token authorized
    await client.query(
      `UPDATE collective_payment_tokens
         SET status = 'authorized', authorized_at = NOW()
       WHERE id = $1`,
      [token.id]
    );

    // Incrementer amount_secured de la session
    const sessionRes = await client.query(
      `UPDATE collective_payment_sessions
         SET amount_secured_kmf = amount_secured_kmf + $1
       WHERE id = $2 AND status = 'open'
       RETURNING *`,
      [token.amount_kmf, token.session_id]
    );

    if (!sessionRes.rows.length) {
      // La session a déjà changé d'état (ended, paid, etc.) — on annule l'autorisation
      console.warn('[CollectivePay] session', token.session_id, 'no longer open, cancelling authorization');
      await client.query('COMMIT');
      // Annulation hors transaction (appel Stripe)
      try { await stripe.paymentIntents.cancel(stripePaymentIntentId); } catch (e) { /* déjà cancel */ }
      return { ignored: true, reason: 'session_no_longer_open' };
    }
    const session = sessionRes.rows[0];

    await engine.logEvent(client, token.session_id /* workspace_id needed */, 'payment_authorized', 'system',
      token.contributor_email || token.contributor_phone,
      { token_id: token.id, payment_intent_id: stripePaymentIntentId, amount_kmf: token.amount_kmf });

    // 100% atteint ?
    const reached100 = (session.amount_secured_kmf >= session.total_to_pay_kmf);
    if (reached100) {
      // Marquer la session ready_to_capture (atomique)
      await client.query(
        `UPDATE collective_payment_sessions
           SET status = 'ready_to_capture'
         WHERE id = $1 AND status = 'open'`,
        [session.id]
      );
    }

    await client.query('COMMIT');

    if (reached100) {
      // Capture atomique de tous les tokens (hors transaction principale, appels Stripe)
      // setImmediate pour ne pas bloquer le webhook
      setImmediate(() => {
        captureAllAndCreateOrder(session.id).catch(err => {
          console.error('[CollectivePay] capture atomique échouée :', err.message);
        });
      });
    }

    return { ok: true, token_status: 'authorized', reached_100: reached100 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CAPTURE ATOMIQUE + CRÉATION COMMANDE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Capture tous les PaymentIntents authorized de la session.
 * Si tous OK → crée la commande.
 * Si un échoue → annule les autres (best effort) + marque session 'failed'.
 *
 * Cette fonction est lourde et doit etre invoquee une seule fois par session.
 */
async function captureAllAndCreateOrder(sessionId) {
  // Lire la session + ses tokens
  const sessionRes = await db.query(
    `SELECT * FROM collective_payment_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!sessionRes.rows.length) throw new Error('session_not_found');
  const session = sessionRes.rows[0];

  if (session.status !== 'ready_to_capture') {
    console.warn('[CollectivePay] session', sessionId, 'not ready_to_capture (status=' + session.status + ')');
    return { skipped: true };
  }

  const tokens = (await db.query(
    `SELECT * FROM collective_payment_tokens
     WHERE session_id = $1 AND status = 'authorized'
     ORDER BY created_at`,
    [sessionId]
  )).rows;

  if (!tokens.length) throw new Error('no_authorized_tokens');

  // Capturer chaque PaymentIntent (avec idempotence)
  const captured = [];
  const failed = [];
  for (const t of tokens) {
    try {
      const pi = await stripe.paymentIntents.capture(t.stripe_payment_intent_id, {}, {
        idempotencyKey: 'cap_' + t.id,
      });
      captured.push({ token_id: t.id, pi_id: pi.id });
    } catch (err) {
      console.error('[CollectivePay] capture failed for token', t.id, err.message);
      failed.push({ token_id: t.id, error: err.message });
    }
  }

  // Si toutes les captures réussissent → créer la commande
  if (failed.length === 0) {
    await _markTokensPaid(captured.map(c => c.token_id));
    await _createOrderFromSession(sessionId);
    return { ok: true, captured_count: captured.length };
  }

  // Une ou plusieurs ont échoué → annuler les réussies (best effort)
  console.error('[CollectivePay] partial failure, refunding', captured.length, 'captures');
  for (const c of captured) {
    try {
      // Refund best effort si déjà capturé
      await stripe.refunds.create({ payment_intent: c.pi_id }, { idempotencyKey: 'refund_' + c.token_id });
    } catch (e) { console.error('[CollectivePay] refund failed:', e.message); }
  }

  await db.query(
    `UPDATE collective_payment_sessions SET status = 'failed', ended_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  await db.query(
    `UPDATE collective_workspaces SET status = 'session_ended' WHERE id = $1`,
    [session.workspace_id]
  );
  await engine.logEvent(null, session.workspace_id, 'session_failed_capture', 'system', null, {
    session_id: sessionId, captured_count: captured.length, failed_count: failed.length, failures: failed,
  });
  return { ok: false, failed_count: failed.length };
}

async function _markTokensPaid(tokenIds) {
  if (!tokenIds.length) return;
  await db.query(
    `UPDATE collective_payment_tokens
       SET status = 'paid', paid_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [tokenIds]
  );
}

async function _createOrderFromSession(sessionId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const session = (await client.query(
      `SELECT * FROM collective_payment_sessions WHERE id = $1 FOR UPDATE`, [sessionId]
    )).rows[0];
    if (!session) { await client.query('ROLLBACK'); throw new Error('session_not_found'); }

    const ws = (await client.query(
      `SELECT * FROM collective_workspaces WHERE id = $1 FOR UPDATE`, [session.workspace_id]
    )).rows[0];
    if (!ws) { await client.query('ROLLBACK'); throw new Error('workspace_not_found'); }

    // Idempotence : si deja créée, on ne refait rien
    if (ws.order_id) {
      await client.query('COMMIT');
      return { order_id: ws.order_id, idempotent: true };
    }

    // Récupérer les items snapshots
    const items = (await client.query(
      `SELECT * FROM collective_workspace_items WHERE workspace_id = $1`,
      [ws.id]
    )).rows;

    // Créer la commande — statut 'confirmed' pour suivre le flux Komerce existant
    // Reference : KOM-COL-{8 chars}
    const reference = 'KOM-COL-' + ws.id.replace(/-/g, '').slice(0, 8).toUpperCase();

    // Si pas de relais, on ne peut pas créer la commande (relais_id NOT NULL dans orders)
    if (!ws.relais_id) {
      await client.query('ROLLBACK');
      throw new Error('missing_relais_id');
    }

    const orderRes = await client.query(
      `INSERT INTO orders (
         reference, user_id, recipient_id, relais_id,
         total_kmf, payment_mode, payment_status, status,
         notes
       ) VALUES (
         $1, $2, NULL, $3,
         $4, 'stripe_eur', 'paid', 'confirmed',
         $5
       )
       RETURNING id, reference`,
      [
        reference,
        ws.creator_user_id || null,
        ws.relais_id,
        session.total_to_pay_kmf,
        'Panier collectif: ' + ws.event_name,
      ]
    );
    const order = orderRes.rows[0];

    // Créer les order_items depuis les snapshots
    for (const it of items) {
      if (!it.product_id) continue; // sécurité (item sans produit lié)
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_kmf)
         VALUES ($1, $2, $3, $4)`,
        [order.id, it.product_id, it.quantity, it.price_snapshot_kmf || 0]
      );
    }

    // Lier — Defense in depth :
    // La WHERE clause refuse explicitement d'écraser un order_id existant
    // ET refuse toute autre transition que payment_pending → order_created.
    // Même si la garde idempotente plus haut (ws.order_id != null → return)
    // est déjà passée, ce filet ultime garantit qu'aucun process concurrent
    // ne peut nous faire écraser une commande déjà liée.
    // Si rowCount = 0 : un autre process a créé une commande entre-temps
    //   → on rollback pour ne JAMAIS détruire le lien existant.
    const linkRes = await client.query(
      `UPDATE collective_workspaces
         SET status = 'order_created', order_id = $1
       WHERE id = $2
         AND order_id IS NULL
         AND status = 'payment_pending'`,
      [order.id, ws.id]
    );
    if (linkRes.rowCount !== 1) {
      await client.query('ROLLBACK');
      throw new Error('workspace_already_linked_to_order_or_wrong_state');
    }
    await client.query(
      `UPDATE collective_payment_sessions SET status = 'paid', ended_at = NOW() WHERE id = $1`,
      [sessionId]
    );

    await engine.logEvent(client, ws.id, 'order_created', 'system', null, {
      order_id: order.id, order_reference: order.reference, session_id: sessionId,
    });

    await client.query('COMMIT');
    console.log('[CollectivePay] ✅ Commande creee', order.reference, 'depuis workspace', ws.id);
    return { order_id: order.id, order_reference: order.reference };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// EXPIRATION (appelé par le cron)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Trouve les sessions dépassées et :
 *   - annule les PaymentIntents actifs (libère les autorisations Stripe)
 *   - marque les tokens 'expired'
 *   - passe la session 'ended'
 *   - passe le workspace 'session_ended' (reprenable)
 */
async function expireOverdueSessions() {
  const overdue = (await db.query(
    `SELECT * FROM collective_payment_sessions
     WHERE status IN ('open','ready_to_capture')
       AND expires_at < NOW()
     ORDER BY expires_at
     LIMIT 50`
  )).rows;

  if (!overdue.length) return { expired_count: 0 };

  const results = [];
  for (const session of overdue) {
    try {
      await _expireSession(session.id);
      results.push({ session_id: session.id, ok: true });
    } catch (err) {
      console.error('[CollectivePay] expire session', session.id, 'failed:', err.message);
      results.push({ session_id: session.id, ok: false, error: err.message });
    }
  }
  return { expired_count: overdue.length, results };
}

async function _expireSession(sessionId) {
  // Récupérer les tokens actifs (avec PI à annuler)
  const tokens = (await db.query(
    `SELECT * FROM collective_payment_tokens
     WHERE session_id = $1 AND status IN ('active','authorized')`,
    [sessionId]
  )).rows;

  // Annuler les PaymentIntents (hors transaction)
  for (const t of tokens) {
    if (t.stripe_payment_intent_id) {
      try {
        await stripe.paymentIntents.cancel(t.stripe_payment_intent_id, {}, {
          idempotencyKey: 'cancel_' + t.id,
        });
      } catch (err) {
        // Ignore : peut-etre deja cancel ou capture
        if (!String(err.message).includes('cannot be canceled')) {
          console.warn('[CollectivePay] PI cancel failed for', t.id, ':', err.message);
        }
      }
    }
  }

  // Marquer en BDD
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const session = (await client.query(
      `SELECT workspace_id FROM collective_payment_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId]
    )).rows[0];

    await client.query(
      `UPDATE collective_payment_tokens
         SET status = 'expired'
       WHERE session_id = $1 AND status IN ('active','authorized')`,
      [sessionId]
    );
    await client.query(
      `UPDATE collective_payment_sessions
         SET status = 'ended', ended_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );
    await client.query(
      `UPDATE collective_workspaces
         SET status = 'session_ended'
       WHERE id = $1 AND status = 'payment_pending'`,
      [session.workspace_id]
    );

    await engine.logEvent(client, session.workspace_id, 'session_ended', 'system', null, {
      session_id: sessionId, reason: 'expired', tokens_expired: tokens.length,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// IDEMPOTENCE WEBHOOK (vérif & enregistrement)
// ═══════════════════════════════════════════════════════════════════════

async function isStripeEventProcessed(stripeEventId) {
  const r = await db.query(
    `SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1`,
    [stripeEventId]
  );
  return r.rows.length > 0;
}

async function markStripeEventProcessed(stripeEventId, eventType, payloadSummary = {}) {
  await db.query(
    `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
     VALUES ($1, $2, $3)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId, eventType, JSON.stringify(payloadSummary)]
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CRON STARTER
// ═══════════════════════════════════════════════════════════════════════

let _cronInterval = null;
function startExpirationCron(intervalMs = 5 * 60 * 1000) {
  if (_cronInterval) return; // déjà démarré
  console.log('[CollectivePay] cron expiration started, interval=' + Math.round(intervalMs/1000) + 's');
  _cronInterval = setInterval(async () => {
    try {
      const r = await expireOverdueSessions();
      if (r.expired_count > 0) {
        console.log('[CollectivePay] cron: expired ' + r.expired_count + ' sessions');
      }
    } catch (err) {
      console.error('[CollectivePay] cron error:', err.message);
    }
  }, intervalMs);
}

function stopExpirationCron() {
  if (_cronInterval) { clearInterval(_cronInterval); _cronInterval = null; }
}

module.exports = {
  createOrGetPaymentIntent,
  onPaymentAuthorized,
  captureAllAndCreateOrder,
  expireOverdueSessions,
  isStripeEventProcessed,
  markStripeEventProcessed,
  startExpirationCron,
  stopExpirationCron,
};
