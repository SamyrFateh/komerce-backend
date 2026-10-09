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
  test('keeps Operations to Hero → health recap → primary chain only',()=>{
    expect(SRC).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    const hero=SRC.indexOf("data-dashboard-role', 'hero");
    const attention=SRC.indexOf("data-dashboard-role', 'attention");
    const primary=SRC.indexOf("data-dashboard-role', 'primary");
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    expect(SRC).not.toContain("data-dashboard-role', 'secondary");
    expect(SRC).not.toContain("cardSection(doc, 'File d’exécution'");
    expect(SRC).not.toContain("cardSection(doc, 'Approfondir'");
    expect(SRC).not.toContain("cardSection(doc, 'Colis en retard critique'");
  });
});
