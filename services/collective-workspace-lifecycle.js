/**
 * @komerce-arch
 * @role          collective-workspace-lifecycle
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        creator_token, duration_hours, idempotency_key
 * @outputs       review_report, session_tokens, workspace_status
 * @depends       services/collective-workspace-internals.js, services/collective-workspace-reads.js
 * @used-by       services/collective-workspace-engine.js
 * @db-read       collective_payment_sessions, collective_workspace_contributions, collective_workspace_items, collective_workspaces, products
 * @db-write      collective_payment_sessions, collective_payment_tokens, collective_workspace_contributions, collective_workspace_events, collective_workspace_items, collective_workspaces
 * @db-txn        required_for_state_transition
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

'use strict';

const { db, CONFIG, _generateToken, _hashToken, logEvent } = require('./collective-workspace-internals');
const { getWorkspaceByCreatorToken } = require('./collective-workspace-reads');

/**
 * Recalcule le total à partir des prix actuels (pas des snapshots).
 * Vérifie disponibilités. Renvoie un rapport pour l'UI sans rien figer.
 */
async function finalizationReview(creatorToken) {
  const ws = await getWorkspaceByCreatorToken(creatorToken);
  if (!ws) throw new Error('workspace_not_found');
  if (ws.status !== 'conception') throw new Error('workspace_not_in_conception');

  const items = (await db.query(
    `SELECT i.*, p.name as current_name, p.price_kmf as current_price_kmf, p.is_active as product_active
     FROM collective_workspace_items i
     LEFT JOIN products p ON p.id = i.product_id
     WHERE i.workspace_id = $1`,
    [ws.id]
  )).rows;

  if (!items.length) throw new Error('no_items');

  let total = 0;
  const lineItems = items.map(it => {
    const currentPrice = parseInt(it.current_price_kmf, 10) || 0;
    const lineTotal = currentPrice * it.quantity;
    total += lineTotal;
    return {
      item_id: it.id,
      product_id: it.product_id,
      product_name: it.current_name || it.product_name_snapshot,
      quantity: it.quantity,
      current_price_kmf: currentPrice,
      line_total_kmf: lineTotal,
      product_active: it.product_active === true || it.product_active === null,
      price_changed: it.price_snapshot_kmf != null && parseInt(it.price_snapshot_kmf, 10) !== currentPrice,
    };
  });

  // Intentions
  const contributions = (await db.query(
    `SELECT id, contributor_name, intended_amount_kmf
     FROM collective_workspace_contributions
     WHERE workspace_id = $1 AND status = 'intention'
     ORDER BY created_at`,
    [ws.id]
  )).rows;

  const intendedSum = contributions.reduce((s, c) => s + parseInt(c.intended_amount_kmf, 10), 0);
  const gap = total - intendedSum;

  await logEvent(null, ws.id, 'finalization_reviewed', 'creator', null, {
    total_kmf: total, intended_sum_kmf: intendedSum, gap_kmf: gap,
  });

  return {
    workspace_id: ws.id,
    line_items: lineItems,
    total_kmf: total,
    intentions: contributions,
    intended_sum_kmf: intendedSum,
    gap_kmf: gap,                             // > 0 = sous-financé, 0 = équilibré, < 0 = sur-financé
    can_finalize: lineItems.every(li => li.product_active) && intendedSum >= total && contributions.length > 0,
    issues: lineItems.filter(li => !li.product_active).map(li => ({ item_id: li.item_id, reason: 'product_inactive' })),
  };
}

/**
 * Fige le panier, convertit les intentions en tokens, crée la payment_session.
 * Utilisation d'une transaction + SELECT FOR UPDATE pour éviter les double clics.
 *
 * Renvoie : { session_id, tokens: [{token, contributor_name, amount_kmf, ...}] }
 * Les tokens BRUTS sont renvoyés UNE SEULE FOIS — le créateur doit les transmettre.
 */
async function finalizeWorkspace(creatorToken, { duration_hours = 72, idempotency_key = null } = {}) {
  const hash = _hashToken(creatorToken);
  const durationMs = Math.max(
    CONFIG.SESSION_DURATION_MIN_MS,
    Math.min(CONFIG.SESSION_DURATION_MS, duration_hours * 60 * 60 * 1000)
  );

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // SELECT FOR UPDATE pour éviter double clic finalisation
    const wsRes = await client.query(
      `SELECT * FROM collective_workspaces
       WHERE creator_token_hash = $1
       FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];

    // Idempotence : si déjà finalisé, renvoyer la session existante
    if (ws.status === 'payment_pending') {
      const existingSession = (await client.query(
        `SELECT * FROM collective_payment_sessions
         WHERE workspace_id = $1 AND status IN ('open','ready_to_capture')
         ORDER BY created_at DESC LIMIT 1`,
        [ws.id]
      )).rows[0];
      if (existingSession) {
        await client.query('COMMIT');
        return { workspace_id: ws.id, session_id: existingSession.id, already_finalized: true, tokens: [] };
      }
    }

    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_in_conception');
    }

    // Recalcul serveur
    const items = (await client.query(
      `SELECT i.*, p.price_kmf as current_price_kmf, p.name as current_name,
              p.image_url as current_image, p.is_active as product_active
       FROM collective_workspace_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.workspace_id = $1
       FOR UPDATE OF i`,
      [ws.id]
    )).rows;

    if (!items.length) {
      await client.query('ROLLBACK');
      throw new Error('no_items');
    }

    let total = 0;
    for (const it of items) {
      if (it.product_id && it.product_active === false) {
        await client.query('ROLLBACK');
        throw new Error('product_inactive:' + it.product_id);
      }
      const price = parseInt(it.current_price_kmf, 10) || 0;
      total += price * it.quantity;
      // Figer les snapshots
      await client.query(
        `UPDATE collective_workspace_items
           SET product_name_snapshot = $1,
               product_image_snapshot = $2,
               price_snapshot_kmf = $3
         WHERE id = $4`,
        [it.current_name || it.product_name_snapshot, it.current_image || it.product_image_snapshot, price, it.id]
      );
    }

    if (total <= 0) {
      await client.query('ROLLBACK');
      throw new Error('total_invalid');
    }

    // Récupérer les intentions
    const contributions = (await client.query(
      `SELECT * FROM collective_workspace_contributions
       WHERE workspace_id = $1 AND status = 'intention'
       ORDER BY created_at
       FOR UPDATE`,
      [ws.id]
    )).rows;

    if (!contributions.length) {
      await client.query('ROLLBACK');
      throw new Error('no_contributions');
    }

    const intendedSum = contributions.reduce((s, c) => s + parseInt(c.intended_amount_kmf, 10), 0);
    if (intendedSum < total) {
      await client.query('ROLLBACK');
      throw new Error('insufficient_intentions:' + intendedSum + '<' + total);
    }

    // Si sur-financé → on ajuste proportionnellement à la baisse, en gardant le total exact
    // Stratégie simple : ratio = total / intendedSum, on applique à chaque contribution
    // (V1 : on accepte la perte de centimes, l'arrondi sera assigné à la dernière contribution)
    const expiresAt = new Date(Date.now() + durationMs);

    // Créer la session
    const sessionRes = await client.query(
      `INSERT INTO collective_payment_sessions
         (workspace_id, total_to_pay_kmf, amount_secured_kmf, status, expires_at)
       VALUES ($1, $2, 0, 'open', $3)
       RETURNING *`,
      [ws.id, total, expiresAt]
    );
    const session = sessionRes.rows[0];

    // Générer les tokens (un par contribution)
    const tokens = [];
    let assignedSum = 0;
    for (let i = 0; i < contributions.length; i++) {
      const c = contributions[i];
      const isLast = (i === contributions.length - 1);

      let amount;
      if (intendedSum === total) {
        amount = parseInt(c.intended_amount_kmf, 10);
      } else if (isLast) {
        amount = total - assignedSum;
      } else {
        amount = Math.floor(parseInt(c.intended_amount_kmf, 10) * (total / intendedSum));
      }
      assignedSum += amount;

      const tokenRaw = _generateToken(CONFIG.PAYMENT_TOKEN_PREFIX);
      const tokenHash = _hashToken(tokenRaw);

      await client.query(
        `INSERT INTO collective_payment_tokens
           (session_id, token_hash, contributor_name, contributor_phone, contributor_email,
            amount_kmf, status, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`,
        [session.id, tokenHash, c.contributor_name, c.contributor_phone, c.contributor_email,
         amount, expiresAt]
      );

      // Marquer la contribution comme convertie
      await client.query(
        `UPDATE collective_workspace_contributions
           SET status = 'converted'
         WHERE id = $1`,
        [c.id]
      );

      tokens.push({
        contributor_name: c.contributor_name,
        contributor_phone: c.contributor_phone,
        contributor_email: c.contributor_email,
        amount_kmf: amount,
        payment_token: tokenRaw,    // BRUT — à transmettre une seule fois
        payment_url_path: '/api/collective-payments/' + tokenRaw,         // API JSON
        payment_page_url: '/event/pay/' + tokenRaw,                       // P1.3 : page HTML utilisateur
      });
    }

    // Passer le workspace en payment_pending
    await client.query(
      `UPDATE collective_workspaces
         SET status = 'payment_pending', finalized_at = NOW()
       WHERE id = $1`,
      [ws.id]
    );

    await logEvent(client, ws.id, 'workspace_finalized', 'creator', null, {
      session_id: session.id, total_kmf: total, tokens_count: tokens.length, expires_at: expiresAt,
    });

    await client.query('COMMIT');
    return {
      workspace_id: ws.id,
      session_id: session.id,
      total_kmf: total,
      expires_at: expiresAt,
      tokens,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// REPRISE (workspace 'session_ended' -> 'conception')
//
// FRONTIÈRE NON-RÉVERSIBLE :
//   Une fois qu'un workspace a un order_id (status = 'order_created'),
//   il ne PEUT PLUS jamais revenir en 'conception'. La création de la
//   commande Komerce est l'engagement irréversible : à partir de là, le
//   moteur logistique standard prend le relais (preparation → shipped → ...).
//
//   Cette frontière est protégée par TROIS verrous indépendants :
//     1. Garde Node : on lit `order_id` en SELECT FOR UPDATE et on refuse
//        explicitement la transition si non-null.
//     2. Garde Node : on contrôle aussi le status courant ('session_ended').
//     3. Garde SQL : la WHERE clause de l'UPDATE filtre sur
//        `order_id IS NULL AND status = 'session_ended'`. Si une race
//        condition imprévue (trigger, autre process, extension future)
//        modifiait l'état entre le SELECT et l'UPDATE, aucune ligne ne
//        serait modifiée et la transaction serait rollback.
//
//   Defense in depth : aucun des 3 verrous ne suffit seul à garantir
//   l'invariant en théorie ; combinés ils rendent le franchissement
//   accidentel impossible.
// ═══════════════════════════════════════════════════════════════════════

async function resumeWorkspace(creatorToken) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const ws = (await client.query(
      `SELECT * FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    )).rows[0];
    if (!ws) { await client.query('ROLLBACK'); throw new Error('workspace_not_found'); }

    // Garde 1 (Node) — non-réversibilité absolue
    if (ws.order_id) {
      await client.query('ROLLBACK');
      throw new Error('workspace_locked_by_order');
    }

    // Garde 2 (Node) — état correct
    if (ws.status !== 'session_ended') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_resumable:' + ws.status);
    }

    // Garde 3 (SQL — defense in depth)
    const upd = await client.query(
      `UPDATE collective_workspaces
         SET status = 'conception'
       WHERE id = $1
         AND order_id IS NULL
         AND status = 'session_ended'`,
      [ws.id]
    );
    if (upd.rowCount !== 1) {
      await client.query('ROLLBACK');
      throw new Error('workspace_locked_by_order');
    }

    // Réactiver les contributions converties (qui n'ont pas abouti) en intentions
    await client.query(
      `UPDATE collective_workspace_contributions
         SET status = 'intention'
       WHERE workspace_id = $1 AND status = 'converted'`,
      [ws.id]
    );

    await logEvent(client, ws.id, 'workspace_resumed', 'creator', null, { from_status: ws.status });

    await client.query('COMMIT');
    return { workspace_id: ws.id, status: 'conception' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { finalizationReview, finalizeWorkspace, resumeWorkspace };
