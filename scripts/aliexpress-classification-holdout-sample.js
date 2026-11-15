#!/usr/bin/env node
/** @komerce-arch-lite
 * @role aliexpress-classification-independent-holdout
 * @domain sourcing
 * @layer tooling
 * @purpose Acquire source-title/category evidence across AliExpress DS categories for blind taxonomy validation; no sourcing/catalog writes.
 * @db-read sourcing_candidates (target check); supplier_oauth_connections (delegated managed runtime)
 * @db-write-via:aliexpress-oauth supplier_oauth_connections (token refresh only, if required)
 * @impact-areas sourcing, catalog, supplier-import, staging
 */
'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const db = require('../db');
const {confirmTarget} = require('./recette/target-guard');
const connected = require('../services/suppliers/connectors/aliexpress-connected-connector');
const base = require('../services/suppliers/connectors/aliexpress-connector');
const discovery = require('../services/suppliers/aliexpress-discovery');

const TARGET=240, PER_ROOT=40, MAX_FEED_CALLS=180, MAX_DETAIL_CALLS=260;
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const text = v=>String(v==null?'':v).trim();
const csvCell = v=>'"'+text(v).replace(/"/g,'""').replace(/[\r\n]+/g,' ')+'"';
function sourcePath(item, categoryName){
  const first=text(item.first_level_category_name);
  const second=text(item.second_level_category_name);
  if(first&&second)return {path:first+' > '+second,provenance:'SUPPLIER_FEED_FULL_PATH'};
  if(first)return {path:first,provenance:'SUPPLIER_FEED_ROOT_ONLY'};
  const fallback=text(categoryName);
  return {path:fallback,provenance:fallback?'SUPPLIER_CATEGORY_FILTER_ONLY':'MISSING'};
}
async function main(){
  if(process.env.KOMERCE_ENV!=='staging'||process.env.NODE_ENV==='production')
    throw new Error('STAGING_ONLY');
  const matched=await confirmTarget({db,env:process.env});
  if(matched?.confirmed!==true)throw new Error('STAGING_IDENTITY_NOT_CONFIRMED');
  const env=await connected.managedRuntimeEnv();
  const invoke=(method,params)=>base.invokeTopWithThrottleRetry(method,params,{env});
  const feeds=discovery.feedNames(await invoke('aliexpress.ds.feedname.get',{})).slice(0,3);
  const categories=discovery.categories(await invoke('aliexpress.ds.category.get',{})).slice(0,48);
  if(!feeds.length||!categories.length)throw new Error('ALIEXPRESS_FEEDS_OR_CATEGORIES_ABSENT');
  const selected=[], seen=new Set(), countByRoot=new Map(), failures={};
  const known=await db.query("SELECT supplier_product_id FROM sourcing_candidates WHERE supplier_name ILIKE 'ali%' AND supplier_product_id IS NOT NULL");
  const knownIds=new Set(known.rows.map(row=>text(row.supplier_product_id)));
  // Prioritize unfiltered feed pages: the provider's own product category
  // evidence, not a requested category_id, determines a defensible root.
  // Historical supplier workers default to AE; KM may return an empty feed.
  const slots=[
    ...feeds.flatMap(feed=>[1,2,3,4].map(page=>({feed,page,cat:null}))),
    ...categories.flatMap(cat=>feeds.flatMap(feed=>[1,2].map(page=>({cat,feed,page})))),
  ];
  let calls=0,detailCalls=0,itemsSeen=0,idsSeen=0,unfilteredCalls=0;
  for(const slot of slots){
    if(selected.length>=TARGET||calls>=MAX_FEED_CALLS)break;
    const {feed,page,cat}=slot;
    let payload;
    calls++;
    if(!cat)unfilteredCalls++;
    try {
      payload=await invoke('aliexpress.ds.recommend.feed.get',{
        country:'AE',target_currency:'USD',target_language:'EN',
        page_size:50,page_no:page,
        ...(cat?.id?{category_id:cat.id}:{}),
        sort:'volumeDesc',feed_name:feed,
      });
    }catch(e){
      const reason=discovery.isEmptyResultError(e)?'EMPTY_FEED':'FEED_ERROR';
      failures[reason]=(failures[reason]||0)+1;
      if(reason==='FEED_ERROR')console.warn('FABLE_FEED_ERROR '+JSON.stringify({category_id:cat?.id||null,reason,code:String(e.code||'').slice(0,60)}));
      continue;
    }
    const items=base.flattenFeedProducts(payload);
    itemsSeen+=items.length;
    idsSeen+=discovery.productIds(payload).length;
    for(const item of items){
      if(selected.length>=TARGET)break;
      const id=text(base.extractProductId(item.product_id||item.itemId));
      if(!/^\d{5,20}$/.test(id)||seen.has(id)||knownIds.has(id))continue;
      const path=sourcePath(item,cat?.name||null);
      if(!path.path)continue;
      const root=text(path.path.split(' > ')[0]);
      if(!root||(countByRoot.get(root)||0)>=PER_ROOT)continue;
      let name=text(item.product_title||item.subject||item.product_name);
      if(!name&&detailCalls<MAX_DETAIL_CALLS){
        detailCalls++;
        try{
          const detail=await base.fetchProductDetail(id,{countryCode:'AE',env});
          const data=discovery.unwrap(detail);
          name=text(data?.ae_item_base_info_dto?.subject||data?.result?.ae_item_base_info_dto?.subject);
        }catch(e){failures.DETAIL_ERROR=(failures.DETAIL_ERROR||0)+1;}
        await sleep(550);
      }
      if(!name)continue;
      seen.add(id);
      selected.push({supplier_name:'AliExpress',supplier_product_id:id,product_name:name,
        supplier_category:path.path,path_evidence:path.provenance,provider_category_id:cat?.id||''});
      countByRoot.set(root,(countByRoot.get(root)||0)+1);
    }
    await sleep(220);
  }
  const headers=['supplier_name','supplier_product_id','product_name','supplier_category','path_evidence','provider_category_id'];
  const csv=[headers.map(csvCell).join(','),...selected.map(row=>headers.map(h=>csvCell(row[h])).join(','))].join('\n')+'\n';
  const hash=crypto.createHash('sha256').update(csv).digest('hex');
  const full=selected.filter(x=>x.path_evidence==='SUPPLIER_FEED_FULL_PATH').length;
  const rootOnly=selected.filter(x=>x.path_evidence==='SUPPLIER_FEED_ROOT_ONLY').length;
  const roots=new Set(selected.map(x=>x.supplier_category.split(' > ')[0])).size;
  const result={status:selected.length>=200&&roots>=8&&full>=200?'SUFFICIENT_RAW_HOLDOUT':'PARTIAL_RAW_HOLDOUT',
    selected:selected.length,distinct_roots:roots,full_supplier_paths:full,feed_root_only:rootOnly,
    category_filter_only:selected.length-full-rootOnly,feed_calls:calls,unfiltered_feed_calls:unfilteredCalls,raw_feed_items:itemsSeen,provider_ids:idsSeen,known_staging_ids:knownIds.size,detail_calls:detailCalls,
    failures,sha256:hash,provider_calls:calls+detailCalls+2,product_writes:0,
    note:'Reference labels still require independent human review; no automatic classification certified'};
  console.log('FABLE_HOLDOUT_RESULT='+JSON.stringify(result));
  console.log('FABLE_HOLDOUT_GZIP_BASE64='+zlib.gzipSync(Buffer.from(csv)).toString('base64'));
}
main().catch(e=>{console.error('FABLE_HOLDOUT_ERROR='+String(e.code||e.message||'UNKNOWN').slice(0,120));process.exitCode=1;})
  .finally(()=>db.pool.end());
