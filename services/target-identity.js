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

const h = (v, n = 8) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, n);

/**
 * Empreinte NON secrète de la base atteinte par un executor, INDÉPENDANTE du chemin réseau
 * (réseau privé du service vs proxy public) : nom, oid de base, heure de démarrage du cluster et,
 * si le rôle y a accès, identifiant système du cluster. L'adresse serveur n'en fait PAS partie
 * (elle diffère selon le chemin). Hash tronqué ; `parts` = hash par composant, pour diagnostiquer
 * un écart sans rien révéler.
 */
async function computeDbFingerprint(executor) {
  const { rows: [r] } = await executor.query(
    `SELECT current_database() AS name,
            (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
            floor(extract(epoch FROM pg_postmaster_start_time()))::text AS started`);
  if (!r) throw new Error('empreinte de base indisponible');
  let sysid = 'n/a';
  try {
    const { rows: [c] } = await executor.query('SELECT system_identifier::text AS sysid FROM pg_control_system()');
    if (c && c.sysid) sysid = c.sysid;
  } catch { sysid = 'n/a'; }
  const raw = [r.name, r.oid, r.started, sysid].join('|');
  return {
    fingerprint: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24),
    database: r.name,
    parts: { name: h(r.name), oid: h(r.oid), started: h(r.started), sysid: h(sysid) },
  };
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
    const lp = local.parts || {};
    const rp = remote.parts || {};
    const differing = Object.keys(lp).filter((k) => rp[k] !== undefined && rp[k] !== lp[k]);
    problems.push(`la base de connexion n'est pas celle du service déployé${differing.length ? ` (composants différents : ${differing.join(', ')})` : ''}`);
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
