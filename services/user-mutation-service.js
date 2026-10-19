/**
 * @komerce-arch
 * @role          auth-identity-user-mutation-boundary
 * @domain        auth-identity
 * @layer         service
 * @criticality   critical
 * @inputs        caller_owned_executor, narrow_user_mutation_payload
 * @outputs       query_result_or_user_projection
 * @depends       none
 * @used-by       dashboard, loyalty
 * @db-read       orders, loyalty_tiers, users, relais
 * @db-write      users
 * @db-txn        caller-owned
 * @doctrine      lifecycle_owner_persistence_boundary
 * @impact-areas  auth-identity, dashboard, loyalty
 * @version       2026-08
 */

'use strict';

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError(
      'user-mutation-service: executor.query requis'
    );
  }

  return executor;
}

async function createAdminUser(executor, {
  fullName,
  email,
  phone = null,
  role,
  currencyPref,
  passwordHash,
}) {
  return requireExecutor(executor).query(
    `INSERT INTO users (
       full_name,
       email,
       phone,
       role,
       currency_pref,
       password_hash,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING
       id,
       full_name,
       email,
       phone,
       role,
       currency_pref,
       created_at`,
    [
      fullName,
      email,
      phone,
      role,
      currencyPref,
      passwordHash,
    ],
  );
}

async function setUserRole(executor, {
  userId,
  role,
}) {
  return requireExecutor(executor).query(
    `UPDATE users
     SET role = $1,
         updated_at = NOW()
     WHERE id = $2::uuid
     RETURNING id, full_name, email, role`,
    [role, userId],
  );
}

/**
 * Rattache un agent relais a son relais (users.relais_id). Seul writer canonique :
 * un agent_relais sans relais_id est refuse (403) par les controles cross-relais.
 * Le relais doit exister et etre actif ; idempotent ; ne change jamais le role.
 */
async function assignAgentRelais(executor, { userId, relaisId }) {
  const db = requireExecutor(executor);
  const { rows: [relais] } = await db.query(
    'SELECT id FROM relais WHERE id = $1::uuid AND is_active = TRUE', [relaisId]);
  if (!relais) return { status: 'relais_not_found', user: null };
  const { rows: [user] } = await db.query(
    `UPDATE users SET relais_id = $2::uuid, updated_at = NOW()
      WHERE id = $1::uuid AND role = 'agent_relais'
        AND relais_id IS DISTINCT FROM $2::uuid
      RETURNING id, relais_id`, [userId, relaisId]);
  if (user) return { status: 'assigned', user };
  const { rows: [current] } = await db.query(
    "SELECT id, relais_id, role FROM users WHERE id = $1::uuid", [userId]);
  if (!current) return { status: 'user_not_found', user: null };
  if (current.role !== 'agent_relais') return { status: 'not_agent_relais', user: null };
  return { status: 'already', user: current };
}

async function setUserPasswordHash(executor, {
  userId,
  passwordHash,
}) {
  return requireExecutor(executor).query(
    `UPDATE users
     SET password_hash = $1,
         updated_at = NOW()
     WHERE id = $2::uuid`,
    [passwordHash, userId],
  );
}

async function anonymizeUser(executor, userId) {
  return requireExecutor(executor).query(
    `UPDATE users
     SET email = 'deleted_' || id || '@komerce.deleted',
         full_name = '[Compte supprimé]',
         phone = NULL,
         password_hash = '',
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [userId],
  );
}

async function deleteUser(executor, userId) {
  return requireExecutor(executor).query(
    'DELETE FROM users WHERE id = $1::uuid',
    [userId],
  );
}

async function deleteNonAdminUsers(executor) {
  return requireExecutor(executor).query(
    "DELETE FROM users WHERE role != 'admin'",
  );
}

async function incrementBigBasketCount(executor, userId) {
  return requireExecutor(executor).query(
    `UPDATE users
     SET big_basket_count = big_basket_count + 1
     WHERE id = $1
     RETURNING
       big_basket_count,
       big_basket_last_notified_count,
       full_name,
       phone`,
    [userId],
  );
}

async function markBigBasketNotified(executor, {
  userId,
  count,
}) {
  return requireExecutor(executor).query(
    'UPDATE users SET big_basket_last_notified_count = $1 WHERE id = $2',
    [count, userId],
  );
}

/*
 * La règle métier reste dans la fonction PostgreSQL historique
 * recalculate_loyalty().
 *
 * Cette capability ne redéfinit aucune logique loyalty :
 * elle place simplement son déclenchement derrière l'owner de users.
 */
async function recalculateUserLoyalty(executor, userId) {
  return requireExecutor(executor).query(
    'SELECT recalculate_loyalty($1)',
    [userId],
  );
}

module.exports = {
  createAdminUser,
  setUserRole,
  assignAgentRelais,
  setUserPasswordHash,
  anonymizeUser,
  deleteUser,
  deleteNonAdminUsers,
  incrementBigBasketCount,
  markBigBasketNotified,
  recalculateUserLoyalty,
};
