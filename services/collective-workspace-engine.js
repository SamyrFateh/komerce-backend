/**
 * KOMERCE — Collective Workspace Engine (V1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine V1 :
 *   "Un evenement. Un panier. Des intentions libres.
 *    Une session courte. Une commande seulement si tout est securise.
 *    Sinon, on reprend simplement."
 *
 * Ce service est PUR : il ne fait pas d'appels Stripe ni de notifications.
 * L'orchestration Stripe vit dans collective-payment-orchestrator.js.
 *
 * RÈGLES MÉTIER FORTES :
 *   1. Workspace en 'conception' = totalement libre (intentions, items modifiables)
 *   2. Finalisation fige tout (snapshots prix, items, total)
 *   3. Tokens = un par contributeur, generation atomique
 *   4. Aucune capture si la session n'est pas a 100%
 *   5. Aucune commande si la capture n'a pas reussi
 *   6. Reprise simple : workspace 'session_ended' -> 'conception'
 *   7. Tokens stockes en hash (jamais en clair)
 *   8. Toutes les actions critiques en transaction PostgreSQL
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');

// ─── Configuration ─────────────────────────────────────────────────────
const CONFIG = {
  TOKEN_BYTES: 24,                          // 192 bits = ~32 chars en base64url
  PUBLIC_TOKEN_PREFIX: 'WS-',               // ex: WS-Ab3xK7...
  CREATOR_TOKEN_PREFIX: 'WC-',              // ex: WC-Ab3xK7...
  PAYMENT_TOKEN_PREFIX: 'PT-',              // ex: PT-Ab3xK7...
  SESSION_DURATION_MS: 72 * 60 * 60 * 1000, // 72h max
  SESSION_DURATION_MIN_MS: 1 * 60 * 60 * 1000, // 1h min (anti-erreur)
};

// ─── Helpers tokens ────────────────────────────────────────────────────
function _generateToken(prefix) {
  const raw = crypto.randomBytes(CONFIG.TOKEN_BYTES).toString('base64url');
  return prefix + raw;
}

function _hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Audit log helper ──────────────────────────────────────────────────
async function logEvent(client, workspaceId, eventType, actorType, actorIdentifier, payload = {}) {
  const c = client || db;
  await c.query(
    `INSERT INTO collective_workspace_events
       (workspace_id, event_type, actor_type, actor_identifier, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, eventType, actorType || null, actorIdentifier || null, JSON.stringify(payload)]
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CRÉATION WORKSPACE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Crée un workspace en mode 'conception'.
 * Renvoie les TOKENS BRUTS (à transmettre une seule fois au créateur).
 * Le créateur reçoit creator_token + public_token.
 * Il partage public_token via WhatsApp à sa famille.
 */
async function createWorkspace({
  event_name,
  event_note,
  creator_name,
  creator_phone,
  creator_email,
  creator_user_id,
  recipient_name,
  recipient_phone,
  relais_id,
}) {
  if (!event_name || !creator_name) {
    throw new Error('event_name et creator_name requis');
  }

  const publicToken  = _generateToken(CONFIG.PUBLIC_TOKEN_PREFIX);
  const creatorToken = _generateToken(CONFIG.CREATOR_TOKEN_PREFIX);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO collective_workspaces (
         public_token_hash, creator_token_hash,
         event_name, event_note,
         creator_name, creator_phone, creator_email, creator_user_id,
         recipient_name, recipient_phone, relais_id,
         status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'conception')
       RETURNING id, event_name, status, created_at`,
      [
        _hashToken(publicToken), _hashToken(creatorToken),
        event_name, event_note || null,
        creator_name, creator_phone || null, creator_email || null, creator_user_id || null,
        recipient_name || null, recipient_phone || null, relais_id || null,
      ]
    );
    const ws = rows[0];

    await logEvent(client, ws.id, 'workspace_created', 'creator', creator_email || creator_phone, {
      event_name, recipient_name, relais_id,
    });

    await client.query('COMMIT');
    return {
      workspace: ws,
      public_token: publicToken,
      creator_token: creatorToken,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lecture publique (par public_token) — pour les contributeurs.
 * Ne renvoie pas le creator_token_hash.
 */
async function getWorkspaceByPublicToken(publicToken) {
  const hash = _hashToken(publicToken);
  const { rows } = await db.query(
    `SELECT w.id, w.event_name, w.event_note,
            w.creator_name, w.recipient_name, w.recipient_phone,
            w.relais_id, w.status, w.order_id,
            w.created_at, w.finalized_at,
            r.name as relais_name
     FROM collective_workspaces w
     LEFT JOIN relais r ON r.id = w.relais_id
     WHERE w.public_token_hash = $1`,
    [hash]
  );
  if (!rows.length) return null;
  const ws = rows[0];

  const items = (await db.query(
    `SELECT id, product_id, quantity, product_name_snapshot,
            product_image_snapshot, price_snapshot_kmf
     FROM collective_workspace_items
     WHERE workspace_id = $1 ORDER BY created_at`,
    [ws.id]
  )).rows;

  const contributions = (await db.query(
    `SELECT id, contributor_name, intended_amount_kmf, status, created_at
     FROM collective_workspace_contributions
     WHERE workspace_id = $1 AND status != 'cancelled'
     ORDER BY created_at`,
    [ws.id]
  )).rows;

  // Session courante (si active)
  const session = (await db.query(
    `SELECT id, total_to_pay_kmf, amount_secured_kmf, status, expires_at, created_at
     FROM collective_payment_sessions
     WHERE workspace_id = $1 AND status IN ('open','ready_to_capture')
     ORDER BY created_at DESC LIMIT 1`,
    [ws.id]
  )).rows[0] || null;

  return { workspace: ws, items, contributions, session };
}

/**
 * Lecture créateur (par creator_token) — vue privilégiée avec tous les détails.
 */
async function getWorkspaceByCreatorToken(creatorToken) {
  const hash = _hashToken(creatorToken);
  const { rows } = await db.query(
    `SELECT * FROM collective_workspaces WHERE creator_token_hash = $1`,
    [hash]
  );
  if (!rows.length) return null;
  return rows[0];
}

// ═══════════════════════════════════════════════════════════════════════
// ITEMS (uniquement en 'conception')
// ═══════════════════════════════════════════════════════════════════════

async function addItem(creatorToken, { product_id, quantity }) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // P0 FIX : SELECT FOR UPDATE pour bloquer toute mutation simultanée (finalize, etc.)
    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_modifiable');
    }

    // Snapshot prix actuel + nom
    let nameSnap = null, imgSnap = null, priceSnap = null;
    if (product_id) {
      const p = await client.query(
        `SELECT name, image_url, price_kmf FROM products WHERE id = $1 AND is_active = true`,
        [product_id]
      );
      if (!p.rows.length) {
        await client.query('ROLLBACK');
        throw new Error('product_not_found');
      }
      nameSnap  = p.rows[0].name;
      imgSnap   = p.rows[0].image_url;
      priceSnap = p.rows[0].price_kmf;
    }

    const { rows } = await client.query(
      `INSERT INTO collective_workspace_items
         (workspace_id, product_id, quantity, product_name_snapshot, product_image_snapshot, price_snapshot_kmf)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [ws.id, product_id || null, Math.max(1, parseInt(quantity, 10) || 1), nameSnap, imgSnap, priceSnap]
    );
    await logEvent(client, ws.id, 'item_added', 'creator', null, { product_id, quantity });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateItem(creatorToken, itemId, { quantity }) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_modifiable');
    }

    const { rows } = await client.query(
      `UPDATE collective_workspace_items
         SET quantity = $1
       WHERE id = $2 AND workspace_id = $3
       RETURNING *`,
      [Math.max(1, parseInt(quantity, 10) || 1), itemId, ws.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      throw new Error('item_not_found');
    }
    await logEvent(client, ws.id, 'item_updated', 'creator', null, { item_id: itemId, quantity });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function removeItem(creatorToken, itemId) {
  const hash = _hashToken(creatorToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE creator_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_modifiable');
    }

    const { rowCount } = await client.query(
      `DELETE FROM collective_workspace_items WHERE id = $1 AND workspace_id = $2`,
      [itemId, ws.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      throw new Error('item_not_found');
    }
    await logEvent(client, ws.id, 'item_removed', 'creator', null, { item_id: itemId });

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CONTRIBUTIONS (intentions libres)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ajoute une intention de contribution.
 * Aucun paiement n'est effectue ici.
 * Le contributeur partage son intention (montant qu'il proposera de payer).
 */
async function addContribution(publicToken, { contributor_name, contributor_phone, contributor_email, intended_amount_kmf }) {
  if (!contributor_name) throw new Error('contributor_name_required');
  const amount = parseInt(intended_amount_kmf, 10);
  if (!amount || amount <= 0) throw new Error('amount_invalid');

  const hash = _hashToken(publicToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // P0 FIX : SELECT FOR UPDATE pour bloquer toute mutation simultanée (finalize, etc.)
    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE public_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_open');
    }

    const { rows } = await client.query(
      `INSERT INTO collective_workspace_contributions
         (workspace_id, contributor_name, contributor_phone, contributor_email, intended_amount_kmf, status)
       VALUES ($1,$2,$3,$4,$5,'intention')
       RETURNING *`,
      [ws.id, contributor_name, contributor_phone || null, contributor_email || null, amount]
    );
    await logEvent(client, ws.id, 'contribution_added', 'contributor', contributor_email || contributor_phone, {
      contributor_name, intended_amount_kmf: amount,
    });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cancelContribution(publicToken, contributionId) {
  const hash = _hashToken(publicToken);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const wsRes = await client.query(
      `SELECT id, status FROM collective_workspaces WHERE public_token_hash = $1 FOR UPDATE`,
      [hash]
    );
    if (!wsRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_found');
    }
    const ws = wsRes.rows[0];
    if (ws.status !== 'conception') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_open');
    }

    const { rowCount } = await client.query(
      `UPDATE collective_workspace_contributions
         SET status = 'cancelled'
       WHERE id = $1 AND workspace_id = $2 AND status = 'intention'`,
      [contributionId, ws.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      throw new Error('contribution_not_found_or_already_handled');
    }
    await logEvent(client, ws.id, 'contribution_cancelled', 'contributor', null, { contribution_id: contributionId });

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FINALISATION REVIEW (recalcul, sans figer)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Recalcule le total a partir des prix actuels (pas des snapshots).
 * Verifie disponibilites. Renvoie un rapport pour l'UI sans rien figer.
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

// ═══════════════════════════════════════════════════════════════════════
// FINALIZE — fige tout, crée session + tokens
// ═══════════════════════════════════════════════════════════════════════

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
    // Stratégie simple : ratio = total / intendedSum, on applique a chaque contribution
    // (V1 : on accepte la perte de centimes, l'arrondi sera assigné a la dernière contribution)
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
        payment_url_path: '/api/collective-payments/' + tokenRaw,
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

    // Garde 1 (Node) — non-réversibilité absolue : si une commande a déjà
    // été créée, ce workspace n'est plus reprenable. La frontière
    // workspace/order est sacrée.
    if (ws.order_id) {
      await client.query('ROLLBACK');
      throw new Error('workspace_locked_by_order');
    }

    // Garde 2 (Node) — état correct
    if (ws.status !== 'session_ended') {
      await client.query('ROLLBACK');
      throw new Error('workspace_not_resumable:' + ws.status);
    }

    // Garde 3 (SQL — defense in depth) — la WHERE clause filtre
    // explicitement sur order_id IS NULL ET status = 'session_ended'.
    // Filet ultime contre toute évolution imprévue de l'état.
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

// ═══════════════════════════════════════════════════════════════════════
// LECTURE TOKEN (pour la route /api/collective-payments/:token)
// ═══════════════════════════════════════════════════════════════════════

async function getTokenInfo(rawToken) {
  const hash = _hashToken(rawToken);
  const { rows } = await db.query(
    `SELECT t.*, s.workspace_id, s.total_to_pay_kmf, s.amount_secured_kmf,
            s.status as session_status, s.expires_at as session_expires_at,
            w.event_name, w.recipient_name
     FROM collective_payment_tokens t
     JOIN collective_payment_sessions s ON s.id = t.session_id
     JOIN collective_workspaces w ON w.id = s.workspace_id
     WHERE t.token_hash = $1`,
    [hash]
  );
  if (!rows.length) return null;
  return rows[0];
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Helpers
  _generateToken, _hashToken, logEvent, CONFIG,

  // Public API
  createWorkspace,
  getWorkspaceByPublicToken,
  getWorkspaceByCreatorToken,
  addItem, updateItem, removeItem,
  addContribution, cancelContribution,
  finalizationReview,
  finalizeWorkspace,
  resumeWorkspace,
  getTokenInfo,
};
