/**
 * KOMERCE — Tests Unitaires : repair-collective-stock-reservations (P0 shared-cart)
 *
 * Couvre I-SWEEP-4B : garde admin, dry-run (2 listes candidates), mode réel
 * (consume des workspaces avec order, release des workspaces terminés sans
 * order), comptage des échecs et émission d'alerte non-bloquante.
 *
 * Run : npx jest tests/unit/repair-collective-stock-reservations.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockEnsureTable = jest.fn().mockResolvedValue(undefined);
const mockConsumeForWorkspace = jest.fn();
const mockReleaseForWorkspace = jest.fn();
jest.mock('../../services/collective-stock-reservation-service', () => ({
  ensureTable: (...args) => mockEnsureTable(...args),
  consumeForWorkspace: (...args) => mockConsumeForWorkspace(...args),
  releaseForWorkspace: (...args) => mockReleaseForWorkspace(...args),
}));

const { repairCollectiveStockReservations } = require('../../services/repair-collective-stock-reservations');

const adminUser = { id: 'admin-1', role: 'admin' };

describe('repairCollectiveStockReservations', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
    mockEnsureTable.mockClear();
    mockConsumeForWorkspace.mockReset();
    mockReleaseForWorkspace.mockReset();
  });

  test('refuse l\'accès à un non-admin', async () => {
    const result = await repairCollectiveStockReservations({ user: { id: 'u1', role: 'client' } });
    expect(result.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockEnsureTable).not.toHaveBeenCalled();
  });

  test('appelle ensureTable avant toute requête', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await repairCollectiveStockReservations({ user: adminUser });

    expect(mockEnsureTable).toHaveBeenCalledTimes(1);
  });

  test('mode dry-run : retourne les deux listes de candidats sans effet de bord', async () => {
    const consumeCandidates = [{ workspace_id: 'ws-1', order_id: 'o-1', reservations_count: 2 }];
    const releaseCandidates = [{ workspace_id: 'ws-2', order_id: null, reservations_count: 1 }];

    mockDbQuery
      .mockResolvedValueOnce({ rows: consumeCandidates })
      .mockResolvedValueOnce({ rows: releaseCandidates });

    const result = await repairCollectiveStockReservations({ user: adminUser, dryRun: true });

    expect(result.status).toBe(200);
    expect(result.body.dry_run).toBe(true);
    expect(result.body.consume_count).toBe(1);
    expect(result.body.release_count).toBe(1);
    expect(mockConsumeForWorkspace).not.toHaveBeenCalled();
    expect(mockReleaseForWorkspace).not.toHaveBeenCalled();
  });

  test('mode réel : consume et release tous les candidats avec succès', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws-1', order_id: 'o-1' }] })
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws-2', order_id: null }] });

    mockConsumeForWorkspace.mockResolvedValueOnce(undefined);
    mockReleaseForWorkspace.mockResolvedValueOnce(undefined);

    const result = await repairCollectiveStockReservations({ user: adminUser, dryRun: false });

    expect(result.status).toBe(200);
    expect(result.body.consumed_count).toBe(1);
    expect(result.body.released_count).toBe(1);
    expect(result.body.failed_count).toBe(0);
    expect(mockConsumeForWorkspace).toHaveBeenCalledWith('ws-1');
    expect(mockReleaseForWorkspace).toHaveBeenCalledWith('ws-2', 'I-SWEEP-4B repair');
  });

  test('mode réel : status 207 et alerte si un consume échoue', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws-1', order_id: 'o-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({}); // INSERT alerts

    mockConsumeForWorkspace.mockRejectedValueOnce(new Error('consume failed'));

    const result = await repairCollectiveStockReservations({ user: adminUser, dryRun: false });

    expect(result.status).toBe(207);
    expect(result.body.failed_count).toBe(1);
    expect(result.body.failed[0]).toMatchObject({ action: 'consume', workspace_id: 'ws-1', error: 'consume failed' });

    const alertCall = mockDbQuery.mock.calls[2];
    expect(alertCall[0]).toMatch(/INSERT INTO alerts/);
    expect(alertCall[1]).toEqual(expect.arrayContaining(['collective_stock_reservation_repair_failed', 'collective_workspace', 'medium']));
    expect(alertCall[1][4]).toMatch(/consume failed for workspace ws-1/);
  });

  test('mode réel : status 207 et alerte si un release échoue', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws-2', order_id: null }] })
      .mockResolvedValueOnce({}); // INSERT alerts

    mockReleaseForWorkspace.mockRejectedValueOnce(new Error('release failed'));

    const result = await repairCollectiveStockReservations({ user: adminUser, dryRun: false });

    expect(result.status).toBe(207);
    expect(result.body.failed[0]).toMatchObject({ action: 'release', workspace_id: 'ws-2' });
  });

  test('l\'échec d\'insertion d\'alerte ne bloque pas le traitement', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws-1', order_id: 'o-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('alerts insert failed'));

    mockConsumeForWorkspace.mockRejectedValueOnce(new Error('consume failed'));

    const result = await repairCollectiveStockReservations({ user: adminUser, dryRun: false });

    expect(result.status).toBe(207);
    expect(result.body.failed_count).toBe(1);
  });

  test('remainingLimit reste au moins 1 même si consumeCandidates dépasse la limite', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws-1' }, { workspace_id: 'ws-2' }] })
      .mockResolvedValueOnce({ rows: [] });

    await repairCollectiveStockReservations({ user: adminUser, dryRun: true, limit: 1 });

    const secondCallParams = mockDbQuery.mock.calls[1][1];
    expect(secondCallParams[0]).toBeGreaterThanOrEqual(1);
  });
});
