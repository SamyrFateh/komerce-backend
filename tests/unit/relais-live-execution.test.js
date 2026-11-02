'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js', f), 'utf8');

test('Relais live · Exécution : mode relay-execution limité aux actions Relais + Cash & dépôts', () => {
  const ws = read('operations-workspace.js');
  expect(ws).toContain("mode === 'relay-execution'");
  expect(ws).toContain("{ id: 'cash', label: 'Cash & dépôts' }");
  expect(ws).toContain('KomerceCanonicalFinanceAccountingWorkspace');
  // Les actions Hub ne sont rendues que dans la vue hub, jamais dans RELAY_LIVE_TABS.
  expect(ws).toMatch(/RELAY_LIVE_TABS = Object\.freeze\(\[\{ id: 'relay'[^\]]*\]\)/);
  expect(ws).not.toMatch(/RELAY_LIVE_TABS = Object\.freeze\(\[[^\]]*'hub'/);
});

test('Relais live expose l’onglet Exécution et app.js route view=execute vers le shell marché', () => {
  expect(read('relay-live.js')).toContain("label:'Exécution'");
  const app = read('app.js');
  expect(app).toContain("surface: 'relais-live-execution'");
  expect(app).toContain("mode: 'relay-execution'");
  expect(read('navigation-policy-v4.js')).toContain("surface === 'relais-live'");
});

test('Finance : accès au seul module Cash & dépôts de Relais live, sans charger la file opérationnelle', () => {
  const ws = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  expect(ws).toContain("options.mode === 'relay-execution' && options.user && options.user.role === 'finance'");
  const branch = ws.slice(ws.indexOf("options.user.role === 'finance'"), ws.indexOf('let currentPayload = null;'));
  expect(branch).not.toContain('endpointFor(marketCode)');
  expect(branch).toContain('KomerceCanonicalFinanceAccountingWorkspace');
});
