/**
 * @komerce-arch
 * @role          bootstrap-server-lifecycle
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-06
 */

'use strict';

const log = require('../utils/logger').child({ module: 'server-lifecycle' });

/**
 * H2 — Server lifecycle bootstrap.
 *
 * Centralise server startup, graceful shutdown and crash guards.
 * Keeps the same operational behavior as the previous inline server.js block.
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
  walletService.ensureWalletTables().catch(e => log.error({ err: e }, 'Wallet init error:'));
  routingService.ensureRoutingColumns(db).catch(e => log.error({ err: e }, 'Routing init error:'));
  parcelSecurity.ensureSecurityTables(db).catch(e => log.error({ err: e }, 'Security init error:'));

  const server = app.listen(port, () => {
    log.info(`KOMERCE API v12.4 — port ${port} — démarrage immédiat — migrations en background`);

    setImmediate(() => {
      runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })
        .catch(err => log.error({ err }, '❌ Migration error (non-fatal, serveur opérationnel)'));
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
  process.on('unhandledRejection', (reason) => {
    log.error('[unhandledRejection]', reason);
  });

  process.on('uncaughtException', (err) => {
    log.error('[uncaughtException]', err);
    // Sortir proprement — l'état du process est incertain après uncaughtException
    setTimeout(() => process.exit(1), 500);
  });

  return server;
}

module.exports = {
  startServerLifecycle,
};
