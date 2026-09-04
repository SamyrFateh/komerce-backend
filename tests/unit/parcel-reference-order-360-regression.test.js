'use strict';

const fs = require('fs');
const path = require('path');

test('order 360 keeps tracking_number compatibility from parcels.reference', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'order-360.js'), 'utf8');
  expect(source).toContain('p.reference AS tracking_number');
  expect(source).not.toContain('p.tracking_number');
});
