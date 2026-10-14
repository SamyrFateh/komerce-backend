'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'settings-workspace.js'),
  'utf8'
);

test('les matrices pricing legacy restent forensic read-only dans Paramètres Canonical', () => {
  expect(source).toContain('Lecture seule · matrice legacy retirée.');
  expect(source).toContain('customs_categories.{douane_pct,tva_pct,taxe_add_pct}');
  expect(source).toContain('customs_categories.{default_dim_l_cm,default_dim_w_cm,default_dim_h_cm}');
  expect(source).not.toContain('putSettingsTaxes');
  expect(source).not.toContain('putSettingsDims');
  expect(source).not.toContain('_saveMatrixRow');
  expect(source).not.toContain('sv-matrix-save');
  expect(source).not.toMatch(/pricing-matrices\/taxes\/\$\{[^}]+\}.*method:\s*['"]PUT['"]/s);
  expect(source).not.toMatch(/pricing-matrices\/dims\/\$\{[^}]+\}.*method:\s*['"]PUT['"]/s);
});

test('UX-03 — Paramètres ouvre sur un Hero canon (kicker + h1), plus sur l’ancien bandeau', () => {
  expect(source).toContain('data-dashboard-role="hero"');
  expect(source).toContain('<span class="kmc-workspace-kicker">CONFIGURATION</span>');
  expect(source).toContain('<h1 class="kmc-workspace-title">Paramètres business</h1>');
  expect(source).not.toContain('class="sv-header"');
});

test('Paramètres respecte la mise en page canonique et ne contient plus de mojibake', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/settings-workspace.js'), 'utf8');
  expect(src).toContain("root.classList.add('kmc-settings-workspace')");
  expect(src).toContain('.kmc-settings-workspace>#sv-tab-body');
  expect(src).toContain('.kmc-settings-workspace>.kmc-workspace-header');
  expect(src).not.toContain('â–');
  expect(src).toContain("content:'▾'");
  expect(src).toContain('Valider ▶');
});

test('settings reste dans sa colonne canonique sans débordement latéral', () => {
 const fs=require('fs'),path=require('path');
 const src=fs.readFileSync(path.join(__dirname,'..','..','public/dashboards/canonical/js/settings-workspace.js'),'utf8');
 expect(src).toContain('overflow-x:clip');
 expect(src).toContain('max-width:min(1480px,100%)');
 expect(src).toContain('box-sizing:border-box;overflow-wrap:anywhere');
});
