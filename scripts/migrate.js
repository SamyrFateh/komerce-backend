#!/usr/bin/env node
/**
 * KOMERCE — Runner de migrations standalone (Vague 3)
 *
 * Usage direct  : node scripts/migrate.js
 * Railway       : ajouter en release command dans railway.toml :
 *                   [deploy]
 *                   releaseCommand = "node scripts/migrate.js"
 *
 * Ce script exécute les migrations de schéma et les seeds,
 * puis se termine proprement (process.exit). Il est complètement
 * découplé du boot HTTP — server.js ne fait plus tourner les migrations.
 */

'use strict';

require('dotenv').config();

const { fixAdminHash, fixMissingSchema } = require('./fix-schema');
const { runAllSeeds }                     = require('./seed');
const { run: runMigrations }              = require('./run-migrations');
const db                                  = require('../db');

(async () => {
  console.log('🔄 Komerce — Runner migrations standalone démarré');
  const t0 = Date.now();
  try {
    await fixAdminHash();
    await fixMissingSchema();
    await runMigrations();   // applique migrations/*.sql en attente
    await runAllSeeds();
    console.log(`✅ Migrations terminées en ${Date.now() - t0}ms`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur critique migration:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // Ferme le pool PG proprement pour éviter que le process reste suspendu
    try { await db.end(); } catch (_) {}
  }
})();
