'use strict';
/**
 * @komerce-arch-lite
 * @role golden-guided-market-hub-v1-contract-tests
 * @domain dashboard
 * @layer unit-test
 * @owner backend-core
 * @purpose Prouver que la recette Hub/marchés n'attribue aucun faux PASS et garde les rôles, écrans et prérequis.
 * @impact-areas dashboard, hub, market-delegation, staging-only
 */
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.join(__dirname,'../..');
const tracksJS=fs.readFileSync(path.join(root,'public/js/guided-v1-tracks.js'),'utf8');
const controller=fs.readFileSync(path.join(root,'public/js/golden-recipe-scenarios.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/golden-e2e-cockpit.html'),'utf8');
const hub=fs.readFileSync(path.join(root,'public/dashboards/canonical/js/hub-workstation.js'),'utf8');
const win={};
vm.runInNewContext(tracksJS,{window:win});
const guide=win.KomerceGuidedV1;

test('Le guide V1 couvre les modes fournisseur, local, partiel, marchés et DJ',()=>{
 expect(Object.keys(guide.tracks).sort()).toEqual([
  'v1_api','v1_dj','v1_local','v1_manual','v1_market','v1_partial','v1_semi',
 ]);
 expect(Object.keys(guide.markets).sort()).toEqual(['CG','CM','DJ','KM','YT']);
 expect(guide.tracks.v1_manual.steps.length).toBeGreaterThanOrEqual(14);
 expect(guide.tracks.v1_api.steps.length).toBeGreaterThanOrEqual(14);
 expect(guide.tracks.v1_local.steps.length).toBe(6);
});

test('Toutes les étapes identifient écran réel, rôle, attente et preuve, sans javascript: ni URL externe',()=>{
 for(const track of Object.values(guide.tracks))for(const s of track.steps){
  expect(s.title.length).toBeGreaterThan(8);
  expect(s.actor.length).toBeGreaterThan(4);
  expect(Array.isArray(s.roles)).toBe(true);
  expect(s.roles.length).toBeGreaterThan(0);
  expect(s.roles.every(r=>['admin','market_operator','agent_hub','agent_relais','agent_transitaire','finance'].includes(r))).toBe(true);
  expect(s.path).toMatch(/^\/(?:admin|dashboards\/canonical)\//);
  expect(s.expected.length).toBeGreaterThan(30);
  expect(s.proof.length).toBeGreaterThan(20);
  expect(s.source).toMatch(/^(?:docs|scripts)\//);
 }
});

test('La directrice Hub valide engagement et paiement séparément ; agent ordinaire est refusé',()=>{
 const steps=guide.tracks.v1_manual.steps;
 const commit=steps.find(s=>/Autoriser l’engagement/.test(s.title));
 const pay=steps.find(s=>/Autoriser séparément le paiement/.test(s.title));
 expect(commit).toBeTruthy();expect(pay).toBeTruthy();
 expect(commit.roles).toEqual(['agent_hub']);expect(pay.roles).toEqual(['agent_hub']);
 expect(commit.proof).toContain('AUTHORIZATION_GRANT_REQUIRED');
 expect(pay.expected).toContain('débit réel');
});

test('Locale sans Hub et DJ inactif ne peuvent être déclarés commandes internationales',()=>{
 const local=guide.tracks.v1_local.steps;
 expect(local.map(s=>s.title).join(' | ')).toContain('Aucun besoin d’achat Hub créé');
 expect(local.map(s=>s.expected).join(' ')).toContain('Aucune ligne IMPORT');
 const dj=guide.tracks.v1_dj.steps;
 expect(dj.some(s=>/checkout DJ/.test(s.title))).toBe(true);
 expect(dj.every(s=>!/activer DJ maintenant/.test(s.expected))).toBe(true);
 expect(controller).toContain("!(market==='DJ'&&track!=='v1_dj')");
 expect(controller).toContain("!(track==='v1_dj'&&market!=='DJ')");
});

test('La source V1 est purement descriptive et ne contacte aucun writer',()=>{
 expect(tracksJS).not.toMatch(/\bfetch\s*\(/);
 expect(tracksJS).not.toMatch(/XMLHttpRequest|\.submit\s*\(|\.click\s*\(|method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
 expect(controller).toContain("fetch('/api/auth/me',{credentials:'include'");
 expect(controller).toContain("step.roles.includes(actualRole)");
 expect(controller).toContain("authReady=false;verifiedCommit=null;render()");
 expect(controller).toContain("backend_verdict:'NOT_PROVEN_BY_HUMAN_GUIDE'");
});

test('Recette visible avant l’ancienne Golden, lien Hub et export sans faux GO',()=>{
 const guideStart=html.indexOf('<details id="extendedRecipe"');
 const goldenStart=html.indexOf('id="wizardSetup"');
 expect(guideStart).toBeGreaterThan(0);
 expect(guideStart).toBeLessThan(goldenStart);
 expect(html).toContain('<script defer src="/js/guided-v1-tracks.js"></script>');
 expect(html.indexOf('src="/js/guided-v1-tracks.js"')).toBeLessThan(html.indexOf('src="/js/golden-recipe-scenarios.js"'));
 for(const id of ['scenarioMarketRule','scenarioExport','scenarioAuthButton','scenarioProof'])
  expect(html).toContain('id="'+id+'"');
 expect(hub).toContain("guide.href='/admin/golden-e2e'");
 expect(hub).toContain("data-hub-guided-recipe");
 expect(controller).toContain("non_certifying:true");
 expect(controller).toContain("status==='observed'?'OBSERVÉ'");
});
