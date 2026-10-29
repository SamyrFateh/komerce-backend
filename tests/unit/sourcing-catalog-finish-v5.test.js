'use strict';
const fs=require('node:fs'),path=require('node:path');
const sourcing=require('../../public/dashboards/canonical/js/sourcing-workspace');
const base=path.resolve(__dirname,'../..');
const load=p=>fs.readFileSync(path.join(base,p),'utf8');
test('Sourcing : un candidat non scanné appelle son contrôle source, pas une publication',()=>{
 expect(sourcing.nextCandidateAction({state:'raw_imported'})).toMatchObject({
  key:'scan-candidate',label:'Scanner le candidat'});
});
test('Sourcing : après scan une vérification du classement est l’action primaire',()=>{
 expect(sourcing.nextCandidateAction({state:'scanned',scan_result:{sourcing_decision:'TEST'}}))
  .toMatchObject({key:'classify-boutique'});
});
test('Sourcing : EXCLUDED ou quarantaine ne peut proposer une remise comme action primaire',()=>{
 expect(sourcing.nextCandidateAction({state:'quarantined'}).key).toBe('update-candidate');
 expect(sourcing.nextCandidateAction({state:'scanned',scan_result:{sourcing_decision:'EXCLUDED'}}).key)
  .toBe('update-candidate');
});
test('Sourcing : remis à la Raffinerie reste consultable en lecture, pas à re-promouvoir',()=>{
 expect(sourcing.nextCandidateAction({state:'imported_to_catalog',product_ref:'KPR-42'}))
  .toMatchObject({key:'view-product'});
});
test('Les 4 rubriques Sourcing utilisent des panneaux avec sélection accessible',()=>{
 const s=load('public/dashboards/canonical/js/sourcing-workspace.js');
 expect(s).toContain("nav.setAttribute('role','tablist')");
 expect(s).toContain("panel.setAttribute('role','tabpanel')");
 expect(s).toContain("context.selectTab(context.focusCandidateRef ? 'candidates' : context.activeTab)");
 expect(s).toContain('kmc-sourcing-row-more-list');
});
test('Catalogue : une référence absente de la projection finalisée est signalée sans dire dépubliée',()=>{
 const s=load('public/dashboards/canonical/js/catalog-workspace.js');
 expect(s).toContain("notice.setAttribute('data-focused-product-result', current ? 'visible' : 'not-in-page')");
 expect(s).toContain('Cette absence ne signifie ni rejet ni dépublication.');
 expect(s).toContain('/admin/workspaces/catalog?view=refinery');
});
test('Assets Sourcing et Catalogue chargés avec révisions cohérentes',()=>{
 const html=load('public/dashboards/canonical/index.html');
 expect(html).toContain('sourcing-finish-v5.css?v=261028-3');
 expect(html).toContain('sourcing-workspace.js?v=261028-3');
 expect(html).toContain('catalog-workspace.js?v=261029-5');
 expect(html).toContain('catalog-workspace-wide-v1.css?v=261029-2');
});
