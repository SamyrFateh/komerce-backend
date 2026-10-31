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
  expect(source).toContain("'Achats fournisseurs'");
  expect(source).toContain("'Suivez les achats fournisseurs en cours et retrouvez les commandes terminées.'");
  expect(source).toContain('Lignes à acheter');
  expect(source).toContain('Sélectionnez les lignes d’un même fournisseur puis préparez la commande.');
});

test('les trois onglets PO expriment leur rôle métier sans modifier les clés de statut', () => {
  expect(source).toContain(`[['prepare', "Ordre d'Achat à envoyer"], ['ongoing', "Ordre d'Achat en Cours"], ['history', "Ordre d'Achat terminés"]]`);
  expect(source).toContain("activeStatuses = { prepare: ['draft'], ongoing: ['notified', 'confirmed'], history: ['hub_received', 'cancelled'] }");
});

test('l\'en-tête du workspace porte le rôle hero (cadre et illustration communs aux overviews)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/purchasing-workspace.js'), 'utf8');
  expect(src).toContain("header.setAttribute('data-dashboard-role', 'hero')");
});

test('Achats : le nom du fournisseur ouvre la fiche Fournisseur 360 (admin) avec retour vers les achats', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/purchasing-workspace.js'), 'utf8');
  expect(src).toContain("context.user.role === 'admin'");
  expect(src).toContain("nav.withEntityReturnTo(`/admin/suppliers/${encodeURIComponent(group.supplier_id)}`, nav.currentReturnTarget(null), 'Retour aux achats')");
});
