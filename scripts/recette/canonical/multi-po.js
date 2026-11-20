/** @komerce-arch-lite
 * @role g6-multi-po-import-plan
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Read-only inventory and loop plan of the import branch of a multi-PO order (M03): one mono-supplier mono-market PO per source, one consolidated customer bag.
 * @impact-areas staging-only
 */
'use strict';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MIN_IMPORT_POS=3;
// Étapes jouées UNE FOIS PAR PO (un geste = une mutation, scripts historiques paramétrés par G6_CANONICAL_PO_ID).
const PER_PO_STAGES=Object.freeze(['HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION','HUB_RECEIVING','HUB_RECEIVING_READBACK']);
// Étapes jouées UNE FOIS PAR COMMANDE (sac client unique consolidé, KOM-BOX, expédition, douane, relais, remise).
const ORDER_STAGES=Object.freeze(['HUB_CUSTOMER_BAG','HUB_KOM_BOX','HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP']);
const IMPORT_STAGES=Object.freeze(['HUB_PO',...PER_PO_STAGES,...ORDER_STAGES]);
// Lignes IMPORT de la commande avec leur PO (lecture seule). Une ligne locale n'a jamais de ligne d'achat.
const IMPORT_SQL=`
 SELECT oi.id AS order_item_id,oi.quantity::int AS quantity,o.market_id AS order_market,
  pl.id AS line_id,pl.purchase_order_id AS po_id,pl.supplier_id AS line_supplier,
  po.supplier_id AS po_supplier,po.market_id AS po_market,po.status::text AS po_status
 FROM order_items oi JOIN orders o ON o.id=oi.order_id
 LEFT JOIN purchase_lines pl ON pl.order_item_id=oi.id AND pl.cancelled_at IS NULL
 LEFT JOIN purchase_orders po ON po.id=pl.purchase_order_id
 WHERE oi.order_id=$1 AND oi.fulfillment_source='IMPORT'
 ORDER BY oi.created_at,oi.id,pl.id`;
async function readImportRows(db,orderId){
 if(!UUID.test(String(orderId||'')))throw Error('G6_MULTIPO_ORDER_ID_INVALID');
 const {rows}=await db.query(IMPORT_SQL,[orderId]);
 return rows;
}
// Pur. Regroupe par PO et refuse tout PO qui n'est pas mono-fournisseur et mono-marché, ou tout fournisseur sur plusieurs PO.
// requirePo=false : avant HUB_PO, on ne vérifie que les lignes déjà rattachées (les lignes sans PO restent à constituer).
function shapeImportPos(rows,{requirePo=true,minPos=MIN_IMPORT_POS}={}){
 if(!Array.isArray(rows)||!rows.length)throw Error('G6_MULTIPO_NO_IMPORT_ITEM');
 const items=new Map(),pos=new Map();
 for(const r of rows){
  if(!items.has(r.order_item_id))items.set(r.order_item_id,{order_item_id:r.order_item_id,quantity:Number(r.quantity),lines:0});
  if(!r.line_id)continue;
  items.get(r.order_item_id).lines++;
  if(!r.po_id){if(requirePo)throw Error('G6_MULTIPO_LINE_WITHOUT_PO_'+r.line_id);continue}
  if(!pos.has(r.po_id))pos.set(r.po_id,{po_id:r.po_id,suppliers:new Set(),markets:new Set(),po_supplier:r.po_supplier,po_market:r.po_market,
   po_status:r.po_status,order_market:r.order_market,item_ids:[],line_ids:[],units:0});
  const p=pos.get(r.po_id);
  p.suppliers.add(String(r.line_supplier));p.markets.add(String(r.po_market));
  p.item_ids.push(r.order_item_id);p.line_ids.push(r.line_id);p.units+=Number(r.quantity);
  if(String(r.line_supplier)!==String(r.po_supplier))p.suppliers.add('PO:'+r.po_supplier);
 }
 if(requirePo)for(const it of items.values())if(!it.lines)throw Error('G6_MULTIPO_ITEM_WITHOUT_PURCHASE_LINE_'+it.order_item_id);
 const list=[...pos.values()];
 for(const p of list){
  if(p.suppliers.size!==1||!p.po_supplier)throw Error('G6_MULTIPO_PO_NOT_MONO_SUPPLIER_'+p.po_id);
  if(p.markets.size!==1||!p.po_market||String(p.po_market)!==String(p.order_market))throw Error('G6_MULTIPO_PO_NOT_MONO_MARKET_'+p.po_id);
 }
 const bySupplier=new Set(list.map(p=>String(p.po_supplier)));
 if(bySupplier.size!==list.length)throw Error('G6_MULTIPO_SUPPLIER_ON_SEVERAL_POS');
 if(requirePo&&list.length<minPos)throw Error('G6_MULTIPO_POS_BELOW_'+minPos+'_GOT_'+list.length);
 return Object.freeze({
  items:[...items.values()],
  pos:list.map(p=>Object.freeze({po_id:p.po_id,supplier_id:String(p.po_supplier),market_id:String(p.po_market),po_status:p.po_status,
   item_ids:p.item_ids,line_ids:p.line_ids,units:p.units})),
  item_count:items.size,units:[...items.values()].reduce((n,i)=>n+i.quantity,0)});
}
async function readImportInventory(db,orderId,opts){return shapeImportPos(await readImportRows(db,orderId),opts)}
// Environnement EFFECTIF d'une itération par PO : exactement celui du chemin M01 (un seul PO).
function perPoEnv(poId){
 if(!UUID.test(String(poId||'')))throw Error('G6_MULTIPO_PO_ID_INVALID');
 return {G6_CANONICAL_PO_ID:poId};
}
// Environnement EFFECTIF des étapes par commande. N=1 : AUCUNE clé en plus du chemin M01 (séquence de gestes identique) ;
// N>1 : listes alignées PO/réception/allocation + totaux, lus par les scripts (défauts = valeurs unitaires historiques).
function orderEnv(inv,{receipts=[],allocations=[]}={}){
 if(inv.pos.length===1&&inv.item_count===1&&inv.units===1)return {G6_CANONICAL_PO_ID:inv.pos[0].po_id};
 if(receipts.length&&receipts.length!==inv.pos.length)throw Error('G6_MULTIPO_RECEIPTS_NOT_ONE_PER_PO');
 const e={G6_CANONICAL_PO_ID:inv.pos[0].po_id,G6_CANONICAL_PO_IDS:JSON.stringify(inv.pos.map(p=>p.po_id)),
  G6_CANONICAL_IMPORT_ITEMS:String(inv.item_count),G6_CANONICAL_IMPORT_UNITS:String(inv.units),
  G6_CANONICAL_IMPORT_ITEM_IDS:JSON.stringify(inv.items.map(i=>i.order_item_id))};
 if(receipts.length)e.G6_CANONICAL_RECEIPT_REFERENCES=JSON.stringify(receipts);
 if(allocations.length)e.G6_CANONICAL_ALLOCATION_IDS=JSON.stringify(allocations);
 return e;
}
// Plan d'une étape : liste d'itérations {po_id|null, env}. PER_PO : une par PO dans l'ordre de l'inventaire ; ORDER : une seule.
function planStage(stageId,inv,extra){
 if(!IMPORT_STAGES.includes(stageId)||stageId==='HUB_PO')throw Error('G6_MULTIPO_STAGE_NOT_PLANNABLE_'+stageId);
 if(PER_PO_STAGES.includes(stageId))return inv.pos.map(p=>({po_id:p.po_id,env:perPoEnv(p.po_id)}));
 return [{po_id:null,env:orderEnv(inv,extra)}];
}
// Lecture des variables d'une étape par commande côté script (défauts = chemin historique à 1 ligne / 1 PO / 1 colis).
function importScope(env,single={}){
 const list=(k,fallback)=>{
  if(env[k]===undefined||env[k]==='')return fallback;
  let v;try{v=JSON.parse(env[k])}catch(_){throw Error('G6_MULTIPO_ENV_NOT_JSON_'+k)}
  if(!Array.isArray(v)||!v.length||v.some(x=>typeof x!=='string'||!x))throw Error('G6_MULTIPO_ENV_NOT_LIST_'+k);
  return v;
 };
 const pos=list('G6_CANONICAL_PO_IDS',single.po?[single.po]:[]);
 const items=Number(env.G6_CANONICAL_IMPORT_ITEMS||1),units=Number(env.G6_CANONICAL_IMPORT_UNITS||1);
 if(!Number.isInteger(items)||items<1||!Number.isInteger(units)||units<items)throw Error('G6_MULTIPO_COUNTS_INVALID');
 return Object.freeze({pos,receipts:list('G6_CANONICAL_RECEIPT_REFERENCES',single.receipt?[single.receipt]:[]),
  allocations:list('G6_CANONICAL_ALLOCATION_IDS',single.allocation?[single.allocation]:[]),
  itemIds:list('G6_CANONICAL_IMPORT_ITEM_IDS',single.item?[single.item]:[]),items,units,multi:pos.length>1});
}
module.exports={UUID,MIN_IMPORT_POS,PER_PO_STAGES,ORDER_STAGES,IMPORT_STAGES,IMPORT_SQL,readImportRows,shapeImportPos,
 readImportInventory,perPoEnv,orderEnv,planStage,importScope};
