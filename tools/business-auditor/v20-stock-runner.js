'use strict';
/**
 * True PostgreSQL stock negative control. Two independent calls to the real
 * adjustStock owner decrement the SAME product. A CHECK prevents stock<0.
 * Four isolated clones for stock 1 and stock 2, all dropped after execution.
 * A protected constraint violation is not a serializability bug.
 */
const crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const MODES=['AB','AB_REPEAT','BA','PARALLEL'];
function normalize(row){
 const n=Number(row?.stock);
 if(!Number.isSafeInteger(n))throw Error('TOOL_ERROR: invalid stock measurement');
 return {stock:n};
}
async function scenario(url,mode,openingStock){
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:6000});
 const connections=[];let seeded=false;
 try{
  for(let i=0;i<3;i++)connections.push(await pool.connect());
  const [monitor,a,b]=connections;
  const product=crypto.randomUUID();
  await monitor.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V20 stock negative control',5000,$2)",
   [product,openingStock]);
  seeded=true;
  const {adjustStock}=require('../../services/product-stock-service');
  const before=normalize((await monitor.query('SELECT stock FROM products WHERE id=$1',[product])).rows[0]);
  const actors=mode==='BA'?[{target:'B',client:b},{target:'A',client:a}]:
    [{target:'A',client:a},{target:'B',client:b}];
  const invoke=async x=>{
   try{
    await adjustStock(x.client,[{product_id:product,quantity:1}],'decrement');
    return {target:x.target,status:'fulfilled',value:{success:true}};
   }catch(e){
    return {target:x.target,status:'rejected',code:e.code||'UNCLASSIFIED'};
   }
  };
  const outcomes=mode==='PARALLEL'?await Promise.all(actors.map(invoke)):
   [await invoke(actors[0]),await invoke(actors[1])];
  const after=normalize((await monitor.query('SELECT stock FROM products WHERE id=$1',[product])).rows[0]);
  return {mode,openingStock,before,after,outcomes,gate:{arrived:2,serialized:false},
   fixture:'PRODUCT_STOCK_LEGACY_SINGLE_ROW'};
 }finally{
  for(const c of connections)c.release();
  await pool.end();
 }
}
async function explore(env=process.env,openingStock=1){
 if(![1,2].includes(openingStock))throw Error('TOOL_ERROR: unsafe stock fixture');
 const cases=[];
 for(const mode of MODES){
  const r=await withClone(env,url=>scenario(url,mode,openingStock));
  cases.push({...r.result,cloneDropped:r.cloneDroppedAfterExecution});
 }
 return {contract:'komerce-opus-stock-negative-control-raw/v20',
  openingStock,cases,allClonesDropped:cases.every(c=>c.cloneDropped),
  actualOwner:'services/product-stock-service.js#adjustStock',
  dbIsolation:'LOCAL_CANONICAL_TEMPLATE_CLONES',
  noExternalPayments:true,productionIncidentConfirmed:false};
}
module.exports={normalize,scenario,explore};
