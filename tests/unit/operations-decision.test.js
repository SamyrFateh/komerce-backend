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
    const hero=renderSource.indexOf('dashboard.appendChild(header)');
    const attention=renderSource.indexOf('dashboard.appendChild(renderControlHealthSummary');
    const primary=renderSource.indexOf('dashboard.appendChild(chain.section)');
    expect(renderStart).toBeGreaterThanOrEqual(0);
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    expect(SRC).not.toContain("data-dashboard-role', 'secondary");
    expect(SRC).not.toContain("cardSection(doc, 'File d’exécution'");
    expect(SRC).not.toContain("cardSection(doc, 'Approfondir'");
    expect(SRC).not.toContain("cardSection(doc, 'Colis en retard critique'");
  });
});

test('le Hero Operations porte le kicker LOGISTIQUE (canon visuel)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'LOGISTIQUE'");
  expect(src).not.toContain('KOMERCE · ADMIN CANONICAL');
});
