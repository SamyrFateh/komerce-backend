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
