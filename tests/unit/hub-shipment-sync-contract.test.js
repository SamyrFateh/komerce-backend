'use strict';

const fs = require('fs');
const path = require('path');

describe('Hub shipment success contract (#2441)', () => {
  test('the ship route rejects failed parcel sync before persisting shipment details or responding success', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../routes/hub-dashboard.js'), 'utf8');
    const start = source.indexOf("router.post('/parcels/:id/ship'");
    const end = source.indexOf('const INCIDENT_TYPES', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const route = source.slice(start, end);
    expect(route).toMatch(/const shipmentSync = await safeSyncScanToParcels\(/);
    expect(route).toMatch(/if \(!shipmentSync\.synced\)/);
    expect(route).toContain("code: 'SHIPMENT_SYNC_FAILED'");
    expect(route.indexOf('if (!shipmentSync.synced)')).toBeLessThan(route.indexOf('appendParcelShipmentInfo('));
    expect(route.indexOf('if (!shipmentSync.synced)')).toBeLessThan(route.indexOf('res.json({'));
  });
});
