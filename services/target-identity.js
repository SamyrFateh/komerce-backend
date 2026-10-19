/**
 * @komerce-arch
 * @role          target-identity
 * @domain        infrastructure
 * @layer         service
 * @criticality   high
 * @inputs        db executor, runtime env (KOMERCE_ENV, RAILWAY_ENVIRONMENT_NAME)
 * @outputs       non-secret target identity + fail-closed comparison
 * @depends       none
 * @used-by       routes/health.js, scripts/recette/target-guard.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed_target_identity, no_secret_in_output
 * @impact-areas  staging, recette, safety
 * @version       2026-10
 */
'use strict';

const crypto = require('crypto');

/**
 * Empreinte NON secrète de la base atteinte par un executor : nom, oid de base, adresse et port
 * serveur (les oid seuls peuvent coïncider entre deux clusters neufs). Hash tronqué, aucune URL.
 */
async function computeDbFingerprint(executor) {
  const { rows: [r] } = await executor.query(
    `SELECT current_database() AS name,
            (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
            COALESCE(host(inet_server_addr()), 'local') AS addr,
            COALESCE(inet_server_port()::text, '0') AS port`);
  if (!r) throw new Error('empreinte de base indisponible');
  const raw = [r.name, r.oid, r.addr, r.port].join('|');
  return { fingerprint: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24), database: r.name };
}

/** Identité d'exécution déclarée par le service (variables Railway + KOMERCE_ENV), sans secret. */
function readRuntimeIdentity(env = process.env) {
  return {
    komerce_env: env.KOMERCE_ENV || null,
    railway_environment: env.RAILWAY_ENVIRONMENT_NAME || null,
  };
}

/**
 * Compare la cible de connexion de l'appelant (empreinte locale) au service déployé (empreinte publiée).
 * Toute différence, ou toute donnée manquante, ⇒ refus. Le nom de base seul ne prouve jamais l'environnement.
 */
function assertSameTarget({ local, remote, expected = {} }) {
  const problems = [];
  if (!local || !local.fingerprint) problems.push('empreinte locale absente');
  if (!remote || !remote.db_fingerprint) problems.push('empreinte du service absente');
  if (local && remote && local.fingerprint && remote.db_fingerprint && local.fingerprint !== remote.db_fingerprint) {
    problems.push('la base de connexion n\'est pas celle du service déployé');
  }
  const id = (remote && remote.identity) || {};
  if (id.komerce_env !== 'staging') problems.push(`service déployé non déclaré staging (komerce_env=${id.komerce_env})`);
  for (const [k, v] of Object.entries(expected)) {
    if (v && id[k] !== v) problems.push(`${k} attendu "${v}", reçu "${id[k]}"`);
  }
  if (problems.length) {
    const err = new Error(`cible non confirmée : ${problems.join(' ; ')}`);
    err.code = 'TARGET_NOT_CONFIRMED';
    err.problems = problems;
    throw err;
  }
  return { confirmed: true, fingerprint: local.fingerprint, identity: id };
}

module.exports = { computeDbFingerprint, readRuntimeIdentity, assertSameTarget };
