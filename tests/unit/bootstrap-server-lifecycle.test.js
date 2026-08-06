/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/server-lifecycle.js (Lot 0)
 *
 * `bootstrap/server-lifecycle.js` était absent de `collectCoverageFrom`
 * (angle mort structurel, Lot 0). C'est le fichier H2 qui démarre le serveur,
 * lance les init tables (wallet/routing/security) en SÉQUENCE (boot-guard.js,
 * timeout + logging par étape) APRÈS app.listen, déclenche les migrations de
 * démarrage en `setImmediate`, et pose les garde-fous process (SIGTERM
 * gracieux, unhandledRejection, uncaughtException).
 *
 * FIX 2026-07-09 : l'init des tables était en fire-and-forget parallèle AVANT
 * app.listen ; elle est maintenant séquentielle, APRÈS app.listen (le serveur
 * répond déjà), via `runSequential` (boot-guard.js). Les tests ci-dessous sont
 * donc `async` et attendent un `flush()` avant d'observer les appels ensure*.
 *
 * Stratégie de mock :
 * - `process.on` est mocké pour capturer les handlers sans les enregistrer
 *   réellement sur le process (évite toute fuite de listeners entre tests).
 * - `process.exit` est mocké (sinon il tuerait le process de test).
 * - `global.setTimeout` est spié (call-through) pour capturer les délais de
 *   force-kill (10s SIGTERM / 500ms uncaughtException) et les déclencher
 *   manuellement sans attendre — les vrais timers sont nettoyés en afterEach.
 * - `app.listen` et `server.close` sont des mocks contrôlés manuellement.
 *
 * Run : npx jest tests/unit/bootstrap-server-lifecycle.test.js
 */

'use strict';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const { startServerLifecycle } = require('../../bootstrap/server-lifecycle');

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeDeps(overrides = {}) {
  const mockServer = { close: jest.fn() };
  const app = { listen: jest.fn((port, cb) => { cb && cb(); return mockServer; }) };
  const db = { __db: true };
  const walletService = { ensureWalletTables: jest.fn().mockResolvedValue() };
  const routingService = { ensureRoutingColumns: jest.fn().mockResolvedValue() };
  const parcelSecurity = { ensureSecurityTables: jest.fn().mockResolvedValue() };
  const runStartupMigrations = jest.fn().mockResolvedValue();
  const fixAdminHash = jest.fn();
  const fixMissingSchema = jest.fn();
  const runAllSeeds = jest.fn();

  return {
    mockServer,
    deps: {
      app, db, walletService, routingService, parcelSecurity,
      runStartupMigrations, fixAdminHash, fixMissingSchema, runAllSeeds,
      ...overrides,
    },
  };
}

describe('bootstrap/server-lifecycle — startServerLifecycle', () => {
  const ORIGINAL_PORT = process.env.PORT;
  let exitSpy;
  let onSpy;
  let setTimeoutSpy;
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PORT;
    handlers = {};
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    onSpy = jest.spyOn(process, 'on').mockImplementation((event, handler) => {
      handlers[event] = handler;
      return process;
    });
    setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  });

  afterEach(() => {
    // Nettoie tout vrai timer réellement programmé (10s / 500ms) pour ne pas
    // laisser de handles ouverts après la fin des tests.
    setTimeoutSpy.mock.results.forEach(r => { try { clearTimeout(r.value); } catch (_) {} });
    exitSpy.mockRestore();
    onSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    process.env.PORT = ORIGINAL_PORT;
  });

  describe('initialisation des tables (séquentielle, post-listen, boot-guard)', () => {
    test('appelle ensureWalletTables, ensureRoutingColumns(db), ensureSecurityTables(db) en séquence après listen', async () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      // synchrone : rien n'est encore appelé, tout part dans le setImmediate post-listen
      expect(deps.walletService.ensureWalletTables).not.toHaveBeenCalled();
      await flush();
      await flush();
      await flush();
      expect(deps.walletService.ensureWalletTables).toHaveBeenCalledTimes(1);
      expect(deps.routingService.ensureRoutingColumns).toHaveBeenCalledWith(deps.db);
      expect(deps.parcelSecurity.ensureSecurityTables).toHaveBeenCalledWith(deps.db);
    });

    test('succès de chaque étape → log.info "[boot-guard] ... OK" avec une durée', async () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureWalletTables', duration_ms: expect.any(Number) }),
        expect.stringMatching(/"ensureWalletTables" OK/)
      );
    });

    test('rejet de ensureWalletTables → log.error boot-guard, pas de crash, séquence continue', async () => {
      const { deps } = makeDeps();
      deps.walletService.ensureWalletTables.mockRejectedValue(new Error('wallet down'));
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureWalletTables', err: expect.any(Error) }),
        expect.stringMatching(/"ensureWalletTables" échec/)
      );
      // la séquence continue malgré l'échec
      expect(deps.routingService.ensureRoutingColumns).toHaveBeenCalledWith(deps.db);
      expect(deps.parcelSecurity.ensureSecurityTables).toHaveBeenCalledWith(deps.db);
    });

    test('rejet de ensureRoutingColumns → log.error boot-guard, pas de crash', async () => {
      const { deps } = makeDeps();
      deps.routingService.ensureRoutingColumns.mockRejectedValue(new Error('routing down'));
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureRoutingColumns', err: expect.any(Error) }),
        expect.stringMatching(/"ensureRoutingColumns" échec/)
      );
    });

    test('rejet de ensureSecurityTables → log.error boot-guard, pas de crash', async () => {
      const { deps } = makeDeps();
      deps.parcelSecurity.ensureSecurityTables.mockRejectedValue(new Error('security down'));
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureSecurityTables', err: expect.any(Error) }),
        expect.stringMatching(/"ensureSecurityTables" échec/)
      );
    });
  });

  describe('KOMERCE_SKIP_STARTUP_MIGRATIONS', () => {
    const ORIGINAL_SKIP = process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS;

    afterEach(() => {
      if (ORIGINAL_SKIP === undefined) delete process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS;
      else process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS = ORIGINAL_SKIP;
    });

    test('KOMERCE_SKIP_STARTUP_MIGRATIONS=true → runStartupMigrations jamais appelé', async () => {
      process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS = 'true';
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(deps.runStartupMigrations).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringMatching(/runStartupMigrations ignoré/)
      );
    });

    test('flag absent ou différent de "true" → runStartupMigrations appelé normalement', async () => {
      delete process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS;
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(deps.runStartupMigrations).toHaveBeenCalledTimes(1);
    });
  });

  describe('KOMERCE_SKIP_BOOT_ENSURE', () => {
    // FIX 2026-07-09 : incident prod — ensureRoutingColumns/ensureSecurityTables
    // en contention avec du trafic live, pool DB immobilisé au boot (catalogue
    // en spinner). Ce flag permet de sauter ces deux étapes au redémarrage sans
    // toucher à ensureWalletTables (31ms, sans risque, toujours actif).
    const ORIGINAL_SKIP = process.env.KOMERCE_SKIP_BOOT_ENSURE;

    afterEach(() => {
      if (ORIGINAL_SKIP === undefined) delete process.env.KOMERCE_SKIP_BOOT_ENSURE;
      else process.env.KOMERCE_SKIP_BOOT_ENSURE = ORIGINAL_SKIP;
    });

    test('KOMERCE_SKIP_BOOT_ENSURE=true → ensureRoutingColumns/ensureSecurityTables jamais appelés, ensureWalletTables l\'est toujours', async () => {
      process.env.KOMERCE_SKIP_BOOT_ENSURE = 'true';
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(deps.walletService.ensureWalletTables).toHaveBeenCalledTimes(1);
      expect(deps.routingService.ensureRoutingColumns).not.toHaveBeenCalled();
      expect(deps.parcelSecurity.ensureSecurityTables).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringMatching(/KOMERCE_SKIP_BOOT_ENSURE=true/)
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureRoutingColumns' }),
        expect.stringMatching(/ignoré \(flag env\)/)
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureSecurityTables' }),
        expect.stringMatching(/ignoré \(flag env\)/)
      );
    });

    test('flag absent ou différent de "true" → les 3 étapes tournent normalement', async () => {
      delete process.env.KOMERCE_SKIP_BOOT_ENSURE;
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      await flush();
      await flush();
      expect(deps.walletService.ensureWalletTables).toHaveBeenCalledTimes(1);
      expect(deps.routingService.ensureRoutingColumns).toHaveBeenCalledWith(deps.db);
      expect(deps.parcelSecurity.ensureSecurityTables).toHaveBeenCalledWith(deps.db);
    });
  });

  describe('démarrage du serveur HTTP', () => {
    test('app.listen appelé avec le port par défaut 3000 si PORT non défini', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      expect(deps.app.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    test('app.listen appelé avec process.env.PORT si défini', () => {
      process.env.PORT = '4242';
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      expect(deps.app.listen).toHaveBeenCalledWith('4242', expect.any(Function));
    });

    test('port explicite passé en option prime sur tout', () => {
      const { deps } = makeDeps();
      startServerLifecycle({ ...deps, port: 9999 });
      expect(deps.app.listen).toHaveBeenCalledWith(9999, expect.any(Function));
    });

    test('log.info émis au démarrage avec le port', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/port 3000/));
    });

    test('retourne l\'instance server renvoyée par app.listen', () => {
      const { deps, mockServer } = makeDeps();
      const result = startServerLifecycle(deps);
      expect(result).toBe(mockServer);
    });
  });

  describe('migrations de démarrage (setImmediate, background)', () => {
    test('runStartupMigrations appelé avec {db, fixAdminHash, fixMissingSchema, runAllSeeds}', async () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      expect(deps.runStartupMigrations).toHaveBeenCalledWith({
        db: deps.db,
        fixAdminHash: deps.fixAdminHash,
        fixMissingSchema: deps.fixMissingSchema,
        runAllSeeds: deps.runAllSeeds,
      });
    });

    test('rejet de runStartupMigrations → log.error non-fatal, pas de crash', async () => {
      const { deps } = makeDeps();
      deps.runStartupMigrations.mockRejectedValue(new Error('migration boom'));
      startServerLifecycle(deps);
      await flush();
      await flush();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Migration error \(non-fatal/)
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('succès de runStartupMigrations → aucun log.error', async () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      await flush();
      await flush();
      expect(mockLog.error).not.toHaveBeenCalled();
    });
  });

  describe('garde-fou SIGTERM — fermeture gracieuse', () => {
    test('SIGTERM déclenche log.info puis server.close()', () => {
      const { deps, mockServer } = makeDeps();
      startServerLifecycle(deps);
      handlers.SIGTERM();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/SIGTERM reçu/));
      expect(mockServer.close).toHaveBeenCalledTimes(1);
    });

    test('close() réussi → log.info fermeture propre + process.exit(0)', () => {
      const { deps, mockServer } = makeDeps();
      startServerLifecycle(deps);
      handlers.SIGTERM();
      // simule la fin réelle de server.close()
      mockServer.close.mock.calls[0][0]();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/fermé proprement/));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('un force-kill à 10s est programmé à chaque SIGTERM', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      handlers.SIGTERM();
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    });

    test("si close() ne rappelle jamais, le timer de force-kill appelle process.exit(1)", () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      handlers.SIGTERM();
      // ne pas invoquer le callback de close() — simule un close qui traîne
      const forceKillCall = setTimeoutSpy.mock.calls.find(c => c[1] === 10_000);
      forceKillCall[0](); // déclenche manuellement le timer de force-kill
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('garde-fous crash (NEW-07)', () => {
    test('unhandledRejection → log.error avec la raison, pas de process.exit', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      const reason = new Error('promise oubliée');
      handlers.unhandledRejection(reason);
      expect(mockLog.error).toHaveBeenCalledWith({ err: reason }, '[unhandledRejection]');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('uncaughtException → log.error avec l\'erreur', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      const err = new Error('crash fatal');
      handlers.uncaughtException(err);
      expect(mockLog.error).toHaveBeenCalledWith({ err }, '[uncaughtException]');
    });

    test('uncaughtException programme un process.exit(1) à 500ms', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      handlers.uncaughtException(new Error('crash fatal'));
      const exitCall = setTimeoutSpy.mock.calls.find(c => c[1] === 500);
      expect(exitCall).toBeDefined();
      exitCall[0]();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('enregistrement des listeners process', () => {
    test('enregistre bien SIGTERM, unhandledRejection et uncaughtException', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    });
  });
});
