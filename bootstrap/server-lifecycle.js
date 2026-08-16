/**
 * @komerce-arch
 * @role          bootstrap-server-lifecycle
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       node:http, bootstrap/boot-guard.js, utils/logger.js
 * @db-write      none
 * @db-read       none
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-08
 */

'use strict';

const http = require('http');
const log = require('../utils/logger').child({ module: 'server-lifecycle' });
const { runSequential } = require('./boot-guard');

/**
 * H2 — Server lifecycle bootstrap.
 *
 * Le schéma wallet est monétaire : il doit être vérifié AVANT toute ouverture
 * du port HTTP. Un échec de ensureWalletTables est donc fatal et empêche
 * server.listen(). Les ensure routing/security restent volontairement
 * post-listen et non fatals, comme depuis le fix de contention du 2026-07-09.
 *
 * `server.ready` expose la promesse de préflight + mise en écoute. server.js
 * conserve ainsi immédiatement une vraie instance http.Server pour le shutdown
 * des tests, sans accepter de trafic tant que le contrat wallet n'est pas sain.
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
  createHttpServer = (handler) => http.createServer(handler),
}) {
  const server = createHttpServer(app);

  const startPostListenInitialization = () => {
    setImmediate(async () => {
      const skipBootEnsure = process.env.KOMERCE_SKIP_BOOT_ENSURE === 'true';
      if (skipBootEnsure) {
        log.info('[boot-guard] ensureRoutingColumns/ensureSecurityTables ignorés (KOMERCE_SKIP_BOOT_ENSURE=true) — préflight ensureWalletTables déjà validé et non skippable');
      }

      await runSequential([
        { label: 'ensureRoutingColumns', run: () => routingService.ensureRoutingColumns(db), skip: skipBootEnsure },
        { label: 'ensureSecurityTables', run: () => parcelSecurity.ensureSecurityTables(db), skip: skipBootEnsure },
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
  };

  const ready = runSequential([
    {
      label: 'ensureWalletTables',
      run: () => walletService.ensureWalletTables(),
      fatal: true,
    },
  ], { log }).then(() => new Promise((resolve, reject) => {
    const onListenError = (err) => {
      if (typeof server.off === 'function') server.off('error', onListenError);
      reject(err);
    };

    if (typeof server.once === 'function') server.once('error', onListenError);

    server.listen(port, () => {
      if (typeof server.off === 'function') server.off('error', onListenError);
      log.info(`KOMERCE API v12.4 — port ${port} — préflight wallet OK — init routing/security + migrations en background`);
      startPostListenInitialization();
      resolve(server);
    });
  }));

  // Le rejet reste observable via server.ready (tests / orchestration), mais en
  // runtime un schéma wallet incomplet doit réellement arrêter le process :
  // aucun HTTP ne doit démarrer et les crons déjà armés ne doivent pas garder
  // un process monétaire invalide en vie.
  ready.catch((err) => {
    log.error({ err }, '❌ Préflight wallet critique en échec — serveur HTTP non démarré');
    process.exit(1);
  });
  server.ready = ready;

  process.on('SIGTERM', () => {
    log.info('SIGTERM reçu — fermeture gracieuse...');
    if (!server.listening) {
      log.info('Serveur HTTP pas encore en écoute — arrêt propre avant listen.');
      process.exit(0);
      return;
    }
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
