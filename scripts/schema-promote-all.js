'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-promote-orchestrator
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Executer en sequence les promotions d'objets, de colonnes et la synthese live SCHEMA.md
 *               contre le meme dump Railway et avec les memes flags CLI.
 * @inputs       scripts/schema-promote.js, scripts/schema-promote-columns.js, scripts/schema-sync-summary.js
 * @outputs      stdout combine, exit code du premier promoteur en echec
 * @depends      scripts/schema-promote.js, scripts/schema-promote-columns.js, scripts/schema-sync-summary.js
 * @used-by      package.json schema:promote*, .github/workflows/schema-refresh.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-08
 */

const path = require('path');
const { spawnSync } = require('child_process');

const forwardedArgs = process.argv.slice(2);
const scripts = [
  path.join(__dirname, 'schema-promote.js'),
  path.join(__dirname, 'schema-promote-columns.js'),
  path.join(__dirname, 'schema-sync-summary.js'),
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [script, ...forwardedArgs], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`🚫 Impossible d'executer ${path.basename(script)}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status == null ? 1 : result.status);
  }
}
