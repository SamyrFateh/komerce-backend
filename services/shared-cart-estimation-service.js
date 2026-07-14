/**
 * @komerce-arch
 * @role          shared-cart-estimation-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        shared_cart_id, participant_identity, estimated_amount
 * @outputs       estimation_snapshot, aggregate_estimation, creator_visibility
 * @depends       db.js, services/shared-cart-queries.js
 * @used-by       routes/shared-cart.js, b-group-view.js
 * @db-read       shared_cart_estimations, shared_carts
 * @db-write      shared_cart_estimations, shared_cart_events
 * @db-txn        estimation_is_not_payment, aggregate_recalculation
 * @doctrine      estimations_indicatives, paiement_seul_acte_engageant, visibilite_createur
 * @impact-areas  participant-flow, creator-flow, shared-cart-progress, notifications
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Shared Cart Estimation Service
 * V4.1 — Lot 3
 *
 * Remplace shared-cart-commitment-service.js.
 *
 * Une estimation est un indicateur facultatif de participation :
 * - sans statut de cycle de vie (pas de pledged/locked/withdrawn) ;
 * - modifiable à tout moment tant que le panier est OPEN ;
 * - supprimable (DELETE, pas de soft-status 'withdrawn') ;
 * - jamais contractuelle, jamais verrouillée.
 *
 * Vue publique : agrégat uniquement ({total_estimated_kmf, count}).
 * Vue créateur : détail complet (listEstimationsForOwner).
 *
 * Fonctions exportées :
 *   getPublicAggregate(token)
 *   getEstimationByPhone(token, phone)
 *   upsertEstimation(token, body)
 *   deleteEstimation(token, estimationId, body)
 *   listEstimationsForOwner(sharedCartId)
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'shared-cart-estimation-service' });

const MIN_ESTIMATION_KMF = 2500;
const MAX_ESTIMATION_KMF = 500000;

function r(n) {
  return Math.round(Number(n) || 0);
}

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function tx(fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function addEvent(client, cartId, eventType, actor, payload) {
  await client.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [cartId, eventType, actor?.type || null, actor?.id || null, payload || {}]
  );
}

/**
 * Guard V4.1 : les estimations ne sont acceptées que si le panier est OPEN.
 */
function assertCartOpenForEstimation(cart) {
  if (!cart) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  if (cart.status !== 'open') {
    throw httpError(
      `Ce panier n'accepte plus d'estimations (statut : ${cart.status})`,
      409,
      'estimation_not_allowed'
    );
  }
}

function validatePayload(body = {}) {
  const name = String(body.participant_name || '').trim();
  if (!name) throw httpError('Nom du participant requis', 400, 'participant_name_required');

  const amount = r(body.amount_kmf);
  if (amount < MIN_ESTIMATION_KMF) {
    throw httpError(`Estimation minimum : ${MIN_ESTIMATION_KMF} KMF`, 400, 'amount_too_low');
  }
  if (amount > MAX_ESTIMATION_KMF) {
    throw httpError(`Estimation maximum : ${MAX_ESTIMATION_KMF} KMF`, 400, 'amount_too_high');
  }

  return {
    participantName: name,
    participantPhone: body.participant_phone || null,
    amountKmf: amount,
  };
}

// ---------------------------------------------------------------------------
// Lecture publique — agrégat uniquement
// ---------------------------------------------------------------------------

/**
 * Retourne l'agrégat public des estimations pour un panier donné (par token).
 * Ne révèle aucun nom ni téléphone.
 *
 * @returns {{ total_estimated_kmf: number, count: number }}
 */
async function getPublicAggregate(token) {
  const { rows: cartRows } = await db.query(
    `SELECT id, status FROM shared_carts WHERE token = $1`,
    [token]
  );
  if (!cartRows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  const cart = cartRows[0];

  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount_kmf), 0)::int AS total_estimated_kmf,
            COUNT(*)::int                      AS count
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1`,
    [cart.id]
  );

  return {
    total_estimated_kmf: rows[0].total_estimated_kmf,
    count: rows[0].count,
  };
}

/**
 * Retourne l'estimation existante d'un participant identifié par son téléphone,
 * pour pré-remplir le formulaire à son retour.
 * Retourne null si aucune estimation n'existe pour ce téléphone.
 */
async function getEstimationByPhone(token, phone) {
  if (!phone) return null;

  const { rows: cartRows } = await db.query(
    `SELECT id, status FROM shared_carts WHERE token = $1`,
    [token]
  );
  if (!cartRows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
  const cart = cartRows[0];

  const { rows } = await db.query(
    `SELECT id, participant_name, amount_kmf, created_at, updated_at
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1
        AND participant_phone = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [cart.id, phone]
  );

  return rows.length ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// Écriture publique — upsert / delete
// ---------------------------------------------------------------------------

/**
 * Crée ou met à jour l'estimation d'un participant.
 * Upsert par téléphone si fourni, sinon insertion simple.
 * Guard : statut cart === 'open' requis.
 *
 * @returns {{ cart, estimation, updated: boolean }}
 */
async function upsertEstimation(token, body = {}) {
  const payload = validatePayload(body);

  return tx(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
    const cart = cartRows[0];
    assertCartOpenForEstimation(cart);

    // Upsert par téléphone si disponible
    if (payload.participantPhone) {
      const { rows: existing } = await client.query(
        `SELECT id FROM shared_cart_estimations
          WHERE shared_cart_id = $1
            AND participant_phone = $2
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE`,
        [cart.id, payload.participantPhone]
      );

      if (existing.length) {
        const { rows: [estimation] } = await client.query(
          `UPDATE shared_cart_estimations
              SET participant_name = $2,
                  amount_kmf       = $3,
                  updated_at       = NOW()
            WHERE id = $1
            RETURNING *`,
          [existing[0].id, payload.participantName, payload.amountKmf]
        );

        await addEvent(client, cart.id, 'estimation_updated', { type: 'participant' }, {
          estimation_id: estimation.id,
          participant_phone: payload.participantPhone,
          amount_kmf: payload.amountKmf,
        });

        log.info('[shared-cart] estimation mise à jour', {
          cart_id: cart.id,
          estimation_id: estimation.id,
        });

        return { cart, estimation, updated: true };
      }
    }

    // Insertion
    const { rows: [estimation] } = await client.query(
      `INSERT INTO shared_cart_estimations
         (shared_cart_id, participant_name, participant_phone, amount_kmf)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [cart.id, payload.participantName, payload.participantPhone, payload.amountKmf]
    );

    await addEvent(client, cart.id, 'estimation_created', { type: 'participant' }, {
      estimation_id: estimation.id,
      participant_phone: payload.participantPhone,
      amount_kmf: payload.amountKmf,
    });

    log.info('[shared-cart] estimation créée', {
      cart_id: cart.id,
      estimation_id: estimation.id,
    });

    return { cart, estimation, updated: false };
  });
}

/**
 * Supprime une estimation (DELETE réel, pas de soft-status 'withdrawn').
 * Guard : statut cart === 'open' requis.
 * Guard optionnel : vérification du téléphone si fourni dans le body.
 *
 * [IDOR-01] Modèle d'autorisation retenu — documenté explicitement (pas de
 * changement de comportement) : la possession du `token` du panier partagé
 * (share URL) vaut droit d'édition sur TOUTES les estimations de ce panier,
 * y compris celles d'autres participants. `participant_phone` est une
 * vérification best-effort optionnelle, PAS une authentification — si le
 * body ne le fournit pas, la suppression réussit quand même (`phoneClause`
 * vide). C'est cohérent avec le reste du flux public non-authentifié
 * (shared_carts n'a pas de notion de compte utilisateur par participant).
 * Rendre `participant_phone` obligatoire casserait le flux existant pour
 * les participants qui ne l'ont jamais renseigné (cas déjà couvert par les
 * tests "sans phone"). Risque résiduel accepté : P3, cohérent avec le
 * modèle "lien = droit d'édition" du panier partagé dans son ensemble.
 */
async function deleteEstimation(token, estimationId, body = {}) {
  return tx(async (client) => {
    const { rows: cartRows } = await client.query(
      `SELECT * FROM shared_carts WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (!cartRows.length) throw httpError('Panier partagé introuvable', 404, 'shared_cart_not_found');
    const cart = cartRows[0];
    assertCartOpenForEstimation(cart);

    const participantPhone = body.participant_phone || null;
    const params = [estimationId, cart.id];
    let phoneClause = '';
    if (participantPhone) {
      params.push(participantPhone);
      phoneClause = ` AND participant_phone = $${params.length}`;
    }

    const { rows: deleted } = await client.query(
      `DELETE FROM shared_cart_estimations
        WHERE id = $1
          AND shared_cart_id = $2
          ${phoneClause}
        RETURNING *`,
      params
    );

    if (!deleted.length) {
      throw httpError('Estimation introuvable ou non supprimable', 404, 'estimation_not_found');
    }

    await addEvent(client, cart.id, 'estimation_deleted', { type: 'participant' }, {
      estimation_id: estimationId,
      participant_phone: participantPhone,
    });

    log.info('[shared-cart] estimation supprimée', {
      cart_id: cart.id,
      estimation_id: estimationId,
    });

    return { cart, deleted: deleted[0] };
  });
}

// ---------------------------------------------------------------------------
// Lecture propriétaire — détail complet (cockpit créateur)
// ---------------------------------------------------------------------------

/**
 * Retourne la liste complète des estimations pour le cockpit créateur.
 * Appelé depuis la route owner GET /:id (engine ou route layer).
 * Les téléphones sont exposés en clair côté propriétaire.
 *
 * @param {string} sharedCartId UUID du panier partagé
 * @returns {Array<{ id, participant_name, participant_phone, amount_kmf, created_at, updated_at }>}
 */
async function listEstimationsForOwner(sharedCartId) {
  const { rows } = await db.query(
    `SELECT id,
            participant_name,
            participant_phone,
            amount_kmf,
            created_at,
            updated_at
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1
      ORDER BY created_at DESC`,
    [sharedCartId]
  );
  return rows;
}

module.exports = {
  getPublicAggregate,
  getEstimationByPhone,
  upsertEstimation,
  deleteEstimation,
  listEstimationsForOwner,
};
