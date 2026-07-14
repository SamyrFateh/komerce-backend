/**
 * KOMERCE — Tests Unitaires : repair-collective-ready-to-capture (P0 shared-cart)
 *
 * Couvre I-SWEEP-4A : garde admin, clamp des paramètres, mode dry-run (liste
 * sans effet de bord), mode réel (capture via orchestrator + comptage
 * repaired/failed), et émission d'alerte non-bloquante en cas d'échec.
 *
 * Run : npx jest tests/unit/repair-collective-ready-to-capture.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockCaptureAllAndCreateOrder = jest.fn();
jest.mock('../../services/collective-payment-orchestrator', () => ({
  captureAllAndCreateOrder: (...args) => mockCaptureAllAndCreateOrder(...args),
}));

const { repairCollectiveReadyToCapture } = require('../../services/repair-collective-ready-to-capture');

const adminUser = { id: 'admin-1', role: 'admin' };

describe('repairCollectiveReadyToCapture', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
    mockCaptureAllAndCreateOrder.mockReset();
  });

  test('refuse l\'accès à un non-admin', async () => {
    const result = await repairCollectiveReadyToCapture({ user: { id: 'u1', role: 'client' } });
    expect(result.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('refuse l\'accès si user absent', async () => {
    const result = await repairCollectiveReadyToCapture({});
    expect(result.status).toBe(403);
  });

  test('clamp limit et minAgeMinutes dans les bornes autorisées', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await repairCollectiveReadyToCapture({ user: adminUser, limit: 9999, minAgeMinutes: -5 });

    const [, params] = mockDbQuery.mock.calls[0];
    expect(params[0]).toBe(100); // limit clampé au max
    expect(params[1]).toBe('0'); // minAgeMinutes clampé au plancher (Math.max(0, ...))
  });

  test('mode dry-run : retourne les candidats sans appeler l\'orchestrator', async () => {
    const candidates = [
      { id: 'sess-1', workspace_id: 'ws-1', event_name: 'Anniversaire' },
    ];
    mockDbQuery.mockResolvedValueOnce({ rows: candidates });

    const result = await repairCollectiveReadyToCapture({ user: adminUser, dryRun: true });

    expect(result.status).toBe(200);
    expect(result.body.dry_run).toBe(true);
    expect(result.body.count).toBe(1);
    expect(result.body.candidates).toEqual(candidates);
    expect(mockCaptureAllAndCreateOrder).not.toHaveBeenCalled();
  });

  test('mode réel : capture toutes les sessions avec succès', async () => {
    const candidates = [
      { id: 'sess-1', workspace_id: 'ws-1' },
      { id: 'sess-2', workspace_id: 'ws-2' },
    ];
    mockDbQuery.mockResolvedValueOnce({ rows: candidates });
    mockCaptureAllAndCreateOrder
      .mockResolvedValueOnce({ order_id: 'order-1' })
      .mockResolvedValueOnce({ order_id: 'order-2' });

    const result = await repairCollectiveReadyToCapture({ user: adminUser, dryRun: false });

    expect(result.status).toBe(200);
    expect(result.body.repaired_count).toBe(2);
    expect(result.body.failed_count).toBe(0);
    expect(result.body.repaired).toHaveLength(2);
    expect(mockCaptureAllAndCreateOrder).toHaveBeenCalledTimes(2);
  });

  test('mode réel : status 207 si une capture échoue, et émet une alerte', async () => {
    const candidates = [{ id: 'sess-1', workspace_id: 'ws-1' }];
    mockDbQuery
      .mockResolvedValueOnce({ rows: candidates }) // SELECT candidates
      .mockResolvedValueOnce({}); // INSERT alerts

    mockCaptureAllAndCreateOrder.mockRejectedValueOnce(new Error('capture failed'));

    const result = await repairCollectiveReadyToCapture({ user: adminUser, dryRun: false });

    expect(result.status).toBe(207);
    expect(result.body.repaired_count).toBe(0);
    expect(result.body.failed_count).toBe(1);
    expect(result.body.failed[0].error).toBe('capture failed');

    const alertCall = mockDbQuery.mock.calls[1];
    expect(alertCall[0]).toMatch(/INSERT INTO alerts/);
    expect(alertCall[1]).toEqual(expect.arrayContaining(['collective_repair_ready_to_capture_failed', 'collective_session']));
    expect(alertCall[1][4]).toMatch(/sess-1/);
  });

  test('mode réel : l\'échec de l\'insertion d\'alerte ne bloque pas le résultat', async () => {
    const candidates = [{ id: 'sess-1', workspace_id: 'ws-1' }];
    mockDbQuery
      .mockResolvedValueOnce({ rows: candidates })
      .mockRejectedValueOnce(new Error('alerts insert failed'));

    mockCaptureAllAndCreateOrder.mockRejectedValueOnce(new Error('capture failed'));

    const result = await repairCollectiveReadyToCapture({ user: adminUser, dryRun: false });

    expect(result.status).toBe(207);
    expect(result.body.failed_count).toBe(1);
  });

  test('mode réel : aucun candidat → 200 avec compteurs à zéro', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await repairCollectiveReadyToCapture({ user: adminUser, dryRun: false });

    expect(result.status).toBe(200);
    expect(result.body.scanned).toBe(0);
    expect(result.body.repaired_count).toBe(0);
    expect(result.body.failed_count).toBe(0);
  });
});
