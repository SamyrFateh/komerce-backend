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
];let proofReady=false,evidenceRead=0;let phase=0,cur=0,ref='',states=Array(10).fill('pending'),backend=Array(10).fill(null),findings=Array(10).fill(null);const $=x=>document.getElementById(x);
const goldenKeys=['CLIENT_ORDER','CLIENT_PAYMENT','PURCHASING','SUPPLIER_EXECUTION','FULFILLMENT','HUB_INBOUND','CUSTOMS','RELAY_AVAILABLE','CUSTOMER_HANDOFF','FINANCIAL_CLOSE'];
function validGoldenProjection(p,requestedRef){return Boolean(p&&p.order&&String(p.order.reference||'').toUpperCase()===requestedRef&&Array.isArray(p.steps)&&p.steps.length===steps.length&&p.steps.every((s,i)=>s&&s.key===goldenKeys[i]&&typeof s.passed==='boolean'&&typeof s.evidence==='string'));}
const GUIDE_VERSION='GOLDEN-V5-2026-10-14';
const STORE_PREFIX='komerce.recipe.human.';
const safeMarket=()=>$('marketSelect').value;
const stateKey=()=>STORE_PREFIX+encodeURIComponent(GUIDE_VERSION)+'.'+encodeURIComponent(safeMarket())+'.'+encodeURIComponent(ref);
function saveHuman(){
  if(!ref)return;
  try{
    localStorage.setItem(stateKey(),JSON.stringify({schema:1,guide:GUIDE_VERSION,market:safeMarket(),reference:ref,states,findings}));
    localStorage.setItem(STORE_PREFIX+'last',JSON.stringify({guide:GUIDE_VERSION,market:safeMarket(),reference:ref}));
    if($('humanSaved'))$('humanSaved').textContent='Constats conservés dans ce navigateur · version '+GUIDE_VERSION;
  }catch(_){if($('humanSaved'))$('humanSaved').textContent='Sauvegarde locale indisponible : ne ferme pas cet onglet.';}
}
function restoreHuman(){
  states.fill('pending');findings.fill(null);
  if(!ref)return;
  try{
    const saved=JSON.parse(localStorage.getItem(stateKey())||'null');
    if(!saved||saved.guide!==GUIDE_VERSION||saved.reference!==ref||saved.market!==safeMarket())return;
    if(!Array.isArray(saved.states)||saved.states.length!==steps.length)return;
    for(let i=0;i<steps.length;i++){
      const status=saved.states[i];
      states[i]=['pass','fail','pending'].includes(status)?status:'pending';
      const f=Array.isArray(saved.findings)?saved.findings[i]:null;
      findings[i]=f&&typeof f==='object'&&typeof f.note==='string'
        ?{state:states[i],note:f.note.slice(0,2000),when:typeof f.when==='string'?f.when:null}:null;
    }
    if($('humanSaved'))$('humanSaved').textContent='Constats de cette commande repris · '+GUIDE_VERSION;
  }catch(_){if($('humanSaved'))$('humanSaved').textContent='Sauvegarde locale illisible : aucun constat restauré.';}
}
function href(path){return path}async function refreshEvidence(){if(!ref)return;const requestedRef=ref,readId=++evidenceRead;proofReady=false;backend=Array(steps.length).fill(null);render();try{$('liveState').textContent='Lecture des faits canoniques…';const r=await fetch('/api/admin/entities/orders/'+encodeURIComponent(requestedRef)+'/golden-evidence',{credentials:'include',headers:{Accept:'application/json'}});const body=await r.json().catch(()=>({}));if(ref!==requestedRef)return;if(readId!==evidenceRead)return;if(!r.ok)throw new Error(body.error||('HTTP '+r.status));if(!Array.isArray(body.steps))throw new Error('Projection backend absente');if(!validGoldenProjection(body,requestedRef))throw new Error('Projection backend incomplète ou mauvaise commande');backend=body.steps;proofReady=true;$('goldenLogin').hidden=true;$('liveState').textContent='Observé '+new Date(body.observed_at).toLocaleTimeString('fr-FR')+' · '+body.verdict;render()}catch(e){if(ref!==requestedRef)return;if(readId!==evidenceRead)return;proofReady=false;backend=Array(steps.length).fill(null);$('liveState').textContent='Preuves indisponibles : '+e.message;$('goldenLogin').hidden=!/Token manquant|connectez-vous|HTTP 401/i.test(String(e.message));render()}}function marketLabel(code){return {KM:'KM · Comores',CM:'CM · Cameroun',CG:'CG · Congo'}[code]||code}
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
];function render(){const s=steps[cur],n=states.filter(x=>x==='pass').length;$('num').textContent='Étape '+(cur+1)+' / 10';$('title').textContent=s[0];$('actor').textContent=s[1];$('surface').textContent=s[2];$('meaning').textContent=s[3];$('proof').textContent=s[4];$('see').textContent=s[5];const be=backend[cur];$('backendEvidence').textContent=be?(be.passed?'✓ '+be.evidence:'⏳ '+be.evidence):'—';$('stepCi').href=existingProofs[cur][0];$('stepCiScope').textContent=existingProofs[cur][1];$('score').textContent=n+' / 10';const bp=backend.filter(b=>b&&b.passed).length;$('verdict').textContent=states.includes('fail')?'Bloqué':n===10?(bp===10?'Recette aval 10/10 · non certifiante':'10/10 humain · preuves backend '+bp+'/10 · NON CERTIFIÉE'):'En cours';$('global').textContent=window.__goldenStage||'NON DÉMARRÉ';$('blocked').classList.toggle('hidden',states[cur]!=='fail');$('openReal').href=cur===0&&ref?'/admin/orders/'+encodeURIComponent(ref):href(s[2]);$('orderRef').textContent=ref||'à renseigner';$('marketStat').textContent=marketLabel($('marketSelect').value);const next=$('nextAction');if(!ref)next.textContent='Crée ou charge une Golden pour commencer.';else if(be&&be.passed&&states[cur]!=='pass')next.textContent='Preuve backend acquise. Ouvre l’écran réel, vérifie visuellement, puis clique ✓ Conforme.';else if(states[cur]==='fail')next.textContent='Anomalie déclarée : reste sur cette étape jusqu’à compréhension de l’écart.';else if(cur>=9)next.textContent='Clôture financière : observation uniquement. Actualise les preuves puis vérifie l’écran Comptabilité.';else next.textContent='Déclenche la prochaine frontière automatique, puis contrôle la preuve backend.';const links=$('links');links.innerHTML='';[['Pilotage','/admin/pilotage'],['Action Center','/admin/action-center'],['Order 360',ref?'/admin/orders/'+encodeURIComponent(ref):'/admin/operations']].forEach(([label,url])=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label+' ↗';links.appendChild(a)});const rail=$('rail');rail.innerHTML='';steps.forEach((x,i)=>{const b=document.createElement('button');b.type='button';const auto=backend[i]&&backend[i].passed;b.className='stepbtn '+(i===cur?'active ':'')+(states[i]==='fail'?'fail':states[i]==='pass'?'pass':'pending');b.innerHTML='';const number=document.createElement('span');number.className='step-number';number.textContent=(states[i]==='fail'?'✕ ':states[i]==='pass'?'✓ ':auto?'● ':'○ ')+String(i+1).padStart(2,'0');const name=document.createElement('span');name.textContent=x[0];b.append(number,name);b.setAttribute('aria-current',i===cur?'step':'false');b.title=x[0]+' · humain : '+(states[i]==='pass'?'conforme':states[i]==='fail'?'anomalie':'non vérifié')+' · backend : '+(auto?'preuve disponible':'non prouvé');b.addEventListener('click',()=>{cur=i;phase=0;render()});rail.appendChild(b)}) ;renderWizard()}
$('humanObservation').addEventListener('input',()=>{if(!ref)return;findings[cur]={state:states[cur],note:$('humanObservation').value.slice(0,2000),when:findings[cur]&&findings[cur].when||null};saveHuman()});
$('createGolden').addEventListener('click',async()=>{const b=$('createGolden');b.disabled=true;$('liveState').textContent='Création de la Golden persistante…';try{const r=await fetch('/api/admin/entities/golden-create',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({marketCode:$('marketSelect').value})});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||('HTTP '+r.status));ref=body.reference;if(body.marketCode)$('marketSelect').value=body.marketCode;$('refInput').value=ref;states.fill('pending');findings.fill(null);backend.fill(null);cur=0;phase=0;saveHuman();await refreshEvidence()}catch(e){$('liveState').textContent='Création refusée : '+e.message;$('goldenLogin').hidden=!/Token manquant|connectez-vous|HTTP 401/i.test(String(e.message))}finally{b.disabled=false}});
$('advance').addEventListener('click',async()=>{if(!ref)return;const requestedRef=ref,readId=++evidenceRead;$('advance').disabled=true;proofReady=false;backend=Array(steps.length).fill(null);render();$('liveState').textContent='Déclenchement de la prochaine frontière canonique…';try{const r=await fetch('/api/admin/entities/orders/'+encodeURIComponent(ref)+'/golden-advance',{method:'POST',credentials:'include',headers:{Accept:'application/json'}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||('HTTP '+r.status));if(ref!==requestedRef||readId!==evidenceRead)return;proofReady=validGoldenProjection(body.projection,requestedRef);backend=proofReady?body.projection.steps:Array(steps.length).fill(null);$('liveState').textContent=body.complete?'Golden complet':'Étape déclenchée · prochaine frontière : '+(body.next&&body.next.key||'observation');render()}catch(e){if(ref!==requestedRef||readId!==evidenceRead)return;proofReady=false;backend=Array(steps.length).fill(null);$('liveState').textContent='Déclenchement refusé : '+e.message;render();}finally{$('advance').disabled=false;}});$('pass').addEventListener('click',()=>{if(!proofReady)return;if(!ref){$('liveState').textContent='Renseigne la référence de commande avant de valider une étape humaine.';return;}states[cur]='pass';findings[cur]={state:'pass',note:$('humanObservation').value.slice(0,2000),when:new Date().toISOString()};saveHuman();render()});$('fail').addEventListener('click',()=>{if(!ref)return;states[cur]='fail';findings[cur]={state:'fail',note:$('humanObservation').value.slice(0,2000),when:new Date().toISOString()};saveHuman();render()});$('reset').addEventListener('click',()=>{states.fill('pending');findings.fill(null);cur=0;phase=0;saveHuman();render()});$('refresh').addEventListener('click',refreshEvidence);$('refForm').addEventListener('submit',e=>{e.preventDefault();ref=$('refInput').value.trim().slice(0,80).toUpperCase();restoreHuman();backend.fill(null);cur=0;phase=0;render();refreshEvidence()});$('marketSelect').addEventListener('change',()=>{if(ref){proofReady=false;++evidenceRead;backend.fill(null);restoreHuman();refreshEvidence()}render()});setInterval(()=>{if(ref)refreshEvidence()},5000);function renderWizard(){
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
  $('pass').disabled=!proofReady;
  $('humanObservation').value=(findings[cur]&&findings[cur].note)||'';
  $('humanRecord').textContent=(findings[cur]&&findings[cur].when)?'Constat '+states[cur]+' · '+new Date(findings[cur].when).toLocaleString('fr-FR'):'Aucun constat humain enregistré pour cette étape.';
  if(phase===2&&!proofReady)next.disabled=true;
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
    if(phase<2){phase++;renderWizard();return}
    if(!proofReady)return;
    if(states[cur]==='pass'&&cur<steps.length-1){cur++;phase=0;render()}
  });
  $('wizardBack').addEventListener('click',()=>{
    if(phase>0){phase--;renderWizard()}
    else if(cur>0){cur--;phase=2;render()}
  });
  $('wizardChange').addEventListener('click',()=>{
    proofReady=false;++evidenceRead;ref='';cur=0;phase=0;states.fill('pending');findings.fill(null);backend.fill(null);
    try{localStorage.removeItem(STORE_PREFIX+'last')}catch(_){}
    $('liveState').textContent='Choisis une commande à suivre.';
    render();
  });
}
initWizard();
try{const last=JSON.parse(localStorage.getItem(STORE_PREFIX+'last')||'null');if(last&&last.guide===GUIDE_VERSION&&['KM','CM','CG'].includes(last.market)&&/^K-GOLDEN-[A-Z0-9_-]{1,70}$/i.test(last.reference||'')){$('marketSelect').value=last.market;ref=last.reference;$('refInput').value=ref;restoreHuman();refreshEvidence()}}catch(_){}
render()})();
