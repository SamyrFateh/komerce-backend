/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/css/relay-workboard.css'),'utf8');

test('Relais : guidage de la file du moment isolé au rôle, disponible sur petits écrans',()=>{
  const scoped='.kmc-operations-workspace[data-workspace-mode="relay-execution"]';
  expect(css).toContain(scoped+' .kmc-relay-next {');
  expect(css).toContain(scoped+' .kmc-relay-next-title {');
  expect(css).toContain(scoped+' .kmc-relay-next-detail {');
  expect(css).toContain('@media (max-width: 650px)');
  expect(css).not.toContain('display:none !important');
});
test('V4 desktop : trois colonnes rétractables, détails natifs sans règle de priorité forcée',()=>{
 const css=require('fs').readFileSync(require('path').join(__dirname,'../../public/dashboards/canonical/css/relay-workboard.css'),'utf8');
 expect(css).toMatch(/\.kmc-relay-v4-board\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 expect(css).toMatch(/\.kmc-relay-v4-card\{[^}]*overflow-wrap:anywhere/);
 const v4=css.slice(css.indexOf('/* V4 :'));
 expect(v4).not.toContain('!important');
});

test('V4 : palette claire du mock, boutons identiques et absence de débordement horizontal des colonnes',()=>{
 const css=require('fs').readFileSync(require('path').join(__dirname,'../../public/dashboards/canonical/css/relay-workboard.css'),'utf8');
 expect(css).toMatch(/\.kmc-relay-v4-lane\{[^}]*background:#e8edf1/);
 expect(css).toMatch(/\.kmc-relay-v4-card\{[^}]*background:white/);
 expect(css).toContain('.kmc-relay-v4-button.is-primary{background:#1765ad');
 expect(css).toMatch(/\.kmc-relay-v4-board\{[^}]*min-width:0/);
});
