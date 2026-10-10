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

test('les liens du Pilotage vers fiches 360 / PO portent le retour vers le Pilotage ; plus de filtres ignorés', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/pilotage-decision.js'), 'utf8');
  expect(src).toContain("nav.withEntityReturnTo(href, '/admin/pilotage', 'Retour au pilotage')");
  expect(src).toContain("href: withReturn(row.href || '/admin/operations#operations-control-chain')");
  expect(src).toContain("href: withReturn(projected.href || '/admin/action-center')");
  expect(src).not.toContain('cost_status=');
  expect(src).toContain("'/admin/finance#finance-incomplete-costs'");
});
