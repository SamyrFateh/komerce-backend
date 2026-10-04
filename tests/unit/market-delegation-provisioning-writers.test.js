'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('Market Control Plane G — delegation-owned provisioning mutations', () => {
  test('central referent and financial ceilings stay behind delegation writer', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-service.js'), 'utf8');
    expect(source).toMatch(/async function setCentralReferent/);
    expect(source).toMatch(/CENTRAL_REFERENT_ASSIGNED/);
    expect(source).toMatch(/async function setCeilingAmountLimits/);
    expect(source).toMatch(/cr\.amount_bearing=TRUE/);
    expect(source).toMatch(/MARKET_CAPABILITY_LIMITS_INCOMPLETE/);
    expect(source).toMatch(/CEILING_AMOUNT_LIMITS_SET/);
  });
});
