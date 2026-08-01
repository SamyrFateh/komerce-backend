/**
 * @komerce-arch
 * @role          admin-portal-pilotage-shell
 * @domain        admin-dashboard
 * @layer         ui-shell
 * @owner         dashboards
 * @purpose       Shell de pilotage multi-role (admin/finance/sourcing/hub/relais) — aiguille vers CT ou BO selon le role.
 * @impact-areas  pilotage, roles, navigation
 * @version       2026-06
 */
'use strict';
const FMT=new Intl.NumberFormat('fr-FR');

/* ── Rôles (miroir de app.js) ──────────────────────────────── */
const KNOWN_ROLES=['admin','finance','sourcing','hub','relais','support'];
const ROLE_SHELLS={admin:['ct','bo'],finance:['ct','bo'],sourcing:['ct','bo'],hub:['bo'],relais:['bo'],support:['bo']};
const CT_ALL=['admin','finance','sourcing'];                                   // routes CT "tous"
const BO_ALL=['admin','finance','sourcing','hub','relais','support'];          // routes BO "tous"
const hasCT=role=>(ROLE_SHELLS[role]||[]).includes('ct');

/* ── Métriques : démo par défaut, remplacées par le live ───────
   Live mappé sur 2 endpoints réels (cf. services backend) :
     /api/dashboard/ops     → activite, sla, logistique, alertes
     /api/dashboard/finance → kpi, marges, evolution
   Repli propre : tout champ absent garde sa valeur démo.        */
const DEMO={ caKmf:4_820_000, caPct:11, margePct:22.4, nbSansCost:0,
  enCours:63, bloquees:4, slaRisque:7, hubAtraiter:18, alertes:3, panier:38500, ruptures:6 };
let M={...DEMO};

const FR=(n,d=0)=>new Intl.NumberFormat('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
const caM=k=>k==null?'—':FR(k/1e6,2);
const trend=p=>p==null?'':`<span class="trend ${p>=0?'up':'down'}">${p>=0?'▲':'▼'} ${FR(Math.abs(p),1)}%</span>`;

function dirKpis(){return [
  {label:'💶 CA période',      val:caM(M.caKmf), unit:'M KMF', sub:M.caPct!=null?trend(M.caPct)+' vs préc.':'période courante', tone:'var(--amber)'},
  {label:'📊 Marge nette',     val:M.margePct!=null?FR(M.margePct,1):'—', unit:'%', sub:M.nbSansCost?`${M.nbSansCost} cmd sans coût saisi`:'coûts complets', tone:'var(--green)'},
  {label:'📦 Commandes en cours', val:String(M.enCours), unit:'', sub:'flux en cours', tone:'var(--blue)'},
  {label:'⛔ Bloquées',        val:String(M.bloquees), unit:'', sub:'&gt; 7 j sans mouvement', tone:M.bloquees?'var(--red)':'var(--green)'},
  {label:'⏱️ SLA à risque',    val:String(M.slaRisque), unit:'cmd', sub:'late + blocked', tone:M.slaRisque?'var(--orange)':'var(--green)'},
  {label:'🚨 Alertes ouvertes',val:String(M.alertes), unit:'', sub:'anomalies à traiter', tone:M.alertes?'var(--red)':'var(--green)'},
];}
function opsKpis(){return [
  {label:'📦 Commandes en cours', val:String(M.enCours), unit:'', sub:'flux en cours', tone:'var(--blue)'},
  {label:'⛔ Bloquées',           val:String(M.bloquees), unit:'', sub:'à débloquer en priorité', tone:M.bloquees?'var(--red)':'var(--green)'},
  {label:'⏱️ SLA à risque',       val:String(M.slaRisque), unit:'cmd', sub:'late + blocked', tone:M.slaRisque?'var(--orange)':'var(--green)'},
  {label:'🏭 À traiter au hub',   val:String(M.hubAtraiter), unit:'colis', sub:'réception & tri', tone:'var(--amber)'},
  {label:'🚨 Alertes ouvertes',   val:String(M.alertes), unit:'', sub:'anomalies à traiter', tone:M.alertes?'var(--red)':'var(--green)'},
];}

/* Métrique + statut d'une carte domaine (live si dispo, sinon statique) */
function domainMetric(d){
  switch(d.id){
    case 'commercial': return {metric:`${caM(M.caKmf)} M <small>CA · panier ${FR(M.panier)}</small>`, status:['ok','tendance '+(M.caPct>=0?'+':'−')]};
    case 'ops':        return {metric:`${M.enCours} <small>en cours · ${M.bloquees} bloquées</small>`, status:[M.bloquees?'warn':'ok',`${M.slaRisque} SLA risque`]};
    case 'finance':    return {metric:`${M.margePct!=null?FR(M.margePct,1):'—'}% <small>marge nette</small>`, status:[M.nbSansCost?'warn':'ok', M.nbSansCost?'coûts partiels':'cash sain']};
    case 'catalogue':  return {metric:d.metric, status:[M.ruptures?'warn':'ok', `${M.ruptures} ruptures`]};
    default:           return {metric:d.metric, status:d.status};
  }
}

/* ── Domaines ──────────────────────────────────────────────── */
const DOMAINS=[
  {id:'catalogue',name:'Catalogue',icon:'🛍️',accent:'var(--teal)',inChain:false,
   mission:"Une boutique vivante et juste : produits, catégories, disponibilités.",
   metric:'248 <small>produits actifs</small>',status:['warn','6 ruptures'],
   ct:[],
   bo:[{icon:'🏷️',label:'Catégories boutique',desc:'Arborescence & mise en avant',route:'/admin/categories',r:['admin']},
       {icon:'🛍️',label:'Produits boutique',desc:'Fiches, stock, publication',route:'/admin/products',r:['admin']}]},

  {id:'sourcing',name:'Sourcing & Prix',icon:'🔎',accent:'var(--violet)',inChain:true,seam:'fiche produit → coût & marge cible',
   mission:"Acheter bien et fixer le juste prix : du fournisseur à la marge cible.",
   metric:'34% <small>marge cible moy.</small>',status:['warn','12 à repricer'],
   ct:[{icon:'📈',label:'Stratégie de prix',desc:'Positionnement & marges visées',route:'/admin/pricing-strategy',r:['admin','sourcing','finance']},
       {icon:'🧮',label:'Construction du prix',desc:'Coûts → prix de vente, pas à pas',route:'/admin/pricing',r:['admin','sourcing','finance']}],
   bo:[{icon:'🔎',label:'Sourcing',desc:'Pipeline de produits à sourcer',route:'/admin/sourcing',r:['admin','sourcing']},
       {icon:'📡',label:'Scanner catalogue',desc:"Veille & détection d'opportunités",route:'/admin/sourcing-scanner',r:['admin','sourcing']},
       {icon:'⚙️',label:'Config des coûts',desc:'Composantes de coût & paramètres',route:'/admin/pricing-workshop',r:['admin']},
       {icon:'🏭',label:'Fournisseurs',desc:"Comptes & conditions d'achat",route:'/admin/suppliers',r:['admin','sourcing']}]},

  {id:'commercial',name:'Commercial',icon:'📈',accent:'var(--amber)',inChain:true,seam:'prix de vente publié',
   mission:"Comprendre et faire grandir la demande : ventes, clients, paniers.",
   metric:'4,82 M <small>CA · panier 38 500</small>',status:['ok','tendance +'],
   ct:[{icon:'📈',label:'Ventes',desc:'CA, funnel, top produits, cohortes',route:'/admin/sales',r:CT_ALL}],
   bo:[{icon:'👥',label:'Clients',desc:'Segments, VIP, clients à risque',route:'/admin/clients',r:['admin','support','finance']},
       {icon:'🛒',label:'Paniers partagés',desc:'Commandes groupées diaspora',route:'/admin/shared-carts',r:['admin','support']}]},

  {id:'ops',name:'Opérationnel',icon:'🚦',accent:'var(--blue)',inChain:true,seam:'commande à exécuter',
   mission:"Que rien ne bloque entre la commande et le retrait au relais.",
   metric:'63 <small>en cours · 4 bloquées</small>',status:['warn','SLA 96%'],
   ct:[{icon:'🗼',label:'Tour de contrôle',desc:'Signal, blocages, arbitrage',route:'/admin/control-tower',r:CT_ALL},
       {icon:'📦',label:'Commandes & logistique',desc:'Pipeline statuts & flux',route:'/admin/orders-logistics',r:CT_ALL},
       {icon:'💰',label:'Coût rendu relais',desc:"Coût complet jusqu'au relais",route:'/admin/costing',r:CT_ALL}],
   bo:[{icon:'⚠️',label:'Problèmes',desc:'File des commandes à débloquer',route:'/admin/problems?focus=1',r:BO_ALL},
       {icon:'🚨',label:'Alertes & incidents',desc:'Signaux à traiter',route:'/admin/alerts',r:BO_ALL},
       {icon:'🏭',label:'Hub & Relais',desc:'Réception, tri, distribution',route:'/admin/hub-relais',r:['admin','hub','relais']},
       {icon:'✈️',label:'Transitaire',desc:'Expéditions vers les Comores',route:'/admin/transitaire',r:['admin','hub']},
       {icon:'📋',label:'Inventaire Hub',desc:'Stock physique au hub',route:'/admin/inventory',r:['admin','hub']}]},

  {id:'finance',name:'Financier',icon:'💰',accent:'var(--green)',inChain:true,seam:'livraison → encaissement & SLA',
   mission:"Chaque euro encaissé, dépensé, et la marge expliquée.",
   metric:'22,4% <small>marge nette</small>',status:['ok','cash sain'],
   ct:[{icon:'📊',label:'Santé économique',desc:'P&L corrélé, cohérence des chiffres',route:'/admin/economic',r:CT_ALL},
       {icon:'💹',label:'Projection & Mix',desc:'Prévision CA/marge, mix catégories',route:'/admin/pilotage-fin',r:CT_ALL},
       {icon:'🔭',label:'Carte économique',desc:'Flux de valeur du prix à la marge',route:'/admin/economic-flow',r:['admin','sourcing','finance']}],
   bo:[{icon:'🧾',label:'Comptabilité',desc:'Encaissements, cash relais, rappro',route:'/admin/accounting',r:['admin','finance']},
       {icon:'📄',label:'Factures',desc:'Émission & suivi',route:'/admin/invoices',r:CT_ALL},
       {icon:'🛃',label:'Douane & shipments',desc:'Droits, taxes, lots import',route:'/admin/customs',r:['admin','finance']}]},
];
const SYSTEM={id:'system',name:'Système & outils',icon:'⚙️',accent:'var(--ink-2)',
  mission:"Paramétrer la mécanique et simuler avant de décider.",metric:'—',status:['ok','stable'],ct:[],
  bo:[{icon:'⚙️',label:'Paramètres',desc:'Taux, SLA, règles globales',route:'/admin/settings',r:['admin']},
      {icon:'🧪',label:'Simulateur',desc:'Tester un scénario de bout en bout',route:'/admin/simulator',r:['admin']}]};
const FIELD=[{icon:'🏭',name:'Application Hub',desc:'Réception & tri — terrain',route:'/hub',r:['admin','hub']},
             {icon:'📍',name:'Application Relais',desc:'Remise client — terrain',route:'/relais',r:['admin','relais']}];

/* ── Filtrage par rôle ─────────────────────────────────────── */
let ROLE='admin';
const can=it=>it.r.includes(ROLE);
const visItems=d=>({ct:(d.ct||[]).filter(can),bo:(d.bo||[]).filter(can)});
const domainVisible=d=>{const v=visItems(d);return v.ct.length+v.bo.length>0;};

/* ── Rendu ─────────────────────────────────────────────────── */
// sanitize_before_render : toute donnee-feuille passee dans une template HTML
// est echappee. Les fragments que NOUS composons (.sub, .metric) restent bruts :
// ils ne portent pas de donnee externe (HTML d'affichage genere ici).
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function cockpitCtaMarkup(dir){
  return dir
    ? '<a class="btn" href="/admin/sante">🏥 Santé business</a><a class="btn amber" href="/admin/pilotage">🎯 Cockpit détaillé</a>'
    : '<a class="btn amber" href="/admin/problems?focus=1">⚠️ File à traiter</a>';
}
function kpisMarkup(set){
  return set.map(x=>`<div class="kpi"><span class="kpi-bar" style="background:${x.tone}"></span>
    <div class="kpi-label">${escapeHtml(x.label)}</div>
    <div class="kpi-val">${escapeHtml(x.val)}${x.unit?` <small>${escapeHtml(x.unit)}</small>`:''}</div>
    <div class="kpi-sub">${x.sub}</div></div>`).join('');
}
function renderCockpit(){
  const dir=hasCT(ROLE);
  const set=dir?dirKpis():opsKpis();
  document.getElementById('cp-eyebrow').textContent=dir?"Direction · vue d'ensemble":"Opérations · vue d'ensemble";
  document.getElementById('cp-title').textContent=dir?"L'activité, d'un seul coup d'œil":"Ce qui doit avancer aujourd'hui";
  document.getElementById('cp-lede').textContent=dir
    ?"Les indicateurs qui se parlent, du plus haut vers le détail. Choisissez un maillon de la chaîne pour ouvrir son domaine."
    :"Les files et incidents à traiter en priorité. Ouvrez un domaine pour accéder à vos outils.";
  document.getElementById('cp-cta').innerHTML = cockpitCtaMarkup(dir);
  const k=document.getElementById('kpis');
  k.style.gridTemplateColumns=`repeat(${set.length},1fr)`;
  k.innerHTML = kpisMarkup(set);
}

function cardMarkup(d){
  const dm=domainMetric(d);const [tone,txt]=dm.status;const v=visItems(d);const n=v.ct.length+v.bo.length;
  return `<button class="card" data-dom="${escapeHtml(d.id)}" style="--accent:${d.accent}" aria-expanded="false">
    <span class="card-rail"></span><div class="card-body">
      <div class="card-top"><div class="card-ico">${escapeHtml(d.icon)}</div><div class="card-name">${escapeHtml(d.name)}</div></div>
      <div class="card-mission">${escapeHtml(d.mission)}</div>
      <div class="card-metric">${dm.metric}</div>
      <div class="card-foot"><span class="pill ${tone}"><span class="d"></span>${escapeHtml(txt)}</span>
        <span class="card-count"><b>${n}</b> dashboard${n>1?'s':''}</span></div>
    </div></button>`;
}

function chainMarkup(doms){
  return doms.map((d,i)=>
    (i>0?`<div class="seam"><div class="arrow">→</div><div class="seam-lbl">${escapeHtml(d.seam)}</div></div>`:'')
    +`<div class="station">${cardMarkup(d)}</div>`).join('');
}
function renderChain(){
  const stage=document.getElementById('chain-stage');
  const doms=DOMAINS.filter(d=>d.inChain&&domainVisible(d));
  if(!doms.length){stage.hidden=true;return;}
  stage.hidden=false;
  document.getElementById('chain').innerHTML = chainMarkup(doms);
}

function cardsMarkup(cards){ return cards.map(cardMarkup).join(''); }
function fieldMarkup(fields){
  return fields.map(f=>`
    <a class="field" href="${f.route}"><span class="ico">${escapeHtml(f.icon)}</span>
      <div><b>${escapeHtml(f.name)}</b><span>${escapeHtml(f.desc)}</span></div><span class="ext">↗</span></a>`).join('');
}
function renderSupport(){
  const stage=document.getElementById('support-stage');
  const cat=DOMAINS.find(d=>d.id==='catalogue');
  const cards=[cat,SYSTEM].filter(domainVisible);
  const fields=FIELD.filter(can);
  if(!cards.length&&!fields.length){stage.hidden=true;return;}
  stage.hidden=false;
  document.getElementById('support').innerHTML = cardsMarkup(cards);
  document.getElementById('field').innerHTML = fieldMarkup(fields);
}

/* ── Drawer ────────────────────────────────────────────────── */
const ALL=[...DOMAINS,SYSTEM];
const drawer=document.getElementById('drawer');
let openId=null;
function toggle(id){id===openId?close():open(id);}
function layerMarkup(title,tag,cls,items){
  return !items.length?'':`<div><div class="layer-lbl"><span class="tag ${cls}">${tag}</span>${escapeHtml(title)}</div>
    <div class="dash-grid">${items.map(it=>`<a class="dash" href="${it.route}">
      <span class="dash-ico">${escapeHtml(it.icon)}</span><span class="dash-txt"><b>${escapeHtml(it.label)}</b><span>${escapeHtml(it.desc)}</span></span>
      <span class="dash-go">→</span></a>`).join('')}</div></div>`;
}
function drawerMarkup(d,v){
  return `<div class="drawer-inner" style="--accent:${d.accent}">
    <div class="drawer-head"><div class="card-ico" style="--accent:${d.accent}">${escapeHtml(d.icon)}</div><h3>${escapeHtml(d.name)}</h3>
      <button class="drawer-close">✕ Fermer</button></div>
    <p class="drawer-mission">${escapeHtml(d.mission)}</p>
    <div class="layers">${layerMarkup('Piloter — décider','CT','ct',v.ct)}${layerMarkup('Back-office — exécuter','BO','bo',v.bo)}</div>
  </div>`;
}
function open(id){
  const d=ALL.find(x=>x.id===id);if(!d)return;openId=id;
  document.querySelectorAll('.card[data-dom]').forEach(c=>{const on=c.dataset.dom===id;c.classList.toggle('open',on);c.setAttribute('aria-expanded',on);});
  drawer.innerHTML = drawerMarkup(d, visItems(d));
  drawer.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function close(){
  openId=null;
  drawer.innerHTML = '';
  document.querySelectorAll('.card[data-dom]').forEach(c=>{c.classList.remove('open');c.setAttribute('aria-expanded','false');});
}
document.addEventListener('click',e=>{
  const c=e.target.closest('.card[data-dom]');if(c){toggle(c.dataset.dom);return;}
  if(e.target.closest('.drawer-close')){close();return;}
  // Avant toute navigation depuis le portail : poser le flag focus
  const link=e.target.closest('a[href]');
  if(link){
    try{ const p=new URL(link.href,location.origin).pathname;
      if(p.startsWith('/admin/')){sessionStorage.setItem('kmc_focus_origin','portail');}
    }catch(_){}
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});

/* ── Hydratation + rendu complet ───────────────────────────── */
function hydrateUser(u){
  const name=u.full_name||u.email||'Utilisateur';
  document.getElementById('who-name').textContent=name;
  document.getElementById('who-role').textContent=u.role||'';
  document.getElementById('av').textContent=(String(name).trim()[0]||'A').toUpperCase();
}
function renderAll(){renderCockpit();renderChain();renderSupport();document.body.classList.remove('boot-hide');}

/* ── Récupération des métriques live (ops + finance) ───────── */
let LIVE=false;
async function fetchMetrics(){
  const period=document.getElementById('period').value||30;
  const m={...DEMO}; let got=false;
  const get=async u=>{const r=await fetch(u,{credentials:'include',headers:{Accept:'application/json'}});return r.ok?r.json():null;};
  try{
    const ops=await get('/api/dashboard/ops');
    if(ops&&ops.activite){
      m.enCours=ops.activite.commandes_en_cours; m.bloquees=ops.activite.commandes_bloquees;
      if(ops.sla)        m.slaRisque=(ops.sla.late||0)+(ops.sla.blocked||0);
      if(ops.logistique?.hub_preparation) m.hubAtraiter=ops.logistique.hub_preparation.count;
      if(ops.alertes){   m.alertes=ops.alertes.anomalies; m.ruptures=ops.alertes.low_stock; }
      got=true;
    }
  }catch(_){}
  try{
    const fin=await get('/api/dashboard/finance?period='+period);
    if(fin&&fin.kpi){
      m.caKmf=fin.kpi.ca_kmf; m.panier=fin.kpi.panier_moyen_kmf;
      m.caPct=fin.kpi.evolution?fin.kpi.evolution.ca_pct:null;
      if(fin.marges){ m.margePct=fin.marges.taux_marge_pct; m.nbSansCost=fin.marges.nb_sans_cost; }
      got=true;
    }
  }catch(_){}
  if(got){ M=m; LIVE=true; }
  return got;
}

/* ── Porte d'entrée : garde de session + adaptation rôle ───── */
async function boot(){
  const params=new URLSearchParams(location.search);
  const forced=params.get('demo');                 // ?demo=hub / ?demo=finance / ?demo=1
  setBadge('demo');
  if(forced!==null){
    const role=(forced&&forced!=='1'&&KNOWN_ROLES.includes(forced))?forced:'admin';
    ROLE=role;hydrateUser({full_name:'Démo',role});renderAll();return;
  }
  let res;
  try{res=await fetch('/api/auth/me',{credentials:'include',headers:{Accept:'application/json'}});}
  catch(_){ ROLE='admin';hydrateUser({full_name:'Aperçu',role:'admin'});renderAll();return; } // backend injoignable → aperçu
  if(res.status===401||res.status===403){location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));return;}
  if(!res.ok){ ROLE='admin';hydrateUser({full_name:'Aperçu',role:'admin'});renderAll();return; }
  const u=await res.json();
  if(!KNOWN_ROLES.includes(u.role)){location.replace('/');return;}   // rôle hors périmètre → accueil public
  ROLE=u.role;hydrateUser(u);
  await fetchMetrics();                              // tente le live ; sinon garde la démo
  renderAll();
  setBadge(LIVE?'live':'demo');
}
function badgeMarkup(kind){ return '<span class="dot"></span> '+(kind==='live'?'Live':'Démo'); }
function setBadge(kind){
  const b=document.getElementById('mode');
  b.className = kind==='live' ? 'mode live' : 'mode demo';
  b.innerHTML = badgeMarkup(kind);
}
document.getElementById('period').addEventListener('change',async()=>{
  if(!LIVE) return;                                  // en démo : la période ne recharge rien
  await fetchMetrics(); renderCockpit(); renderChain(); renderSupport();
});

// Lancement + filets de sécurité : aucune erreur ne doit laisser la page blanche.
boot().catch(()=>{ if(document.body.classList.contains('boot-hide')){
  try{ ROLE='admin'; hydrateUser({full_name:'Aperçu',role:'admin'}); renderAll(); }
  catch(_){ document.body.classList.remove('boot-hide'); } } });
setTimeout(()=>{ if(document.body.classList.contains('boot-hide')){
  try{ renderAll(); }catch(_){ document.body.classList.remove('boot-hide'); } } }, 4000);
