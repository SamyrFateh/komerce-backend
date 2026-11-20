/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/css/hub-workstation.css'),'utf8');

describe('Hub — navigation Direction et commentaire d’étape terminée',()=>{
  test('la Direction dispose de toute la largeur, sans réduire le Kanban',()=>{
    expect(css).toContain('[data-hub-active-branch="direction"] .hlc-director-body');
    expect(css).toContain('max-height:none;');
    expect(css).toContain('overflow:visible;');
    expect(css).toContain('.kmc-hub-app-branch[data-hub-branch="direction"]');
  });
  test('la publication reste visible sur étape grisée, avec focus clavier',()=>{
    expect(css).toContain('.kmc-hub-board-menu-action.is-comment');
    expect(css).toContain('is-comment:focus-visible');
    expect(css).toContain('background:#edf7fd');
  });
  test('les trois onglets restent utilisables à 390 px',()=>{
    expect(css).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');
    expect(css).toContain('.kmc-hub-app .kmc-hub-app-branch-copy small {display:none;}');
  });
});
