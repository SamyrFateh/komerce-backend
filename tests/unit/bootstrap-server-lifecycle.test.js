/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/server-lifecycle.js
 *
 * P1 Wallet / intégrité monétaire — Lot A : ensureWalletTables est désormais
 * un préflight fatal AVANT server.listen. Routing/security et les migrations de
 * startup restent post-listen, séquentiels et non fatals.
 *
 * Run : npx jest tests/unit/bootstrap-server-lifecycle.test.js
 */

'use strict';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const { startServerLifecycle } = require('../../bootstrap/server-lifecycle');

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeDeps(overrides = {}) {
  const mockServer = {
    listening: false,
    once: jest.fn(),
    off: jest.fn(),
    listen: jest.fn((port, cb) => {
      mockServer.listening = true;
      if (cb) cb();
      return mockServer;
    }),
    close: jest.fn(),
  };
  const app = { __app: true };
  const createHttpServer = jest.fn(() => mockServer);
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
    createHttpServer,
    deps: {
      app, db, walletService, routingService, parcelSecurity,
      runStartupMigrations, fixAdminHash, fixMissingSchema, runAllSeeds,
      createHttpServer,
      ...overrides,
    },
  };
}

async function startReady(deps) {
  const server = startServerLifecycle(deps);
  await server.ready;
  return server;
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
    setTimeoutSpy.mock.results.forEach(r => { try { clearTimeout(r.value); } catch (_) {} });
    exitSpy.mockRestore();
    onSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    process.env.PORT = ORIGINAL_PORT;
  });

  describe('préflight wallet fatal avant listen', () => {
    test('ensureWalletTables termine avant server.listen ; routing/security restent post-listen', async () => {
      const { deps, mockServer } = makeDeps();
      const server = startServerLifecycle(deps);

      expect(mockServer.listen).not.toHaveBeenCalled();
      expect(deps.routingService.ensureRoutingColumns).not.toHaveBeenCalled();
      expect(deps.parcelSecurity.ensureSecurityTables).not.toHaveBeenCalled();

      await server.ready;

      expect(deps.walletService.ensureWalletTables).toHaveBeenCalledTimes(1);
      expect(mockServer.listen).toHaveBeenCalledTimes(1);
      expect(deps.walletService.ensureWalletTables.mock.invocationCallOrder[0])
        .toBeLessThan(mockServer.listen.mock.invocationCallOrder[0]);

      await flush();
      await flush();
      expect(deps.routingService.ensureRoutingColumns).toHaveBeenCalledWith(deps.db);
      expect(deps.parcelSecurity.ensureSecurityTables).toHaveBeenCalledWith(deps.db);
    });

    test('succès du préflight → boot-guard logge ensureWalletTables OK avec durée', async () => {
      const { deps } = makeDeps();
      await startReady(deps);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureWalletTables', duration_ms: expect.any(Number) }),
        expect.stringMatching(/"ensureWalletTables" OK/)
      );
    });

    test('rejet de ensureWalletTables → aucun listen, aucun ensure post-listen, process exit(1)', async () => {
      const { deps, mockServer } = makeDeps();
      const err = new Error('wallet down');
      deps.walletService.ensureWalletTables.mockRejectedValue(err);

      const server = startServerLifecycle(deps);
      await expect(server.ready).rejects.toThrow('wallet down');
      await flush();

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureWalletTables', err }),
        expect.stringMatching(/"ensureWalletTables" échec/)
      );
      expect(mockLog.error).toHaveBeenCalledWith(
        { err },
        expect.stringMatching(/Préflight wallet critique en échec/)
      );
      expect(mockServer.listen).not.toHaveBeenCalled();
      expect(deps.routingService.ensureRoutingColumns).not.toHaveBeenCalled();
      expect(deps.parcelSecurity.ensureSecurityTables).not.toHaveBeenCalled();
      expect(deps.runStartupMigrations).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('rejet de ensureRoutingColumns → non fatal après listen', async () => {
      const { deps, mockServer } = makeDeps();
      deps.routingService.ensureRoutingColumns.mockRejectedValue(new Error('routing down'));
      await startReady(deps);
      await flush();
      await flush();
      expect(mockServer.listen).toHaveBeenCalledTimes(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureRoutingColumns', err: expect.any(Error) }),
        expect.stringMatching(/"ensureRoutingColumns" échec/)
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('rejet de ensureSecurityTables → non fatal après listen', async () => {
      const { deps, mockServer } = makeDeps();
      deps.parcelSecurity.ensureSecurityTables.mockRejectedValue(new Error('security down'));
      await startReady(deps);
      await flush();
      await flush();
      expect(mockServer.listen).toHaveBeenCalledTimes(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'ensureSecurityTables', err: expect.any(Error) }),
        expect.stringMatching(/"ensureSecurityTables" échec/)
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('KOMERCE_SKIP_STARTUP_MIGRATIONS', () => {
    const ORIGINAL_SKIP = process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS;

    afterEach(() => {
      if (ORIGINAL_SKIP === undefined) delete process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS;
      else process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS = ORIGINAL_SKIP;
    });

    test('true → runStartupMigrations jamais appelé', async () => {
      process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS = 'true';
      const { deps } = makeDeps();
      await startReady(deps);
      await flush();
      await flush();
      expect(deps.runStartupMigrations).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringMatching(/runStartupMigrations ignoré/)
      );
    });

    test('flag absent ou différent de true → runStartupMigrations appelé', async () => {
      delete process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS;
      const { deps } = makeDeps();
      await startReady(deps);
      await flush();
      await flush();
      expect(deps.runStartupMigrations).toHaveBeenCalledTimes(1);
    });
  });

  describe('KOMERCE_SKIP_BOOT_ENSURE', () => {
    const ORIGINAL_SKIP = process.env.KOMERCE_SKIP_BOOT_ENSURE;

    afterEach(() => {
      if (ORIGINAL_SKIP === undefined) delete process.env.KOMERCE_SKIP_BOOT_ENSURE;
      else process.env.KOMERCE_SKIP_BOOT_ENSURE = ORIGINAL_SKIP;
    });

    test('true → routing/security sautés mais préflight wallet toujours exécuté', async () => {
      process.env.KOMERCE_SKIP_BOOT_ENSURE = 'true';
      const { deps } = makeDeps();
      await startReady(deps);
      await flush();
      await flush();
      expect(deps.walletService.ensureWalletTables).toHaveBeenCalledTimes(1);
      expect(deps.routingService.ensureRoutingColumns).not.toHaveBeenCalled();
      expect(deps.parcelSecurity.ensureSecurityTables).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringMatching(/préflight ensureWalletTables déjà validé et non skippable/)
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

    test('flag absent → les 3 vérifications tournent', async () => {
      delete process.env.KOMERCE_SKIP_BOOT_ENSURE;
      const { deps } = makeDeps();
      await startReady(deps);
      await flush();
      await flush();
      expect(deps.walletService.ensureWalletTables).toHaveBeenCalledTimes(1);
      expect(deps.routingService.ensureRoutingColumns).toHaveBeenCalledWith(deps.db);
      expect(deps.parcelSecurity.ensureSecurityTables).toHaveBeenCalledWith(deps.db);
    });
  });

  describe('démarrage du serveur HTTP', () => {
    test('crée une vraie abstraction serveur à partir de app', () => {
      const { deps, createHttpServer } = makeDeps();
      startServerLifecycle(deps);
      expect(createHttpServer).toHaveBeenCalledWith(deps.app);
    });

    test('listen utilise le port par défaut 3000 après préflight', async () => {
      const { deps, mockServer } = makeDeps();
      await startReady(deps);
      expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    test('listen utilise process.env.PORT', async () => {
      process.env.PORT = '4242';
      const { deps, mockServer } = makeDeps();
      await startReady(deps);
      expect(mockServer.listen).toHaveBeenCalledWith('4242', expect.any(Function));
    });

    test('port explicite prime sur process.env.PORT', async () => {
      process.env.PORT = '4242';
      const { deps, mockServer } = makeDeps();
      const server = startServerLifecycle({ ...deps, port: 9999 });
      await server.ready;
      expect(mockServer.listen).toHaveBeenCalledWith(9999, expect.any(Function));
    });

    test('log.info de démarrage n’est émis qu’après préflight/listen', async () => {
      const { deps } = makeDeps();
      const server = startServerLifecycle(deps);
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringMatching(/KOMERCE API v12\.4/));
      await server.ready;
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/préflight wallet OK/));
    });

    test('retourne immédiatement l’instance server et expose server.ready', async () => {
      const { deps, mockServer } = makeDeps();
      const result = startServerLifecycle(deps);
      expect(result).toBe(mockServer);
      expect(result.ready).toBeInstanceOf(Promise);
      await result.ready;
    });
  });

  describe('migrations de démarrage (post-listen, background)', () => {
    test('runStartupMigrations reçoit les dépendances attendues', async () => {
      const { deps } = makeDeps();
      await startReady(deps);
      await flush();
      await flush();
      expect(deps.runStartupMigrations).toHaveBeenCalledWith({
        db: deps.db,
        fixAdminHash: deps.fixAdminHash,
        fixMissingSchema: deps.fixMissingSchema,
        runAllSeeds: deps.runAllSeeds,
      });
    });

    test('rejet de runStartupMigrations → log.error non fatal', async () => {
      const { deps } = makeDeps();
      deps.runStartupMigrations.mockRejectedValue(new Error('migration boom'));
      await startReady(deps);
      await flush();
      await flush();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Migration error \(non-fatal/)
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('succès → aucun log.error', async () => {
      const { deps } = makeDeps();
      await startReady(deps);
      await flush();
      await flush();
      expect(mockLog.error).not.toHaveBeenCalled();
    });
  });

  describe('garde-fou SIGTERM — fermeture gracieuse', () => {
    test('après listen, SIGTERM déclenche server.close()', async () => {
      const { deps, mockServer } = makeDeps();
      await startReady(deps);
      handlers.SIGTERM();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/SIGTERM reçu/));
      expect(mockServer.close).toHaveBeenCalledTimes(1);
    });

    test('close réussi → process.exit(0)', async () => {
      const { deps, mockServer } = makeDeps();
      await startReady(deps);
      handlers.SIGTERM();
      mockServer.close.mock.calls[0][0]();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringMatching(/fermé proprement/));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('un force-kill à 10s est programmé après listen', async () => {
      const { deps } = makeDeps();
      await startReady(deps);
      handlers.SIGTERM();
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    });

    test('si close ne rappelle jamais, le force-kill appelle exit(1)', async () => {
      const { deps } = makeDeps();
      await startReady(deps);
      handlers.SIGTERM();
      const forceKillCall = setTimeoutSpy.mock.calls.find(c => c[1] === 10_000);
      forceKillCall[0]();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test('SIGTERM avant listen arrête proprement sans appeler close', () => {
      const { deps, mockServer } = makeDeps();
      startServerLifecycle(deps);
      handlers.SIGTERM();
      expect(mockServer.close).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('garde-fous crash (NEW-07)', () => {
    test('unhandledRejection → log.error avec raison, pas d’exit', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      const reason = new Error('promise oubliée');
      handlers.unhandledRejection(reason);
      expect(mockLog.error).toHaveBeenCalledWith({ err: reason }, '[unhandledRejection]');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test('uncaughtException → log.error avec erreur', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      const err = new Error('crash fatal');
      handlers.uncaughtException(err);
      expect(mockLog.error).toHaveBeenCalledWith({ err }, '[uncaughtException]');
    });

    test('uncaughtException programme exit(1) à 500ms', () => {
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
    test('enregistre SIGTERM, unhandledRejection et uncaughtException', () => {
      const { deps } = makeDeps();
      startServerLifecycle(deps);
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    });
  });
});
