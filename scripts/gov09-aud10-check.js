'use strict';

/**
 * GOV-09 — Vérification et fix AUD-10 (schema_migrations après dédoublonnage)
 * =============================================================================
 * AUD-10 (clos 2026-06-23) a renommé 4 migrations :
 *   014_transaction_documents.sql          → 083_transaction_documents.sql
 *   072_jwt_revocation.sql                 → 084_jwt_revocation.sql
 *   073_shared_cart_cash_contributions.sql → 085_shared_cart_cash_contributions.sql
 *   074_invoice_public_token.sql           → 086_invoice_public_token.sql
 *
 * Si schema_migrations contient encore les anciens noms, run-migrations.js
 * verra les nouveaux comme "non appliqués" et tentera de les rejouer.
 * Les migrations sont idempotentes (IF NOT EXISTS) — pas de corruption,
 * mais tracking incohérent. Ce script corrige ça en une passe.
 *
 * Usage : node scripts/gov09-aud10-check.js [--fix]
 *   Sans --fix : diagnostic uniquement (dry-run).
 *   Avec --fix : applique les UPDATE si nécessaire.
 *
 * Idempotent : peut être relancé sans risque.
 */

require('dotenv').config();
const db = require('../db');

const RENAMES = [
  { old: '014_transaction_documents.sql',          new: '083_transaction_documents.sql' },
  { old: '072_jwt_revocation.sql',                 new: '084_jwt_revocation.sql' },
  { old: '073_shared_cart_cash_contributions.sql', new: '085_shared_cart_cash_contributions.sql' },
  { old: '074_invoice_public_token.sql',           new: '086_invoice_public_token.sql' },
];

const FIX_MODE = process.argv.includes('--fix');

async function run() {
  console.log('── GOV-09 : Audit AUD-10 schema_migrations ──────────────────────────────');
  console.log(`Mode : ${FIX_MODE ? '✏️  FIX (--fix)' : '🔍  DRY-RUN (passer --fix pour corriger)'}\n`);

  // 1. Vérifier que schema_migrations existe
  const { rows: tableCheck } = await db.query(`
    SELECT to_regclass('public.schema_migrations') AS tbl
  `);
  if (!tableCheck[0]?.tbl) {
    console.error('❌ Table schema_migrations introuvable. Rien à faire.');
    process.exit(1);
  }

  // 2. Charger l'état actuel pour les 8 noms concernés
  const allNames = RENAMES.flatMap(r => [r.old, r.new]);
  const { rows } = await db.query(
    `SELECT filename, applied_at FROM schema_migrations WHERE filename = ANY($1) ORDER BY filename`,
    [allNames]
  );

  const found = new Set(rows.map(r => r.filename));
  console.log(`Entrées trouvées dans schema_migrations (${rows.length}) :`);
  rows.forEach(r => console.log(`  ${r.filename}  (appliqué : ${r.applied_at?.toISOString().slice(0,10)})`));
  console.log('');

  // 3. Analyser chaque paire
  let needsFix = 0;
  let alreadyOk = 0;
  let notTracked = 0;

  const toRename = [];

  for (const pair of RENAMES) {
    const hasOld = found.has(pair.old);
    const hasNew = found.has(pair.new);

    if (hasOld && !hasNew) {
      console.log(`⚠️  À renommer  : ${pair.old} → ${pair.new}`);
      toRename.push(pair);
      needsFix++;
    } else if (hasNew) {
      console.log(`✅  Déjà à jour : ${pair.new}`);
      alreadyOk++;
    } else {
      console.log(`ℹ️  Non tracké  : ni ${pair.old} ni ${pair.new} — run-migrations.js s'en chargera`);
      notTracked++;
    }
  }

  console.log(`\nRésumé : ${alreadyOk} OK · ${needsFix} à corriger · ${notTracked} non trackés`);

  if (needsFix === 0) {
    console.log('\n✅ Rien à faire — schema_migrations est cohérent.');
    await db.pool.end();
    return;
  }

  if (!FIX_MODE) {
    console.log(`\n→ Relancer avec --fix pour appliquer les ${needsFix} UPDATE.`);
    await db.pool.end();
    process.exit(0);
  }

  // 4. Appliquer les renames
  console.log('\nApplication des corrections…');
  for (const pair of toRename) {
    const { rowCount } = await db.query(
      `UPDATE schema_migrations SET filename = $1 WHERE filename = $2`,
      [pair.new, pair.old]
    );
    console.log(`  ${rowCount === 1 ? '✅' : '⚠️ '} ${pair.old} → ${pair.new} (${rowCount} ligne mise à jour)`);
  }

  // 5. Vérification finale
  const { rows: after } = await db.query(
    `SELECT filename FROM schema_migrations WHERE filename = ANY($1) ORDER BY filename`,
    [allNames]
  );
  const afterSet = new Set(after.map(r => r.filename));
  const staleOld = RENAMES.filter(p => afterSet.has(p.old));
  if (staleOld.length > 0) {
    console.error(`\n❌ Anciens noms encore présents : ${staleOld.map(p => p.old).join(', ')}`);
    process.exit(1);
  }

  console.log('\n✅ schema_migrations aligné sur les nouveaux noms (083-086).');
  console.log('   Vous pouvez déployer le commit AUD-10 sans risque de rejeu.');
  await db.pool.end();
}

run().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
