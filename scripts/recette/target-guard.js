'use strict';

/**
 * Garde d'identité de cible — à exécuter AVANT toute écriture de recette.
 * Compare l'empreinte de la base atteinte par DATABASE_URL à celle publiée par le service
 * déployé (GET <STAGING_BASE_URL>/health/target) et exige komerce_env=staging.
 * N'affiche jamais l'URL ni de secret. Sortie 1 si la cible n'est pas confirmée.
 *
 * Variables : DATABASE_URL, STAGING_BASE_URL, optionnelles EXPECTED_RAILWAY_ENVIRONMENT /
 * EXPECTED_RAILWAY_SERVICE (épinglage non secret).
 */

const { computeDbFingerprint, assertSameTarget } = require('../../services/target-identity');

async function confirmTarget({ db, fetchImpl = fetch, env = process.env } = {}) {
  const base = String(env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) {
    const err = new Error('STAGING_BASE_URL (https) requis');
    err.code = 'TARGET_NOT_CONFIRMED';
    throw err;
  }
  const local = await computeDbFingerprint(db);
  const res = await fetchImpl(`${base}/health/target`);
  if (!res.ok) {
    const err = new Error(`service injoignable (${res.status})`);
    err.code = 'TARGET_NOT_CONFIRMED';
    throw err;
  }
  const remote = await res.json();
  return assertSameTarget({
    local, remote,
    expected: {
      railway_environment: env.EXPECTED_RAILWAY_ENVIRONMENT || null,
      railway_service: env.EXPECTED_RAILWAY_SERVICE || null,
    },
  });
}

async function main() {
  const db = require('../../db');
  try {
    const verdict = await confirmTarget({ db });
    process.stdout.write(`${JSON.stringify({ ...verdict, database: undefined }, null, 2)}\n`);
  } finally {
    if (db.pool && db.pool.end) await db.pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`REFUS: ${e.message}\n`); process.exit(1); });
}

module.exports = { confirmTarget };
