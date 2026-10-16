'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname,'../../migrations/295_customs_financial_change_audit.sql'),'utf8');
describe('customs financial audit migration',()=>{
  test('writes before/after snapshots within source update transaction',()=>{
    expect(sql).toMatch(/AFTER UPDATE OF customs_paid_kmf, freight_kmf, allocation_method, allocation_config/);
    expect(sql).toMatch(/old_fin IS DISTINCT FROM new_fin/);
    expect(sql).toMatch(/old_values, new_values/);
  });
  test('stores optional actor and reason without fabricating a value',()=>{
    expect(sql).toMatch(/current_setting\('komerce.actor_id', true\)/);
    expect(sql).toMatch(/current_setting\('komerce.change_reason', true\)/);
  });
  test('never permits UPDATE or DELETE of audit rows',()=>{
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON customs_shipment_financial_audit/);
    expect(sql).toMatch(/append-only/);
  });
});
