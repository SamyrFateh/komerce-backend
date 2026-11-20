/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/css/relay-workboard.css'),'utf8');

describe('Relais : guide du prochain geste',()=>{
  test('le guide reste scindé de la mutation physique et réservé au poste Relais',()=>{
    expect(css).toContain('.kmc-operations-workspace[data-workspace-mode="relay-execution"] .kmc-relay-guided-task {');
    expect(css).toContain('.kmc-relay-guided-title');
    expect(css).toContain('.kmc-relay-guided-hint');
    expect(css).toContain('.kmc-relay-guided-volume');
  });
  test('une seule colonne sur viewport étroit sans débordement imposé',()=>{
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(css).toContain('@media(max-width:760px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('max-width: 100%;');
  });
});
