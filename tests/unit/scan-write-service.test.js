'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  recordHubPreparationScan,
  recordQrCollectionScan,
  detachUserFromScans,
} = require('../../services/scan-write-service');

describe('scan-write-service', () => {
  test('recordHubPreparationScan écrit via l\'executor fourni', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await recordHubPreparationScan(executor, {
      orderId: 'order-1',
      scannedBy: 'user-1',
      notes: 'Préparation démarrée par hub',
      scanCode: 'HUB-PREP-ORDER1',
    });

    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('INSERT INTO scans');
    expect(executor.query.mock.calls[0][0]).toContain("'preparation'");
    expect(executor.query.mock.calls[0][1]).toEqual([
      'order-1',
      'user-1',
      'Préparation démarrée par hub',
      'HUB-PREP-ORDER1',
    ]);
  });

  test('recordQrCollectionScan conserve RETURNING id et le même executor', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'scan-1' }], rowCount: 1 }),
    };

    const scan = await recordQrCollectionScan(executor, {
      orderId: 'order-1',
      scannedBy: 'user-1',
      location: 'Relais Moroni',
      scanCode: 'QR-ABCDEF12',
    });

    expect(scan).toEqual({ id: 'scan-1' });
    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('RETURNING id');
    expect(executor.query.mock.calls[0][1]).toEqual([
      'order-1',
      'user-1',
      'Relais Moroni',
      'QR-ABCDEF12',
    ]);
  });

  test('detachUserFromScans nullifie scanned_by sans supprimer les scans', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 2 }) };

    await detachUserFromScans(executor, 'user-1');

    expect(executor.query).toHaveBeenCalledWith(
      'UPDATE scans SET scanned_by = NULL WHERE scanned_by = $1::uuid',
      ['user-1']
    );
  });

  test('refuse un executor sans query', async () => {
    await expect(
      recordHubPreparationScan({}, {
        orderId: 'order-1', scannedBy: 'user-1', notes: '', scanCode: 'x',
      })
    ).rejects.toThrow(/requires an executor/);
  });
});
