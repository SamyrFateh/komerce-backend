/**
 * @komerce-arch
 * @role          shared-cart-library-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   high
 * @inputs        user_id, share_token, shared_cart_id
 * @outputs       library_sections, saved_access_row, saved_access_removal
 * @depends       db.js, services/shared-cart-reads.js
 * @used-by       routes/shared-cart.js, routes/shared-cart-saved.js
 * @db-read       order_items, shared_cart_items, shared_cart_saved_access, shared_carts, users
 * @db-write      shared_cart_saved_access
 * @db-txn        none
 * @doctrine      domaine_minimal_boutique_first, sauvegarde_explicite_jamais_implicite
 * @impact-areas  shared-cart, creator-flow, participant-flow, mon-komerce
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Bibliothèque « Mes listes » (Amendement V2 §D)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Remplace l'heuristique V1 (group-side-cart.js::activateOwnerMostRecentList
 * — ouvrait toujours la liste créée la plus récente, sans notion de liste
 * *reçue*). Deux sections, jamais mélangées :
 *
 *   - Créées par moi    → shared_carts.organizer_user_id = viewer
 *                          (déjà servi par shared-cart-reads.js::listMySharedCarts,
 *                          réutilisé tel quel, pas dupliqué ici).
 *   - Partagées avec moi → listes reçues par lien token qu'un destinataire
 *                          a explicitement choisi de conserver
 *                          (shared_cart_saved_access, migration 127).
 *
 * Doctrine « sauvegarde explicite, jamais implicite » : ouvrir un lien
 * reçu (GET /api/shared-carts/public/:token) ne pose jamais de trace dans
 * shared_cart_saved_access. Seul un appel explicite à
 * saveSharedCartForUser() (POST /api/shared-carts/save) fait apparaître
 * une liste reçue dans la section « Partagées avec moi ». Rien n'est posé
 * automatiquement en arrière-plan — jamais de "signet" implicite.
 *
 * Retirer une liste de la bibliothèque ne supprime jamais la liste réelle,
 * ses articles, ses commandes ou son token public. Seule la ligne d'accès
 * propre à l'utilisateur courant est retirée.
 */

const db = require('../db');
const { listMySharedCarts } = require('./shared-cart-reads');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(message, status = 400, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/**
 * Bibliothèque complète d'un utilisateur : les deux sections en un seul
 * appel (l'écran « Mes listes » a besoin des deux en même temps, jamais
 * l'une sans l'autre).
 * @param {string} userId
 * @returns {Promise<{created: Array, saved: Array}>}
 */
async function getSharedCartLibrary(userId) {
  const created = await listMySharedCarts(userId);

  const { rows: saved } = await db.query(
    `SELECT sc.id, sc.token, sc.title, sc.status, sc.created_at,
            sc.closed_at, sc.cancelled_at,
            ssa.saved_at,
            u.full_name AS organizer_full_name,
            COALESCE(agg.total_kmf, 0)::int AS total_kmf,
            COALESCE(agg.items_count, 0)::int AS items_count,
            COALESCE(agg.claimed_count, 0)::int AS claimed_count
       FROM shared_cart_saved_access ssa
       JOIN shared_carts sc ON sc.id = ssa.shared_cart_id
       LEFT JOIN users u ON u.id = sc.organizer_user_id
       LEFT JOIN LATERAL (
         SELECT SUM(sci.line_total_kmf_snapshot) AS total_kmf,
                -- Mandat §11 — même correctif que listMySharedCarts
                -- (services/shared-cart-reads.js) : items_count/claimed_count
                -- en unités (SUM(quantity)), pas en lignes (COUNT(*)), pour
                -- correspondre au libellé "X/Y articles" affiché ici aussi.
                COALESCE(SUM(sci.quantity), 0) AS items_count,
                COALESCE(SUM(sci.quantity) FILTER (WHERE oi.id IS NOT NULL), 0) AS claimed_count
           FROM shared_cart_items sci
           LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
          WHERE sci.shared_cart_id = sc.id
       ) agg ON TRUE
      WHERE ssa.user_id = $1
      ORDER BY ssa.saved_at DESC`,
    [userId]
  );

  return { created, saved };
}

/**
 * Sauvegarde explicite d'une liste reçue par lien — jamais appelé
 * automatiquement à la simple ouverture d'un lien (voir doctrine
 * ci-dessus). Idempotent : sauvegarder deux fois la même liste ne
 * duplique rien (ON CONFLICT DO NOTHING, filet de sécurité : l'index
 * unique de la migration 127).
 *
 * @param {string} userId  utilisateur authentifié qui sauvegarde
 * @param {string} token   token public de la liste (?p= / lien reçu)
 * @returns {Promise<{ok: boolean, shared_cart_id: string, already_saved: boolean}>}
 */
async function saveSharedCartForUser(userId, token) {
  if (!token || !String(token).trim()) {
    throw httpError('token requis', 400, 'token_required');
  }

  const { rows: cartRows } = await db.query(
    `SELECT id, organizer_user_id FROM shared_carts WHERE token = $1`,
    [String(token).trim()]
  );
  if (!cartRows.length) {
    throw httpError('Ce lien de liste partagée est invalide ou expiré.', 404, 'shared_cart_not_found');
  }
  const cart = cartRows[0];

  if (String(cart.organizer_user_id) === String(userId)) {
    throw httpError(
      'Vous êtes le créateur de cette liste — elle apparaît déjà dans « Créées par moi ».',
      400,
      'cannot_save_own_list'
    );
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM shared_cart_saved_access WHERE user_id = $1 AND shared_cart_id = $2`,
    [userId, cart.id]
  );
  if (existing.length) {
    return { ok: true, shared_cart_id: cart.id, already_saved: true };
  }

  await db.query(
    `INSERT INTO shared_cart_saved_access (user_id, shared_cart_id)
          VALUES ($1, $2)
     ON CONFLICT (user_id, shared_cart_id) DO NOTHING`,
    [userId, cart.id]
  );

  return { ok: true, shared_cart_id: cart.id, already_saved: false };
}

/**
 * Retire une liste reçue de « Partagées avec moi » pour l'utilisateur
 * courant. Cette opération est volontairement idempotente : une seconde
 * suppression répond encore ok avec removed=false.
 *
 * Aucun DELETE n'est effectué sur shared_carts ou shared_cart_items et le
 * token public reste valide. Le contexte de liste éventuellement ouvert
 * côté Boutique n'est pas concerné par cette préférence de bibliothèque.
 *
 * @param {string} userId
 * @param {string} sharedCartId
 * @returns {Promise<{ok: boolean, shared_cart_id: string, removed: boolean}>}
 */
async function removeSavedSharedCartForUser(userId, sharedCartId) {
  const normalizedId = String(sharedCartId || '').trim();
  if (!normalizedId) {
    throw httpError('shared_cart_id requis', 400, 'shared_cart_id_required');
  }
  if (!UUID_RE.test(normalizedId)) {
    throw httpError('shared_cart_id invalide', 400, 'shared_cart_id_invalid');
  }

  const result = await db.query(
    `DELETE FROM shared_cart_saved_access
      WHERE user_id = $1
        AND shared_cart_id = $2`,
    [userId, normalizedId]
  );

  return {
    ok: true,
    shared_cart_id: normalizedId,
    removed: result.rowCount > 0,
  };
}

module.exports = {
  getSharedCartLibrary,
  saveSharedCartForUser,
  removeSavedSharedCartForUser,
};
