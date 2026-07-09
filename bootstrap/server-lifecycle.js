/**
 * @komerce-arch
 * @role          bootstrap-server-lifecycle
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/logger.js
 * @db-write      none
 * @db-read      none
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-07
 */

'use strict';

const log = require('../utils/logger').child({ module: 'server-lifecycle' });
const { runSequential } = require('./boot-guard');

/**
 * H2 — Server lifecycle bootstrap.
 *
 * Centralise server startup, graceful shutdown and crash guards.
 *
 * FIX 2026-07-09 : ensureWalletTables / ensureRoutingColumns / ensureSecurityTables
 * tournaient en fire-and-forget PARALLÈLE avant app.listen, sans logging de durée
 * ni timeout — point faible identifié lors du diagnostic de la fuite de pool
 * catalogue (cf. commit 9c90b42). Ils s'exécutent maintenant en SÉQUENCE, APRÈS
 * app.listen (le serveur répond déjà), avec logging de durée par étape et un
 * timeout individuel (boot-guard.js) pour rendre tout blocage diagnosticable.
 * Chaque échec reste non-fatal (comportement inchangé), juste attribuable.
 */

function startServerLifecycle({
  app,
  db,
  walletService,
  routingService,
  parcelSecurity,
  runStartupMigrations,
  fixAdminHash,
  fixMissingSchema,
  runAllSeeds,
  port = process.env.PORT || 3000,
}) {
  const server = app.listen(port, () => {
    log.info(`KOMERCE API v12.4 — port ${port} — démarrage immédiat — init tables + migrations en background`);

    setImmediate(async () => {
      await runSequential([
        { label: 'ensureWalletTables', run: () => walletService.ensureWalletTables() },
        { label: 'ensureRoutingColumns', run: () => routingService.ensureRoutingColumns(db) },
        { label: 'ensureSecurityTables', run: () => parcelSecurity.ensureSecurityTables(db) },
      ], { log });

      if (process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS === 'true') {
        log.info('[boot-guard] runStartupMigrations ignoré (KOMERCE_SKIP_STARTUP_MIGRATIONS=true)');
        return;
      }

      try {
        await runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds });
      } catch (err) {
        log.error({ err }, '❌ Migration error (non-fatal, serveur opérationnel)');
      }
    });
  });

  process.on('SIGTERM', () => {
    log.info('SIGTERM reçu — fermeture gracieuse...');
    server.close(() => {
      log.info('Serveur fermé proprement.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  });

  // NEW-07 — Crash guards : éviter qu'une promesse non catchée tue le process
  //
  // FIX 2026-07-09 : `log.error(msg, err)` était dans le mauvais ordre pour
  // pino (convention projet = `log.error({ err }, msg)`, cf. utils/logger.js).
  // Avec le 1er argument en string, pino ignore silencieusement le 2ᵉ
  // argument positionnel : reason/err n'apparaissait JAMAIS dans les logs,
  // masquant la cause réelle des rejets (dont la fuite de pool DB en prod).
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, '[unhandledRejection]');
  });

  process.on('uncaughtException', (err) => {
    log.error({ err }, '[uncaughtException]');
    // Sortir proprement — l'état du process est incertain après uncaughtException
    setTimeout(() => process.exit(1), 500);
  });

  return server;
}

module.exports = {
  startServerLifecycle,
};
