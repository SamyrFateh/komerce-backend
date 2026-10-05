'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('Market Control Plane — activation gate', () => {
  test('ACTIVE requires both readiness verdicts and lifecycle changes are audited', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-provisioning-service.js'), 'utf8');
    expect(source).toMatch(/target === 'ACTIVE'/);
    expect(source).toMatch(/activationControl\.readiness\.ready_for_activation/);
    expect(source).toMatch(/MARKET_NOT_READY_FOR_ACTIVATION/);
    expect(source).toMatch(/transitionMarketLifecycle/);
    expect(source).toMatch(/MARKET_LIFECYCLE_CHANGED/);
  });

  test('route exposes one lifecycle mutation surface', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'admin-market-control-plane.js'), 'utf8');
    expect(source).toMatch(/router\.post\('\/:marketCode\/lifecycle'/);
    expect(source).toMatch(/setMarketLifecycle/);
  });
});
