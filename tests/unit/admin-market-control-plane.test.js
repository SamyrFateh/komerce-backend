'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'routes', 'admin-market-control-plane.js'),
  'utf8'
);

describe('admin-market-control-plane lifecycle route', () => {
  test('exposes the protected lifecycle mutation through setMarketLifecycle', () => {
    expect(source).toMatch(/router\.post\('\/:marketCode\/lifecycle', \.\.\.centralAdmin/);
    expect(source).toMatch(/setMarketLifecycle/);
  });
});

describe('mandat : route de statut et projection de sortie (D2)', () => {
  test('POST assignment/status et GET exit-readiness sont admin central et passent par les services', () => {
    expect(source).toMatch(/router\.post\('\/:marketCode\/assignment\/status', \.\.\.centralAdmin/);
    expect(source).toMatch(/setAssignmentLifecycle/);
    expect(source).toMatch(/router\.get\('\/:marketCode\/exit-readiness', \.\.\.centralAdmin/);
    expect(source).toContain('controlPlane.getExitReadiness(db, req.params.marketCode)');
  });
});
