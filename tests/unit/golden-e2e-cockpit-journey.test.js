'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..','..');
test('Golden journey controller is CSP-safe and loaded by the cockpit',()=>{
  const html=fs.readFileSync(path.join(ROOT,'public/golden-e2e-cockpit.html'),'utf8');
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(html).toContain('<script defer src="/js/golden-e2e-cockpit-journey.js"></script>');
  expect(html).not.toMatch(/<script(?:\s[^>]*)?>\s*\(/);
  expect(js).toContain("const steps=[");
  expect(js).toContain("function render()");
});

test('Golden V4 affiche la préparation seule avant le choix d’une commande',()=>{
  const html=fs.readFileSync(path.join(ROOT,'public/golden-e2e-cockpit.html'),'utf8');
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(html).toContain('id="wizardSetup"');
  expect(html).toContain('id="wizardStage" hidden');
  expect(html).toContain('id="goldenStats" hidden');
  expect(html).toContain('id="wizardChange"');
  expect(js).toContain("$('wizardSetup').hidden=ready");
  expect(js).toContain("$('wizardStage').hidden=!ready");
  expect(js).toContain("$('goldenStats').hidden=!ready");
});

test('Golden V4 impose Comprendre puis Visualiser puis Valider et conserve les preuves à la demande',()=>{
  const html=fs.readFileSync(path.join(ROOT,'public/golden-e2e-cockpit.html'),'utf8');
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(html).toContain('id="wizardProofDetails"');
  expect(html).toContain('id="wizardTechnical"');
  expect(html).toContain('id="wizardNext"');
  expect(html).toContain('id="wizardBack"');
  expect(html).toContain('id="humanDisclaimer"');
  expect(js).toContain("['guide','view','validate'][phase]");
  expect(js).toContain("next.disabled=phase===2&&(states[cur]!=='pass'||cur===steps.length-1)");
  expect(js).toContain("if(states[cur]==='pass'&&cur<steps.length-1){cur++;phase=0;render()}");
});

test('Golden V4 sépare constat humain, backend et changement de référence',()=>{
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(js).toContain("states[cur]='pass';findings[cur]");
  expect(js).toContain("states[cur]='fail';findings[cur]");
  expect(js).toContain("ref='';cur=0;phase=0;states.fill('pending');findings.fill(null);backend.fill(null)");
  expect(js).toContain("'/admin/orders/'+encodeURIComponent(ref)");
  expect(js).toContain("backend=Array.isArray(body.projection?.steps)?body.projection.steps:Array(steps.length).fill(null)");
});


test('Golden: backend manquant ou indisponible invalide le cache de preuve',()=>{
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(js).toContain("if(!Array.isArray(body.steps))throw new Error('Projection backend absente')");
  expect(js).toContain("backend=Array(steps.length).fill(null);$('liveState').textContent='Preuves indisponibles");
  expect(js).toContain('if(ref!==requestedRef)return');
  expect(js).toContain('if(readId!==evidenceRead)return');
  expect(js).toContain("$('pass').disabled=!proofReady");
  expect(js).toContain('backend=Array.isArray(body.projection?.steps)?body.projection.steps:Array(steps.length).fill(null)');
});

test('Golden: constats locaux indexés par market, référence et version du guide',()=>{
  const html=fs.readFileSync(path.join(ROOT,'public/golden-e2e-cockpit.html'),'utf8');
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(html).toContain('id="humanObservation"');
  expect(js).toContain('const GUIDE_VERSION=');
  expect(js).toContain('localStorage.setItem(stateKey()');
  expect(js).toContain('function restoreHuman()');
  expect(js).toContain("if(!proofReady)return");
});
