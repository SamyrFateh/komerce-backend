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
  expect(js).toContain("if(states[cur]==='pass'&&cur<steps.length-1){cur++;phase=0;render();saveHuman()}");
});

test('Golden V4 sépare constat humain, backend et changement de référence',()=>{
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(js).toContain("states[cur]='pass';render();saveHuman()");
  expect(js).toContain("states[cur]='fail';render();saveHuman()");
  expect(js).toContain("ref='';cur=0;phase=0;states.fill('pending');notes.fill('');backend.fill(null);proofNonce++");
  expect(js).toContain("'/admin/orders/'+encodeURIComponent(ref)");
  expect(js).toContain('if(!validGoldenProjection(body.projection,requestedRef,requestedMarket))');
});


test('Golden: backend manquant ou indisponible invalide le cache de preuve',()=>{
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(js).toContain("if(!Array.isArray(body.steps))throw new Error('Projection backend absente')");
  expect(js).toContain("proofReady=false;backend=Array(steps.length).fill(null);$('liveState').textContent='Preuves indisponibles");
  expect(js).toContain('nonce!==proofNonce');
  expect(js).toContain('backend=Array.isArray(body.projection?.steps)?body.projection.steps:Array(steps.length).fill(null)');
});


test('Golden: reprise des constats humains indexée par SHA + market + commande, jamais la preuve backend',()=>{
  const html=fs.readFileSync(path.join(ROOT,'public/golden-e2e-cockpit.html'),'utf8');
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(html).toContain('id="caseSaveState"');
  expect(html).toContain('id="humanObservation"');
  expect(html).toContain('id="exportHuman"');
  expect(js).toContain("RECORD_PREFIX+version+':'+market+':'+reference");
  expect(js).toContain("record.states.every(s=>['pending','pass','fail'].includes(s))");
  expect(js).toContain("backend=Array(steps.length).fill(null);proofNonce++");
  expect(js).toContain("non_certifying:true");
  expect(js).toContain("versionReady=fetch('/health/version'");
});

test('Golden: preuve strictement limitée à la bonne commande, au bon marché et aux dix étapes',()=>{
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(js).toContain('function validGoldenProjection(p,requestedRef,requestedMarket)');
  expect(js).toContain('p.steps.length===steps.length');
  expect(js).toContain('s.key===goldenKeys[i]');
  expect(js).toContain("if(!proofReady)return");
  expect(js).toContain("$('pass').disabled=!proofReady");
  expect(js).toContain('if(phase===2&&!proofReady)next.disabled=true');
});
