/**
 * @komerce-arch-lite
 * @role          sourcing-source-autopilot-one-pass
 * @domain        sourcing
 * @layer         tooling
 * @owner         services/sourcing-source-autopilot.js
 * @purpose       Exécuter un passage borné sur les sources API dont l'autopilot est explicitement ON.
 * @impact-areas  sourcing, catalog, supplier-import
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const autopilot = require('../services/sourcing-source-autopilot');

function boundedLimit(value) {
  const n = Number.parseInt(value ?? '10', 10);
  if (!Number.isInteger(n) || n < 1) return 10;
  return Math.min(n, 50);
}

async function main() {
  const result = await autopilot.runActiveSources({
    limit: boundedLimit(process.env.KOMERCE_SOURCE_AUTOPILOT_BATCH_LIMIT),
    reason: 'railway_cron',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.status === 'disabled') return;
  if ((result.results || []).some((row) => row.status === 'failed')) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
