'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','shipping-customs-workspace.js'),'utf8');

test('Expéditions & Douane garde seulement Hero + décisions + Transit + Douane',()=>{
  expect(source).toContain("data-workspace-kind', 'shipping-customs");
  expect(source).toContain("'EXPÉDITIONS & DOUANE'");
  expect(source).toContain("'Flux international'");
  const start=source.indexOf('function renderPayload');
  const renderSource=source.slice(start);
  expect(renderSource).not.toContain('renderSignals(rootNode');
  expect(renderSource).not.toContain('renderHistory(rootNode');
  expect(renderSource).toContain('renderTransit(rootNode');
  expect(renderSource).toContain('renderCustoms(rootNode');
});

test('l\'en-tête du workspace porte le rôle hero (cadre et illustration communs aux overviews)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/shipping-customs-workspace.js'), 'utf8');
  expect(src).toContain("header.setAttribute('data-dashboard-role', 'hero')");
});

test('la déclaration douane passe par un formulaire intégré (ni prompt ni confirm natif) et propose la correction', () => {
  const start = source.indexOf('function renderCustoms');
  const customs = source.slice(start, source.indexOf('function renderHistory'));
  expect(customs).toContain("openCustomsForm(context, doc, formHost, row, 'declare')");
  expect(customs).toContain("openCustomsForm(context, doc, formHost, row, 'correct')");
  expect(customs).not.toMatch(/Montant douane payé pour/);
  const formSource = source.slice(source.indexOf('function openCustomsForm'), start);
  expect(formSource).not.toMatch(/\b(prompt|confirm)\(/);
  expect(formSource).toContain('customs/shipments/${ref}/declare');
  expect(formSource).toContain('customs/shipments/${ref}/update');
});

test('le formulaire douane est stylé dans canonical-legacy-theme-v1.css (unité, erreur, boutons distincts, mobile)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css', 'canonical-legacy-theme-v1.css'), 'utf8');
  ['.kmc-customs-form {', '.kmc-customs-unit', '.kmc-customs-form-error', '.kmc-customs-form-actions', 'tr.is-highlighted'].forEach(sel => expect(css).toContain(sel));
  expect(css).toMatch(/@media \(max-width: 680px\)\s*\{\s*\.kmc-customs-form/);
});

test('Expéditions & Douane : la colonne Commande ouvre la fiche 360 avec retour, réservée aux rôles autorisés', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/shipping-customs-workspace.js'), 'utf8');
  expect(src).toContain('nav.canOpenEntity360(context.user)');
  expect(src).toContain("nav.withEntityReturnTo(`/admin/orders/${encodeURIComponent(value)}`, nav.currentReturnTarget(null), 'Retour aux expéditions')");
});
