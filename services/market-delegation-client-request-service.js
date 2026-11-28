/**
 * @komerce-arch
 * @role          market-delegation-client-request-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated actor, canonical market code, client request
 * @outputs       authorized dossier projections and auditable state transitions
 * @depends       services/market-delegation-service.js, services/market-delegation-read-authority.js, services/conversation-service.js
 * @db-read       client_requests, markets, products, product_skus, users
 * @db-write      client_requests
 * @db-write-via:conversation-service conversation_messages, conversation_attachments
 * @db-txn        caller-owned
 * @doctrine      market_scope_is_server_authority, private_conversation, client_requests_not_orders
 * @impact-areas  market-delegation, notifications, dashboard
 */
'use strict';
const {randomUUID}=require('node:crypto');
const {resolveAuthorization,resolveActiveAssignmentByMarketCode}=require('./market-delegation-service');
const {resolveCanonicalMarketRead}=require('./market-delegation-read-authority');
const conversations=require('./conversation-service');
const {normalizePhone}=require('../utils/phone');
const {isProductExposedForMarketCode}=require('./catalog-market-exposure-service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOTIFS=new Set(['auto_parts','express','other']);
function fail(code,status=400){throw Object.assign(new Error(code),{code,status});}
function requireId(value){if(typeof value!=='string'||!UUID.test(value))fail('CLIENT_REQUEST_ID_INVALID');return value}
function actorId(actor){if(!actor?.id||!UUID.test(String(actor.id)))fail('AUTH_REQUIRED',401);return actor.id}
function marketCode(value){const s=String(value||'').trim().toUpperCase();if(!/^[A-Z]{2}$/.test(s))fail('MARKET_CODE_INVALID');return s}
async function authority(q,actor,scope,code,write=false){
  const userId=actorId(actor);
  if(scope==='client'){if(actor.role!=='client')fail('CLIENT_REQUEST_FORBIDDEN',403);return {scope,userId}}
  if(scope==='hub'){if(!['admin','agent_hub'].includes(actor.role))fail('CLIENT_REQUEST_FORBIDDEN',403);return {scope,userId}}
  if(scope!=='market')fail('CLIENT_REQUEST_FORBIDDEN',403);
  const market=marketCode(code);
  const auth=await resolveCanonicalMarketRead(resolveAuthorization,q,{userId,actorRole:actor.role,marketCode:market,primaryCapability:'client.read'});
  if(write&&actor.role!=='admin')await resolveAuthorization(q,{userId,marketCode:market,requiredCapability:'client.case.handle'});
  return {scope,userId,marketId:auth.market_id,canHandle:actor.role==='admin'||auth.capabilities?.includes('client.case.handle')||write};
}
function predicate(auth){
  if(auth.scope==='client')return {sql:'r.user_id=$1',args:[auth.userId]};
  if(auth.scope==='market')return {sql:'r.market_id=$1',args:[auth.marketId]};
  if(auth.scope==='hub')return {sql:'r.hub_shared IS TRUE',args:[]};
  fail('CLIENT_REQUEST_FORBIDDEN',403);
}
async function find(q,auth,ref,lock='SHARE'){
  if(!['SHARE','UPDATE'].includes(lock))fail('CLIENT_REQUEST_LOCK_INVALID');
  const p=predicate(auth);
  const {rows:[row]}=await q.query(`SELECT r.* FROM client_requests r WHERE ${p.sql} AND r.reference=$${p.args.length+1} FOR ${lock} OF r`,[...p.args,String(ref||'')]);
  if(!row)fail('CLIENT_REQUEST_NOT_FOUND',404);
  return row;
}
function projection(row,scope){
  // Never return the raw row: the Hub receives no user identifiers or client
  // fields; all scopes use explicit allowlists.
  const base={reference:row.reference,motif:row.motif,status:row.status,created_at:row.created_at,closed_at:row.closed_at};
  if(scope==='hub')return base;
  return {...base,product_id:row.product_id,sku_id:row.sku_id,...(scope==='market'?{hub_shared:row.hub_shared,first_staff_reply_at:row.first_staff_reply_at}:{})};
}
async function list(q,{actor,scope,market,before=null}){
  const auth=await authority(q,actor,scope,market);
  const p=predicate(auth);
  const {rows}=await q.query(`SELECT r.* FROM client_requests r WHERE ${p.sql}
    AND ($${p.args.length+1}::text IS NULL OR (r.created_at,r.id)<(SELECT r2.created_at,r2.id FROM client_requests r2 WHERE r2.reference=$${p.args.length+1} AND r2.id IN(SELECT r.id FROM client_requests r WHERE ${p.sql})))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,[...p.args,before]);
  return rows.map(row=>projection(row,scope));
}
async function read(q,{actor,scope,market,ref,before=null}){
  const auth=await authority(q,actor,scope,market);
  const row=await find(q,auth,ref);
  const request=projection(row,scope);
  if(scope==='market'){
    request.can_handle=Boolean(auth.canHandle);
    if(auth.canHandle&&row.verified_callback_phone){
      const {rows:[owner]}=await q.query('SELECT phone,whatsapp_phone FROM users WHERE id=$1',[row.user_id]);
      if(owner&&[owner.phone,owner.whatsapp_phone].map(p=>normalizePhone(p)).includes(row.verified_callback_phone))request.callback_phone=row.verified_callback_phone;
    }
  }
  return {request,messages:await conversations.list(q,{requestId:row.id,scope,before})};
}
async function create(q,{actor,market,motif,productId=null,skuId=null,body='',files=[]}){
  const auth=await authority(q,actor,'client');
  if(!MOTIFS.has(motif))fail('CLIENT_REQUEST_MOTIF_INVALID');
  if(motif!=='express'&&(productId||skuId))fail('CLIENT_REQUEST_PRODUCT_FORBIDDEN');
  if(skuId&&!productId)fail('CLIENT_REQUEST_PRODUCT_REQUIRED');
  const {rows:[m]}=await q.query("SELECT id FROM markets WHERE code=$1 AND is_active IS TRUE AND lifecycle_status='ACTIVE' FOR SHARE",[marketCode(market)]);
  if(!m)fail('MARKET_NOT_ACTIVE',404);
  if(productId){
    const {rows:[p]}=await q.query('SELECT id FROM products WHERE id=$1 AND is_active IS TRUE AND is_available IS TRUE',[requireId(productId)]);
    if(!p||!(await isProductExposedForMarketCode(productId,marketCode(market),q)))fail('CLIENT_REQUEST_PRODUCT_NOT_FOUND',404);
    if(skuId){
      const {rows:[s]}=await q.query('SELECT id FROM product_skus WHERE id=$1 AND product_id=$2 AND is_active IS TRUE',[requireId(skuId),productId]);
      if(!s)fail('CLIENT_REQUEST_PRODUCT_NOT_FOUND',404);
    }
  }
  const reference='D-'+randomUUID().toUpperCase();
  const proof=normalizePhone(actor.verifiedOtpPhone);
  let callback=null;
  if(proof){const {rows:[owner]}=await q.query('SELECT phone,whatsapp_phone FROM users WHERE id=$1',[auth.userId]);if(owner&&[owner.phone,owner.whatsapp_phone].map(p=>normalizePhone(p)).includes(proof))callback=proof;}
  const {rows:[row]}=await q.query('INSERT INTO client_requests(reference,market_id,user_id,motif,product_id,sku_id,verified_callback_phone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[reference,m.id,auth.userId,motif,productId,skuId,callback]);
  const message=await conversations.append(q,{request:row,actorId:auth.userId,scope:'client',visibility:'client',body,files});
  return {row,message,request:projection(row,'client')};
}
async function post(q,{actor,scope,market,ref,visibility,body='',files=[]}){
  const auth=await authority(q,actor,scope,market,true);
  const row=await find(q,auth,ref,'UPDATE');
  const message=await conversations.append(q,{request:row,actorId:auth.userId,scope,visibility,body,files});
  if(scope==='market'&&visibility==='client'){
    const {rows:[updated]}=await q.query("UPDATE client_requests SET status='in_progress',first_staff_reply_at=COALESCE(first_staff_reply_at,now()) WHERE id=$1 RETURNING *",[row.id]);
    return {row:updated,message,request:projection(updated,scope)};
  }
  return {row,message,request:projection(row,scope)};
}
async function transition(q,{actor,market,ref,target,reason=''}){
  const auth=await authority(q,actor,'market',market,true);
  const row=await find(q,auth,ref,'UPDATE');
  if(target===row.status)return {row,request:projection(row,'market'),changed:false};
  if(!['in_progress','closed'].includes(target))fail('CLIENT_REQUEST_TRANSITION_INVALID',409);
  if(target==='closed'&&(typeof reason!=='string'||!reason.trim()))fail('CLIENT_REQUEST_CLOSE_REASON_REQUIRED');
  const eventType=target==='closed'?'closed':row.status==='closed'?'reopened':'started';
  const {rows:[updated]}=await q.query(`UPDATE client_requests SET status=$2,
    closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END,
    closed_by=CASE WHEN $2='closed' THEN $3::uuid ELSE NULL END
    WHERE id=$1 RETURNING *`,[row.id,target,auth.userId]);
  if(row.status==='closed'&&target==='in_progress'){
    // Reopening never resurrects photos whose retention deadline passed.
    await q.query(`DELETE FROM conversation_attachments a USING conversation_messages m
      WHERE a.message_id=m.id AND m.subject_id=$1 AND a.purge_after<=now()`,[row.id]);
  }
  await q.query(`UPDATE conversation_attachments a SET purge_after=CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE $2::timestamptz+interval '180 days' END
    FROM conversation_messages m WHERE a.message_id=m.id AND m.subject_id=$1`,[row.id,updated.closed_at]);
  await conversations.append(q,{request:updated,actorId:auth.userId,scope:'market',visibility:'internal',body:reason,eventType});
  return {row:updated,request:projection(updated,'market'),changed:true};
}
async function share(q,{actor,market,ref,shared}){
  if(typeof shared!=='boolean')fail('CLIENT_REQUEST_SHARE_INVALID');
  const auth=await authority(q,actor,'market',market,true);
  const row=await find(q,auth,ref,'UPDATE');
  if(row.hub_shared===shared)return {request:projection(row,'market'),changed:false};
  if(shared&&row.status==='closed')fail('CLIENT_REQUEST_CLOSED',409);
  const {rows:[updated]}=await q.query('UPDATE client_requests SET hub_shared=$2 WHERE id=$1 RETURNING *',[row.id,shared]);
  await conversations.append(q,{request:updated,actorId:auth.userId,scope:'market',visibility:'internal',body:'',eventType:shared?'hub_shared':'hub_revoked'});
  return {request:projection(updated,'market'),changed:true};
}
async function attachment(q,{actor,scope,market,ref,attachmentId}){
  const auth=await authority(q,actor,scope,market);
  const row=await find(q,auth,ref);
  return conversations.attachment(q,{requestId:row.id,attachmentId:requireId(attachmentId),scope});
}
module.exports={list,read,create,post,transition,share,attachment};
