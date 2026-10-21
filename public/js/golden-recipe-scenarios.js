/**
 * @komerce-arch
 * @role golden-human-scenario-controller
 * @domain admin-dashboard
 * @layer frontend
 * @criticality medium
 * @inputs human_test_scope
 * @outputs browser_local_human_observations
 * @depends none
 * @used-by public/golden-e2e-cockpit.html
 * @db-read none
 * @db-write none
 * @db-txn none
 * @impact-areas dashboard, e2e-certification
 * @doctrine human_observation_is_not_backend_evidence,fail_closed_auth_and_scope
 * @version 2026-10
 */
'use strict';
(()=>{
const $=id=>document.getElementById(id);
const RECIPE_VERSION='HUMAN-RECETTE-V1-2026-10-14';
const PREFIX='komerce.recipe.scenarios.';
const GITHUB='https://github.com/SamyrFateh/komerce-backend/blob/';
const e=(title,actor,path,expected,proof,source)=>({title,actor,path,expected,proof,source});
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
 rct1:{label:'RCT1 × Golden · P1–P7 (recette guidée)',steps:[
  e('Version et isolation RCT1','Admin staging','/admin/finance','Comparer le SHA réellement déployé à /health/version avant toute observation. RCT1 est un périmètre simulé, jamais de la vente réelle ; vérifier sans et avec scope.','SHA, session, marché, période, API, référence RCT1 et exclusion du réel.','docs/recette/RCT1_GOLDEN_P1_P7_CONVERGENCE_20261021.md'),
  e('P1 · origine fournisseur et qualification','Sourcing / Raffinerie','/admin/workspaces/sourcing','Retrouver la source, le run, le SKU et la décision canonique ; les produits RCT1 et le lot CJ indépendant ne prouvent pas un même parcours sans référence liée.','Source → décision → catalogue, preuves indépendantes, ou NON COUVERT motivé.','docs/doctrine/KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md'),
  e('P1 · prix et exposition par marché','Admin / Responsable pays','/admin/workspaces/pricing','Contrôler origine LOCAL_STOCK vs IMPORT, coûts applicables, conversion P5, prix local et approbation humaine ; vérifier offre globale et exposition par marché.','Product/SKU, prix, unités, parité, catégorie, provenance, décision et exposition.','docs/recette/RECETTE_STAGING_CADRAGE_EXECUTABLE.md'),
  e('P2 · commandes et paiement','Opérations','/admin/orders','Ouvrir la vue Commandes DISTINCTE, les files et Order 360 ; rattacher E1, F, C, C2, I3 et G au bon marché. Liste et partage selon contrat actif, aucun checkout nouveau supposé.','Référence, statut, paiement, wallet, marché, produits, colis, retour contextuel ; F/C restent incomplets.','services/dashboard-orders.js'),
  e('Commerce · ventes payées RCT1','Responsable pays','/admin/commerce','Comparer la même cohorte payée dans les KPI, série par jour, répartition marchés et dernières commandes. Contrôler RCT1 vs activité réelle séparément, sans imposer les chiffres historiques.','API JSON, période, ventes wallet compris, devises, captures, écarts vs preuve datée.','services/dashboard-commerce.js'),
  e('P3 · achats fournisseurs','Acheteur','/admin/workspaces/purchasing','Relier les commandes payées à des PO, quantités, prix et réception ; absence de PO réelle = NON COUVERT, pas réussite implicite.','Référence de PO, ligne, preuve fournisseur, état et propriétaire.','features/purchasing.feature.js'),
  e('P4 · réception au Hub Dubaï','Agent Hub','/admin/hub-live','Flux Hub par défaut. Lire réception PO, unités, quarantaine, marchés ; PO groupé ne signifie pas groupage transport ni expédition prête.','PO → unité reçue, horodatage, état, GAP explicite si source absente.','services/hub-dubai-projection.js'),
  e('P4 · transport et douane','Transitaire','/admin/workspaces/shipping-customs','Rapprocher I3 scindé, SH1 douane inconnue, SH2 douane zéro confirmé, frais ventilés sans double compte ; trajet Dubaï → marché jamais présumé.','Shipment, ligne, colis, fret, douane NULL/0 explicite, segments À CONFIGURER.','docs/recette/RECETTE_STAGING_CADRAGE_EXECUTABLE.md'),
  e('P2/P4 · remise au relais','Agent relais','/admin/relais-live','Suivre le même colis et la même commande jusqu’à la remise, sans confondre unités et commandes ; J/K inter-marchés restent sous contrôle.','Référence, état disponible/collecté, preuve remise, marché et droits 403/409.','services/golden-checkout-thread.js'),
  e('P5 · encaissement et garde cash','Finance / Responsable pays','/admin/workspaces/accounting','Distinguer vente payée, cash détenu, dépôt reçu et settlement ; Stripe E2 uniquement si mode test prouvé, sans paiement réel.','Événement source, mode, autorité, custody, confirmation ou NON COUVERT.','docs/doctrine/KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md'),
  e('P6 · coûts constatés et marge finalisée','Finance','/admin/finance','Rapprocher E1/G (historique 4 765 / 1 850 KMF), F sans relais, C douane inconnue, I3 fret ventilé. Calcul de marge uniquement si coûts réels complets ; revue prix P6 → P1 humaine.','Coût et provenance FICTIF recette, applicabilité, complétude, 3 KPI Finance et statut actual/partial.','services/dashboard-finance-canonical.js'),
  e('P7 · Pilotage et marché','Admin / Responsable pays','/admin/pilotage','Superviser les marchés ACTIVE même sans commande, alertes, chaîne de valeur, accès aux dashboards et décisions humaines ; valider isolations de droits et retour contextuel.','Market, readiness, période, réel/RCT1 si supporté, incidents, 401/403, preuve écran et prochaine décision.','docs/doctrine/KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md')
 ]},
 process:{label:'Parcours canonique · offre → commande → clôture',steps:[
  e('Sourcing · origine fournisseur','Sourcing','/admin/workspaces/sourcing','Sélectionner une source et son passage réel : source fournisseur, product_ref, SKU, provenance et run identifié. Aucun import fictif déclaré réel.','Capture, run ID, source, supplier_unit_ref, date et réponse canonique.','services/sourcing-integrity-service.js'),
  e('Sourcing live · synchronisation','Sourcing','/admin/import-runtime','Comparer le passage et son horodatage à Sourcing ; Live observe sans créer un deuxième statut. Erreurs et fraîcheur explicites.','Référence du même run, generated_at, erreurs et nombre de candidats.','public/dashboards/canonical/js/import-runtime.js'),
  e('Raffinerie · qualification','Raffinerie','/admin/workspaces/sourcing','Dans le parcours Raffinerie, suivre la même unité importée : classée, à compléter ou refusée, avec motif. Aucune publication par déduction.','Produit/SKU, classification canonique, transformation, statut et arbitrage.','services/golden-upstream-evidence.js'),
  e('Atelier des prix · décision économique','Admin / Prix','/admin/workspaces/pricing','Comparer coût d’achat source, transport, douane, coûts applicables, devise et prix par marché. Inconnu ne vaut jamais zéro ; activation manuelle seulement.','Unités, assiettes, parités KM/CM/CG, provenance et décision humaine.','features/economic-engine.feature.js'),
  e('Catalogue global · offre validée','Catalogue','/admin/workspaces/catalog','Vérifier catégorie, SKU et décision de publication de la fiche canonique ; absence de prix ou approbation = non exposé, jamais vert présumé.','Product ref, SKU, état actif/exposé et preuves de décision.','features/catalog.feature.js'),
  e('Marchés · projections locales','Responsable pays','/dashboards/canonical/access.html','Confronter visibilité, prix et disponibilité KM/CM/CG aux projections locales réelles ; un marché sans donnée ne devient pas automatiquement vendu.','Code Market, produit et source du prix local, réponse API et autorité.','docs/doctrine/DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS.md'),
  e('Liste, partage et engagement','Créateur / Participant','/admin/commerce','Contrôler la Liste figée, son partage, l’OTP et le paiement conforme au contrat actif, sans nouveau paiement réel ni état automatique supposé.','Liste et lignes, référence, version de contrat, paiements prouvés.','docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md'),
  e('Commande · paiement et files','Opérations','/admin/orders','Rapprocher référence de commande, statut payé, valeur wallet comprise et files d’exécution. La date de création ne prouve pas la date d’encaissement.','Order 360, montant KMF, statut, Market et events de paiement.','services/dashboard-commerce.js'),
  e('Achats · engagement fournisseur','Acheteur','/admin/workspaces/purchasing','Partir des lignes commandées et suivre PO, exécution et preuve fournisseur, sans transformer requested en réel payé.','PO/ligne, supplier_order_id, état d’exécution, preuve de débit vérifiée ou absente.','features/purchasing.feature.js'),
  e('Hub · réception du fournisseur','Agent Hub','/admin/hub-live','Relier PO à réception et unités Hub : idempotence, quantité attendue/reçue, exceptions ; le Hub Live est une lecture, pas le propriétaire de la mutation.','PO, unités, date et statut d’opération, quarantaine éventuelle.','services/golden-checkout-thread.js'),
  e('Transport · douane et groupage','Transitaire','/admin/workspaces/shipping-customs','Tracer regroupement, colis, transports, taxes et preuve de douane. Inconnu, zéro confirmé et montant payé doivent rester distincts.','Shipment, colis, frais typés, événements, montant et applicabilité.','features/customs.feature.js'),
  e('Relais · remise client','Agent Relais','/admin/relais-live','Comparer colis arrivé, disponibilité, retrait et preuve de remise ; ne pas confondre commandes, colis et unités.','Référence commande, unité, relais/Market, horodatage de remise.','services/golden-checkout-thread.js'),
  e('Finance · coûts et marge réels','Finance','/admin/finance','Rapprocher ventes, encaissements et coûts réels complets avec leur provenance. Marge inconnue ou partielle ≠ marge zéro.','Vente, coût estimé/réel, couverture, statut de complétude, période.','services/dashboard-finance-canonical.js'),
  e('Pilotage · bilan partenaire','Admin / Responsable pays','/admin/pilotage','Consolider les décisions par Market sans agréger des monnaies différentes ni présenter RCT1 comme activité réelle. Capturer écarts, responsabilité et prochaine action.','Tableau pays, décision, responsables, captures et verdict humain distinct de CI.','features/dashboard.feature.js')
 ]},
 dashboards:{label:'Contrôle canonique · 5 décisions + 3 Live',steps:[
  e('Pilotage · contexte et décisions','Admin / Responsable pays','/admin/pilotage','Vérifier indicateurs, source, âge, périmètre Market et liens vers Action Center. Ne pas transformer un signal en écriture automatique.','Capture 1440/1024/390, réponse API, période, Market, rôles et CTA.','public/dashboards/canonical/js/pilotage-decision.js'),
  e('Commerce · quatre KPI','Admin / Responsable pays','/admin/commerce','Réconcilier ventes payées wallet inclus, commandes créées, panier moyen, quantités vendues, devises et vue RCT1 isolée.','Même période et scope : attendu vs JSON API vs écran, KMF/XAF ; source SQL RCT1.','services/dashboard-commerce.js'),
  e('Commandes · files et Order 360','Opérations / Responsable pays','/admin/orders','Contrôler Cash à confirmer, Colis à créer, commandes à suivre et Order 360 ; /admin/orders est une vue distincte, sans statut parallèle.','Comptes des deux files, API, URL Order 360, retour et droits.','bootstrap/html-routes.js'),
  e('Opérations · contrôle de chaîne','Opérations','/admin/operations','Ordre des étapes et situations de livraison, santé/cause de chaque commande, lien vers le propriétaire ; aucune donnée inventée.','Commande → étape → cause → propriétaire, action réalisable, retour contextuel.','public/dashboards/canonical/js/operations-decision.js'),
  e('Finance · vérité économique','Finance / Admin','/admin/finance','Séparer encaissement, vente, coût réel, marge inconnue et dépenses estimées ; vérifier provenance et cohorte RCT1/réel.','KPI, unités, réconciliation source, complétude et vues marché.','services/dashboard-finance-canonical.js'),
  e('Sourcing live · fraîcheur','Sourcing','/admin/import-runtime','Vérifier run fournisseur, heure du dernier relevé, erreur visible, polling unique et confidentialité.','URL live, generated_at, erreurs, scopes et rôle.','public/dashboards/canonical/js/import-runtime.js'),
  e('Hub live · quantités','Agent Hub','/admin/hub-live','Confronter commandes, colis et unités reçues ; surveillance sans mutation du stock depuis le cockpit Live.','Identifiants PO/HUB, unités, statut, timestamp serveur.','public/dashboards/canonical/js/hub-live.js'),
  e('Relais live · remise','Agent Relais','/admin/relais-live','Confronter colis disponibles, commandes remises, état de fraîcheur et autorisation du relais.','Market/relais, unités, horodatages et absence de fuite inter-marchés.','public/dashboards/canonical/js/relay-live.js')
 ]},
 l1l10:{label:'Backoffice · remédiations historiques L1 à L10',steps:[
  e('L1 · vérité des KPI','Pilotage / Opérations / Finance','/admin/pilotage','P-01, O-02, O-03, F-02 : actives/paiements/retards même propriétaire, scope et statut.','JSON propriétaire + période + Market + devise + capture.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L2 · menu et capacités','Opérateur / Admin','/admin/pilotage','C-10, N-01, N-02, N-03 : menu cohérent avec les capacités serveur, pas de 403 promis.','Deux comptes de rôles distincts, écran menu + HTTP.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L3 · Ancien regroupement Commandes / Opérations','Opérations','/admin/orders','O-01, O-04 : état historique remplacé par #2786 ; vue Commandes désormais distincte, files réutilisées et Order 360 préservé.','URL, lignes des files, retour au 360.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L4 · navigation contextualisée','Pilotage / Action Center','/admin/action-center','C-08, A-02, O-05, P-04 : origine, returnTo, filtres et CTA « Traiter » conservés.','Quatre origines testées + URL et captures retour.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L5 · trois Live fiables','Sourcing / Hub / Relais','/admin/import-runtime','L-01 à L-09 : generated_at serveur, état périmé, erreur visible, polling unique, confidentialité.','Réseau + captures, erreurs simulées en environnement isolé.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L6 · Action Center traçable','Action Center','/admin/action-center','P-02, A-01, A-03, A-04 : compteur égal aux lignes et résolution justifiée ; ne pas contourner D3.','Liste/API, droits, note obligatoire, audit.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L7 · unités Hub / Relais','Hub / Relais','/admin/hub-live','L-10 : quantités de colis et commandes non confondues ; D4 requis pour comparaison.','Même market/fixture/unité dans workspace et Live.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L8 · marchés accessibles','Administration Market','/dashboards/canonical/access.html','N-05, C-06 : Hero unique, accès marchés visible et D5 explicitement tranchée ou exclue.','URL, captures 1280/1440/1672 et droits.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L9 · aucun retrait Legacy cassé','Navigation / Terrain','/admin/operations','N-04, N-06 : recherche, retrait, douane, fournisseurs et applications terrain préservés ; D6/D7 à tracer.','Inventaire de routes, consommateur et non-régression.','docs/audits/BACKOFFICE_CANONICAL_GAP.md'),
  e('L10 · parité visuelle','UX / métier','/admin/commerce','U-01, U-02, C-06, C-11 : cinq références et 30 secondes métier ; Live inchangé visuellement.','Captures 1280/1440/1672, écarts, 4/4 réponses ≤30 s.','docs/audits/BACKOFFICE_CANONICAL_GAP.md')
 ]}
});
let run=null,stepIndex=0,phase=0,authReady=false,probeId=0,records=[],verifiedCommit=null;
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
function hrefForStep(path){
 if(!run||!/^RCT1(?:-|$)/.test(run.ref))return path;
 if(!/^\/admin\/(?:commerce|finance)(?:\?|$)/.test(path))return path;
 return path+(path.includes('?')?'&':'?')+'simulation_scope=RCT1';
}
function scopeNote(path){
 if(!run||!/^RCT1(?:-|$)/.test(run.ref))return '';
 return /^\/admin\/(?:commerce|finance)(?:\?|$)/.test(path)
  ? ' · RCT1 : filtre explicite sur cet écran.'
  : ' · RCT1 : écran sans filtre de simulation certifié ; rapprocher uniquement les références et faits canoniques.';
}
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
 $('scenarioProofExpected').textContent=s.proof+scopeNote(s.path);
 $('scenarioOpen').href=hrefForStep(s.path);
 $('scenarioSource').href=GITHUB+encodeURIComponent(run.sha)+'/'+s.source;
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
 $('scenarioVersion').textContent=verifiedCommit
  ? 'SHA staging vérifié : '+verifiedCommit.slice(0,12)
  : 'SHA déclaré : '+run.sha+' (NON VÉRIFIÉ contre staging)';
}
async function checkAuth(){
 if(!run)return;
 const expectedKey=key(),currentProbe=++probeId;
 authReady=false;verifiedCommit=null;$('scenarioAuth').textContent='Vérification de version et de lecture en cours…';
 try{
  const v=await fetch('/health/version',{cache:'no-store',headers:{Accept:'application/json'}});
  if(!run||key()!==expectedKey||currentProbe!==probeId)return;
  if(!v.ok)throw new Error('version indisponible HTTP '+v.status);
  const body=await v.json();
  const actual=typeof body.commit==='string'?body.commit.toLowerCase():'';
  if(!/^[0-9a-f]{7,40}$/.test(actual)||!(actual.startsWith(run.sha)||run.sha.startsWith(actual))){
   $('scenarioAuth').textContent='BLOQUÉ : commit staging absent ou différent du SHA déclaré. Actualise le SHA déployé.';
   showMessage('Version staging NON PROUVÉE : impossible d’enregistrer une observation pour ce run.');
   render();return;
  }
  verifiedCommit=actual;
  const r=await fetch('/api/admin/entities/golden-upstream?market='+encodeURIComponent(run.market),{credentials:'include',headers:{Accept:'application/json'}});
  if(!run||key()!==expectedKey||currentProbe!==probeId)return;
  if(!r.ok){
   const b=await r.json().catch(()=>({}));
   $('scenarioAuth').textContent=(r.status===401||r.status===403?'Session ou autorité refusée : ':'Lecture non disponible : ')+(b.error||'HTTP '+r.status);
   showMessage('Prérequis d’authentification NON PROUVÉ. Ouvre une session admin autorisée puis recommence.');
  }else{
   authReady=true;
   $('scenarioAuth').textContent='SHA staging vérifié ; lecture des preuves amont autorisée. Autorité des autres marchés/surfaces NON prouvée.';
  }
 }catch(_){if(!run||key()!==expectedKey||currentProbe!==probeId)return;
  $('scenarioAuth').textContent='Accès de lecture ou vérification SHA NON PROUVÉ : erreur réseau/version.';}
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
 stepIndex=0;phase=0;authReady=false;verifiedCommit=null;++probeId;
 $('extendedRecipe').open=true;
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
 run=null;authReady=false;verifiedCommit=null;++probeId;$('scenarioStage').hidden=true;
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