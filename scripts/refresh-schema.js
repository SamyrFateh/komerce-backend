'use strict';

/**
 * KOMERCE — Refresh db/schema.sql depuis Railway prod (cross-platform)
 * Équivalent Node.js de scripts/refresh-schema.sh — fonctionne sur Windows.
 *
 * Usage :
 *   railway run node scripts/refresh-schema.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL non défini.');
  process.exit(1);
}

const SCHEMA_FILE = path.join(__dirname, '..', 'db', 'schema.sql');

console.log('🔄 Dump du schéma prod → db/schema.sql');

try {
  const sql = execSync(
    `pg_dump --schema-only --no-owner --no-acl --no-privileges --encoding=UTF8 "${DATABASE_URL}"`,
    { maxBuffer: 50 * 1024 * 1024 }
  );
  fs.writeFileSync(SCHEMA_FILE, sql);
  const lines = sql.toString().split('\n').length;
  console.log(`✅ db/schema.sql mis à jour (${lines} lignes)`);
} catch (err) {
  console.error('❌ pg_dump a échoué :', err.message);
  process.exit(1);
}

// Vérification de fraîcheur
console.log('\n🔍 Vérification colonnes post-migrations…');
try {
  execSync('node scripts/check-schema-freshness.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ schema.sql complet');
} catch {
  console.error('⚠️  Colonnes manquantes détectées (voir ci-dessus)');
}

console.log('\n📋 Prochaine étape :');
console.log('   git add db/schema.sql');
console.log('   git commit -m "chore(schema): refresh prod (post-081 product_ref)"');
console.log('   git push');
