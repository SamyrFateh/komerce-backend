/**
 * @komerce-arch
 * @role          client-requests-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated client, market agent or Hub actor
 * @outputs       authorized private dossier, message, attachment
 * @depends       middleware/auth.js, middleware/require-verified-identity.js, middleware/rate-limit.js, middleware/upload.js, services/market-delegation-client-request-service.js, services/signal-service.js, services/client-notification-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-delegation-client-request-service client_requests
 * @db-write-via:conversation-service conversation_messages, conversation_attachments
 * @db-write-via:signal-service signals
 * @db-write-via:client-notification-service client_notifications
 * @db-txn        caller-owned
 * @doctrine      market_scope_is_server_authority, private_conversation
 * @impact-areas  market-delegation, notifications, dashboard
 */
'use strict';
const express=require('express');
const multer=require('multer');
const path=require('node:path');
const db=require('../db');
const {authenticate,requireRole}=require('../middleware/auth');
const {requireVerifiedIdentityForCheckout}=require('../middleware/require-verified-identity');
const {clientRequestLimiter}=require('../middleware/rate-limit');
const {validateMagicBytes}=require('../middleware/upload');
const requestService=require('../services/market-delegation-client-request-service');
const {upsertSignal,resolveSignalForEntity}=require('../services/signal-service');
const {emitClientRequestReply}=require('../services/client-notification-service');
const router=express.Router();
const clientAuth=[authenticate,requireVerifiedIdentityForCheckout,requireRole(['client'])];
const hubAuth=[authenticate,requireRole(['admin','agent_hub'])];
const marketAuth=[authenticate];
const formats=new Set(['.jpg','.jpeg','.png','.webp']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:3,fields:8,fieldSize:10000,parts:12},fileFilter(_req,file,cb){
  if(!formats.has(path.extname(file.originalname).toLowerCase()))return cb(Object.assign(new Error('CONVERSATION_IMAGE_INVALID'),{status:415,code:'CONVERSATION_IMAGE_INVALID'}));
  cb(null,true);
}}).array('photos',3);
function photoUpload(req,res,next){
  upload(req,res,err=>{
    if(err instanceof multer.MulterError)return res.status(400).json({code:'CONVERSATION_UPLOAD_LIMIT',error:'Limite de pièces jointes dépassée.'});
    if(err)return next(err);
    return validateMagicBytes(req,res,next);
  });
}
function fail(code,status=400){throw Object.assign(new Error(code),{code,status});}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cursor(req,scope){const value=req.query.before;if(value==null)return null;if(typeof value!=='string'||value.length>80||(scope==='messages'&&!UUID.test(value)))fail('CLIENT_REQUEST_CURSOR_INVALID');return value}
function actor(req){return {id:req.user.id,role:req.user.role}}
function params(req,scope){return {actor:actor(req),scope,market:req.params.code,ref:req.params.ref}}
function verifyFields(req,allowed){
  if(Object.keys(req.body||{}).some(k=>!allowed.includes(k)))fail('CLIENT_REQUEST_FIELD_FORBIDDEN');
}
function resultResponse(res,body,status=200){res.set('Cache-Control','private, no-store');return res.status(status).json(body)}
function wrap(fn){return async(req,res,next)=>{try{return await fn(req,res)}catch(err){if(Number.isInteger(err.status)&&err.status>=400&&err.status<500)return resultResponse(res,{code:err.code||'CLIENT_REQUEST_REFUSED',error:err.status===404?'Demande introuvable.':err.message},err.status);return next(err)}}}
function signalKey(row){return {signal_type:'client_request_awaiting_reply',market_id:row.market_id,entity_type:'client_request',entity_id:row.id}}
async function awaiting(q,row){
  return upsertSignal({...signalKey(row),severity:'info',title:'Demande client à traiter',summary:'Une réponse du conseiller est attendue.',source_module:'market-delegation-client-request-service',target_shell:'bo',target_view:'clients',target_filters:{client_request_ref:row.reference},owner_role:'market_operator'},q);
}
async function answered(q,row,message){
  await resolveSignalForEntity(signalKey(row),q);
  await emitClientRequestReply({dbClient:q,userId:row.user_id,requestId:row.id,reference:row.reference,messageId:message.id});
}
router.post('/client-requests',...clientAuth,clientRequestLimiter,photoUpload,wrap(async(req,res)=>{
  verifyFields(req,['market','motif','product_id','sku_id','body']);
  const b=req.body||{};
  const result=await db.withTransaction(async q=>{
    const r=await requestService.create(q,{actor:actor(req),market:b.market,motif:b.motif,productId:b.product_id||null,skuId:b.sku_id||null,body:b.body||'',files:req.files||[]});
    await awaiting(q,r.row);return {request:r.request,message:r.message};
  });
  return resultResponse(res,result,201);
}));
function registerScope(scope,prefix,auth){
  router.get(prefix,...auth,wrap(async(req,res)=>{
    const requests=await db.withTransaction(q=>requestService.list(q,{...params(req,scope),before:cursor(req,'requests')}));
    return resultResponse(res,{requests});
  }));
  router.get(prefix+'/:ref',...auth,wrap(async(req,res)=>{
    const data=await db.withTransaction(q=>requestService.read(q,{...params(req,scope),before:cursor(req,'messages')}));
    return resultResponse(res,data);
  }));
  router.post(prefix+'/:ref/messages',...auth,clientRequestLimiter,photoUpload,wrap(async(req,res)=>{
    verifyFields(req,['body','visibility']);
    const b=req.body||{};
    const visibility=b.visibility||(scope==='hub'?'internal':'client');
    const data=await db.withTransaction(async q=>{
      const r=await requestService.post(q,{...params(req,scope),visibility,body:b.body||'',files:req.files||[]});
      if(scope==='client')await awaiting(q,r.row);
      else if(scope==='market'&&visibility==='client')await answered(q,r.row,r.message);
      return {request:r.request,message:r.message};
    });
    return resultResponse(res,data,201);
  }));
  router.get(prefix+'/:ref/attachments/:id',...auth,wrap(async(req,res)=>{
    const file=await db.withTransaction(q=>requestService.attachment(q,{...params(req,scope),attachmentId:req.params.id}));
    res.set({'Content-Type':file.mime,'Content-Length':String(file.size_bytes),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'});
    return res.send(file.content);
  }));
}
const marketPrefix='/markets/:code/client-requests';
registerScope('client','/client-requests',clientAuth);
registerScope('market',marketPrefix,marketAuth);
registerScope('hub','/hub/client-requests',hubAuth);
router.post(marketPrefix+'/:ref/close',...marketAuth,clientRequestLimiter,wrap(async(req,res)=>{
  verifyFields(req,['reason']);
  const data=await db.withTransaction(async q=>{
    const r=await requestService.transition(q,{...params(req,'market'),target:'closed',reason:req.body?.reason});
    if(r.changed)await resolveSignalForEntity(signalKey(r.row),q);
    return {request:r.request};
  });
  return resultResponse(res,data);
}));
router.post(marketPrefix+'/:ref/reopen',...marketAuth,clientRequestLimiter,wrap(async(req,res)=>{
  verifyFields(req,['reason']);
  const data=await db.withTransaction(async q=>{
    const r=await requestService.transition(q,{...params(req,'market'),target:'in_progress',reason:req.body?.reason||''});
    return {request:r.request};
  });return resultResponse(res,data);
}));
router.post(marketPrefix+'/:ref/hub-share',...marketAuth,clientRequestLimiter,wrap(async(req,res)=>{
  verifyFields(req,[]);
  return resultResponse(res,await db.withTransaction(q=>requestService.share(q,{...params(req,'market'),shared:true})));
}));
router.delete(marketPrefix+'/:ref/hub-share',...marketAuth,clientRequestLimiter,wrap(async(req,res)=>{
  verifyFields(req,[]);
  return resultResponse(res,await db.withTransaction(q=>requestService.share(q,{...params(req,'market'),shared:false})));
}));
module.exports=router;
