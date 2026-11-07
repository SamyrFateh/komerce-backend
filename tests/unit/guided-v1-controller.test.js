'use strict';
/**
 * @komerce-arch-lite
 * @role golden-guided-v1-human-session-contract-tests
 * @domain dashboard
 * @layer unit-test
 * @owner backend-core
 * @purpose Vérifier que le guide revalide le rôle et préserve la preuve saisie sans appel HTTP mutateur.
 * @impact-areas dashboard, staging-only, authorization
 */
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.join(__dirname,'../..');
const tracksSource=fs.readFileSync(path.join(root,'public/js/guided-v1-tracks.js'),'utf8');
const controllerSource=fs.readFileSync(path.join(root,'public/js/golden-recipe-scenarios.js'),'utf8');
const sha='d490759b666f6dae738252ff53d455113394a034';
function session(){
 const win={},dom=new Map(),stored=new Map(),calls=[];
 const elem=id=>{
  if(!dom.has(id))dom.set(id,{value:'',textContent:'',disabled:false,hidden:true,open:false,
   dataset:{},handlers:{},addEventListener(k,fn){this.handlers[k]=fn;}});
  return dom.get(id);
 };
 const localStorage={setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k)||null,removeItem:k=>stored.delete(k)};
 const current={role:'admin'};
 const fetch=async(url,opts)=>{
  calls.push({url,method:opts?.method||'GET'});
  if(url==='/health/version')return{ok:true,status:200,json:async()=>({commit:sha})};
  if(url==='/api/auth/me')return{ok:true,status:200,json:async()=>({role:current.role})};
  throw Error('Unexpected non-readonly endpoint: '+url);
 };
 vm.runInNewContext(tracksSource,{window:win});
 elem('scenarioTrack').value='v1_manual';
 elem('scenarioMarket').value='KM';
 elem('scenarioRef').value='E2E-HUB-V1-43BE86B3-KOM-101';
 elem('scenarioSha').value=sha;
 vm.runInNewContext(controllerSource,{
  window:win,document:{getElementById:elem},localStorage,fetch,
  Blob:class{},URL:{createObjectURL:()=>''},setTimeout:()=>{},
 });
 return {elem,current,calls};
}
test('Le guide conserve note et preuve lors du GET de revalidation et ne produit pas de GO backend',async()=>{
 const s=session();
 s.elem('scenarioStart').handlers.click();
 await s.elem('scenarioAuthButton').handlers.click();
 s.elem('scenarioNext').handlers.click();s.elem('scenarioNext').handlers.click();
 s.elem('scenarioNote').value='Commande payée réellement vue et market correct.';
 s.elem('scenarioProof').value='https://github.com/SamyrFateh/komerce-backend/issues/3349';
 await s.elem('scenarioObserved').handlers.click();
 expect(s.elem('scenarioState').textContent).toContain('OBSERVÉ');
 expect(s.elem('scenarioState').textContent).toContain('automatique : NON PROUVÉ');
 expect(s.elem('scenarioNote').value).toContain('Commande payée réellement');
 expect(s.elem('scenarioNext').disabled).toBe(false);
 expect(s.calls.every(c=>c.method==='GET')).toBe(true);
});
test('La recette redemande la bonne identité après changement d’étape ; aucun droit admin accordé à Hub',async()=>{
 const s=session();
 s.elem('scenarioStart').handlers.click();
 await s.elem('scenarioAuthButton').handlers.click();
 s.elem('scenarioNext').handlers.click();s.elem('scenarioNext').handlers.click();
 s.elem('scenarioNote').value='Référence et commandes présentes sur la vraie interface.';
 s.elem('scenarioProof').value='https://github.com/SamyrFateh/komerce-backend/issues/3349';
 await s.elem('scenarioObserved').handlers.click();
 s.elem('scenarioNext').handlers.click();
 expect(s.elem('scenarioTitle').textContent).toContain('Besoin fournisseur');
 expect(s.elem('scenarioObserved').disabled).toBe(true);
 await s.elem('scenarioAuthButton').handlers.click();
 expect(s.elem('scenarioAuth').textContent).toContain('BLOQUÉ');
 expect(s.elem('scenarioObserved').disabled).toBe(true);
 s.current.role='agent_hub';
 await s.elem('scenarioAuthButton').handlers.click();
 expect(s.elem('scenarioObserved').disabled).toBe(false);
 expect(s.calls.every(c=>c.method==='GET')).toBe(true);
});
test('DJ ne peut pas ouvrir le parcours de commande importée, même avec une référence',()=>{
 const s=session();
 s.elem('scenarioMarket').value='DJ';
 s.elem('scenarioStart').handlers.click();
 expect(s.elem('scenarioMessage').textContent).toContain('DJ : refus uniquement');
 expect(s.elem('scenarioStage').hidden).toBe(true);
});
