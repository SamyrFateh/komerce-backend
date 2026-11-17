#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g13-cj-three-media-proof
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Fetch real CJ media from staging-pinned read-only catalog for visual review; never claims approval.
 * @db-read products, catalog_media
 * @db-write none
 * @impact-areas catalog, staging-only
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const TARGETS=Object.freeze(['KPR-000245','KPR-000246','KPR-000247']);
const ALLOWED_HOSTS=Object.freeze(['cf.cjdropshipping.com','oss-cf.cjdropshipping.com']);
const OUT=path.resolve('test-results/g13-cj-visual-evidence');
const MAX_PER_IMAGE=4*1024*1024, MAX_TOTAL=150*1024*1024, MAX_MEDIA=180;
function guard(env) {
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER
    ||env.KOMERCE_ENV!=='staging'||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'
    ||env.STAGING_BASE_URL!==BASE
    ||!String(env.PGOPTIONS||'').includes('default_transaction_read_only=on')
    ||env.G13_MEDIA_SCOPE!=='cj-three-authentic'
    ||!/^\d{5,20}$/.test(env.GITHUB_RUN_ID||''))throw Error('G13_MEDIA_GUARD_REFUSED');
}
function sourceURL(raw) {
  const u=new URL(String(raw||''));
  if(u.protocol!=='https:'||!ALLOWED_HOSTS.includes(u.hostname)||u.username||u.password||u.port)
    throw Error('UNAPPROVED_MEDIA_SOURCE');
  return u;
}
function detectImage(bytes) {
  if(bytes.length<16)return null;
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpg';
  if(bytes[0]===0x89&&bytes.subarray(1,4).equals(Buffer.from('PNG')))return 'png';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';
  if(bytes.subarray(0,3).toString()==='GIF')return 'gif';
  return null;
}
async function ro(sql,params) {
  const c=await db.pool.connect();
  try {await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='15000ms'");
    return (await c.query(sql,params)).rows;}
  finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
}
async function download(row,index) {
  const source=sourceURL(row.url);
  const res=await fetch(source.toString(),{redirect:'manual',signal:AbortSignal.timeout(22000),
    headers:{'accept':'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'}});
  if(!res.ok)throw Error('MEDIA_HTTP_'+res.status);
  const mime=String(res.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!mime.startsWith('image/'))throw Error('MEDIA_MIME_NOT_IMAGE');
  const len=Number(res.headers.get('content-length')||0);
  if(len>MAX_PER_IMAGE)throw Error('MEDIA_TOO_LARGE');
  const reader=res.body.getReader();
  const parts=[];let size=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;
      size+=value.length;if(size>MAX_PER_IMAGE)throw Error('MEDIA_BYTES_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(parts),ext=detectImage(bytes);
  if(!ext)throw Error('MEDIA_INVALID_IMAGE_BYTES');
  const filename=String(index+1).padStart(3,'0')+'.'+ext;
  const folder=path.join(OUT,row.product_ref);
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,filename),bytes);
  return {file:path.join(row.product_ref,filename),size,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
async function main(env=process.env) {
  const report={schema:'g13-cj-three-real-media/1',run_id:env.GITHUB_RUN_ID||null,
    verdict:'NOT_PROVEN',items:[],expected:0,fetched:0,bytes:0,approval:'NOT_PERFORMED'};
  const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');};
  try {
    guard(env);
    const target=await confirmTarget({db,env});
    if(!target.confirmed)throw Error('TARGET_NOT_CONFIRMED');
    report.db_fingerprint=target.fingerprint;
    const rows=await ro(`SELECT p.product_ref,p.is_active,p.lifecycle_status,
        cm.source_media_id,cm.url,cm.option_values,cm.display_order
        FROM products p JOIN catalog_media cm ON cm.product_id=p.id AND cm.is_active=TRUE
        WHERE p.product_ref=ANY($1::text[])
        ORDER BY p.product_ref,cm.display_order,cm.created_at,cm.id`,[TARGETS]);
    report.expected=rows.length;
    const found=[...new Set(rows.map(x=>x.product_ref))];
    if(found.length!==3||TARGETS.some(x=>!found.includes(x)))throw Error('THREE_PRODUCTS_MEDIA_REQUIRED');
    if(rows.some(x=>x.is_active===true||x.lifecycle_status==='active'))
      throw Error('PRODUCT_ALREADY_PUBLISHED_NOT_CLEAN_DRAFT');
    if(rows.length>MAX_MEDIA)throw Error('MEDIA_SET_TOO_LARGE_REQUIRE_SEPARATE_APPROVAL');
    if(rows.some(x=>!x.source_media_id||!x.url))throw Error('MEDIA_IDENTITY_MISSING');
    rows.forEach(x=>sourceURL(x.url));
    const tasks=rows.map((row,i)=>({...row,index:i}));
    // Small fixed concurrency; never POST to staging or supplier.
    for(let i=0;i<tasks.length;i+=6){
      const batch=tasks.slice(i,i+6);
      const processed=await Promise.all(batch.map(async row=>{
        const item={product_ref:row.product_ref,source_media_id:row.source_media_id,
          url:row.url,option_values:row.option_values,display_order:row.display_order,verdict:'NOT_PROVEN'};
        try {
          const v=await download(row,row.index);
          Object.assign(item,v,{verdict:'IMAGE_BYTES_VERIFIED_NOT_VISUALLY_APPROVED'});
        }catch(err){item.verdict='IMAGE_FETCH_BLOCKED';item.error=String(err.message||err).slice(0,180);}
        return item;
      }));
      report.items.push(...processed);
      save();
    }
    report.fetched=report.items.filter(x=>x.verdict==='IMAGE_BYTES_VERIFIED_NOT_VISUALLY_APPROVED').length;
    report.bytes=report.items.reduce((sum,x)=>sum+Number(x.size||0),0);
    report.verdict=report.expected>0&&report.fetched===report.expected&&report.bytes<=MAX_TOTAL
      ? 'MEDIA_DOWNLOADED_FOR_VISUAL_REVIEW_NOT_APPROVED' : 'MEDIA_EVIDENCE_INCOMPLETE_NO_GO';
    if(report.verdict==='MEDIA_EVIDENCE_INCOMPLETE_NO_GO')process.exitCode=2;
  }catch(e){report.verdict='BLOCKED';report.error=String(e.message||e).slice(0,240);process.exitCode=2;}
  finally{save();await db.pool.end().catch(()=>{});
    console.log(JSON.stringify({verdict:report.verdict,expected:report.expected,fetched:report.fetched,error:report.error||null}));}
}
if(require.main===module)main();
module.exports={TARGETS,ALLOWED_HOSTS,guard,sourceURL,detectImage};
