/** @komerce-arch-lite
 * @role g6-cleanup-recette-core
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Pure classification and gesture planning for leftover G6-BUYER orders; no I/O, no writes.
 * @impact-areas staging-only
 */
'use strict';
const SCOPE='G6-BUYER';
// Miroir de routes/orders/cancel.js : l'annulation n'est permise qu'avant CANCEL_CUTOFF_STATUS (exclu).
const STATUS_ORDER=Object.freeze(['pending','confirmed','ordered','preparation','shipped','in_transit','available','collected']);
const RECEIVED_PO=Object.freeze(['hub_received','received','partially_received']);
const RECEIVED_ORDER=Object.freeze(['preparation','shipped','in_transit','available']);
const ENGAGED_PO=Object.freeze(['notified','confirmed']);
const TERMINAL=Object.freeze(['collected','cancelled','refunded']);
const ACTIONS=Object.freeze(['discard_po','cancel_line','cancel_order','cancel_g6_po','close_hub_order']);
const MISSING=Object.freeze({
 D_RECEIVED_GOODS:'Aucun écran de retour, invendu, remise en stock ou clôture de recette pour marchandise reçue au Hub.',
 CUTOFF:'Annulation Order 360 refusée par la règle de coupure serveur (statut au-delà du seuil).',
 PAYMENT_MODE:'Le bouton Order 360 est réservé au paiement cash_relais.',
 PO_ENGAGED:'Aucun écran d’annulation d’un PO groupé notifié ou confirmé (l’annulation de commande le laisse engagé avec alerte).'
});
const cutoffBlocks=(status,cutoff='shipped')=>{
 const cur=STATUS_ORDER.indexOf(status),cut=STATUS_ORDER.indexOf(cutoff);
 return cur>=cut;           // statut inconnu = -1 : non bloqué, comme le serveur
};
/** Entrée : { order:{id,reference,market,status,payment_mode,simulation_scope},
 *   lines:[{line_id,po_id|null,po_status|null}], po_peers:{[po_id]:[{reference,simulation_scope}]} } */
function classify(entry,{cutoff='shipped'}={}){
 const {order,lines=[],po_peers={}}=entry;
 const poStatus=new Map();
 for(const l of lines)if(l.po_id)poStatus.set(l.po_id,l.po_status);
 const pos=[...poStatus.keys()].sort();
 const res={reference:order.reference,order_id:order.id,market:order.market,order_status:order.status,
  po_ids:pos,po_peers:Object.fromEntries(pos.map(p=>[p,(po_peers[p]||[]).map(x=>x.reference).sort()])),
  class:null,gestures:[],verdict:'PLANNED',reason:null,missing:[]};
 if(order.simulation_scope!==SCOPE){res.class='OUT_OF_SCOPE';res.verdict='REFUSED';res.reason='NOT_G6_BUYER';return res;}
 if(TERMINAL.includes(order.status)){res.class='TERMINAL';res.verdict='SKIPPED';return res;}
 const mixed=pos.filter(p=>(po_peers[p]||[]).length===0||(po_peers[p]||[]).some(x=>x.simulation_scope!==SCOPE));
 const st=pos.map(p=>poStatus.get(p));
 if(st.some(s=>RECEIVED_PO.includes(s))||RECEIVED_ORDER.includes(order.status))res.class='D';
 else if(st.some(s=>ENGAGED_PO.includes(s)))res.class='C';
 else if(st.includes('draft'))res.class='A';
 else res.class='B';
 // Un PO partagé avec une commande non G6 (ou sans pairs lisibles) n'est jamais touché.
 if(mixed.length){res.verdict='REFUSED';res.reason='MIXED_PO';res.mixed_po_ids=mixed;return res;}
 if(res.class==='D'){
  if(order.payment_mode!=='cash_relais'){res.verdict='REFUSED';res.reason='PAYMENT_MODE';return res;}
  res.gestures.push({action:'close_hub_order',order_id:order.id,reference:order.reference});
  return res;
 }
 if(order.payment_mode!=='cash_relais'){res.verdict='SCREEN_MISSING';res.missing.push('PAYMENT_MODE');res.reason=MISSING.PAYMENT_MODE;return res;}
 if(res.class!=='C'&&cutoffBlocks(order.status,cutoff)){res.verdict='SCREEN_MISSING';res.missing.push('CUTOFF');res.reason=MISSING.CUTOFF;return res;}
 if(res.class==='A')for(const p of pos.filter(x=>poStatus.get(x)==='draft'))res.gestures.push({action:'discard_po',po_id:p});
 for(const l of lines.filter(x=>!x.po_id||(x.po_status==='draft')))res.gestures.push({action:'cancel_line',line_id:l.line_id});
 if(res.class==='C')for(const p of pos.filter(x=>ENGAGED_PO.includes(poStatus.get(x))))res.gestures.push({action:'cancel_g6_po',po_id:p});
 res.gestures.push({action:'cancel_order',order_id:order.id,reference:order.reference});
 return res;
}

/** PO engagés dont les commandes sont DÉJÀ annulées : jamais convertir une
 * commande vivante, un achat physique ou un débit réel en annulation implicite. */
function classifyOrphanPo(po){
 const peers=po.peers||[];
 const references=[...new Set(peers.map(p=>p.reference).filter(Boolean))].sort();
 const item={po_id:po.po_id,po_status:po.po_status,reference:references[0]||null,
  references,class:'C_PO',verdict:'REFUSED',reason:null,gestures:[],
  has_physical:!!po.has_physical,has_debit:!!po.has_debit};
 const reject=reason=>{item.reason=reason;return item;};
 if(!ENGAGED_PO.includes(po.po_status))return reject('PO_NOT_ENGAGED');
 if(po.legacy_order_id!==null&&po.legacy_order_id!==undefined)return reject('PO_NOT_GROUPED');
 if(!peers.length||!po.line_count||peers.length!==po.line_count||
   peers.some(p=>!p.order_id||!p.reference))return reject('PO_PEER_INCOMPLETE');
 if(peers.some(p=>p.simulation_scope!==SCOPE))return reject('MIXED_PO');
 if(peers.some(p=>p.payment_mode!=='cash_relais'))return reject('PAYMENT_MODE');
 if(po.has_physical)return reject('PO_PHYSICAL_RECEIVED');
 if(po.has_debit)return reject('PO_REAL_SUPPLIER_DEBIT');
 if(peers.some(p=>p.order_status!=='cancelled'))return reject('PO_PEER_NOT_CANCELLED');
 item.verdict='PLANNED';
 item.gestures=[{action:'cancel_g6_po',po_id:po.po_id,reference:item.reference}];
 return item;
}

/** Ordre imposé : PO brouillons, lignes, PO G6 notifiés/confirmés, commandes, clôtures Hub D. */
function buildPlan(entries,opts={}){
 const items=entries.map(e=>classify(e,opts));
 const poItems=(opts.orphanPos||[]).map(classifyOrphanPo);
 const rank={A:0,B:0,C:1,D:2};
 const todo=items.filter(i=>i.verdict==='PLANNED').sort((a,b)=>rank[a.class]-rank[b.class]||a.reference.localeCompare(b.reference));
 const seen=new Set(),steps=[];
 const push=(g,i)=>{const k=g.action+':'+(g.po_id||g.line_id||g.order_id);if(seen.has(k))return;seen.add(k);steps.push({...g,reference:i.reference,class:i.class});};
 for(const a of ['discard_po','cancel_line','cancel_g6_po','cancel_order','close_hub_order'])
  for(const grp of [['A','B'],['C'],['D']])
   for(const i of todo.filter(x=>grp.includes(x.class)))
    for(const g of i.gestures.filter(x=>x.action===a))push(g,i);
 // Les PO orphelins éligibles sont annulés avant les commandes D, jamais en doublon.
 const known=new Set(steps.filter(x=>x.action==='cancel_g6_po').map(x=>x.po_id));
 for(const po of poItems.filter(p=>p.verdict==='PLANNED')){
  if(known.has(po.po_id))continue;
  known.add(po.po_id);steps.unshift({...po.gestures[0],class:'C_PO'});
 }
 return {items,poItems,steps};
}
/** Garde exécutée avant chaque geste : seule une commande G6-BUYER du plan peut être touchée. */
function assertGestureAllowed(step,plan){
 if(!ACTIONS.includes(step.action))throw Error('G6_CLEANUP_ACTION_FORBIDDEN');
 const item=step.class==='C_PO'
  ?(plan.poItems||[]).find(i=>i.po_id===step.po_id)
  :plan.items.find(i=>i.reference===step.reference);
 if(!item||item.verdict!=='PLANNED')throw Error('G6_CLEANUP_ORDER_NOT_PLANNED');
 if(item.class==='OUT_OF_SCOPE')throw Error('G6_CLEANUP_OUT_OF_SCOPE');
 if(!plan.steps.some(s=>s.action===step.action&&(s.po_id||s.line_id||s.order_id)===(step.po_id||step.line_id||step.order_id)))
  throw Error('G6_CLEANUP_GESTURE_NOT_IN_PLAN');
 return true;
}
module.exports={SCOPE,STATUS_ORDER,MISSING,ACTIONS,cutoffBlocks,classify,classifyOrphanPo,buildPlan,assertGestureAllowed};
