'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','purchasing-workspace.js'),'utf8');

test('Achats fournisseurs garde une vue d’ensemble centrée sur les achats à traiter',()=>{
  expect(source).toContain("data-workspace-kind', 'purchasing");
  expect(source).toContain("'ACHATS FOURNISSEURS'");
  expect(source).toContain("'Achats à traiter'");
  expect(source).toContain("'Voir ce qui doit être commandé ou confirmé auprès des fournisseurs.'");
  expect(source).toContain("'Lignes à acheter'");
  expect(source).toContain("'Sélectionnez les lignes d’un même fournisseur puis préparez la commande.'");
});
