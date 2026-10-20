'use strict';
/** Human-guided recipe contracts: no real payments, resets, or certification. */
const fs=require('fs');
const path=require('path');
const vm=require('node:vm');
const root=path.join(__dirname,'..','..');
const js=fs.readFileSync(path.join(root,'public/js/golden-recipe-scenarios.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/golden-e2e-cockpit.html'),'utf8');

test('guided scenario script compiles under CSP without inline script',()=>{
  expect(()=>new vm.Script(js,{filename:'golden-recipe-scenarios.js'})).not.toThrow();
  expect(html).toContain('<script defer src="/js/golden-recipe-scenarios.js"></script>');
  expect(html).toContain('id="extendedRecipe"');
  expect(html).toContain('id="scenarioAuthButton"');
  expect(html).toContain('id="scenarioProof"');
});

test('CJ, collectif et dix remédiations ne prétendent pas être une preuve backend',()=>{
  expect(js).toContain("cj:{label:'CJ · lot 20 / 15 / 5'");
  expect(js).toContain("collective:{label:'Partage et financement");
  expect(js).toContain("l1l10:{label:'Backoffice");
  expect(js).toMatch(/L1 · vérité des KPI/);
  expect(js).toMatch(/L10 · parité visuelle/);
  expect(js).toContain('20 = 15 + 5');
  expect(js).toContain("automatique : NON PROUVÉ");
  expect(js).not.toContain("fetch('/api/admin/entities/golden-create'");
  expect(js).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('session admin requise, preuve humaine indexée et retour entre marchés isolé',()=>{
  expect(js).toContain('run.track,run.market,run.ref,run.sha');
  expect(js).toContain("status==='observed'&&(!authReady||proof.length<8)");
  expect(js).toContain("credentials:'include'");
  expect(js).toContain('currentProbe!==probeId');
  expect(js).toContain('localStorage.setItem(key()');
  expect(js).toContain("GITHUB+encodeURIComponent(run.sha)+'/'+s.source");
  expect(js).toContain("authReady=false;++probeId");
  expect(html).toContain('href="/login.html"');
});

test('processus et dashboards canoniques : parcours complets sans faux propriétaire ni droit UI',()=>{
  expect(html).toContain('<option value="process">');
  expect(html).toContain('<option value="dashboards">');
  expect(js).toContain("process:{label:'Parcours canonique");
  expect(js).toContain("dashboards:{label:'Contrôle canonique");
  for (const route of [
    '/admin/workspaces/sourcing','/admin/import-runtime','/admin/workspaces/pricing',
    '/admin/workspaces/catalog','/dashboards/canonical/access.html',
    '/admin/commerce','/admin/operations','/admin/workspaces/purchasing',
    '/admin/hub-live','/admin/workspaces/shipping-customs','/admin/relais-live',
    '/admin/finance','/admin/pilotage',
  ]) expect(js).toContain("'"+route+"'");
  expect(js).toContain('Marge inconnue ou partielle ≠ marge zéro');
  expect(js).toContain('Inconnu, zéro confirmé et montant payé');
  expect(js).toContain('5 décisions + 3 Live');
});

test('garde anti-contamination : RCT1 préservé sur les vues filtrées, SHA staging vérifié',()=>{
  expect(js).toContain("simulation_scope=RCT1");
  expect(js).toContain("function hrefForStep(path)");
  expect(js).toContain("function scopeNote(path)");
  expect(js).toContain("fetch('/health/version',{cache:'no-store'");
  expect(js).toContain("actual.startsWith(run.sha)||run.sha.startsWith(actual)");
  expect(js).toContain("BLOQUÉ : commit staging absent ou différent");
  expect(js).toContain('verifiedCommit=actual');
  expect(js).not.toMatch(/method\\s*:\\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});
