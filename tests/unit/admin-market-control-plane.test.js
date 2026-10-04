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
