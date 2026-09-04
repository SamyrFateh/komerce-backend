'use strict';

const fs = require('fs');
const path = require('path');

describe('parcel signal reference debt', () => {
  test.todo('signal-service parcel_blocked must stop querying parcels.tracking_number');

  test('remaining drift stays isolated to signal-service until cleanup', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'signal-service.js'), 'utf8');
    expect(source).toContain('p.tracking_number');
  });
});
