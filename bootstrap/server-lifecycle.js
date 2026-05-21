'use strict';

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
  walletService.ensureWalletTables().catch(e => console.error('Wallet init error:', e.message));
  routingService.ensureRoutingColumns(db).catch(e => console.error('Routing init error:', e.message));
  parcelSecurity.ensureSecurityTables(db).catch(e => console.error('Security init error:', e.message));

  const server = app.listen(port, () => {
    console.log(`KOMERCE API v12.4 — port ${port} — démarrage immédiat — migrations en background`);

    setImmediate(() => {
      runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })
        .catch(err => console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message));
    });
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM reçu — fermeture gracieuse...');
    server.close(() => {
      console.log('Serveur fermé proprement.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  });

  // NEW-07 — Crash guards : éviter qu'une promesse non catchée tue le process
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    // Sortir proprement — l'état du process est incertain après uncaughtException
    setTimeout(() => process.exit(1), 500);
  });

  return server;
}

module.exports = {
  startServerLifecycle,
};
