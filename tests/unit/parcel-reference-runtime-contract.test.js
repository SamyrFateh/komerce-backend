'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('parcel runtime reference contract', () => {
  test('parcel schema owns reference and does not define tracking_number', () => {
    const migration = source('db/migrations/010_parcels_foundation.sql');
    const tableBlock = migration.match(/CREATE TABLE IF NOT EXISTS parcels \([\s\S]*?\n\);/);

    expect(tableBlock).not.toBeNull();
    expect(tableBlock[0]).toMatch(/reference\s+TEXT UNIQUE NOT NULL/);
    expect(tableBlock[0]).not.toMatch(/tracking_number/i);
  });

  test.each([
    'services/dashboard-operations.js',
    'services/order-360.js',
    'services/action-center-workspace.js',
  ])('%s never queries a nonexistent parcels.tracking_number column', relativePath => {
    const runtime = source(relativePath);

    expect(runtime).not.toContain('p.tracking_number');
    expect(runtime).toContain('p.reference AS tracking_number');
  });
});
