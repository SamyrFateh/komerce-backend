'use strict';

const fs = require('fs');
const path = require('path');

test('action center resolves parcel business refs from parcels.reference', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'action-center-workspace.js'), 'utf8');
  expect(source).toContain('p.reference AS tracking_number');
  expect(source).not.toContain('p.tracking_number');
});
