'use strict';

/**
 * @test-kind helper
 * @test-runner jest
 * @test-requires postgres
 *
 * Processus enfant du test d'integration du reset Staging : lance runReset(mode) contre la base ephemere
 * (DATABASE_URL de l'environnement) en remplacant UNIQUEMENT le garde reseau confirmTarget (pas de service deploye local).
 * Toutes les autres gardes (environnement, epingle de base, ACK, jeton) restent actives.
 */

const db = require('../../db');
const { runReset } = require('../../scripts/recette/staging-reset');

const mode = process.argv[2];
runReset(mode, { deps: { confirmTarget: async () => ({ confirmed: true, fingerprint: 'ephemeral-test' }) } })
  .then((report) => console.log(JSON.stringify({ ok: true, report })))
  .catch((error) => console.log(JSON.stringify({ ok: false, code: error.code || null, message: error.message, report: error.report || null })))
  .finally(() => db.pool.end().catch(() => {}));
