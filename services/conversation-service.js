/**
 * @komerce-arch
 * @role          conversation-service
 * @domain        notifications
 * @layer         service
 * @criticality   high
 * @inputs        transaction executor, authorized locked subject, actor, message
 * @outputs       conversation projections, private attachment bytes
 * @depends       services/conversation-photo-sanitizer.js
 * @db-read       conversation_messages, conversation_attachments, client_requests
 * @db-write      conversation_messages, conversation_attachments
 * @db-txn        caller-owned
 * @doctrine      private_client_conversation, immutable_messages
 * @impact-areas  notifications, market-delegation
 */
'use strict';
const {sanitizePhoto}=require('./conversation-photo-sanitizer');
function failure(code,status=400){return Object.assign(new Error(code),{code,status});}
const CHANNELS=Object.freeze({
  client:['client'],
  market:['client','internal'],
  hub:['internal'],
});
function allowed(scope) {
  const values=Object.prototype.hasOwnProperty.call(CHANNELS,scope)?CHANNELS[scope]:null;
  if(!values)throw failure('CONVERSATION_SCOPE_INVALID',403);
  return values;
}
function prepare({body='',files=[],visibility,scope,eventType='message'}){
  const channels=allowed(scope);
  if(!channels.includes(visibility))throw failure('CONVERSATION_VISIBILITY_FORBIDDEN',403);
  if(typeof body!=='string'||Array.from(body).length>2000)throw failure('CONVERSATION_TEXT_INVALID');
  if(!Array.isArray(files)||files.length>3)throw failure('CONVERSATION_TOO_MANY_PHOTOS');
  if(eventType!=='message'&&(scope!=='market'||visibility!=='internal'||files.length))throw failure('CONVERSATION_EVENT_FORBIDDEN',403);
  if(eventType==='message'&&!body.trim()&&!files.length)throw failure('CONVERSATION_MESSAGE_EMPTY');
  const photos=new Map();
  for(const file of files){
    const photo=sanitizePhoto(file.buffer);
    if(file.detectedMimeType&&file.detectedMimeType!==photo.mime)throw failure('CONVERSATION_IMAGE_INVALID',415);
    if(file.mimetype&&file.mimetype!==photo.mime)throw failure('CONVERSATION_IMAGE_INVALID',415);
    photos.set(photo.sha256,photo);
  }
  return {body:body.trim(),photos:[...photos.values()],visibility,eventType};
}
// Caller must lock and authorize the request row in the same transaction.
// Never pass a request identity or scope supplied by a browser to this service.
async function append(q,{request,actorId,scope,visibility,body,files,eventType='message'}){
  if(request.status==='closed'&&eventType==='message')throw failure('CLIENT_REQUEST_CLOSED',409);
  const data=prepare({scope,visibility,body,files,eventType});
  const {rows:[message]}=await q.query(
    'INSERT INTO conversation_messages(subject_id,visibility,author_user_id,author_side,event_type,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,visibility,author_side,event_type,body,created_at',
    [request.id,data.visibility,actorId,scope==='client'?'client':'staff',data.eventType,data.body]);
  const attachments=[];
  for(const photo of data.photos){
    // Deduplicate only within the SAME visibility. Never reveal a private internal
    // image to a client as a consequence of cross-channel content equality.
    const {rows:[existing]}=await q.query(
      'SELECT a.id FROM conversation_attachments a JOIN conversation_messages m ON m.id=a.message_id WHERE m.subject_id=$1 AND m.visibility=$2 AND a.sha256=$3 LIMIT 1',
      [request.id,data.visibility,photo.sha256]);
    if(existing)continue;
    const {rows:[attachment]}=await q.query(
      'INSERT INTO conversation_attachments(message_id,mime,size_bytes,sha256,content) VALUES($1,$2,$3,$4,$5) RETURNING id,mime,size_bytes,created_at',
      [message.id,photo.mime,photo.size_bytes,photo.sha256,photo.content]);
    attachments.push(attachment);
  }
  // An exact replay of a photo-only message must not leave an empty message.
  if(!data.body&&eventType==='message'&&!attachments.length)throw failure('CONVERSATION_DUPLICATE_PHOTO',409);
  return {...message,attachments};
}
async function list(q,{requestId,scope,limit=100,before=null}){
  const channels=allowed(scope);
  const {rows}=await q.query(
    `WITH page AS (
      SELECT id,visibility,author_side,event_type,body,created_at
        FROM conversation_messages
       WHERE subject_id=$1 AND visibility=ANY($2::text[])
         AND ($3::uuid IS NULL OR (created_at,id) < (SELECT created_at,id FROM conversation_messages WHERE id=$3 AND subject_id=$1 AND visibility=ANY($2::text[])))
       ORDER BY created_at DESC,id DESC LIMIT $4
     )
     SELECT p.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'mime',a.mime,'size_bytes',a.size_bytes) ORDER BY a.created_at,a.id)
       FROM conversation_attachments a WHERE a.message_id=p.id AND (a.purge_after IS NULL OR a.purge_after>now())), '[]'::jsonb) AS attachments
       FROM page p ORDER BY p.created_at,p.id`,
    [requestId,channels,before,Math.max(1,Math.min(100,Number(limit)||100))]);
  return rows;
}
async function attachment(q,{requestId,attachmentId,scope}){
  const {rows:[file]}=await q.query(
    `SELECT a.id,a.mime,a.size_bytes,a.content
       FROM conversation_attachments a JOIN conversation_messages m ON m.id=a.message_id
      WHERE m.subject_id=$1 AND a.id=$2 AND m.visibility=ANY($3::text[])
        AND (a.purge_after IS NULL OR a.purge_after>now())`,
    [requestId,attachmentId,allowed(scope)]);
  if(!file)throw failure('CONVERSATION_ATTACHMENT_NOT_FOUND',404);
  return file;
}
async function purgeExpired(q){
  const {rowCount}=await q.query(`WITH due AS (
    SELECT r.id FROM client_requests r WHERE r.status='closed' AND EXISTS (
      SELECT 1 FROM conversation_messages m JOIN conversation_attachments a ON a.message_id=m.id
       WHERE m.subject_id=r.id AND a.purge_after<=now())
     ORDER BY r.closed_at,r.id LIMIT 100 FOR UPDATE OF r SKIP LOCKED
   )
   DELETE FROM conversation_attachments a USING conversation_messages m,due
    WHERE a.message_id=m.id AND m.subject_id=due.id AND a.purge_after<=now()`);
  return rowCount;
}
async function setRetention(q,{requestId,reopening=false}){
  if(reopening)await q.query(`DELETE FROM conversation_attachments a USING conversation_messages m
    WHERE a.message_id=m.id AND m.subject_id=$1 AND a.purge_after<=now()`,[requestId]);
  // Use the locked database row directly: JS Date truncates PostgreSQL microseconds.
  await q.query(`UPDATE conversation_attachments a SET purge_after=r.closed_at+interval '180 days'
    FROM conversation_messages m JOIN client_requests r ON r.id=m.subject_id
    WHERE a.message_id=m.id AND r.id=$1`,[requestId]);
}
module.exports={append,list,attachment,purgeExpired,prepare,setRetention};
