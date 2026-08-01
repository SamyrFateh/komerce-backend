/**
 * @komerce-arch
 * @role          pickup-authorization-service
 * @domain        auth-identity
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, utils/name-normalize.js, utils/alerts.js
 * @used-by       routes/auth.js, services/pickup-secret-service.js (logistics, lecture verrouillée)
 * @db-read       user_pickup_authorizations
 * @db-write      alerts, user_pickup_authorizations
 * @db-txn        resolve_before_behavior_change
 * @doctrine      exceptional_pickup_strict_normalized_match
 * @impact-areas  auth-identity, logistics
 * @version       2026-07
 */

/**
 * KOMERCE — Pickup Authorization Service (Lot 5)
 *
 * Possède la préférence courante du compte : l'autorisation nominative de
 * retrait exceptionnel (`user_pickup_authorizations`). Une seule ligne active
 * par utilisateur, versionnée, consultée AU MOMENT EXACT de la remise —
 * jamais figée dans une commande (§4 du lot).
 *
 * Frontière : ce fichier appartient à auth-identity. La procédure de remise
 * elle-même (comparaison + collecte atomique) appartient à logistics
 * (services/pickup-secret-service.js), qui consomme UNIQUEMENT
 * `getActiveAuthorizationForUpdate` — jamais de requête directe sur
 * `user_pickup_authorizations` en dehors de ce fichier.
 *
 * Exports :
 *   getMyAuthorization              — GET (propriétaire uniquement)
 *   setMyAuthorization              — PUT (création OU remplacement atomique)
 *   deleteMyAuthorization           — DELETE (désactivation immédiate)
 *   getActiveAuthorizationForUpdate — lecture verrouillée FOR UPDATE, réservée
 *                                     à un appelant qui possède déjà une
 *                                     transaction (logistics/pickup)
 */

'use strict';

const db = require('../db');
const { normalizeName } = require('../utils/name-normalize');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'pickup-authorization-service' });

const MAX_NAME_LENGTH = 100;
const MIN_NAME_LENGTH = 1;

function _validateNamePair(givenNames, familyName) {
  const g = String(givenNames || '').trim();
  const f = String(familyName || '').trim();
  if (g.length < MIN_NAME_LENGTH || f.length < MIN_NAME_LENGTH) {
    return { status: 400, body: { error: 'Prénom(s) et nom de famille requis' } };
  }
  if (g.length > MAX_NAME_LENGTH || f.length > MAX_NAME_LENGTH) {
    return { status: 400, body: { error: `Chaque champ est limité à ${MAX_NAME_LENGTH} caractères` } };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// getMyAuthorization
// ══════════════════════════════════════════════════════════════════════════════
// Retourne { status: 'NONE' } ou { status: 'ACTIVE', given_names, family_name,
// version, updated_at }. Le propriétaire peut voir le nom complet qu'il a
// lui-même enregistré (§9 — jamais exposé au relais, cf. logistics).

async function getMyAuthorization(userId) {
  const { rows: [row] } = await db.query(
    `SELECT authorized_given_names, authorized_family_name, version, updated_at, is_active
     FROM user_pickup_authorizations WHERE user_id = $1`,
    [userId]
  );

  if (!row || !row.is_active) {
    return { status: 200, body: { status: 'NONE' } };
  }

  return {
    status: 200,
    body: {
      status:      'ACTIVE',
      given_names: row.authorized_given_names,
      family_name: row.authorized_family_name,
      version:     row.version,
      updated_at:  row.updated_at,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// setMyAuthorization
// ══════════════════════════════════════════════════════════════════════════════
// Création OU remplacement atomique (UPSERT). Incrémente toujours version.
// Prend effet immédiatement — aucun snapshot par commande (§4).

async function setMyAuthorization({ userId, givenNames, familyName }) {
  const invalid = _validateNamePair(givenNames, familyName);
  if (invalid) return invalid;

  const given  = String(givenNames).trim();
  const family = String(familyName).trim();
  const normGiven  = normalizeName(given);
  const normFamily = normalizeName(family);

  const { rows: [row] } = await db.query(
    `INSERT INTO user_pickup_authorizations
       (user_id, authorized_given_names, authorized_family_name,
        normalized_given_names, normalized_family_name,
        version, is_active, revoked_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 1, true, NULL, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       authorized_given_names = EXCLUDED.authorized_given_names,
       authorized_family_name = EXCLUDED.authorized_family_name,
       normalized_given_names = EXCLUDED.normalized_given_names,
       normalized_family_name = EXCLUDED.normalized_family_name,
       version    = user_pickup_authorizations.version + 1,
       is_active  = true,
       revoked_at = NULL,
       updated_at = NOW()
     RETURNING version, updated_at`,
    [userId, given, family, normGiven, normFamily]
  );

  const isFirstEverCreation = row.version === 1;

  try {
    await createAlert(db, {
      type:        isFirstEverCreation ? 'PICKUP_AUTHORIZATION_CREATED' : 'PICKUP_AUTHORIZATION_UPDATED',
      entityType:  'user',
      entityId:    userId,
      severity:    'low',
      title:       isFirstEverCreation
        ? 'Autorisation de retrait exceptionnel créée'
        : 'Autorisation de retrait exceptionnel remplacée',
      // Jamais le nom en clair dans l'audit (§18) — seule la version compte.
      description: `user_id=${userId} version=${row.version}`,
    });
  } catch (e) {
    log.error({ err: e, user_id: userId }, '[PICKUP-AUTH] audit createAlert failed (non-fatal)');
  }

  return {
    status: 200,
    body: {
      status:      'ACTIVE',
      given_names: given,
      family_name: family,
      version:     row.version,
      updated_at:  row.updated_at,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// deleteMyAuthorization
// ══════════════════════════════════════════════════════════════════════════════
// Désactivation immédiate. Idempotent : si aucune autorisation n'existe,
// no-op silencieux (pas d'erreur — l'état final souhaité est déjà atteint).

async function deleteMyAuthorization(userId) {
  const { rows: [row] } = await db.query(
    `UPDATE user_pickup_authorizations
     SET is_active = false,
         authorized_given_names = NULL,
         authorized_family_name = NULL,
         normalized_given_names = NULL,
         normalized_family_name = NULL,
         version    = version + 1,
         revoked_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1 AND is_active = true
     RETURNING version`,
    [userId]
  );

  if (row) {
    try {
      await createAlert(db, {
        type:        'PICKUP_AUTHORIZATION_REVOKED',
        entityType:  'user',
        entityId:    userId,
        severity:    'low',
        title:       'Autorisation de retrait exceptionnel supprimée',
        description: `user_id=${userId} version=${row.version}`,
      });
    } catch (e) {
      log.error({ err: e, user_id: userId }, '[PICKUP-AUTH] audit createAlert failed (non-fatal)');
    }
  }

  return { status: 200, body: { status: 'NONE' } };
}

// ══════════════════════════════════════════════════════════════════════════════
// getActiveAuthorizationForUpdate — API interne réservée à logistics/pickup
// ══════════════════════════════════════════════════════════════════════════════
// Lecture verrouillée (FOR UPDATE) dans la transaction DÉJÀ OUVERTE par
// l'appelant (services/pickup-secret-service.js). Ne révèle jamais le nom au
// relais — retourne les champs normalisés pour comparaison stricte, jamais
// affichés directement par l'appelant.
//
// dbClient est OBLIGATOIRE : cette fonction n'a de sens que verrouillée dans
// la transaction de remise (§4 : "consulter l'autorisation courante au moment
// exact de la remise").

async function getActiveAuthorizationForUpdate(dbClient, userId) {
  if (!dbClient) throw new Error('getActiveAuthorizationForUpdate: dbClient requis (lecture verrouillée)');
  if (!userId) return null;

  const { rows: [row] } = await dbClient.query(
    `SELECT normalized_given_names, normalized_family_name, version
     FROM user_pickup_authorizations
     WHERE user_id = $1 AND is_active = true
     FOR UPDATE`,
    [userId]
  );

  if (!row) return null;

  return {
    normalizedGivenNames: row.normalized_given_names,
    normalizedFamilyName: row.normalized_family_name,
    version: row.version,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// hasActiveAuthorization — API interne réservée à logistics/pickup
// ══════════════════════════════════════════════════════════════════════════════
// Lecture NON verrouillée, booléen uniquement — pour l'endpoint de
// disponibilité relais (§10 : "ne jamais révéler le nom attendu"). Ne
// retourne jamais les champs nominatifs. Ne pas utiliser pour la remise
// elle-même : voir getActiveAuthorizationForUpdate.

async function hasActiveAuthorization(userId) {
  if (!userId) return false;
  const { rows: [row] } = await db.query(
    `SELECT 1 FROM user_pickup_authorizations WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  return !!row;
}

module.exports = {
  getMyAuthorization,
  setMyAuthorization,
  deleteMyAuthorization,
  getActiveAuthorizationForUpdate,
  hasActiveAuthorization,
};
