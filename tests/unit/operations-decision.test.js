'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','operations-decision.js'),'utf8');

describe('operations-decision visual hierarchy contract',()=>{
  test('declares hero attention primary secondary roles in canonical order',()=>{
    expect(SRC).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    const hero=SRC.indexOf("data-dashboard-role', 'hero");
    const attention=SRC.indexOf("data-dashboard-role', 'attention");
    const primary=SRC.indexOf("data-dashboard-role', 'primary");
    const secondary=SRC.indexOf("data-dashboard-role', 'secondary");
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    expect(secondary).toBeGreaterThan(primary);
  });
});
