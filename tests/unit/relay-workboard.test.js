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