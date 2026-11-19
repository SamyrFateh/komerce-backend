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
const ACTIONS=Object.freeze(['discard_po','cancel_line','cancel_order']);
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
 if(res.class==='D'){res.verdict='SCREEN_MISSING';res.missing.push('D_RECEIVED_GOODS');res.reason=MISSING.D_RECEIVED_GOODS;return res;}
 if(order.payment_mode!=='cash_relais'){res.verdict='SCREEN_MISSING';res.missing.push('PAYMENT_MODE');res.reason=MISSING.PAYMENT_MODE;return res;}
 if(cutoffBlocks(order.status,cutoff)){res.verdict='SCREEN_MISSING';res.missing.push('CUTOFF');res.reason=MISSING.CUTOFF;return res;}
 if(res.class==='A')for(const p of pos.filter(x=>poStatus.get(x)==='draft'))res.gestures.push({action:'discard_po',po_id:p});
 for(const l of lines.filter(x=>!x.po_id||(x.po_status==='draft')))res.gestures.push({action:'cancel_line',line_id:l.line_id});
 res.gestures.push({action:'cancel_order',order_id:order.id,reference:order.reference});
 if(res.class==='C'){res.missing.push('PO_ENGAGED');res.residual=MISSING.PO_ENGAGED;}
 return res;
}
/** Ordre imposé : PO brouillons, puis lignes, puis commandes A et B, puis C. D n'a aucun geste. */
function buildPlan(entries,opts){
 const items=entries.map(e=>classify(e,opts));
 const rank={A:0,B:0,C:1};
 const todo=items.filter(i=>i.verdict==='PLANNED').sort((a,b)=>rank[a.class]-rank[b.class]||a.reference.localeCompare(b.reference));
 const seen=new Set(),steps=[];
 const push=(g,i)=>{const k=g.action+':'+(g.po_id||g.line_id||g.order_id);if(seen.has(k))return;seen.add(k);steps.push({...g,reference:i.reference,class:i.class});};
 for(const a of ['discard_po','cancel_line','cancel_order'])
  for(const grp of [['A','B'],['C']])
   for(const i of todo.filter(x=>grp.includes(x.class)))
    for(const g of i.gestures.filter(x=>x.action===a))push(g,i);
 return {items,steps};
}
/** Garde exécutée avant chaque geste : seule une commande G6-BUYER du plan peut être touchée. */
function assertGestureAllowed(step,plan){
 if(!ACTIONS.includes(step.action))throw Error('G6_CLEANUP_ACTION_FORBIDDEN');
 const item=plan.items.find(i=>i.reference===step.reference);
 if(!item||item.verdict!=='PLANNED')throw Error('G6_CLEANUP_ORDER_NOT_PLANNED');
 if(item.class==='OUT_OF_SCOPE')throw Error('G6_CLEANUP_OUT_OF_SCOPE');
 if(!plan.steps.some(s=>s.action===step.action&&(s.po_id||s.line_id||s.order_id)===(step.po_id||step.line_id||step.order_id)))
  throw Error('G6_CLEANUP_GESTURE_NOT_IN_PLAN');
 return true;
}
module.exports={SCOPE,STATUS_ORDER,MISSING,ACTIONS,cutoffBlocks,classify,buildPlan,assertGestureAllowed};
