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

test('Hub exécution : header compact et labels de réception lisibles sans changer Relais', () => {
  expect(css).toContain('body.kmc-shell-v4 .kmc-operations-workspace[data-workspace-mode="execution"] > .kmc-workspace-header');
  expect(css).toContain('.kmc-workspace-receive-field-label');
  expect(css).toContain('.kmc-workspace-receive-field-label[hidden] { display: none; }');
  expect(css).toContain('.kmc-workspace-receive-qty');
  expect(css).toContain('min-height: 40px');
});

test('Hub UX : les ateliers visibles ne peuvent agrandir la grille desktop ou mobile', () => {
  const scoped = '.kmc-operations-workspace[data-workspace-mode="execution"]';
  expect(css).toContain(scoped + ' {\n  grid-template-columns: minmax(0, 1fr);');
  expect(css).toContain(scoped + ' [data-hub-physical-details] {\n  width: 100%;');
  expect(css).toContain('overflow: clip;');
  expect(css).toContain(scoped + ' [data-hub-physical-details] .kmc-workspace-table-wrap {');
  expect(css).toContain('overflow-x: auto;');
});

test('V3 desktop : tableau dense et barre de validation, styles limités à la réception V3',()=>{
 expect(css).toContain('[data-hub-quality-v3] .kmc-quality-v3-table');
 expect(css).toContain('table-layout:fixed');
 expect(css).toContain('padding:7px 6px');
 expect(css).toContain('[data-hub-quality-v3] .kmc-quality-v3-footer');
 expect(css).toContain('.kmc-quality-v3-qty[hidden] { display:none; }');
});

test('C1 : tableau COMBOX borné et fiche d’action unique dans le poste',()=>{
  expect(css).toContain('.kmc-hub-po-v8-actions .kmc-hub-workshop-table');
  expect(css).toContain('max-height: min(32vh,300px);overflow:auto');
  expect(css).toContain('.kmc-hub-po-v8-actions .kmc-hub-workshop-table thead th {position:sticky');
  expect(css).toContain('.kmc-hub-po-v8-actions .kmc-hub-workshop-action[hidden] {display:none;}');
});

test('C2 : actions de départ sur une ligne et tableau dimensionné',()=>{
 expect(css).toContain('.kmc-hub-po-v8-actions .kmc-workshop-inline-actions {display:flex');
 expect(css).toContain('.kmc-hub-po-v8-actions .kmc-hub-departure-table th:last-child {width:18%;}');
});
