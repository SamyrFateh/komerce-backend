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

const ONE_SHOT_ENV = 'KOMERCE_SOURCE_AUTOPILOT_ONE_SHOT';

function boundedLimit(value) {
  const n = Number.parseInt(value ?? '10', 10);
  if (!Number.isInteger(n) || n < 1) return 10;
  return Math.min(n, 50);
}

function parseOneShotTask(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'autopilot' };

  if (raw === 'aliexpress-golden-dry-run') {
    return { kind: 'aliexpress-golden', args: ['--dry-run'] };
  }

  const aliexpressImport = raw.match(/^aliexpress-golden-import:([0-9]{5,20})$/);
  if (aliexpressImport) {
    return {
      kind: 'aliexpress-golden',
      args: ['--execute-import', `--supplier-product-id=${aliexpressImport[1]}`],
    };
  }

  const allegroPrebuyer = raw.match(/^allegro-golden-prebuyer:([1-9][0-9]{0,8}(?:\.[0-9]{1,2})?)$/);
  if (allegroPrebuyer) {
    return {
      kind: 'allegro-golden-prebuyer',
      args: [`--price-kmf=${allegroPrebuyer[1]}`],
    };
  }

  const error = new Error(`${ONE_SHOT_ENV}_NOT_ALLOWLISTED`);
  error.code = 'source_autopilot_one_shot_not_allowlisted';
  throw error;
}

async function runTask(env = process.env, dependencies = {}) {
  const task = parseOneShotTask(env[ONE_SHOT_ENV]);

  if (task.kind === 'aliexpress-golden') {
    const golden = dependencies.aliexpressGolden || require('./aliexpress-golden-e2e');
    return { task, result: await golden.main(task.args, env) };
  }

  if (task.kind === 'allegro-golden-prebuyer') {
    const golden = dependencies.allegroGolden || require('./allegro-golden-prebuyer-proof');
    return { task, result: await golden.run(task.args, { env }) };
  }

  const runner = dependencies.autopilot || autopilot;
  const result = await runner.runActiveSources({
    limit: boundedLimit(env.KOMERCE_SOURCE_AUTOPILOT_BATCH_LIMIT),
    reason: 'railway_cron',
  });
  return { task, result };
}

async function main(env = process.env, dependencies = {}) {
  const outcome = await runTask(env, dependencies);
  process.stdout.write(`${JSON.stringify(outcome.result, null, 2)}\n`);

  if (outcome.task.kind === 'autopilot') {
    if (outcome.result.status === 'disabled') return outcome;
    if ((outcome.result.results || []).some((row) => row.status === 'failed')) {
      process.exitCode = 1;
    }
  }

  return outcome;
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(`${err?.stack || err}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.pool.end().catch(() => {});
    });
}

module.exports = {
  ONE_SHOT_ENV,
  boundedLimit,
  parseOneShotTask,
  runTask,
  main,
};
