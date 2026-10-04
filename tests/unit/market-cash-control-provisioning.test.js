'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs'); const path=require('path');
const ROOT=path.join(__dirname,'..','..');

describe('cash policy provisioning',()=>{
  test('central initialization is provisioning-only and audited without delegated authority',()=>{
    const s=fs.readFileSync(path.join(ROOT,'services','market-cash-control-policy-service.js'),'utf8');
    expect(s).toMatch(/initializeProvisioningCashPolicy/);
    expect(s).toMatch(/lifecycle_status !== 'PROVISIONING'/);
    expect(s).toMatch(/CASH_CONTROL_POLICY_PROVISIONED/);
    expect(s).toMatch(/updated_by_membership_id\)\s*VALUES[\s\S]*NULL/);
  });
});
