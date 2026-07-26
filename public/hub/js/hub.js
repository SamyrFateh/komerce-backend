/**
 * @komerce-arch-lite
 * @role          dashboard-hub-app
 * @domain        dashboard
 * @layer         ui-bootstrap
 * @owner         dashboards
 * @purpose       Logique applicative complète de /hub/ (file d'attente commandes,
 *                détail, expédition, incidents) — servie en <script src> same-origin.
 * @impact-areas  dashboard, hub, csp
 * @version       2026-07
 */

/**
 * hub.js — application de public/hub/index.html, externalisée depuis un <script> inline.
 *
 * ── Pourquoi ce fichier existe (et pourquoi il ne doit PAS redevenir inline) ──
 * bootstrap/security.js pose `script-src 'self'` SANS 'unsafe-inline'. Le bloc
 * <script> inline de /hub/ était donc silencieusement bloqué en production
 * (mesuré en navigateur réel — cf. AUDIT_COUTURES_COUCHES.md) : le squelette
 * HTML se peignait, l'application ne démarrait jamais. Aucune erreur serveur,
 * aucun test unitaire en échec — juste une page de travail hub inopérante.
 *
 * ── Contraintes de chargement ──
 *   1. Chargé en <script src> SYNCHRONE (jamais defer/async) juste avant </body>,
 *      à l'emplacement exact du bloc inline d'origine.
 *
 * Gate associé : scripts/check-inline-scripts.js (étendu à tout public/, pas
 * seulement public/boutique/).
 */
'use strict';

const api={
  get:u=>fetch(u,{credentials:'include'}).then(r=>r.ok?r.json():r.json().then(e=>Promise.reject(e))),
  post:(u,b)=>fetch(u,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json().then(d=>r.ok?d:Promise.reject(d)))
};
const Hub=(()=>{
  let _tab='queue',_sq='',_sqt=null,_order=null,_parcelId=null,_incType=null,_carriers=[];

  function ago(dt){const h=(Date.now()-new Date(dt))/3600000;if(h<1)return Math.round(h*60)+'min';if(h<24)return Math.round(h)+'h';return Math.round(h/24)+'j';}
  function slbl(s){return{confirmed:'confirmé',ordered:'commandé',preparation:'prépa',shipped:'expédié',in_transit:'transit',available:'dispo',collected:'retiré',cancelled:'annulé'}[s]||s;}
  function ccls(c){return{complete:'green',partial:'amber',unassigned:'red',empty:'red'}[c]||'gray';}
  function clbl(c){return{complete:'✓ complet',partial:'⚠ partiel',unassigned:'○ non-assigné',empty:'✗ vide'}[c]||c;}
  function kmf(n){return Number(n||0).toLocaleString('fr-FR')+' KMF';}

  function toast(msg,type='',dur=3000){const e=document.getElementById('toast');e.textContent=msg;e.className='show '+(type||'');clearTimeout(e._t);e._t=setTimeout(()=>{e.className='';},dur);}

  async function init(){
    try{
      const me=await api.get('/api/auth/me');
      document.getElementById('header-user').textContent=me.full_name||me.email||'Hub';
      _carriers=await api.get('/api/carriers').then(r=>r.data||[]).catch(()=>[]);
      await loadTab('queue');
      await loadStats();
    }catch(e){if(e&&(e.status===401||String(e.error||'').includes('onnect')))location.href='/';}
  }

  function switchTab(tab){
    _tab=tab;
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
    document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+tab));
    loadTab(tab);
  }

  async function loadTab(tab){
    if(tab==='queue')await loadQ('to_prepare','lq','bq');
    if(tab==='prep')await loadQ('preparation','lp','bp');
    if(tab==='ship')await loadQ('ready','ls','bs');
    if(tab==='stats')await loadStats();
  }

  async function loadQ(filter,listId,badgeId){
    const el=document.getElementById(listId);
    el.innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
    try{
      const p=new URLSearchParams({tab:filter,limit:50});
      if(_sq&&filter==='to_prepare')p.set('search',_sq);
      const d=await api.get('/api/hub-dash/queue?'+p);
      const rows=d.data||[];
      setBadge(badgeId,rows.length);
      if(!rows.length){el.innerHTML='<div class="empty"><div class="empty-icon">📭</div>Aucune commande</div>';return;}
      el.innerHTML=rows.map(o=>card(o)).join('');
      el.querySelectorAll('.order-card').forEach(c=>c.addEventListener('click',()=>openDetail(c.dataset.id)));
      if(filter==='to_prepare'){
        const urg=rows.filter(o=>o.age_hours>48).length;
        document.getElementById('chip-pending').textContent=rows.length+' en attente';
        const cu=document.getElementById('chip-urgent');
        if(urg>0){cu.textContent='⚡ '+urg+' urgent';cu.style.display='';}else cu.style.display='none';
      }
    }catch(e){el.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div>'+(e.error||'Erreur réseau')+'</div>';}
  }

  function setBadge(id,n){const b=document.getElementById(id);if(!b)return;b.textContent=n>0?n:'';b.className=n>0?'tab-badge on':'tab-badge off';}

  function card(o){
    const urg=o.age_hours>48,inc=o.open_incidents>0;
    return `<div class="order-card${inc?' incident':urg?' urgent':''}" data-id="${o.id}">
      <div class="card-top"><div class="card-ref">${o.reference}</div><div class="card-age">${ago(o.created_at)}</div></div>
      <div class="card-client">${o.client_name||'—'} · ${o.destination_island||'?'}</div>
      <div class="card-meta">
        <span class="badge ${ccls(o.completeness)}">${clbl(o.completeness)}</span>
        <span class="badge gray">${o.items_qty||0} art.</span>
        ${o.payment_status==='paid'?'<span class="badge green">payé</span>':'<span class="badge amber">paiement en attente</span>'}
        ${inc?'<span class="badge red">⚠ incident</span>':''}
        ${urg?'<span class="badge red">+48h</span>':''}
      </div>
    </div>`;
  }

  function onSearch(v){_sq=v.trim();clearTimeout(_sqt);_sqt=setTimeout(()=>loadQ('to_prepare','lq','bq'),350);}

  async function loadStats(){
    const g=document.getElementById('sg');
    try{
      const [kd,wk]=await Promise.all([api.get('/api/hub-dash/dashboard').catch(()=>({})),api.get('/api/hub/stats/week').catch(()=>({}))]);
      const o=kd.orders||{},p=kd.parcels||{},i=kd.incidents||{},ws=wk.summary||{};
      g.innerHTML=`
        <div class="stat-card hl"><div class="stat-val">${p.shipped_today||0}</div><div class="stat-lbl">Expédiés aujourd'hui</div></div>
        <div class="stat-card"><div class="stat-val">${(o.to_prepare||0)+(o.in_preparation||0)}</div><div class="stat-lbl">En attente</div></div>
        <div class="stat-card"><div class="stat-val">${o.in_preparation||0}</div><div class="stat-lbl">En préparation</div></div>
        <div class="stat-card"><div class="stat-val">${i.open||0}</div><div class="stat-lbl">Incidents ouverts</div></div>
        <div class="stat-card" style="grid-column:1/-1"><div class="stat-val" style="font-size:20px">${ws.avg_processing_hours?ws.avg_processing_hours+'h':'—'}</div><div class="stat-lbl">Délai moyen traitement (7j)</div></div>`;
    }catch(e){g.innerHTML='<div class="empty">Stats indisponibles</div>';}
  }

  async function openDetail(id){
    _order=null;
    const dp=document.getElementById('detail-panel');
    document.getElementById('detail-body').innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
    document.getElementById('detail-actions').innerHTML='';
    document.getElementById('detail-title').textContent='Chargement…';
    dp.classList.add('open');
    try{const d=await api.get('/api/hub-dash/orders/'+id);_order=d;renderDetail(d);}
    catch(e){document.getElementById('detail-body').innerHTML='<div class="empty">'+(e.error||'Erreur')+'</div>';}
  }

  function renderDetail(d){
    const o=d.order,items=d.items||[],parcels=d.parcels||[];
    document.getElementById('detail-title').textContent=o.reference;
    document.getElementById('detail-badges').innerHTML=`<span class="badge ${o.payment_status==='paid'?'green':'amber'}">${o.payment_status==='paid'?'payé':'non payé'}</span>`;
    const assigned=new Set((d.parcels||[]).flatMap(p=>(p.items||[]).map(i=>i.order_item_id)));
    document.getElementById('detail-body').innerHTML=`
      <div class="section"><div class="section-head">Commande</div><div class="section-body">
        <div class="info-row"><span class="info-label">Client</span><span class="info-val">${o.client_name||'—'}</span></div>
        <div class="info-row"><span class="info-label">Téléphone</span><span class="info-val">${o.client_phone||'—'}</span></div>
        <div class="info-row"><span class="info-label">Destination</span><span class="info-val">${o.destination_island||'—'} · ${o.routing_mode||'—'}</span></div>
        <div class="info-row"><span class="info-label">Relais</span><span class="info-val">${o.relais_name||'—'}</span></div>
        <div class="info-row"><span class="info-label">Total</span><span class="info-val">${kmf(o.total_kmf)}</span></div>
        <div class="info-row"><span class="info-label">Statut</span><span class="info-val">${slbl(o.status)}</span></div>
      </div></div>
      <div class="section"><div class="section-head">Articles (${items.length})</div><div class="section-body" style="gap:0">
        ${items.map(it=>`<div class="item-row"><div class="item-qty">×${it.quantity}</div><div class="item-name">${it.product_name||'Produit'}</div><div class="item-check ${assigned.has(it.id)?'assigned':''}">${assigned.has(it.id)?'✓':''}</div></div>`).join('')}
      </div></div>
      ${parcels.length?`<div class="section"><div class="section-head">Colis (${parcels.length})</div><div class="section-body" style="gap:0">
        ${parcels.map(p=>`<div class="parcel-row"><div><div class="parcel-ref">${p.reference}</div><div class="parcel-status">${p.items?p.items.length:'?'} art. · ${slbl(p.status)}</div></div><span class="badge ${p.status==='shipped'?'green':p.status==='preparation'?'amber':'gray'}">${slbl(p.status)}</span></div>`).join('')}
      </div></div>`:''}
      ${(d.incidents||[]).filter(i=>i.status==='open').length?`<div class="section" style="border-color:rgba(255,171,64,.3)"><div class="section-head" style="color:var(--amber)">⚠ Incidents ouverts</div><div class="section-body">
        ${d.incidents.filter(i=>i.status==='open').map(i=>`<div class="info-row"><span class="info-label">${i.type}</span><span class="info-val" style="color:var(--amber)">${i.description||'—'}</span></div>`).join('')}
      </div></div>`:''}
    `;
    renderActions(o,items,parcels,assigned);
  }

  function renderActions(o,items,parcels,assigned){
    const el=document.getElementById('detail-actions');
    const allOk=items.length>0&&assigned.size>=items.length;
    const hasReady=parcels.some(p=>p.status==='preparation');
    const hasDraft=parcels.some(p=>p.status==='draft');
    const isPaid=o.payment_status==='paid';
    let html='';
    if(['confirmed','ordered'].includes(o.status)||(!allOk&&o.status==='preparation')){
      html+=`<button class="btn btn-primary" id="bap" data-act="auto-prepare" data-id="${o.id}">📦 Préparer automatiquement</button>`;
    }
    if(hasDraft&&allOk&&!hasReady){
      const dp=parcels.find(p=>p.status==='draft');
      html+=`<button class="btn btn-amber" data-act="mark-ready" data-id="${dp.id}">✓ Marquer colis prêt</button>`;
    }
    if(hasReady){
      const rp=parcels.find(p=>p.status==='preparation');
      _parcelId=rp.id;
      html+=isPaid
        ?`<button class="btn btn-primary" data-act="open-ship" data-id="${rp.id}">✈️ Expédier ${rp.reference}</button>`
        :`<button class="btn btn-secondary" disabled>✈️ Expédier (paiement manquant)</button>`;
    }
    html+=`<div class="btn-row"><button class="btn btn-secondary" data-act="open-incident">🚨 Incident</button><button class="btn btn-secondary" data-act="backorder" data-id="${o.id}">📋 Backorder</button></div>`;
    el.innerHTML=html;
  }

  function closeDetail(){document.getElementById('detail-panel').classList.remove('open');_order=null;_parcelId=null;loadTab(_tab);}

  async function autoPrepare(id){
    const b=document.getElementById('bap');
    if(b){b.disabled=true;b.innerHTML='<div class="spinner"></div> Création du colis…';}
    try{
      const r=await api.post('/api/hub-dash/orders/'+id+'/auto-prepare',{});
      toast(r.already_complete?'Articles déjà tous assignés':'✓ '+r.message,'success');
      const d=await api.get('/api/hub-dash/orders/'+id);_order=d;renderDetail(d);
    }catch(e){toast(e.error||'Erreur','error');if(b){b.disabled=false;b.innerHTML='📦 Préparer automatiquement';}}
  }

  async function markReady(pid){
    try{await api.post('/api/hub-dash/parcels/'+pid+'/ready',{});toast('✓ Colis prêt à expédier','success');const d=await api.get('/api/hub-dash/orders/'+_order.order.id);_order=d;renderDetail(d);}
    catch(e){toast(e.error||'Erreur','error');}
  }

  async function openShipModal(pid){
    _parcelId=pid;
    const sel=document.getElementById('ship-carrier');
    sel.innerHTML=_carriers.length
      ?'<option value="">— Transporteur —</option>'+_carriers.map(c=>`<option value="${c.id}" data-name="${c.name}">${c.name}${c.type?' · '+c.type:''}</option>`).join('')
      :'<option value="">Aucun transporteur configuré</option>';
    document.getElementById('ship-tracking').value='';
    document.getElementById('ship-notes').value='';
    document.getElementById('ship-modal').classList.add('open');
  }
  function closeShipModal(){document.getElementById('ship-modal').classList.remove('open');}

  async function confirmShip(){
    const b=document.getElementById('btn-confirm-ship');
    const sel=document.getElementById('ship-carrier');
    const cname=sel.selectedOptions[0]?.dataset.name||sel.value||'';
    const tracking=document.getElementById('ship-tracking').value.trim();
    const notes=document.getElementById('ship-notes').value.trim();
    b.disabled=true;b.innerHTML='<div class="spinner"></div> En cours…';
    try{
      await api.post('/api/hub-dash/parcels/'+_parcelId+'/ship',{transport:[cname,tracking].filter(Boolean).join(' · ')||'non spécifié',carrier_id:sel.value||null,notes:notes||null});
      closeShipModal();toast('✈️ Colis expédié !','success');
      const d=await api.get('/api/hub-dash/orders/'+_order.order.id);_order=d;renderDetail(d);
    }catch(e){toast(e.error||'Erreur expédition','error');}
    finally{b.disabled=false;b.innerHTML='✈️ Confirmer l\'expédition';}
  }

  function openIncidentModal(){_incType=null;document.querySelectorAll('.incident-type-btn').forEach(b=>b.classList.remove('selected'));document.getElementById('inc-desc').value='';document.getElementById('incident-modal').classList.add('open');}
  function closeIncidentModal(){document.getElementById('incident-modal').classList.remove('open');}
  function selInc(el){document.querySelectorAll('.incident-type-btn').forEach(b=>b.classList.remove('selected'));el.classList.add('selected');_incType=el.dataset.type;}

  async function confirmIncident(){
    if(!_incType){toast('Sélectionnez un type','error');return;}
    const desc=document.getElementById('inc-desc').value.trim();
    if(!desc){toast('Décrivez l\'incident','error');return;}
    const b=document.getElementById('btn-confirm-inc');b.disabled=true;b.innerHTML='<div class="spinner"></div>';
    try{await api.post('/api/hub-dash/orders/'+_order.order.id+'/incident',{type:_incType,description:desc,priority:'normal'});closeIncidentModal();toast('🚨 Incident signalé','success');const d=await api.get('/api/hub-dash/orders/'+_order.order.id);_order=d;renderDetail(d);}
    catch(e){toast(e.error||'Erreur','error');}
    finally{b.disabled=false;b.innerHTML='🚨 Envoyer le signalement';}
  }

  async function backorder(id){
    try{await api.post('/api/hub-dash/orders/'+id+'/backorder',{reason:'En attente fournisseur — hub'});toast('📋 Backorder signalé','success');}
    catch(e){toast(e.error||'Erreur','error');}
  }

  return{init,switchTab,onSearch,openDetail,closeDetail,autoPrepare,markReady,openShipModal,closeShipModal,confirmShip,openIncidentModal,closeIncidentModal,selInc,confirmIncident,backorder};
})();

// ── Static wiring ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function(btn){
  btn.addEventListener('click', function(){ Hub.switchTab(btn.dataset.tab); });
});
document.getElementById('sq').addEventListener('input', function(e){ Hub.onSearch(e.target.value); });
document.getElementById('btn-back').addEventListener('click', function(){ Hub.closeDetail(); });
document.getElementById('btn-confirm-ship').addEventListener('click', function(){ Hub.confirmShip(); });
document.getElementById('btn-cancel-ship').addEventListener('click', function(){ Hub.closeShipModal(); });
document.getElementById('ship-modal').addEventListener('click', function(e){ if(e.target===this) Hub.closeShipModal(); });
document.getElementById('btn-confirm-inc').addEventListener('click', function(){ Hub.confirmIncident(); });
document.getElementById('btn-cancel-inc').addEventListener('click', function(){ Hub.closeIncidentModal(); });
document.getElementById('incident-modal').addEventListener('click', function(e){ if(e.target===this) Hub.closeIncidentModal(); });
document.querySelectorAll('.incident-type-btn').forEach(function(btn){
  btn.addEventListener('click', function(){ Hub.selInc(btn); });
});
// ── Dynamic action delegation ───────────────────────────────────
document.getElementById('detail-actions').addEventListener('click', function(e){
  var btn = e.target.closest('[data-act]');
  if(!btn) return;
  var act = btn.dataset.act, id = btn.dataset.id;
  if(act==='auto-prepare') Hub.autoPrepare(id);
  else if(act==='mark-ready') Hub.markReady(id);
  else if(act==='open-ship') Hub.openShipModal(id);
  else if(act==='open-incident') Hub.openIncidentModal();
  else if(act==='backorder') Hub.backorder(id);
});

fetch('/api/auth/me',{credentials:'include'}).then(r=>{if(!r.ok)location.href='/';else Hub.init();}).catch(()=>location.href='/');
