/**
 * @komerce-arch
 * @role golden-human-scenario-controller
 * @domain admin-dashboard
 * @layer frontend
 * @criticality medium
 * @inputs human_test_scope
 * @outputs browser_local_human_observations
 * @db-read none
 * @db-write none
 * @doctrine human_observation_is_not_backend_evidence,fail_closed_auth_and_scope
 * @version 2026-10
 */
'use strict';
(()=>{
const $=id=>document.getElementById(id);
const RECIPE_VERSION='HUMAN-RECETTE-V1-2026-10-14';
const PREFIX='komerce.recipe.scenarios.';
const GITHUB='https://github.com/SamyrFateh/komerce-backend/blob/main/';
const e=(title,actor,path,expected,proof,source)=>({title,actor,path,expected,proof,source:GITHUB+source});
const TRACKS=Object.freeze({
 cj:{label:'CJ · lot 20 / 15 / 5',steps:[
  e('Identifier la source CJ','Sourcing','/admin/workspaces/sourcing','Identifier le run CJ exact, le Market et les références fournisseur ; ne pas réutiliser un seed comme preuve réelle.','Run ID, fournisseur, SKU, Market, date UTC, état de lecture réel.','docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md'),
  e('Rapprocher les 20 entrées','Sourcing','/admin/workspaces/sourcing','Retrouver les 20 éléments attendus par la fixture 20/15/5 ; confronter les identifiants au run canonique.','Décompte, liste des 20 IDs distincts et origine de la fixture.','services/suppliers/connectors/cj-connector.js'),
  e('Qualifier les 15 éléments','Raffinerie / Catalogue','/admin/workspaces/catalog','Identifier les 15 éléments de la branche attendue sans présumer publiés, acceptés ou commandables ; lire leur statut réel.','IDs, statuts, décision, éventuels SKU/Unit exacts et horodatage.','services/golden-upstream-evidence.js'),
  e('Expliquer les 5 restants','Sourcing / Qualité','/admin/workspaces/sourcing','Identifier les 5 éléments restants et leur véritable issue ; justifier 20 = 15 + 5 sans les appeler rejets par défaut.','5 IDs, motifs et décisions, pas de disparition silencieuse.','docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md'),
  e('Raccorder au parcours client','Catalogue / Achats','/admin/workspaces/purchasing','Comparer les produits réellement exposés aux décisions Sourcing et aux preuves d’achat ; aucune PO ou paiement CJ présumé.','Product/SKU/Unit, exposure Market, éventuelle PO, preuve indépendante.','docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md')
 ]},
 collective:{label:'Partage et financement · contrat actuel',steps:[
  e('Identifier le contrat actif','Produit / Admin','/admin/commerce','Distinguer la Liste partageable actuelle du moteur collectif historique. Vérifier le parcours réellement exposé ; ne pas réactiver un ancien modèle.','Version, route UI active, statut backend, doctrine appliquée.','docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md'),
  e('Partager sans muter la sélection','Créateur / Participant','/admin/commerce','Contrôler le lien partagé, les lignes figées et les droits du participant ; aucune modification indue après partage.','Capture écran, référence de liste, lignes/quantités comparées.','docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md'),
  e('Identifier la vraie frontière de paiement','Client / Finance','/admin/finance','Établir qui paie, à quel moment OTP intervient et quelle preuve Stripe/cash appartient au contrat courant. Pas de paiement réel.','Session sandbox ou simulation autorisée, statut serveur, idempotence.','docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md'),
  e('Observer le cas 100 %','Créateur / Opérations','/admin/operations','Vérifier la conséquence exacte de 100 % selon le moteur actif : ne présumer ni ORDERED automatique ni commande manuelle.','États avant/après, contrat actif, référence éventuelle de commande.','docs/backend/PANIER_COLLECTIF_BACKEND_DELTA.md'),
  e('Observer insuffisance et choix','Créateur / Finance','/admin/finance','Si le moteur actif prévoit 48 h et AWAITING_CHOICE/72 h, contrôler Compléter / Réduire / Annuler ; sinon consigner « ancien contrat / N/A justifié ».','Horodatages et choix enregistrés, preuve de version du contrat.','migrations/080_v41_shared_cart_state_machine.sql'),
  e('Boucler vers le client et le pilotage','Client / Pilotage','/admin/pilotage','Suivre statut final, communications et impact finance/commandes. Aucun parcours complet déclaré certifié sans chaque frontière.','Référence, notifications, écran client et comparaison aux APIs.','docs/audits/FULL_RECETTE_E2E_EVIDENCE_REGISTER.md')
 ]},
 l1l10:{label:'Backoffice · remédiations L1 à L10',steps:[
  e('L1 · vérité des KPI','Pilotage / Opérations / Finance','/admin/pilotage','P-01, O-02, O-03, F-02 : actives/paiements/retards même propriétaire, scope et statut.','JSON propriétaire + période + Market + devise + capture.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L2 · menu et capacités','Opérateur / Admin','/admin/pilotage','C-10, N-01, N-02, N-03 : menu cohérent avec les capacités serveur, pas de 403 promis.','Deux comptes de rôles distincts, écran menu + HTTP.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L3 · Commandes dans Opérations','Opérations','/admin/operations','O-01, O-04 : deux files conservées, /admin/orders redirige, Order 360 préservé.','URL, lignes des files, retour au 360.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L4 · navigation contextualisée','Pilotage / Action Center','/admin/action-center','C-08, A-02, O-05, P-04 : origine, returnTo, filtres et CTA « Traiter » conservés.','Quatre origines testées + URL et captures retour.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L5 · trois Live fiables','Sourcing / Hub / Relais','/admin/import-runtime','L-01 à L-09 : generated_at serveur, état périmé, erreur visible, polling unique, confidentialité.','Réseau + captures, erreurs simulées en environnement isolé.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L6 · Action Center traçable','Action Center','/admin/action-center','P-02, A-01, A-03, A-04 : compteur égal aux lignes et résolution justifiée ; ne pas contourner D3.','Liste/API, droits, note obligatoire, audit.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L7 · unités Hub / Relais','Hub / Relais','/admin/hub-live','L-10 : quantités de colis et commandes non confondues ; D4 requis pour comparaison.','Même market/fixture/unité dans workspace et Live.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L8 · marchés accessibles','Administration Market','/dashboards/canonical/access.html','N-05, C-06 : Hero unique, accès marchés visible et D5 explicitement tranchée ou exclue.','URL, captures 1280/1440/1672 et droits.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L9 · aucun retrait Legacy cassé','Navigation / Terrain','/admin/operations','N-04, N-06 : recherche, retrait, douane, fournisseurs et applications terrain préservés ; D6/D7 à tracer.','Inventaire de routes, consommateur et non-régression.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L10 · parité visuelle','UX / métier','/admin/commerce','U-01, U-02, C-06, C-11 : cinq références et 30 secondes métier ; Live inchangé visuellement.','Captures 1280/1440/1672, écarts, 4/4 réponses ≤30 s.','docs/audits/BACKOFFICE_CANONICAL_GAP.md')
 ]}
});
let run=null,stepIndex=0,phase=0,authReady=false,records=[];
function key(){return PREFIX+JSON.stringify([RECIPE_VERSION,run.track,run.market,run.ref,run.sha]);}
function save(){
 if(!run)return;
 try{
  localStorage.setItem(key(),JSON.stringify({version:RECIPE_VERSION,run,records}));
  localStorage.setItem(PREFIX+'last',JSON.stringify(run));
  $('scenarioSaved').textContent='Constats sauvegardés localement · pas de certification backend.';
 }catch(_){$('scenarioSaved').textContent='Échec sauvegarde navigateur : ne pas fermer cette session.';}
}
function restore(){
 records=TRACKS[run.track].steps.map(()=>({status:'pending',note:'',proof:'',time:''}));
 try{
  const x=JSON.parse(localStorage.getItem(key())||'null');
  if(!x||x.version!==RECIPE_VERSION||!Array.isArray(x.records)||x.records.length!==records.length)return;
  records=x.records.map(v=>({
   status:['observed','blocked'].includes(v&&v.status)?v.status:'pending',
   note:typeof(v&&v.note)==='string'?v.note.slice(0,1600):'',
   proof:typeof(v&&v.proof)==='string'?v.proof.slice(0,300):'',
   time:typeof(v&&v.time)==='string'?v.time:''
  }));
 }catch(_){}
}
function showMessage(value){$('scenarioMessage').textContent=value;}
function record(status){
 if(!run)return;
 const note=$('scenarioNote').value.trim().slice(0,1600);
 const proof=$('scenarioProof').value.trim().slice(0,300);
 if(note.length<8){showMessage('Décris d’abord ce qui est réellement observé (8 caractères minimum).');return;}
 if(status==='observed'&&(!authReady||proof.length<8)){
  showMessage('Lecture admin autorisée et référence de preuve requises pour enregistrer une observation.');
  return;
 }
 records[stepIndex]={status,note,proof,time:new Date().toISOString()};
 save();showMessage(status==='observed'?'Observation humaine enregistrée ; preuve backend toujours NON PROUVÉE.':'Blocage consigné. Aucune validation de cette étape.');
 render();
}
function render(){
 if(!run)return;
 const track=TRACKS[run.track],s=track.steps[stepIndex],v=records[stepIndex];
 $('scenarioStage').hidden=false;
 $('scenarioHeading').textContent=track.label+' · '+run.market+' · '+run.ref;
 $('scenarioCount').textContent='Étape '+(stepIndex+1)+' / '+track.steps.length;
 $('scenarioTitle').textContent=s.title;
 $('scenarioExpected').textContent=s.expected;
 $('scenarioActor').textContent='Acteur : '+s.actor;
 $('scenarioProofExpected').textContent=s.proof;
 $('scenarioOpen').href=s.path;
 $('scenarioSource').href=s.source;
 $('scenarioState').textContent='Constat humain : '+(v.status==='observed'?'OBSERVÉ':v.status==='blocked'?'BLOQUÉ':'NON EXÉCUTÉ')+' · automatique : NON PROUVÉ';
 $('scenarioNote').value=v.note;
 $('scenarioProof').value=v.proof;
 $('scenarioNext').textContent=phase<2?(phase===0?'Voir l’écran →':'Saisir le constat →'):(stepIndex===track.steps.length-1?'Fin du guide':'Étape suivante →');
 $('scenarioBack').disabled=phase===0&&stepIndex===0;
 $('scenarioNext').disabled=phase===2&&(v.status!=='observed'||stepIndex===track.steps.length-1);
 $('scenarioObserved').disabled=!authReady;
 $('scenarioStage').dataset.phase=['guide','view','validate'][phase];
 $('scenarioPhases').textContent=['1 · Comprendre','2 · Visualiser','3 · Valider'][phase];
 $('scenarioProgress').textContent=records.filter(x=>x.status==='observed').length+' observation(s) / '+track.steps.length+' · jamais certifié';
 $('scenarioVersion').textContent='SHA déclaré : '+run.sha+' (à confronter au staging réellement déployé)';
}
async function checkAuth(){
 if(!run)return;
 authReady=false;$('scenarioAuth').textContent='Vérification de lecture en cours…';
 try{
  const r=await fetch('/api/admin/entities/golden-upstream?market='+encodeURIComponent(run.market),{credentials:'include',headers:{Accept:'application/json'}});
  if(!r.ok){
   const b=await r.json().catch(()=>({}));
   $('scenarioAuth').textContent=(r.status===401||r.status===403?'Session ou autorité refusée : ':'Lecture non disponible : ')+(b.error||'HTTP '+r.status);
   showMessage('Prérequis d’authentification NON PROUVÉ. Ouvre une session admin autorisée puis recommence.');
  }else{
   authReady=true;
   $('scenarioAuth').textContent='Accès de lecture des preuves amont : autorisé. Accès aux autres marchés/surfaces NON prouvé.';
  }
 }catch(_){$('scenarioAuth').textContent='Accès de lecture NON PROUVÉ : erreur réseau.';}
 render();
}
function begin(){
 const track=$('scenarioTrack').value,market=$('scenarioMarket').value;
 const ref=$('scenarioRef').value.trim().slice(0,80).toUpperCase();
 const sha=$('scenarioSha').value.trim().toLowerCase();
 if(!TRACKS[track]||!['KM','CM','CG'].includes(market)||!ref||!/^[0-9a-f]{7,40}$/.test(sha)){
  showMessage('Choisis un guide et un market, renseigne une référence de fixture/commande et un SHA staging valide.');
  return;
 }
 run={track,market,ref,sha};
 stepIndex=0;phase=0;authReady=false;
 restore();save();showMessage('Guide ouvert. Vérifie l’accès authentifié ; chaque observation exige une preuve datée.');
 $('scenarioAuth').textContent='Accès authentifié : NON VÉRIFIÉ';
 render();
}
$('scenarioStart').addEventListener('click',begin);
$('scenarioAuthButton').addEventListener('click',checkAuth);
$('scenarioObserved').addEventListener('click',()=>record('observed'));
$('scenarioBlocked').addEventListener('click',()=>record('blocked'));
$('scenarioNext').addEventListener('click',()=>{
 if(phase<2){phase++;render();return;}
 if(records[stepIndex].status==='observed'&&stepIndex<TRACKS[run.track].steps.length-1){stepIndex++;phase=0;render();}
});
$('scenarioBack').addEventListener('click',()=>{
 if(phase>0)phase--;
 else if(stepIndex>0){stepIndex--;phase=2;}
 render();
});
$('scenarioRestart').addEventListener('click',()=>{
 if(!run)return;
 try{localStorage.removeItem(key());localStorage.removeItem(PREFIX+'last')}catch(_){}
 run=null;authReady=false;$('scenarioStage').hidden=true;
 showMessage('Guide fermé ; les constats locaux de ce périmètre ont été effacés.');
});
try{
 const last=JSON.parse(localStorage.getItem(PREFIX+'last')||'null');
 if(last&&TRACKS[last.track]&&['KM','CM','CG'].includes(last.market)&&typeof last.ref==='string'&&/^[0-9a-f]{7,40}$/.test(last.sha||'')){
  $('scenarioTrack').value=last.track;$('scenarioMarket').value=last.market;
  $('scenarioRef').value=last.ref;$('scenarioSha').value=last.sha;
  begin();
 }
}catch(_){}
})();