'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sourcing = require('../../public/dashboards/canonical/js/sourcing-workspace');
const root = path.resolve(__dirname, '../..');
const load = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Sourcing : une source sans prix ou devise fiable appelle seulement une correction fournisseur', () => {
  expect(sourcing.sourcingRemedy({state:'raw_imported', purchase_price:null, currency:'AED'}))
    .toMatchObject({key:'update-candidate'});
  expect(sourcing.sourcingRemedy({state:'raw_imported', purchase_price:10, currency:'unknown'}))
    .toMatchObject({key:'update-candidate'});
});

test('Sourcing : un candidat valide mais jamais contrôlé peut être contrôlé dans Sourcing', () => {
  expect(sourcing.sourcingRemedy({state:'raw_imported',purchase_price:10,currency:'AED'}))
    .toMatchObject({key:'scan-candidate'});
});

test('Sourcing : un candidat scanné et complet ne crée aucune fausse anomalie source', () => {
  const row={state:'scanned',scan_at:'2026-10-31T11:00:00Z',
    scan_result:{sourcing_decision:'TEST'},purchase_price:10,currency:'AED'};
  expect(sourcing.sourcingRemedy(row)).toBeNull();
  expect(sourcing.nextCandidateAction(row)).toMatchObject({key:'view-catalog'});
});

test('Sourcing : décisions définitives, quarantaine et exclusion ne sont pas des corrections source', () => {
  for (const state of ['imported_to_catalog','rejected','archived','quarantined']) {
    expect(sourcing.sourcingRemedy({state,purchase_price:10,currency:'AED'})).toBeNull();
  }
  expect(sourcing.sourcingRemedy({state:'scanned',purchase_price:10,currency:'AED',
    scan_result:{sourcing_decision:'EXCLUDED'}})).toBeNull();
});

test('Sourcing : trois rubriques et aucune classification produit dupliquée', () => {
  const s=load('public/dashboards/canonical/js/sourcing-workspace.js');
  expect(s).toContain("label:'Sources & imports'");
  expect(s).toContain("label:'Exceptions source'");
  expect(s).toContain("label:'Fournisseurs'");
  expect(s).not.toContain("const classify = makeButton(doc, 'Classer'");
  expect(s).not.toContain("'Découvrir 20 '");
  expect(s).toContain("panel.setAttribute('role','tabpanel')");
});

test('Catalogue global maître : raffinerie sans file humaine ni préparation au montage', () => {
  const s=load('public/dashboards/canonical/js/catalog-workspace.js');
  expect(s).toContain('renderRefineryMonitoring(rootNode, ui, doc, payload)');
  expect(s).not.toContain('function renderApproval(');
  expect(s).not.toContain('function renderRefineryCoverage(');
  expect(s).not.toContain('scheduleAutoFrenchPreparation(context, payload);');
  expect(s).toContain("get('diagnostic') === '1'");
  expect(s).toContain('Rechercher cette référence dans le Catalogue');
});

test('Shell : une seule navigation Catalogue global et un Catalogue pays distinct', () => {
  const s=load('public/dashboards/canonical/js/navigation-policy-v4.js');
  expect(s).not.toContain("id: 'workspace-refinery'");
  expect(s).toContain("id: 'workspace-catalog', label: 'Catalogue global'");
  expect(s).toContain("id: 'market-catalog', label: 'Catalogue pays'");
});

test('Assets des écrans Catalogue/Sourcing toujours référencés avec versions', () => {
  const html=load('public/dashboards/canonical/index.html');
  expect(html).toMatch(/sourcing-workspace\.js\?v=/);
  expect(html).toMatch(/catalog-workspace\.js\?v=/);
});
