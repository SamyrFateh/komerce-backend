'use strict';
/** @test-kind integration @test-runner jest @test-requires postgres */
const {randomUUID}=require('node:crypto');
const db=require('../../db');
const svc=require('../../services/market-delegation-client-request-service');
const conv=require('../../services/conversation-service');
const {upsertSignal,resolveSignalForEntity}=require('../../services/signal-service');
const {emitClientRequestReply,listOpenForUser}=require('../../services/client-notification-service');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGO8o+HGwMDAxMDAwMDAAAAQOAFOsvRgogAAAABJRU5ErkJggg==','base64');
const photo={buffer:PNG,mimetype:'image/png',detectedMimeType:'image/png'};
afterAll(async()=>{await db.pool.end()});
test('private dossier lifecycle and cross-market/client/Hub isolation on real PostgreSQL',async()=>{
 const q=await db.getClient();
 try{
  await q.query('BEGIN');
  const {rows:used}=await q.query('SELECT code FROM markets');
  const codes=[];const existing=new Set(used.map(r=>r.code));
  for(const a of 'ZYXWVUTSRQ')for(const b of 'ZYXWVUTSRQ')if(!existing.has(a+b)&&codes.length<2)codes.push(a+b);
  expect(codes).toHaveLength(2);
  async function market(code){
   const {rows:[m]}=await q.query("INSERT INTO markets(code,name,currency,minor_unit,is_active,lifecycle_status) VALUES($1,'On Demand test','KMF',0,TRUE,'ACTIVE') RETURNING id",[code]);
   const {rows:[a]}=await q.query("INSERT INTO market_operating_assignments(market_id,status) VALUES($1,'ACTIVE') RETURNING id",[m.id]);
   for(const cap of ['client.read','client.case.handle'])await q.query('INSERT INTO assignment_capability_ceiling(assignment_id,capability) VALUES($1,$2)',[a.id,cap]);
   return {id:m.id,assignment:a.id,code};
  }
  async function user(role){
   const id=randomUUID(),phone='+269'+String(3000000+Math.floor(Math.random()*5999999));
   await q.query('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5::public.user_role)',[id,'On Demand test',id+'@test.local',phone,role]);
   return {id,role,verifiedOtpPhone:phone};
  }
  async function grant(u,m,caps){
   const {rows:[member]}=await q.query("INSERT INTO assignment_memberships(assignment_id,user_id,status) VALUES($1,$2,'ACTIVE') RETURNING id",[m.assignment,u.id]);
   for(const cap of caps)await q.query('INSERT INTO membership_capabilities(membership_id,capability) VALUES($1,$2)',[member.id,cap]);
  }
  const m=await market(codes[0]),other=await market(codes[1]);
  const owner=await user('client'),stranger=await user('client'),agent=await user('market_operator'),reader=await user('market_operator'),wrong=await user('market_operator'),hub=await user('agent_hub'),admin=await user('admin');
  await grant(agent,m,['client.read','client.case.handle']);await grant(reader,m,['client.read']);await grant(wrong,other,['client.read','client.case.handle']);
  const opened=await svc.create(q,{actor:owner,market:m.code,motif:'auto_parts',body:'Alternateur',files:[photo]});
  const ref=opened.request.reference,requestId=opened.row.id,clientPhoto=opened.message.attachments[0].id;
  const as=(actor,scope,market=m.code)=>({actor,scope,market,ref});
  expect(opened.request.status).toBe('new');
  await expect(svc.read(q,as(stranger,'client'))).rejects.toMatchObject({status:404});
  await expect(svc.attachment(q,{...as(stranger,'client'),attachmentId:clientPhoto})).rejects.toMatchObject({status:404});
  await expect(svc.read(q,as(wrong,'market',other.code))).rejects.toMatchObject({status:404});
  await expect(svc.read(q,as(hub,'hub'))).rejects.toMatchObject({status:404});
  expect((await svc.read(q,as(reader,'market'))).request).not.toHaveProperty('callback_phone');
  await expect(svc.post(q,{...as(reader,'market'),visibility:'client',body:'denied'})).rejects.toMatchObject({status:403});
  expect((await svc.read(q,as(agent,'market'))).request.callback_phone).toBe(owner.verifiedOtpPhone);
  expect((await svc.read(q,as(admin,'market'))).request.can_handle).toBe(true);
  expect((await svc.list(q,{actor:agent,scope:'market',market:m.code}))[0]).not.toHaveProperty('callback_phone');
  const sig={signal_type:'client_request_awaiting_reply',market_id:m.id,entity_type:'client_request',entity_id:requestId};
  await upsertSignal({...sig,title:'Test request',owner_role:'market_operator'},q);
  await svc.share(q,{actor:agent,market:m.code,ref,shared:true});
  await expect(svc.post(q,{...as(hub,'hub'),visibility:'client',body:'denied'})).rejects.toMatchObject({status:403});
  const internal=await svc.post(q,{...as(hub,'hub'),visibility:'internal',body:'Interne seulement',files:[photo]});
  const internalPhoto=internal.message.attachments[0].id;
  expect((await svc.read(q,as(hub,'hub'))).request).not.toHaveProperty('callback_phone');
  expect((await svc.read(q,as(hub,'hub'))).messages.every(x=>x.visibility==='internal')).toBe(true);
  expect((await svc.read(q,as(owner,'client'))).messages.every(x=>x.visibility==='client')).toBe(true);
  await expect(svc.attachment(q,{...as(owner,'client'),attachmentId:internalPhoto})).rejects.toMatchObject({status:404});
  await expect(svc.attachment(q,{...as(hub,'hub'),attachmentId:clientPhoto})).rejects.toMatchObject({status:404});
  expect((await svc.attachment(q,{...as(hub,'hub'),attachmentId:internalPhoto})).content).toEqual(PNG);
  expect((await q.query("SELECT status FROM signals WHERE signal_type=$1 AND entity_id=$2",[sig.signal_type,requestId])).rows[0].status).toBe('open');
  expect((await listOpenForUser(owner.id,{dbClient:q}))).toHaveLength(0);
  const reply=await svc.post(q,{...as(agent,'market'),visibility:'client',body:'Réponse'});
  expect(reply.request.status).toBe('in_progress');
  await resolveSignalForEntity(sig,q);
  await emitClientRequestReply({dbClient:q,userId:owner.id,requestId,reference:ref,messageId:reply.message.id});
  expect((await listOpenForUser(owner.id,{dbClient:q}))[0]).toMatchObject({action_target:'client_requests',order_reference:ref});
  await svc.share(q,{actor:agent,market:m.code,ref,shared:false});
  await expect(svc.read(q,as(hub,'hub'))).rejects.toMatchObject({status:404});
  await expect(svc.attachment(q,{...as(hub,'hub'),attachmentId:internalPhoto})).rejects.toMatchObject({status:404});
  await svc.transition(q,{actor:agent,market:m.code,ref,target:'closed',reason:'Terminé'});
  await expect(svc.post(q,{...as(owner,'client'),visibility:'client',body:'denied'})).rejects.toMatchObject({status:409});
  await expect(svc.post(q,{...as(agent,'market'),visibility:'client',body:'denied'})).rejects.toMatchObject({status:409});
  const retention=await q.query("SELECT a.purge_after=r.closed_at+interval '180 days' AS ok FROM conversation_attachments a JOIN conversation_messages c ON c.id=a.message_id JOIN client_requests r ON r.id=c.subject_id WHERE r.id=$1",[requestId]);
  expect(retention.rows.every(r=>r.ok)).toBe(true);
  await svc.transition(q,{actor:agent,market:m.code,ref,target:'in_progress'});
  expect((await svc.read(q,as(agent,'market'))).messages.some(x=>x.event_type==='reopened')).toBe(true);
  await svc.transition(q,{actor:agent,market:m.code,ref,target:'closed',reason:'Terminé'});
  await q.query("UPDATE conversation_attachments SET purge_after=now()-interval '1 second' WHERE id=ANY($1::uuid[])",[[clientPhoto,internalPhoto]]);
  await conv.purgeExpired(q);
  expect((await q.query('SELECT id FROM conversation_attachments WHERE id=ANY($1::uuid[])',[[clientPhoto,internalPhoto]])).rows).toHaveLength(0);
  await conv.purgeExpired(q);
  expect((await q.query('SELECT id FROM orders WHERE user_id=$1',[owner.id])).rows).toHaveLength(0);
 }finally{await q.query('ROLLBACK');q.release()}
},30000);
