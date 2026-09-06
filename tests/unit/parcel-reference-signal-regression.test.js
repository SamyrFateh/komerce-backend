'use strict';

const fs = require('fs');
const path = require('path');

test('signal-service parcel_blocked keeps tracking_number compatibility from parcels.reference', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'signal-service.js'), 'utf8');

  expect(source).toContain('p.reference AS tracking_number');
  expect(source).not.toContain('p.tracking_number');
});
