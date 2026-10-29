'use strict';
/**
 * Independent withheld-mutant loader for test evaluator only.
 * The case generator does not import or select these mutations.
 * Intercepts exactly one owner module on a throwaway PostgreSQL clone.
 */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const url=new URL(process.env.DATABASE_URL||'');
const mutation=process.env.KBA_V40_EVALUATOR_MUTANT;
if(process.env.NODE_ENV!=='test'||
   process.env.KOMERCE_DISABLE_CRONS!=='true'||
   !['localhost','127.0.0.1','::1'].includes(url.hostname)||
   !/^\/kba_[a-f0-9]{18}$/.test(url.pathname)||
   !['SKIP_COMPLETION','RELAX_FOREIGN_GUARD'].includes(mutation))
 throw Error('G3_MUTANT_TOOL_ERROR: evaluator requires local disposable clone');
const owner=path.resolve(__dirname,'../../services/inventory-service.js');
const initial=Module._extensions['.js'];
Module._extensions['.js']=function(mod,filename){
 if(path.resolve(filename)!==owner)return initial(mod,filename);
 Module._extensions['.js']=initial;
 const source=fs.readFileSync(filename,'utf8');
 const before=mutation==='SKIP_COMPLETION'?
  'await updateOrderCompletion(oi.order_id, client);':
  'if (order_id != null && String(order_id) !== String(oi.order_id)) {';
 const after=mutation==='SKIP_COMPLETION'?
  'await Promise.resolve(); /* evaluator mutation: omit completion */':
  'if (false && order_id != null && String(order_id) !== String(oi.order_id)) {';
 if(source.split(before).length!==2)
  throw Error('G3_MUTANT_TOOL_ERROR: owner anchor changed or non-unique');
 process.env.KBA_V40_MUTANT_APPLIED='YES';
 return mod._compile(source.replace(before,after),filename);
};
