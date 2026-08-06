/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : bootstrap/crons.js (Lot 0)
 *
 * `bootstrap/crons.js` était absent de `collectCoverageFrom` (angle mort
 * structurel, voir AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md, Lot 0). Aucun
 * test ne `require()`ait ce fichier avant ce lot.
 *
 * Toutes les dépendances (db, logger, services) sont mockées. On utilise les
 * fake timers Jest pour déclencher les `setTimeout`/`setInterval` sans
 * attendre les délais réels (jusqu'à 24h pour la rétention snapshots).
 * On vérifie : (1) le bon service est appelé au bon moment, (2) les erreurs
 * sont avalées via `log.error` sans jamais faire planter le process — c'est
 * le comportement attendu d'un cron en production.
 *
 * Run : npx jest tests/unit/bootstrap-crons.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ child: () => mockLog }));

const mockProcessCashRelaisReminders = jest.fn();
const mockProcessBackorderReminders = jest.fn();
jest.mock('../../services/cash-reminder-service', () => ({
  processCashRelaisReminders: (...args) => mockProcessCashRelaisReminders(...args),
  processBackorderReminders: (...args) => mockProcessBackorderReminders(...args),
}));

const mockAutoConfirmExpired = jest.fn();
jest.mock('../../services/inventory-service', () => ({
  autoConfirmExpired: (...args) => mockAutoConfirmExpired(...args),
}));

const mockGetRuleNumber = jest.fn();
jest.mock('../../utils/rules', () => ({
  getRuleNumber: (...args) => mockGetRuleNumber(...args),
}));

const crons = require('../../bootstrap/crons');

describe('bootstrap/crons', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValue({ rowCount: 0 });
    mockProcessCashRelaisReminders.mockResolvedValue(undefined);
    mockProcessBackorderReminders.mockResolvedValue({ processed: 0, sms_sent: 0 });
    mockAutoConfirmExpired.mockResolvedValue({ auto_confirmed: 0 });
    mockGetRuleNumber.mockResolvedValue(60);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ── startSnapshotRetentionCron ──────────────────────────────────────────
  describe('startSnapshotRetentionCron', () => {
    test('ne purge pas avant 5 minutes', async () => {
      crons.startSnapshotRetentionCron();
      await jest.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('purge economic_snapshots > 90 jours après 5 minutes', async () => {
      mockDbQuery.mockResolvedValue({ rowCount: 3 });
      crons.startSnapshotRetentionCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      expect(mockDbQuery.mock.calls[0][0]).toMatch(/DELETE FROM economic_snapshots/);
      expect(mockDbQuery.mock.calls[0][0]).toMatch(/INTERVAL '90 days'/);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 3 }),
        expect.any(String)
      );
    });

    test('ne logue rien si rowCount = 0', async () => {
      mockDbQuery.mockResolvedValue({ rowCount: 0 });
      crons.startSnapshotRetentionCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockLog.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ deleted: expect.anything() }),
        expect.any(String)
      );
    });

    test('erreur DB avalée via log.error, ne relance pas', async () => {
      mockDbQuery.mockRejectedValue(new Error('db down'));
      crons.startSnapshotRetentionCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/retention/i)
      );
    });

    test("re-exécute toutes les 24h après la première passe", async () => {
      crons.startSnapshotRetentionCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
    });
  });

  // ── startPickupTokenCleanupCron ─────────────────────────────────────────
  describe('startPickupTokenCleanupCron', () => {
    test('purge les deux tables de tokens éphémères après 5 minutes', async () => {
      // setTimeout(run, 5min) ET setInterval(run, 5min) partagent le même délai :
      // les deux se déclenchent au même tick à t=5min, donc run() s'exécute 2 fois
      // (4 requêtes DB au total). Comportement réel du code, pas une approximation.
      mockDbQuery.mockResolvedValue({ rowCount: 2 });
      crons.startPickupTokenCleanupCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(4);
      const queries = mockDbQuery.mock.calls.map(c => c[0]);
      expect(queries.some(q => q.includes('pickup_print_tokens'))).toBe(true);
      expect(queries.some(q => q.includes('pickup_reveal_codes'))).toBe(true);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 4 }),
        expect.any(String)
      );
    });

    test('erreur sur une des deux requêtes avalée via log.error', async () => {
      mockDbQuery.mockRejectedValue(new Error('timeout'));
      crons.startPickupTokenCleanupCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/pickup token cleanup/i)
      );
    });

    test('se répète toutes les 5 minutes', async () => {
      mockDbQuery.mockResolvedValue({ rowCount: 0 });
      crons.startPickupTokenCleanupCron();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(4); // setTimeout + 1er tick setInterval, même délai
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(6); // +1 tick setInterval seul (2 requêtes)
    });
  });

  // ── startJwtRevocationCleanupCron ───────────────────────────────────────
  describe('startJwtRevocationCleanupCron', () => {
    test('purge revoked_tokens après 10 minutes', async () => {
      mockDbQuery.mockResolvedValue({ rowCount: 5 });
      crons.startJwtRevocationCleanupCron();
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      expect(mockDbQuery.mock.calls[0][0]).toMatch(/DELETE FROM revoked_tokens/);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 5 }),
        expect.any(String)
      );
    });

    test('erreur DB avalée via log.error', async () => {
      mockDbQuery.mockRejectedValue(new Error('conn lost'));
      crons.startJwtRevocationCleanupCron();
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/revoked_tokens/i)
      );
    });

    test('se répète toutes les heures', async () => {
      mockDbQuery.mockResolvedValue({ rowCount: 0 });
      crons.startJwtRevocationCleanupCron();
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
    });
  });

  // ── startBackorderCron ───────────────────────────────────────────────────
  describe('startBackorderCron', () => {
    test('exécute un check initial après 30 secondes', async () => {
      mockProcessBackorderReminders.mockResolvedValue({ processed: 2, sms_sent: 2 });
      crons.startBackorderCron({ processBackorderReminders: mockProcessBackorderReminders });
      await jest.advanceTimersByTimeAsync(30 * 1000);
      expect(mockProcessBackorderReminders).toHaveBeenCalledTimes(1);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ processed: 2 }),
        expect.stringMatching(/Initial backorder/)
      );
    });

    test('ne logue pas le check initial si processed = 0', async () => {
      mockProcessBackorderReminders.mockResolvedValue({ processed: 0 });
      crons.startBackorderCron({ processBackorderReminders: mockProcessBackorderReminders });
      await jest.advanceTimersByTimeAsync(30 * 1000);
      expect(mockLog.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ processed: expect.anything() }),
        expect.stringMatching(/Initial backorder/)
      );
    });

    test('check initial : erreur avalée via log.error', async () => {
      mockProcessBackorderReminders.mockRejectedValue(new Error('sms provider down'));
      crons.startBackorderCron({ processBackorderReminders: mockProcessBackorderReminders });
      await jest.advanceTimersByTimeAsync(30 * 1000);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Initial backorder/)
      );
    });

    test('re-exécute toutes les 6h après le check initial', async () => {
      mockProcessBackorderReminders.mockResolvedValue({ processed: 0 });
      crons.startBackorderCron({ processBackorderReminders: mockProcessBackorderReminders });
      await jest.advanceTimersByTimeAsync(30 * 1000);
      expect(mockProcessBackorderReminders).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      expect(mockProcessBackorderReminders).toHaveBeenCalledTimes(2);
    });

    test('erreur dans le cron périodique avalée via log.error, sans bloquer le prochain run', async () => {
      mockProcessBackorderReminders
        .mockResolvedValueOnce({ processed: 0 }) // check initial
        .mockRejectedValueOnce(new Error('boom')) // 1er run périodique
        .mockResolvedValueOnce({ processed: 1 }); // 2e run périodique
      crons.startBackorderCron({ processBackorderReminders: mockProcessBackorderReminders });
      await jest.advanceTimersByTimeAsync(30 * 1000);
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Backorder check failed/)
      );
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      expect(mockProcessBackorderReminders).toHaveBeenCalledTimes(3);
    });

    test('le garde-fou backorderCronRunning évite le chevauchement de deux runs périodiques', async () => {
      let resolveFirst;
      mockProcessBackorderReminders
        .mockResolvedValueOnce({ processed: 0 }) // check initial (30s)
        .mockImplementationOnce(() => new Promise(res => { resolveFirst = res; })) // 1er run périodique, reste pending
        .mockResolvedValueOnce({ processed: 5 }); // 3e run

      crons.startBackorderCron({ processBackorderReminders: mockProcessBackorderReminders });
      await jest.advanceTimersByTimeAsync(30 * 1000); // check initial
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); // 1er run périodique démarre, reste pending
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); // 2e tick pendant que le 1er tourne encore
      expect(mockProcessBackorderReminders).toHaveBeenCalledTimes(2); // check initial + 1er run seulement, le 2e tick a été sauté

      resolveFirst({ processed: 0 });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); // 3e tick, le garde-fou est relâché
      expect(mockProcessBackorderReminders).toHaveBeenCalledTimes(3);
    });
  });

  // ── startCashRelaisCron ──────────────────────────────────────────────────
  describe('startCashRelaisCron', () => {
    const deps = () => ({
      processCashRelaisReminders: mockProcessCashRelaisReminders,
      processBackorderReminders: mockProcessBackorderReminders,
      getRuleNumber: mockGetRuleNumber,
    });

    test("utilise l'intervalle retourné par getRuleNumber", async () => {
      mockGetRuleNumber.mockResolvedValue(30); // 30 min au lieu du défaut 60
      crons.startCashRelaisCron(deps());
      await jest.advanceTimersByTimeAsync(0); // laisse l'IIFE async résoudre getRuleNumber
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(mockProcessCashRelaisReminders).toHaveBeenCalledTimes(1);
    });

    test('fallback 60 min si getRuleNumber échoue', async () => {
      mockGetRuleNumber.mockRejectedValue(new Error('rule not found'));
      crons.startCashRelaisCron(deps());
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(59 * 60 * 1000);
      expect(mockProcessCashRelaisReminders).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1 * 60 * 1000);
      expect(mockProcessCashRelaisReminders).toHaveBeenCalledTimes(1);
    });

    test('auto-confirme les propositions inventaire toutes les 30 minutes', async () => {
      mockAutoConfirmExpired.mockResolvedValue({ auto_confirmed: 4 });
      crons.startCashRelaisCron(deps());
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(mockAutoConfirmExpired).toHaveBeenCalledTimes(1);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.objectContaining({ auto_confirmed: 4 }),
        expect.stringMatching(/auto-confirmed/i)
      );
    });

    test('erreur autoConfirmExpired avalée silencieusement (non-fatal)', async () => {
      mockAutoConfirmExpired.mockRejectedValue(new Error('inventory service down'));
      crons.startCashRelaisCron(deps());
      await expect(jest.advanceTimersByTimeAsync(30 * 60 * 1000 + 100)).resolves.not.toThrow();
    });

    test('erreur processCashRelaisReminders avalée via log.error', async () => {
      mockProcessCashRelaisReminders.mockRejectedValue(new Error('reminder failed'));
      crons.startCashRelaisCron(deps());
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringMatching(/Cash reminder cron failed/)
      );
    });

    test('le garde-fou cronRunning évite le chevauchement de deux runs', async () => {
      let resolveFirst;
      mockProcessCashRelaisReminders
        .mockImplementationOnce(() => new Promise(res => { resolveFirst = res; }))
        .mockImplementationOnce(() => Promise.resolve());

      crons.startCashRelaisCron(deps());
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // 1er run démarre, reste pending
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // 2e tick pendant que le 1er tourne encore
      expect(mockProcessCashRelaisReminders).toHaveBeenCalledTimes(1); // le 2e a été sauté

      resolveFirst();
      await Promise.resolve(); // laisse le finally s'exécuter
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000); // 3e tick, le garde-fou est relâché
      expect(mockProcessCashRelaisReminders).toHaveBeenCalledTimes(2);
    });
  });

  // ── startOperationalCrons ────────────────────────────────────────────────
  describe('startOperationalCrons', () => {
    test('câble tous les sous-crons — au moins un appel de chaque service dépendant', async () => {
      mockGetRuleNumber.mockResolvedValue(60);
      crons.startOperationalCrons();

      await jest.advanceTimersByTimeAsync(0); // résout l'IIFE de startCashRelaisCron

      // Snapshot retention (5 min)
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockDbQuery).toHaveBeenCalled();

      // Backorder initial check (30s, déjà couvert par les 5 min ci-dessus)
      expect(mockProcessBackorderReminders).toHaveBeenCalled();

      // Pickup token cleanup (déjà couvert par les 5 min ci-dessus)
      // JWT revocation cleanup (10 min)
      await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

      // Cash relais reminder (60 min par défaut)
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(mockProcessCashRelaisReminders).toHaveBeenCalled();
      expect(mockAutoConfirmExpired).toHaveBeenCalled();
    });

    test('expose bien toutes les fonctions individuelles pour tests/monitoring ciblés', () => {
      expect(typeof crons.startOperationalCrons).toBe('function');
      expect(typeof crons.startCashRelaisCron).toBe('function');
      expect(typeof crons.startBackorderCron).toBe('function');
      expect(typeof crons.startSnapshotRetentionCron).toBe('function');
      expect(typeof crons.startPickupTokenCleanupCron).toBe('function');
      expect(typeof crons.startJwtRevocationCleanupCron).toBe('function');
    });
  });
});
