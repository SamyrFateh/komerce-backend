'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','operations-workspace.css'),'utf8');

test('Hub / Relais possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="hub-relay"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #f4fbfa');
});


test('Expéditions & Douane possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="shipping-customs"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #f5f9ff');
});


test('Sourcing possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="sourcing"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #FFFFFF');
});


test('Finance / Comptabilité possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="accounting"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #f6fbf8');
  expect(css).toContain('.kmc-accounting-hero-controls');
});

test('UX-07 — onglets de vue exclusive stylés', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css/operations-workspace.css'), 'utf8');
  expect(css).toContain('.kmc-workspace-tab.is-active');
  expect(css).toContain('.kmc-accounting-hero-controls');
});

test('les tables workspace gardent de vraies cellules (pas de display:grid/flex sur td)', () => {
  const read = f => require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/css', f), 'utf8');
  const ops = read('operations-workspace.css');
  const block = selector => {
    const i = ops.indexOf(selector + ' {');
    return i < 0 ? '' : ops.slice(i, ops.indexOf('}', i));
  };
  expect(block('.kmc-catalog-product-cell')).toContain('display: table-cell');
  expect(block('.kmc-workspace-table td:last-child')).toContain('display: table-cell');
  expect(block('.kmc-workspace-table td:last-child')).not.toMatch(/display:\s*(flex|grid)/);
  expect(block('.kmc-sourcing-candidates-table td:last-child')).not.toMatch(/display:\s*(flex|grid)/);
  expect(ops).toContain('.kmc-workspace-table.kmc-catalog-curation-table');
  expect(ops).not.toMatch(/\.kmc-catalog-curation-table td:nth-child\(1\)[^}]*width:\s*42%/);
  expect(read('catalog-control-tower.css')).not.toMatch(/\.kmc-cbt-table td:first-child \{[^}]*display:\s*grid/);
});
