'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs=require('fs');
const path=require('path');

const ROOT=path.join(__dirname,'..','..');
const css=fs.readFileSync(path.join(ROOT,'public/dashboards/canonical/css/operations-control-board-v1.css'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'public/dashboards/canonical/index.html'),'utf8');

describe('Operations logistics control board V1',()=>{
  test('la couche est chargée dans le runtime canonical',()=>{
    expect(html).toContain('/dashboards/canonical/css/operations-control-board-v1.css');
  });

  test('le tableau garde neuf colonnes potentielles et une géométrie de poste opérationnel',()=>{
    expect(css).toMatch(/\.kmc-control-chain\s*\{[^}]*grid-auto-flow:\s*column/s);
    expect(css).toMatch(/grid-auto-columns:\s*minmax\(145px,\s*1fr\)/);
    expect(css).toMatch(/\.kmc-control-stage\s*\{[^}]*min-height:\s*470px/s);
    expect(css).toMatch(/\.kmc-control-chain::before\s*\{[^}]*height:\s*4px/s);
    expect(css).toMatch(/\.kmc-control-stage-icon\s*\{[^}]*width:\s*60px[^}]*height:\s*60px/s);
  });

  test('les cartes commandes distinguent normal, risque, bloqué et inconnu',()=>{
    expect(css).toContain('.kmc-control-order.is-positive');
    expect(css).toContain('.kmc-control-order.is-warning');
    expect(css).toContain('.kmc-control-order.is-critical');
    expect(css).toContain('.kmc-control-order.is-unknown');
  });

  test('le récapitulatif santé reste compact et sémantique',()=>{
    expect(css).toContain('.kmc-control-health-summary');
    expect(css).toContain('.kmc-control-health-summary-item.is-positive');
    expect(css).toContain('.kmc-control-health-summary-item.is-warning');
    expect(css).toContain('.kmc-control-health-summary-item.is-critical');
    expect(css).toContain('.kmc-control-health-summary-item.is-unknown');
  });

  test('le board respecte le thème legacy mesuré',()=>{
    expect(css).toContain('--ocb-paper: #f1f5f9');
    expect(css).toContain('--ocb-card: #ffffff');
    expect(css).toContain('--ocb-line: #e2e8f0');
  });
});


test('les cartes commandes restent compactes et le détail est progressif',()=>{
  expect(css).toMatch(/\.kmc-control-order\s*\{[^}]*min-height:\s*42px/s);
  expect(css).toContain('.kmc-control-order-detail[hidden]');
  expect(css).toContain('.kmc-control-order-focus');
  expect(css).toContain('.kmc-control-order-lineage');
  expect(css).toContain('.kmc-control-order-open');
});


test('la composition Operations suit le mock : hero + pipeline flottant + colonnes sous le rail',()=>{
  expect(css).toContain("operations-logistics-hero.svg");
  expect(css).toMatch(/\.kmc-control-stage::after\s*\{[^}]*top:\s*112px/s);
  expect(css).toMatch(/\.kmc-control-chain::before\s*\{[^}]*height:\s*4px/s);
  expect(css).toMatch(/grid-auto-columns:\s*minmax\(145px,\s*1fr\)/);
  expect(css).toMatch(/\.kmc-control-stage-icon\s*\{[^}]*width:\s*60px[^}]*height:\s*60px/s);
});
