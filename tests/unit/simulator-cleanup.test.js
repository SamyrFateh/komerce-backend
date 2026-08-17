'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const { cleanup } = require('../../services/simulator/cleanup');

describe('simulator cleanup', () => {
  beforeEach(() => jest.clearAllMocks());

  test('supprime uniquement les artefacts simulateur et retourne les compteurs', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 4 });
    await expect(cleanup()).resolves.toEqual({
      deleted: { parcel_items: 3, parcels: 2, scans: 4 },
      errors: [],
    });
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(db.query.mock.calls[0][0]).toContain('DELETE FROM parcel_items');
    expect(db.query.mock.calls[1][0]).toContain('DELETE FROM parcels');
    expect(db.query.mock.calls[2][0]).toContain('DELETE FROM scans');
  });

  test('une erreur DB est rendue visible sans faux succès', async () => {
    db.query.mockRejectedValueOnce(new Error('db-down'));
    await expect(cleanup()).resolves.toEqual({ deleted: {}, errors: ['db-down'] });
  });
});
