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
    const renderStart=SRC.indexOf('function render(rootNode');
    const renderSource=SRC.slice(renderStart);
    const attention=renderSource.indexOf('header.appendChild(renderControlHealthSummary');
    const hero=renderSource.indexOf('dashboard.appendChild(header)');
    const primary=renderSource.indexOf('dashboard.appendChild(chain.section)');
    expect(renderStart).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThanOrEqual(0);
    expect(hero).toBeGreaterThan(attention);
    expect(primary).toBeGreaterThan(hero);
    expect(SRC).not.toContain("data-dashboard-role', 'secondary");
    expect(SRC).not.toContain("cardSection(doc, 'File d’exécution'");
    expect(SRC).not.toContain("cardSection(doc, 'Approfondir'");
    expect(SRC).not.toContain("cardSection(doc, 'Colis en retard critique'");
  });
});
