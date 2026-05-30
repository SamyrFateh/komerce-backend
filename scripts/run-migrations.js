'use strict';

/**
 * KOMERCE — Migration Runner (scripts/run-migrations.js)
 * ============================================================================
 * Comble le trou identifié à la passe du 2026-05-30 : il n'existait AUCUN
 * runner automatique pour migrations/*.sql. Seul le bloc codé en dur de
 * bootstrap/startup-migrations.js tournait → toute migration .sql postérieure
 * au dernier `psql` manuel restait en attente (ex. 015b, 073).
 *
 * Principe :
 *   - table `schema_migrations(filename, applied_at, checksum)` = source de vérité
 *   - applique, dans l'ordre, tout fichier migrations/NNN*.sql non encore enregistré
 *   - chaque fichier dans SA PROPRE transaction (échec → rollback de CE fichier)
 *
 * Usage :
 *   node scripts/run-migrations.js              # applique les migrations en attente
 *   node scripts/run-migrations.js --baseline   # enregistre TOUT comme appliqué SANS exécuter
 *   node scripts/run-migrations.js --dry-run     # liste ce qui serait appliqué
 *
 * ADOPTION SUR LA PROD EXISTANTE (à faire une seule fois, dans cet ordre) :
 *   1) psql "$DATABASE_URL" -f RECONCILIATION_PROD.sql   # rattrape 015b + 073 + commitment_id
 *   2) node scripts/run-migrations.js --baseline          # marque l'historique comme appliqué
 *   À partir de là, toute NOUVELLE migration .sql sera appliquée automatiquement.
 *
 * CONVENTION ENUM : ne jamais UTILISER une valeur d'enum dans la même migration
 * qui l'ajoute (ALTER TYPE ... ADD VALUE), car le fichier tourne dans une seule
 * transaction. Scinder en deux migrations si besoin.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
// On ne traite que les vraies migrations numérotées (NNN...). On ignore les
// helpers : deploy-all.sql, migrate-categories-v2.sql, patch_variants.sql, GAPS.md
const MIGRATION_RE = /^\d{3}.*\.sql$/;

function listMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => MIGRATION_RE.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getApplied(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map(r => r.filename));
}

async function run({ baseline = false, dryRun = false } = {}) {
  const client = await db.getClient();
  const applied = [];
  try {
    await ensureTable(client);
    const done = await getApplied(client);
    const files = listMigrationFiles();
    const pending = files.filter(f => !done.has(f));

    if (pending.length === 0) {
      console.log('✅ Aucune migration en attente — schéma à jour.');
      return { applied: [], pending: [] };
    }

    console.log(`${pending.length} migration(s) en attente :`);
    pending.forEach(f => console.log('   • ' + f));

    if (dryRun) {
      console.log('\n(dry-run — rien n\'a été exécuté)');
      return { applied: [], pending };
    }

    for (const f of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const sum = checksum(sql);

      if (baseline) {
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)
           ON CONFLICT (filename) DO NOTHING`,
          [f, sum]
        );
        console.log(`   ↩ baseline (non exécutée) : ${f}`);
        applied.push(f);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)
           ON CONFLICT (filename) DO NOTHING`,
          [f, sum]
        );
        await client.query('COMMIT');
        console.log(`   ✅ appliquée : ${f}`);
        applied.push(f);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`   ❌ ÉCHEC : ${f}\n      ${err.message}`);
        throw new Error(`Migration ${f} échouée — arrêt (les précédentes sont committées).`);
      }
    }

    console.log(`\n✅ ${applied.length} migration(s) ${baseline ? 'baselinées' : 'appliquées'}.`);
    return { applied, pending };
  } finally {
    client.release();
  }
}

/**
 * Variante SÛRE pour l'appel au boot.
 * Ne fait RIEN tant que la base n'a pas été baselinée (schema_migrations vide
 * ou absente) — sinon le runner tenterait de rejouer tout l'historique sur une
 * prod qui a déjà ses ~70 migrations. Idéale pour un appel non-fatal au démarrage.
 */
async function runPendingSafe() {
  const client = await db.getClient();
  let baselined = false;
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'
      ) AS has_table
    `);
    if (rows[0].has_table) {
      const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
      baselined = cnt[0].n > 0;
    }
  } finally {
    client.release();
  }

  if (!baselined) {
    console.warn('[run-migrations] schema_migrations vide/absente — auto-apply ignoré. ' +
      'Lancer une fois : node scripts/run-migrations.js --baseline');
    return { applied: [], pending: [], skipped: true };
  }
  return run({ baseline: false, dryRun: false });
}

module.exports = { run, runPendingSafe, listMigrationFiles };

// Exécution directe en CLI
if (require.main === module) {
  const baseline = process.argv.includes('--baseline');
  const dryRun = process.argv.includes('--dry-run');
  run({ baseline, dryRun })
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
