/**
 * @komerce-arch
 * @role          bootstrap-boot-guard
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        async_init_steps
 * @outputs       side_effects, structured_logs
 * @depends       none
 * @db-write      none
 * @db-read      none
 * @used-by       bootstrap/server-lifecycle.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-07
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Court-circuite une promesse si elle dépasse `timeoutMs`, et logge début/fin
 * de chaque étape avec sa durée. Objectif : rendre visible, en logs, tout
 * ralentissement ou blocage lors du boot séquentiel (ensureWalletTables,
 * ensureRoutingColumns, ensureSecurityTables, migrations...), ce qui était
 * impossible à diagnostiquer avec le fire-and-forget parallèle précédent.
 */
function withTimeout(promiseFactory, { label, log, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const start = Date.now();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[boot-guard] Timeout (${timeoutMs}ms) dépassé pour "${label}"`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  return Promise.race([Promise.resolve().then(promiseFactory), timeout])
    .then((result) => {
      clearTimeout(timer);
      log.info({ step: label, duration_ms: Date.now() - start }, `[boot-guard] "${label}" OK`);
      return result;
    })
    .catch((err) => {
      clearTimeout(timer);
      log.error({ step: label, err, duration_ms: Date.now() - start }, `[boot-guard] "${label}" échec`);
      throw err;
    });
}

/**
 * Exécute une liste d'étapes d'init en séquence (pas en parallèle), pour que
 * chaque échec soit attribuable sans ambiguïté et que l'ordre soit déterministe.
 * Chaque étape : { label, run: () => Promise, timeoutMs?, fatal?, skip? }.
 * Par défaut, une étape en échec est non-fatale (log.error + on continue) —
 * comportement identique à l'existant (Wallet/Routing/Security init error).
 * `fatal: true` propage l'erreur et arrête la séquence.
 */
async function runSequential(steps, { log }) {
  const results = {};
  for (const step of steps) {
    if (step.skip) {
      log.info({ step: step.label }, `[boot-guard] "${step.label}" ignoré (flag env)`);
      continue;
    }
    try {
      results[step.label] = await withTimeout(step.run, {
        label: step.label,
        log,
        timeoutMs: step.timeoutMs,
      });
    } catch (err) {
      if (step.fatal) throw err;
      // non-fatal : déjà loggé par withTimeout, on continue la séquence
    }
  }
  return results;
}

module.exports = { withTimeout, runSequential, DEFAULT_TIMEOUT_MS };
