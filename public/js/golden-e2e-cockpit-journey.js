'use strict';
(()=>{const steps=[
['Commande client','Client / Admin','/admin/operations','La commande Comores existe avec la bonne identité métier.','Référence, client, relais, montant et lignes cohérents.','La commande apparaît dans Opérations et sa fiche 360 est accessible.'],
['Paiement client','Client / Finance','/admin/finance','Le paiement client est confirmé sans duplication.','payment_status=paid et preuve liée à cette commande.','La commande est payée ; Finance reflète le même fait.'],
['Achat fournisseur','Achats','/admin/workspaces/purchasing','Le besoin client devient une PO fournisseur.','PO + ligne d’achat vers le SKU exact vendu.','Une PO existe avec fournisseur, quantité et SKU corrects.'],
['Exécution fournisseur','Achats','/admin/workspaces/purchasing','La commande et le paiement fournisseur ont leur preuve propre.','Supplier execution + paiement matched + débit réel vérifié.','L’exécution fournisseur est rattachée à la bonne PO.'],
['Fulfillment','Achats / Logistique','/admin/workspaces/purchasing','Le fournisseur a expédié ; cela ne prouve pas le Hub.','Fulfillment + tracking présents, Hub encore PENDING.','Le tracking existe sans fausse réception physique.'],
['Réception Hub','Agent Hub','/admin/hub-live','Une unité physique est reçue et affectée.','Allocation + physical unit + placement RECEIVE.','Hub Live montre la réception et la quantité exacte.'],
['Transport & douane','Transitaire / Ops','/admin/workspaces/shipping-customs','Le colis rejoint le market et passe la frontière douane.','Parcel + shipment + déclaration et coûts réels.','La disponibilité reste bloquée tant que la douane n’est pas déclarée.'],
['Disponible relais','Agent Relais','/admin/relais-live','Le colis est réellement disponible au relais choisi.','Parcel/order AVAILABLE après le gate douane.','Relais Live montre le colis dans la bonne file.'],
['Remise client','Agent Relais / Client','/admin/relais-live','La remise client possède une preuve autorisée.','Scan COLLECTED + PICKUP_CODE + bon relais.','Après retrait, colis et commande sont collectés.'],
['Clôture financière','Finance','/admin/workspaces/accounting','Toutes les frontières et tous les coûts convergent.','FINANCIAL_CLOSE_MATCHED + economic maturity + aucune divergence.','Comptabilité/Finance reflètent une boucle entièrement fermée.']
];let phase=0,cur=0,ref='',states=Array(10).fill('pending'),backend=Array(10).fill(null);const $=x=>document.getElementById(x);function href(path){return path}
const RECORD_PREFIX='komerce:golden-human:v1:';
let version='unknown',proofNonce=0,notes=Array(steps.length).fill('');
function caseKey(market=$('marketSelect').value,reference=ref){
  return RECORD_PREFIX+version+':'+market+':'+reference;
}
function humanRecord(){
  return {schema:'golden-human-v1',version,market:$('marketSelect').value,reference:ref,
    recorded_at:new Date().toISOString(),index:cur,phase,states:[...states],notes:[...notes]};
}
function saveHuman(){
  if(!ref||version==='unknown')return;
  try{
    localStorage.setItem(caseKey(),JSON.stringify(humanRecord()));
    localStorage.setItem(RECORD_PREFIX+'last:'+version,JSON.stringify({market:$('marketSelect').value,reference:ref}));
    $('caseSaveState').textContent='Constats humains conservés sur ce navigateur · version '+version.slice(0,10)+'.';
  }catch(e){$('caseSaveState').textContent='Sauvegarde locale indisponible : exporte les constats avant de quitter.'}
}
function restoreHuman(){
  states=Array(steps.length).fill('pending');notes=Array(steps.length).fill('');cur=0;phase=0;
  backend=Array(steps.length).fill(null);proofNonce++;
  if(!ref||version==='unknown')return;
  try{
    const record=JSON.parse(localStorage.getItem(caseKey())||'null');
    if(record&&record.schema==='golden-human-v1'&&record.version===version&&record.market===$('marketSelect').value&&record.reference===ref
      &&Array.isArray(record.states)&&record.states.length===steps.length
      &&record.states.every(s=>['pending','pass','fail'].includes(s))){
      states=record.states;
      notes=Array.isArray(record.notes)&&record.notes.length===steps.length?record.notes.map(n=>String(n||'').slice(0,1000)):notes;
      cur=Number.isInteger(record.index)&&record.index>=0&&record.index<steps.length?record.index:0;
      phase=Number.isInteger(record.phase)&&record.phase>=0&&record.phase<=2?record.phase:0;
      $('caseSaveState').textContent='Constats humains restaurés · preuves backend à relire.';
    }else $('caseSaveState').textContent='Nouvelle recette humaine · version '+version.slice(0,10)+'.';
  }catch(e){$('caseSaveState').textContent='Sauvegarde locale illisible : nouveau suivi. Les preuves backend doivent être relues.'}
}
function selectHumanCase(reference,market){
  ref=String(reference||'').trim().slice(0,80).toUpperCase();
  if(market)$('marketSelect').value=market;
  $('refInput').value=ref;
  restoreHuman();render();if(ref)refreshEvidence();
}
function exportHuman(){
  if(!ref){$('liveState').textContent='Charge une commande avant export.';return}
  const record=humanRecord();
  record.backend_snapshot={non_certifying:true,exported_at:new Date().toISOString(),
    evidence:backend.map(step=>step?{key:step.key,passed:step.passed,evidence:step.evidence}:null)};
  const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='komerce-recette-'+record.market+'-'+ref.replace(/[^A-Z0-9-]/g,'')+'-'+version.slice(0,10)+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
const versionReady=fetch('/health/version',{credentials:'include',headers:{Accept:'application/json'}})
  .then(async response=>{if(!response.ok)throw Error('Version indisponible');const body=await response.json();
    if(!/^[0-9a-f]{40}$/i.test(body.commit||''))throw Error('Commit non certifié');
    version=body.commit;
  }).catch(()=>{version='unknown';$('caseSaveState').textContent='Version non vérifiée : reprise automatique désactivée, ne pas valider la recette.'});
versionReady.then(()=>{
  if(ref||version==='unknown')return;
  try{
    const last=JSON.parse(localStorage.getItem(RECORD_PREFIX+'last:'+version)||'null');
    if(last&&['KM','CM','CG'].includes(last.market)&&/^[A-Z0-9-]{1,80}$/.test(last.reference||''))selectHumanCase(last.reference,last.market);
    else $('caseSaveState').textContent='Version staging '+version.slice(0,10)+' · prête pour une recette tracée.';
  }catch(e){$('caseSaveState').textContent='Ancien suivi indisponible · ouvre une commande.'}
});async function refreshEvidence(){if(!ref)return;const requestedRef=ref,requestedMarket=$('marketSelect').value,nonce=++proofNonce;
try{$('liveState').textContent='Lecture des faits canoniques…';
const r=await fetch('/api/admin/entities/orders/'+encodeURIComponent(requestedRef)+'/golden-evidence',{credentials:'include',headers:{Accept:'application/json'}});
const body=await r.json().catch(()=>({}));
if(ref!==requestedRef||$('marketSelect').value!==requestedMarket||nonce!==proofNonce)return;
if(!r.ok)throw new Error(body.error||('HTTP '+r.status));
if(!Array.isArray(body.steps))throw new Error('Projection backend absente');
backend=body.steps;$('liveState').textContent='Observé '+new Date(body.observed_at).toLocaleTimeString('fr-FR')+' · '+body.verdict;render();
}catch(e){
if(ref!==requestedRef||$('marketSelect').value!==requestedMarket||nonce!==proofNonce)return;
backend=Array(steps.length).fill(null);$('liveState').textContent='Preuves indisponibles : '+e.message;render()
}}function marketLabel(code){return {KM:'KM · Comores',CM:'CM · Cameroun',CG:'CG · Congo'}[code]||code}
const existingProofs=[
['https://github.com/SamyrFateh/komerce-backend/blob/main/public/boutique/tests/e2e/authenticated/order-flow.spec.js','F01 boutique : suite existante ; la commande de cette session exige une preuve backend distincte.'],
['https://github.com/SamyrFateh/komerce-backend/actions/runs/38447414712','Golden L4 : encaissement cash validé ; pas une certification des prestataires externes.'],
['https://github.com/SamyrFateh/komerce-backend/blob/main/tests/e2e-cash/order-to-cash-thread.spec.js','Golden L4 n’atteste pas la création d’une PO fournisseur : contrôle métier autonome requis.'],
['https://github.com/SamyrFateh/komerce-backend/blob/main/docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md','Exécution fournisseur : preuve du fil réel encore à relier ; ne pas assimiler au cash L4.'],
['https://github.com/SamyrFateh/komerce-backend/blob/main/docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md','Fulfillment fournisseur : contrôle indépendant du transport logistique local L4.'],
['https://github.com/SamyrFateh/komerce-backend/actions/runs/38447414712','L4 certifie une réception Hub dans la chaîne cash de test, pas le fournisseur réel.'],
['https://github.com/SamyrFateh/komerce-backend/blob/main/docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md','Transport et douane externe : hors preuve Golden L4.'],
['https://github.com/SamyrFateh/komerce-backend/actions/runs/38447414712','L4 certifie des opérations relais de test ; vérifier le relais de la commande suivie.'],
['https://github.com/SamyrFateh/komerce-backend/actions/runs/38447414712','L4 certifie une remise en test ; vérifier le retrait de cette commande précise.'],
['https://github.com/SamyrFateh/komerce-backend/actions/runs/38447414712','L4 couvre cash/comptabilité/garde ; aucune clôture économique réelle induite.']
];function render(){const s=steps[cur],n=states.filter(x=>x==='pass').length;$('num').textContent='Étape '+(cur+1)+' / 10';$('title').textContent=s[0];$('actor').textContent=s[1];$('surface').textContent=s[2];$('meaning').textContent=s[3];$('proof').textContent=s[4];$('see').textContent=s[5];const be=backend[cur];$('backendEvidence').textContent=be?(be.passed?'✓ '+be.evidence:'⏳ '+be.evidence):'—';$('stepCi').href=existingProofs[cur][0];$('stepCiScope').textContent=existingProofs[cur][1];$('score').textContent=n+' / 10';const bp=backend.filter(b=>b&&b.passed).length;$('verdict').textContent=states.includes('fail')?'Bloqué':n===10?(bp===10?'Recette aval 10/10 · non certifiante':'10/10 humain · preuves backend '+bp+'/10 · NON CERTIFIÉE'):'En cours';$('global').textContent=window.__goldenStage||'NON DÉMARRÉ';$('blocked').classList.toggle('hidden',states[cur]!=='fail');$('openReal').href=cur===0&&ref?'/admin/orders/'+encodeURIComponent(ref):href(s[2]);$('orderRef').textContent=ref||'à renseigner';$('humanObservation').value=notes[cur]||'';$('marketStat').textContent=marketLabel($('marketSelect').value);const next=$('nextAction');if(!ref)next.textContent='Crée ou charge une Golden pour commencer.';else if(be&&be.passed&&states[cur]!=='pass')next.textContent='Preuve backend acquise. Ouvre l’écran réel, vérifie visuellement, puis clique ✓ Conforme.';else if(states[cur]==='fail')next.textContent='Anomalie déclarée : reste sur cette étape jusqu’à compréhension de l’écart.';else if(cur>=9)next.textContent='Clôture financière : observation uniquement. Actualise les preuves puis vérifie l’écran Comptabilité.';else next.textContent='Déclenche la prochaine frontière automatique, puis contrôle la preuve backend.';const links=$('links');links.innerHTML='';[['Pilotage','/admin/pilotage'],['Action Center','/admin/action-center'],['Order 360',ref?'/admin/orders/'+encodeURIComponent(ref):'/admin/operations']].forEach(([label,url])=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label+' ↗';links.appendChild(a)});const rail=$('rail');rail.innerHTML='';steps.forEach((x,i)=>{const b=document.createElement('button');b.type='button';const auto=backend[i]&&backend[i].passed;b.className='stepbtn '+(i===cur?'active ':'')+(states[i]==='fail'?'fail':states[i]==='pass'?'pass':'pending');b.innerHTML='';const number=document.createElement('span');number.className='step-number';number.textContent=(states[i]==='fail'?'✕ ':states[i]==='pass'?'✓ ':auto?'● ':'○ ')+String(i+1).padStart(2,'0');const name=document.createElement('span');name.textContent=x[0];b.append(number,name);b.setAttribute('aria-current',i===cur?'step':'false');b.title=x[0]+' · humain : '+(states[i]==='pass'?'conforme':states[i]==='fail'?'anomalie':'non vérifié')+' · backend : '+(auto?'preuve disponible':'non prouvé');b.addEventListener('click',()=>{cur=i;phase=0;render();saveHuman()});rail.appendChild(b)}) ;renderWizard()}
$('createGolden').addEventListener('click',async()=>{const b=$('createGolden');b.disabled=true;$('liveState').textContent='Création de la Golden persistante…';try{const r=await fetch('/api/admin/entities/golden-create',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({marketCode:$('marketSelect').value})});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||('HTTP '+r.status));await versionReady;selectHumanCase(body.reference,body.marketCode||$('marketSelect').value);saveHuman()}catch(e){$('liveState').textContent='Création refusée : '+e.message}finally{b.disabled=false}});
$('advance').addEventListener('click',async()=>{if(!ref)return;const requestedRef=ref,nonce=++proofNonce;$('advance').disabled=true;$('liveState').textContent='Déclenchement de la prochaine frontière canonique…';try{const r=await fetch('/api/admin/entities/orders/'+encodeURIComponent(ref)+'/golden-advance',{method:'POST',credentials:'include',headers:{Accept:'application/json'}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||('HTTP '+r.status));if(ref!==requestedRef||nonce!==proofNonce)return;backend=Array.isArray(body.projection?.steps)?body.projection.steps:Array(steps.length).fill(null);$('liveState').textContent=body.complete?'Golden complet':'Étape déclenchée · prochaine frontière : '+(body.next&&body.next.key||'observation');render()}catch(e){if(ref===requestedRef&&nonce===proofNonce){backend=Array(steps.length).fill(null);$('liveState').textContent='Déclenchement refusé : '+e.message;render()}}finally{$('advance').disabled=false;}});$('pass').addEventListener('click',()=>{if(!ref){$('liveState').textContent='Renseigne la référence de commande avant de valider une étape humaine.';return;}states[cur]='pass';render();saveHuman()});$('fail').addEventListener('click',()=>{states[cur]='fail';render();saveHuman()});$('reset').addEventListener('click',()=>{states.fill('pending');notes.fill('');cur=0;phase=0;render();saveHuman()});$('refresh').addEventListener('click',refreshEvidence);$('refForm').addEventListener('submit',async e=>{e.preventDefault();await versionReady;selectHumanCase($('refInput').value,$('marketSelect').value)});$('marketSelect').addEventListener('change',()=>{if(ref){ref='';states.fill('pending');notes.fill('');backend.fill(null);proofNonce++;cur=0;phase=0;$('liveState').textContent='Marché changé : charge une commande du nouveau marché.'}render()});$('humanObservation').addEventListener('input',()=>{notes[cur]=String($('humanObservation').value||'').slice(0,1000);saveHuman()});$('exportHuman').addEventListener('click',exportHuman);setInterval(()=>{if(ref)refreshEvidence()},5000);function renderWizard(){
  const grid=document.querySelector('.wizard-grid'),ready=Boolean(ref);
  if(!grid)return;
  $('wizardSetup').hidden=ready;
  $('wizardStage').hidden=!ready;
  $('goldenStats').hidden=!ready;
  grid.dataset.phase=['guide','view','validate'][phase];
  ['phaseGuide','phaseView','phaseValidate'].forEach((id,i)=>{
    $(id).classList.toggle('current',phase===i);
    $(id).classList.toggle('done',phase>i);
  });
  $('wizardProgressText').textContent='Étape '+(cur+1)+' sur '+steps.length+' · '+steps[cur][0];
  $('wizardProgressFill').style.width=((cur+1)/steps.length*100)+'%';
  const next=$('wizardNext');
  next.textContent=phase===0?'Voir l’écran →':phase===1?'Passer à la validation →':cur===steps.length-1?'Parcours humain terminé':'Étape suivante →';
  next.disabled=phase===2&&(states[cur]!=='pass'||cur===steps.length-1);
  $('wizardBack').disabled=phase===0&&cur===0;
  $('wizardShowSteps').setAttribute('aria-expanded',String(!$('rail').hidden));
  $('humanDisclaimer').textContent=states[cur]==='fail'?'Anomalie signalée : la recette humaine est bloquée ici, sans changement de statut backend.':states[cur]==='pass'?'Observation humaine conforme enregistrée. La preuve backend reste indépendante.':'Ton constat ne certifie pas une preuve backend et ne modifie aucun état métier.';
}
function initWizard(){
  const controls=$('wizardSetupControls');
  if(!controls)return;
  for(const el of [$('marketSelect'),$('createGolden'),$('refForm')])if(el)controls.appendChild(el);
  $('wizardStatus').appendChild($('liveState'));
  const extra=$('wizardExtraControls');
  for(const el of [$('refresh'),$('reset')])if(el)extra.appendChild(el);
  $('wizardShowSteps').addEventListener('click',()=>{
    $('rail').hidden=!$('rail').hidden;
    renderWizard();
  });
  $('wizardNext').addEventListener('click',()=>{
    if(phase<2){phase++;renderWizard();saveHuman();return}
    if(states[cur]==='pass'&&cur<steps.length-1){cur++;phase=0;render();saveHuman()}
  });
  $('wizardBack').addEventListener('click',()=>{
    if(phase>0){phase--;renderWizard();saveHuman()}
    else if(cur>0){cur--;phase=2;render();saveHuman()}
  });
  $('wizardChange').addEventListener('click',()=>{
    ref='';cur=0;phase=0;states.fill('pending');notes.fill('');backend.fill(null);proofNonce++;
    $('liveState').textContent='Choisis une commande à suivre.';
    render();
  });
}
initWizard();render()})();
