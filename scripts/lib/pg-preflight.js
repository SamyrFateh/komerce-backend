'use strict';

/**
 * scripts/lib/pg-preflight.js
 *
 * Preflight unique PostgreSQL, réutilisé par tout runner qui lance au moins
 * une suite `@test-requires postgres` (scripts/run-integration-tests.js,
 * scripts/run-e2e-feature-tests.js).
 *
 * Ne duplique pas la garde anti-production : la reconnaissance "est-ce une
 * base de test ?" reste dans tests/helpers/e2eDbKit.js (assertTestDatabase),
 * seule source de vérité. Ce module ajoute uniquement ce qu'e2eDbKit ne
 * fait pas : une connexion réelle, un SELECT 1, et une vérification
 * minimale que le schéma Komerce attendu est présent — AVANT de lancer la
 * première suite, pas suite par suite.
 *
 * Contrat : ne lève jamais. Retourne toujours
 *   { ready: boolean, stage: string, reason: string, detail?: object }
 * pour que l'appelant distingue mécaniquement "environnement absent/cassé"
 * d'un vrai FAIL métier — jamais l'un pour l'autre (doctrine mission §0).
 */

const { assertTestDatabase } = require('../../tests/helpers/e2eDbKit');

// Tables qui doivent exister dans tout schéma Komerce à jour. Volontairement
// minimal — ce n'est pas un check de migration complet (schema:check s'en
// charge déjà), seulement de quoi distinguer "DB vide/mauvaise cible" d'une
// vraie absence de PostgreSQL.
const EXPECTED_CORE_TABLES = ['users', 'orders', 'relais'];

async function checkPostgresPreflight({ databaseUrl = process.env.DATABASE_URL } = {}) {
  // 1. DATABASE_URL existe
  if (!databaseUrl) {
    return {
      ready: false,
      stage: 'env',
      reason: 'DATABASE_URL absent.',
    };
  }

  // 2. URL valide + 3. cible explicitement reconnue comme DB de test
  //    (fail-closed — assertTestDatabase lève sur URL illisible, hôte qui
  //    ressemble à de la prod, ou nom de base non reconnu comme test).
  let target;
  try {
    target = assertTestDatabase(databaseUrl);
  } catch (err) {
    return {
      ready: false,
      stage: 'guard',
      reason: err.message,
    };
  }

  // 4. connexion possible + 5. SELECT 1
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (err) {
    return {
      ready: false,
      stage: 'connect',
      reason: `Connexion PostgreSQL impossible (${target.host}/${target.database}) : ${err.message}`,
    };
  }

  try {
    await client.query('SELECT 1');
  } catch (err) {
    await client.end().catch(() => {});
    return {
      ready: false,
      stage: 'select1',
      reason: `SELECT 1 a échoué sur ${target.database} : ${err.message}`,
    };
  }

  // 6. schéma Komerce minimal attendu présent
  try {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [EXPECTED_CORE_TABLES]
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_CORE_TABLES.filter((t) => !present.has(t));
    if (missing.length) {
      await client.end().catch(() => {});
      return {
        ready: false,
        stage: 'schema',
        reason: `Base ${target.database} atteignable mais schéma Komerce incomplet — ` +
          `table(s) manquante(s) : ${missing.join(', ')}. ` +
          `Voir docs/db/railway-live-schema.sql + scripts/ci-migrate.js.`,
      };
    }
  } catch (err) {
    await client.end().catch(() => {});
    return {
      ready: false,
      stage: 'schema',
      reason: `Vérification du schéma impossible sur ${target.database} : ${err.message}`,
    };
  }

  await client.end().catch(() => {});
  return {
    ready: true,
    stage: 'ok',
    reason: `PostgreSQL prêt (${target.host}/${target.database}).`,
    detail: target,
  };
}

module.exports = { checkPostgresPreflight, EXPECTED_CORE_TABLES };
