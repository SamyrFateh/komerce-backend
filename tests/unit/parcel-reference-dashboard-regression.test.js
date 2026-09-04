'use strict';

const db = require('../../db');
const operations = require('../../services/dashboard-operations');

jest.mock('../../db', () => ({ query: jest.fn() }));

describe('dashboard operations parcel reference regression', () => {
  beforeEach(() => db.query.mockReset());

  test('critical delays query reads the canonical parcel reference', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await operations.getCriticalDelays();

    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('p.reference AS tracking_number');
    expect(sql).not.toContain('p.tracking_number');
  });
});
