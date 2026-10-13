'use strict';
(()=>{const $=x=>document.getElementById(x);
const GATES=[['SOURCE_PROVED','Sourcing','/admin/workspaces/sourcing','Source, offre, identité fournisseur, capture/observation et décision attestées'],['REFINERY_PROVED','Raffinerie','/admin/workspaces/catalog','Contrôles exécutés, contenu FR, médias, variantes, rejets ou approbations'],['CATALOG_RELEASE_PROVED','Catalogue','/admin/workspaces/catalog','KIR, produit/SKU/SOI exacts, prix local, exposition Market'],['STOREFRONT_PROVED','Boutique','','Produit visible et vendable dans la boutique, variante et prix cohérents'],['CUSTOMER_ORDER_PROVED','Commande → achat','/admin/workspaces/purchasing','Lignes vendues couvertes par des lignes d’achat de même SKU et même unité fournisseur']];
const LABEL={PROVED:'PROUVÉ',NON_PROUVE:'NON PROUVÉ',ANOMALIE:'ANOMALIE'};
function line(parent,label,text){const p=document.createElement('p');const b=document.createElement('strong');b.textContent=label+' : ';p.appendChild(b);p.appendChild(document.createTextNode(text||'—'));parent.appendChild(p)}
function card(g){const d=document.createElement('div');d.className='gate';d.dataset.gate=g.key;const h=document.createElement('h3');h.textContent=g.label;d.appendChild(h);const st=document.createElement('span');st.className='st '+g.status;st.textContent=LABEL[g.status]||g.status;d.appendChild(st);
line(d,'Attendu',g.expected);line(d,'Constat',g.finding);
const ev=g.evidence||{};const ids=Object.entries(ev).filter(([,v])=>v!=null&&typeof v!=='object').map(([k,v])=>k+'='+v).join(' · ');line(d,'Preuve',ids||'aucune');
if(g.anomalies&&g.anomalies.length)line(d,'Anomalie',g.anomalies.join(' | '));
line(d,'Prochaine action',g.next_action);
if(g.human_checks&&g.human_checks.length)line(d,'Contrôle humain (distinct)',g.human_checks.join(' ; '));
if(g.link){const a=document.createElement('a');a.href=g.link;a.target='_blank';a.rel='noopener';a.className='btn';a.textContent='Ouvrir l’écran réel ↗';d.appendChild(a)}return d}
function setStage(stage){window.__goldenStage=stage;$('stageBadge').textContent=stage;$('global').textContent=stage}
function show(gates,stage,idsText,note){const root=$('upstream');root.innerHTML='';gates.forEach(g=>root.appendChild(card(g)));setStage(stage);$('upstreamIds').textContent=idsText||'';if(note)$('upstreamIds').textContent+=(idsText?' · ':'')+note}
function placeholders(status,finding){return GATES.map(([key,label,link,expected])=>({key,label,link,expected,status,finding,evidence:{},next_action:'Renseigner un Product ID issu d’un vrai sourcing, puis lire les preuves.'}))}
async function readUpstream(){const pid=$('productId').value.trim();const market=$('marketSelect').value;const ref=$('orderRef').textContent;
if(!pid){show(placeholders('NON_PROUVE','Aucun produit renseigné : rien n’est prouvé.'),'NON DÉMARRÉ','');return}
const q=new URLSearchParams({product_id:pid,market});if(ref&&ref!=='à renseigner')q.set('order_reference',ref);
try{const r=await fetch('/api/admin/entities/golden-upstream?'+q.toString(),{credentials:'include',headers:{Accept:'application/json'}});
if(!r.ok)throw new Error('HTTP '+r.status);const b=await r.json();q.set('download','1');$('exportDossier').href='/api/admin/entities/golden-upstream?'+q.toString();$('exportDossier').title=(b.dossier&&b.dossier.complete?'Dossier complet':'Dossier INCOMPLET : '+((b.dossier&&b.dossier.incomplete_reasons)||[]).join(' · '))+' · sha256 '+((b.dossier&&b.dossier.sha256)||'');show(b.gates,b.stage,'product_id='+(b.ids.product_id||'—')+' · market='+(b.ids.market_code||'—')+' · '+b.certification);renderP1(b);}
catch(e){show(placeholders('NON_PROUVE','API indisponible ('+e.message+') : état NON PROUVÉ, jamais PASS.'),'PREUVE MANQUANTE','','Lecture impossible');renderP1(null)}
if(window.__goldenRender)window.__goldenRender()}
function renderP1(b){const root=$('p1Steps');if(!root)return;root.innerHTML='';
const lvl=b&&b.evidence_level;$('p1Level').textContent='NIVEAU DE PREUVE : '+(lvl||'NON LU')+(lvl==='L5_STAGING'?'':' · cible isolée, pas une preuve staging');
const t=b&&b.thread;$('p1Thread').textContent=t?('Fil · market='+(t.market||'—')+' · source='+(t.source_id||'—')+' · capture='+(t.capture_id||'—')+' · product='+(t.product_id||'—')+' · sku='+((t.sku_ids||[]).join(',')||'—')+' · soi='+((t.soi_unit_refs||[]).join(',')||'—')+' · commande='+(t.order_reference||'—')+' · trace='+(t.trace_id||'—')):'Fil : renseigner produit et commande pour établir le fil unique.';
((b&&b.operator_script)||[]).forEach(st=>{const li=document.createElement('li');li.className='p1step'+(st.locked?' locked':'');const h=document.createElement('h3');h.textContent=st.label;const sp=document.createElement('span');sp.className='p1st '+st.status;sp.textContent=st.locked?'VERROUILLÉ':st.status;h.appendChild(sp);li.appendChild(h);if(st.finding){const p=document.createElement('p');p.textContent=st.finding;li.appendChild(p)}root.appendChild(li)})}
$('readUpstream').addEventListener('click',readUpstream);
show(placeholders('NON_PROUVE','Aucune lecture effectuée.'),'NON DÉMARRÉ','');
})();
