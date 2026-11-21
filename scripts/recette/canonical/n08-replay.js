/** @komerce-arch-lite
 * @role g6-n08-idempotency-replay
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose N08 (clé d'idempotence concurrente) : rejoue, depuis la session du client, la requête de commande émise par l'écran (même clé x5, même clé et contenu différent, sans clé, sans total accepté) et juge les réponses.
 * @db-read none
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const PARALLEL=5;
const ok2xx=h=>h>=200&&h<300;
const json=s=>{try{return JSON.parse(s)}catch(_){return null}};
// Sonde API signalée (aucun écran n'envoie deux fois la même clé) : même origine, session du client, corps normalisé de la requête de l'écran.
async function post(page,origin,headers,data){
 const r=await page.request.post(origin+'/api/orders',{headers:{origin,'content-type':'application/json',...headers},data}).catch(()=>null);
 if(!r)return {http:null,code:null,order_id:null};
 const b=await r.json().catch(()=>({}));
 return {http:r.status(),code:String(b.code||b.error?.code||'').slice(0,60)||null,order_id:b.order?.id||null};
}
// cap = {key, body} capturés sur la requête POST /api/orders de l'écran (clé = en-tête Idempotency-Key, corps = JSON envoyé).
async function replayN08(page,origin,cap){
 const body=json(cap.body);
 if(!cap||!cap.key||!body||!Array.isArray(body.items)||!body.items.length)throw Error('G6_N08_SCREEN_MISSING_CAPTURED_ORDER_REQUEST');
 const altered=JSON.stringify({...body,items:body.items.map((it,i)=>i===0?{...it,quantity:Number(it.quantity||1)+1}:it)});
 const {expected_total_kmf:_t,...noTotal}=body;
 const out={parallel_same_key:[],different_content:null,no_key:null,no_accepted_total:null,via:'API_PROBE_NO_SCREEN_GESTURE'};
 out.parallel_same_key=await Promise.all(Array.from({length:PARALLEL},()=>post(page,origin,{'idempotency-key':cap.key},cap.body)));
 out.different_content=await post(page,origin,{'idempotency-key':cap.key},altered);
 out.no_key=await post(page,origin,{},cap.body);
 out.no_accepted_total=await post(page,origin,{'idempotency-key':'g6-n08-nt-'+String(cap.key).slice(-12)},JSON.stringify(noTotal));
 return out;
}
// Pur : liste des écarts produit (vide = conforme). orderId = commande créée par l'écran.
function judgeN08(r,orderId){
 const gaps=[];
 if(!r||!Array.isArray(r.parallel_same_key)||r.parallel_same_key.length!==PARALLEL)return ['N08_REPLAY_INCOMPLETE'];
 for(const x of r.parallel_same_key){
  if(x.http===null)gaps.push('SAME_KEY_NO_RESPONSE');
  else if(ok2xx(x.http)){if(x.order_id!==orderId)gaps.push('SAME_KEY_OTHER_ORDER')}
  else if(!(x.http===409&&x.code==='idempotency_in_progress'))gaps.push('SAME_KEY_HTTP_'+x.http);
 }
 const d=r.different_content;
 if(!d||d.http===null||ok2xx(d.http)||d.order_id)gaps.push('DIFFERENT_CONTENT_ACCEPTED');
 else if(!(d.http===409&&d.code==='idempotency_key_reused'))gaps.push('DIFFERENT_CONTENT_CODE_'+d.http+'_'+d.code);
 const n=r.no_key;
 if(!n||n.http===null||ok2xx(n.http)||n.order_id)gaps.push('NO_KEY_ACCEPTED');
 else if(![400,428].includes(n.http))gaps.push('NO_KEY_HTTP_'+n.http);
 const t=r.no_accepted_total;
 if(!t||t.http===null||ok2xx(t.http)||t.order_id)gaps.push('NO_ACCEPTED_TOTAL_ORDER_CREATED');
 else if(t.http!==428)gaps.push('NO_ACCEPTED_TOTAL_HTTP_'+t.http);
 return gaps;
}
module.exports={replayN08,judgeN08,PARALLEL};
