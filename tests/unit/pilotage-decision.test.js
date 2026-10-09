'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','pilotage-decision.js'),'utf8');

describe('pilotage-decision visual hierarchy contract',()=>{
  test('keeps Pilotage to hero attention and one primary object only',()=>{
    expect(SRC).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    const renderStart=SRC.indexOf('function render(rootNode');
    const renderSource=SRC.slice(renderStart);
    const hero=renderSource.indexOf("data-dashboard-role', 'hero");
    const attention=renderSource.indexOf("data-dashboard-role', 'attention");
    const primary=renderSource.indexOf("data-dashboard-role', 'primary");
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    expect(renderSource).not.toContain("data-dashboard-role', 'secondary");
    expect(renderSource).not.toContain("cardSection(\n        doc,\n        'Causes structurelles'");
    expect(renderSource).not.toContain("cardSection(\n        doc,\n        'À traiter'");
  });
});
