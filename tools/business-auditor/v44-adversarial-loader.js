'use strict';
/** Test-only source mutation loader. No runtime service files are modified. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {mutate}=require('./v44-adversarial-mutations');
const url=new URL(process.env.DATABASE_URL||'');
const id=process.env.KBA_V44_BENCH_MUTANT;
if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true'||
   !['localhost','127.0.0.1','::1'].includes(url.hostname)||
   !/^\/kba_[a-f0-9]{18}$/.test(url.pathname)||!id)
 throw Error('V44_MUTANT_REQUIRES_DISPOSABLE_LOCAL_PG');
const owner=path.resolve(__dirname,'../../services/inventory-service.js');
const load=Module._extensions['.js'];
Module._extensions['.js']=function(mod,filename){
 if(path.resolve(filename)!==owner)return load(mod,filename);
 Module._extensions['.js']=load;
 const modified=mutate(fs.readFileSync(filename,'utf8'),id);
 process.env.KBA_V40_MUTANT_APPLIED='YES';
 return mod._compile(modified,filename);
};
