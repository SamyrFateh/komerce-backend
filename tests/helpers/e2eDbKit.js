'use strict';

/**
 * tests/helpers/e2eDbKit.js
 *
 * Socle partagé des E2E fonctionnels Feature First (tests/e2e-api/**).
 *
 * Rôle — et pourquoi il est transverse plutôt que dupliqué par feature :
 * chaque E2E à écriture doit satisfaire les mêmes quatre obligations
 * (chantier E2E Feature First, doctrine §2) :
 *
 *   1. refuser de s'exécuter contre une base de production (fail-closed) ;
 *   2. créer des identifiants uniques (pas d'UUID fixes partagés entre
 *      suites — source de collisions quand deux specs tournent sur la même
 *      base de test) ;
 *   3. nettoyer ses données, dans l'ordre inverse de création ;
 *   4. se skipper explicitement — jamais échouer en dur — quand
 *      DATABASE_URL est absent, comme le fait déjà
 *      tests/integration/alerts-contract-real-db.test.js.
 *
 * Ce kit ne mocke RIEN : il n'expose que de l'outillage d'environnement.
 * Les mocks de req/res restent dans tests/helpers/backendTestKit.js, le
 * mock de client transactionnel dans tests/integration/test-harness/mock-db.js.
 * Un E2E qui aurait besoin de l'un de ces deux-là n'est pas un E2E.
 */

const crypto = require('crypto');

// ── 1. Garde anti-production ────────────────────────────────────────────────
// Fail-closed : on n'autorise QUE ce qu'on reconnaît explicitement comme base
// de test. Une URL inconnue est refusée, pas tolérée. Le mode « je bloque une
// liste noire » laisse toujours passer l'hôte qu'on a oublié d'y mettre.
// L9 §17 (STOP-SHIP) — /^railway$/i a été retiré de cette allowlist. Railway
// nomme très souvent sa base par défaut « railway » : la garder ici couplée
// à KOMERCE_E2E_ALLOW_REMOTE revenait à protéger un hôte de prod/staging
// avec un seul opt-in générique. Un hôte marqué PROD_HOST_MARKERS avec une
// base non explicitement reconnue comme test exige maintenant un SECOND
// opt-in explicite (KOMERCE_STAGING_DB_EXPLICIT) — voir assertTestDatabase.
const TEST_DB_ALLOWLIST = [/^komerce_test$/i, /_test$/i, /^test_/i];
const PROD_HOST_MARKERS = ['railway', 'rlwy.net', 'amazonaws', 'komerce.co', 'supabase'];

function parseDbUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, database: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  } catch {
    return null;
  }
}

/**
 * Lève si DATABASE_URL ne désigne pas une base de test reconnue.
 * Appelée par describeE2E() — un spec n'a normalement pas à l'appeler seul.
 */
function assertTestDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('[e2eDbKit] DATABASE_URL absent — garde non évaluable.');

  const parsed = parseDbUrl(url);
  if (!parsed) throw new Error('[e2eDbKit] DATABASE_URL illisible — refus fail-closed.');

  const hostMarker = PROD_HOST_MARKERS.find((m) => parsed.host.includes(m));
  const namedAsTest = TEST_DB_ALLOWLIST.some((rx) => rx.test(parsed.database));

  if (hostMarker) {
    // L9 §17 — double opt-in obligatoire pour tout hôte ressemblant à de la
    // production/staging (Railway, RDS, komerce.co, Supabase...).
    const remoteAllowed = process.env.KOMERCE_E2E_ALLOW_REMOTE === '1';
    if (!remoteAllowed) {
      throw new Error(
        `[e2eDbKit] REFUS — l'hôte « ${parsed.host} » ressemble à un hébergeur de production ` +
        `(marqueur « ${hostMarker} »). Les E2E à écriture ne tournent que sur une base de test. ` +
        `Posez KOMERCE_E2E_ALLOW_REMOTE=1 si vous ciblez délibérément un staging distant.`
      );
    }
    // Un hôte distant AVEC un nom de base générique (ex. « railway ») exige
    // un second opt-in explicite : KOMERCE_E2E_ALLOW_REMOTE seul ne suffit
    // plus à couvrir le cas où le nom de base ne dit rien de son usage.
    const explicitStaging = process.env.KOMERCE_STAGING_DB_EXPLICIT === '1';
    if (!namedAsTest && !explicitStaging) {
      throw new Error(
        `[e2eDbKit] REFUS — hôte distant « ${parsed.host} » + base « ${parsed.database} » ` +
        `non reconnue comme base de test. Nommez la base komerce_test/*_test/test_* ou ` +
        `posez KOMERCE_STAGING_DB_EXPLICIT=1 (second opt-in requis pour un hôte de ` +
        `production/staging avec un nom de base générique).`
      );
    }
    return { host: parsed.host, database: parsed.database };
  }

  // Hôte non marqué (ex. localhost) : la reconnaissance par nom suffit.
  if (!namedAsTest) {
    throw new Error(
      `[e2eDbKit] REFUS — la base « ${parsed.database} » n'est pas reconnue comme base de test. ` +
      `Nommez-la komerce_test, *_test ou test_* (voir .github/workflows/ci.yml).`
    );
  }
  return { host: parsed.host, database: parsed.database };
}

// ── 2. Identifiants uniques ─────────────────────────────────────────────────
// Préfixe commun à un run : permet un nettoyage de secours (« DELETE WHERE
// email LIKE 'e2e-<run>%' ») si un afterAll a été coupé.
const RUN_TAG = `e2e${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

/** UUID v4 réel — jamais un UUID fixe partagé entre suites. */
function uuid() {
  return crypto.randomUUID();
}

/** Chaîne unique et traçable, ex. tag('email') → 'e2ele1x9f-email-7c2a'. */
function tag(label) {
  return `${RUN_TAG}-${label}-${crypto.randomBytes(2).toString('hex')}`;
}

// ── 3. Registre de nettoyage ────────────────────────────────────────────────
/**
 * Empile des suppressions et les rejoue dans l'ordre inverse (LIFO), ce qui
 * respecte naturellement les clés étrangères : l'enfant créé en dernier est
 * supprimé en premier.
 */
function createCleanup(db) {
  const stack = [];

  return {
    /** @param {string} table @param {string} column @param {string} value */
    track(table, column, value) {
      stack.push({ table, column, value });
    },
    /** @param {string} sql @param {any[]} params — nettoyage sur mesure. */
    trackSql(sql, params = []) {
      stack.push({ sql, params });
    },
    async run() {
      const errors = [];
      while (stack.length) {
        const entry = stack.pop();
        try {
          if (entry.sql) await db.query(entry.sql, entry.params);
          else await db.query(`DELETE FROM ${entry.table} WHERE ${entry.column} = $1`, [entry.value]);
        } catch (err) {
          errors.push(`${entry.sql || entry.table}: ${err.message}`);
        }
      }
      // On ne masque pas un nettoyage raté : une donnée orpheline fausse le
      // run suivant, et le silence est précisément ce qui rend ce genre de
      // bug introuvable trois semaines plus tard.
      if (errors.length) {
        throw new Error(`[e2eDbKit] nettoyage incomplet :\n  - ${errors.join('\n  - ')}`);
      }
    },
  };
}

// ── 4. Enveloppe de suite ───────────────────────────────────────────────────
/**
 * Remplace `describe` dans les E2E à base réelle.
 *
 *   - DATABASE_URL absent  → suite skippée, message explicite, exit 0.
 *   - DATABASE_URL suspect → suite EN ÉCHEC (on ne skippe pas une garde de
 *     sécurité : un skip silencieux sur une URL de prod est exactement le
 *     scénario qu'on veut rendre impossible).
 *   - sinon                → suite exécutée.
 *
 * @param {string} title
 * @param {(ctx: {db: object}) => void} body
 */
function describeE2E(title, body) {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line jest/no-disabled-tests
    describe.skip(`${title} — SKIPPED: DATABASE_URL absent`, () => {
      it('exige DATABASE_URL (voir .github/workflows/ci.yml)', () => {});
    });
    return;
  }

  const target = assertTestDatabase();
  const db = require('../../db');

  describe(`${title} [db=${target.database}]`, () => {
    // Les hooks de nettoyage du scénario sont enregistrés par body()
    // avant ce finaliseur : les données sont supprimées avant le pool.
    body({ db });
    afterAll(async () => {
      if (db.pool && db.pool.end) await db.pool.end();
    });
  });
}

module.exports = {
  assertTestDatabase,
  createCleanup,
  describeE2E,
  RUN_TAG,
  tag,
  uuid,
};
