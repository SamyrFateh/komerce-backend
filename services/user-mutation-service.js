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
 * @db-write      users, hub_authorization_grants
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

async function markUserPendingActivation(executor, userId) {
  return requireExecutor(executor).query(
    'UPDATE users SET account_activation_required=TRUE, updated_at=NOW() WHERE id=$1::uuid',
    [userId],
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
         credentials_changed_at = NOW(),
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

/**
 * Reset d'usine / utilisateurs : libère, AVANT la suppression des comptes non-admin, uniquement des références de
 * DÉLÉGATION ou de simple trace opérationnelle, par listes EXPLICITES. Doctrine : aucun fait métier (cash, encaissements,
 * remboursements, documents, audit, preuves) n'est jamais supprimé ni modifié ici ; toute autre FK RESTRICT/NO ACTION
 * vers users portant des lignes est découverte dans le catalogue puis RAPPORTÉE dans `blocked`, sans aucune écriture.
 */
// Suppression de ligne : délégations/configuration seulement (la ligne n'a de sens que tant que le compte existe).
const RELEASE_DELETE_ROWS = Object.freeze([
  ['hub_authorization_grants', 'user_id'],
  ['hub_authorization_grants', 'granted_by'],
  ['hub_authorization_grants', 'revoked_by'], // CHECK lie revoked_by à revoked_at : on retire la délégation entière
]);
// Mise à NULL : traces opérationnelles nullables (jamais financières, probatoires ni d'audit).
const RELEASE_NULL_COLUMNS = Object.freeze([
  ['purchase_orders', 'sent_by'],
  ['international_shipment_hub_units', 'attached_by'],
]);

async function releaseNonAdminUserReferences(executor) {
  const client = requireExecutor(executor);
  const nonAdmin = "(SELECT id FROM users WHERE role <> 'admin')";
  const cleared = {};
  const run = async (key, sql) => {
    await client.query('SAVEPOINT sp_release_user_ref');
    try {
      const r = await client.query(sql);
      await client.query('RELEASE SAVEPOINT sp_release_user_ref');
      if (r.rowCount) cleared[key] = r.rowCount;
      return null;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_release_user_ref');
      return err.message;
    }
  };
  const errors = {};
  // Identifiants issus des listes constantes ci-dessus : aucune valeur utilisateur.
  for (const [table, col] of RELEASE_DELETE_ROWS) {
    const err = await run(`${table}.${col}`, `DELETE FROM ${table} WHERE ${col} IN ${nonAdmin}`); // arch-safe: liste constante
    if (err) errors[`${table}.${col}`] = err;
  }
  for (const [table, col] of RELEASE_NULL_COLUMNS) {
    const err = await run(`${table}.${col}`, `UPDATE ${table} SET ${col} = NULL WHERE ${col} IN ${nonAdmin}`); // arch-safe: liste constante
    if (err) errors[`${table}.${col}`] = err;
  }
  // Découverte (lecture seule) : toute autre FK RESTRICT/NO ACTION vers users qui porte encore des lignes est rapportée.
  const { rows: fks } = await client.query(
    `SELECT format('%s', c.conrelid::regclass) AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
        AND c.confdeltype IN ('a','r') AND array_length(c.conkey, 1) = 1
      ORDER BY 1, 2`);
  const handled = new Set([...RELEASE_DELETE_ROWS, ...RELEASE_NULL_COLUMNS].map(([t, c]) => `${t}.${c}`));
  const quote = (id) => `"${String(id).replace(/"/g, '""')}"`;
  const blocked = [];
  for (const fk of fks) {
    const key = `${fk.tbl}.${fk.col}`;
    if (handled.has(key) && !errors[key]) continue;
    const target = fk.tbl.split('.').map((part) => (/^"/.test(part) ? part : quote(part))).join('.');
    await client.query('SAVEPOINT sp_release_user_ref');
    try {
      // arch-safe: identifiants issus de pg_catalog, quotés ; SELECT seul.
      const { rows: [r] } = await client.query(`SELECT COUNT(*)::int AS n FROM ${target} WHERE ${quote(fk.col)} IN ${nonAdmin}`);
      await client.query('RELEASE SAVEPOINT sp_release_user_ref');
      if (r.n > 0 || errors[key]) blocked.push({ table: fk.tbl, column: fk.col, rows: r.n, ...(errors[key] ? { error: errors[key] } : {}) });
    } catch (_) {
      await client.query('ROLLBACK TO SAVEPOINT sp_release_user_ref');
    }
  }
  return { cleared, blocked };
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
  markUserPendingActivation,
  setUserRole,
  assignAgentRelais,
  setUserPasswordHash,
  anonymizeUser,
  deleteUser,
  deleteNonAdminUsers,
  releaseNonAdminUserReferences,
  incrementBigBasketCount,
  markBigBasketNotified,
  recalculateUserLoyalty,
};
