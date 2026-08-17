'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  createHubParcel,
  createAutoPreparedParcel,
  setParcelWeight,
  appendParcelShipmentInfo,
  markCustomsCleared,
  markBackorderReminderSent,
} = require('../../services/parcel-mutation-service');

describe('parcel-mutation-service', () => {
  test('createHubParcel preserves secured insert and returns parcel', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'p1' }] }),
    };

    const parcel = await createHubParcel(executor, {
      reference: 'P-1',
      externalCode: 'EXT-1',
      sealCode: 'SEAL-1',
      orderId: 'o1',
      type: 'standard',
      notes: 'note',
    });

    expect(parcel).toEqual({ id: 'p1' });
    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('INSERT INTO parcels');
    expect(executor.query.mock.calls[0][0]).toContain('external_code');
    expect(executor.query.mock.calls[0][1]).toEqual([
      'P-1', 'EXT-1', 'SEAL-1', 'o1', 'standard', 'note',
    ]);
  });

  test('createAutoPreparedParcel preserves caller executor and standard draft semantics', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'p2' }] }),
    };

    const parcel = await createAutoPreparedParcel(executor, {
      reference: 'P-2',
      externalCode: null,
      sealCode: null,
      orderId: 'o2',
      notes: 'auto',
    });

    expect(parcel).toEqual({ id: 'p2' });
    expect(executor.query.mock.calls[0][0]).toContain("'standard', 'draft'");
    expect(executor.query.mock.calls[0][1]).toEqual(['P-2', 'o2', 'auto']);
  });

  test('setParcelWeight preserves exact update params', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    await setParcelWeight(executor, { parcelId: 'p1', weightKg: 12.34 });
    expect(executor.query).toHaveBeenCalledWith(
      'UPDATE parcels SET weight_kg = $1 WHERE id = $2',
      [12.34, 'p1']
    );
  });

  test('appendParcelShipmentInfo preserves shipped_at and notes append', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    await appendParcelShipmentInfo(executor, { parcelId: 'p1', note: ' / bateau' });
    expect(executor.query.mock.calls[0][0]).toContain('shipped_at = NOW()');
    expect(executor.query.mock.calls[0][0]).toContain("COALESCE(notes, '') || $1");
    expect(executor.query.mock.calls[0][1]).toEqual([' / bateau', 'p1']);
  });

  test('markCustomsCleared preserves conditional clearance update', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 2 }) };
    await markCustomsCleared(executor, { parcelIds: ['p1', 'p2'], notes: 'ok' });
    expect(executor.query.mock.calls[0][0]).toContain('customs_cleared_at IS NULL');
    expect(executor.query.mock.calls[0][1]).toEqual([['p1', 'p2'], 'ok']);
  });

  test('markBackorderReminderSent preserves reminder update', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    await markBackorderReminderSent(executor, 'p1');
    expect(executor.query).toHaveBeenCalledWith(
      `UPDATE parcels SET backorder_reminder_sent = TRUE, updated_at = NOW()\n     WHERE id = $1`,
      ['p1']
    );
  });

  test('rejects executor without query', async () => {
    await expect(
      setParcelWeight({}, { parcelId: 'p1', weightKg: 1 })
    ).rejects.toThrow(/requires an executor/);
  });
});
