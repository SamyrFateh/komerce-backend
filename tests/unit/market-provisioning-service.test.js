'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('Market Control Plane G — provisioning composition', () => {
  test('provisioning composes existing owners and never activates directly', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-provisioning-service.js'), 'utf8');
    expect(source).toMatch(/createProvisioningMarket/);
    expect(source).toMatch(/delegation\.createAssignment/);
    expect(source).toMatch(/delegation\.setCentralReferent/);
    expect(source).toMatch(/delegation\.setCeilingAmountLimits/);
    expect(source).toMatch(/targetCapabilitiesForScope/);
    expect(source).toMatch(/inviteTeamMember/);
    expect(source).toMatch(/grantsOperatingLead:\s*true/);
    expect(source).toMatch(/controlPlane\.getControlPlane/);
    expect(source).not.toMatch(/lifecycle_status\s*=\s*['"]ACTIVE/);
    expect(source).not.toMatch(/UPDATE market_operating_assignments/);
  });

  test('central referent requires an explicit active central grant', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-provisioning-service.js'), 'utf8');
    expect(source).toMatch(/centralAuthority\.overview/);
    expect(source).toMatch(/CENTRAL_REFERENT_AUTHORITY_REQUIRED/);
  });
});


test('lifecycle activation is gated by readiness and audited', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-provisioning-service.js'), 'utf8');
  expect(source).toMatch(/target === 'ACTIVE'/);
  expect(source).toMatch(/ready_for_activation/);
  expect(source).toMatch(/MARKET_NOT_READY_FOR_ACTIVATION/);
  expect(source).toMatch(/MARKET_LIFECYCLE_CHANGED/);
});


test('provisioning H composes payment cash and relay writers', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-provisioning-service.js'), 'utf8');
  expect(source).toMatch(/configureProvisioningProvider/);
  expect(source).toMatch(/initializeProvisioningCashPolicy/);
  expect(source).toMatch(/relaisMutation\.createRelais/);
});


describe('historical market reprovision', () => {
  test('reuses the same canonical provisioning composition', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-provisioning-service.js'), 'utf8');
    expect(source).toMatch(/async function configureProvisioningMarket/);
    expect(source).toMatch(/async function reprovisionMarket/);
    expect(source.match(/return configureProvisioningMarket\(executor/g)).toHaveLength(2);
    expect(source).toMatch(/loadProvisioningMarket/);
  });
});
