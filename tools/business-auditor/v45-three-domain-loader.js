'use strict';
/** Test-only loader. Changes exactly one allowlisted business owner in memory. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {CASES,mutate}=require('./v45-three-domain-mutations');
const env=process.env,url=new URL(env.DATABASE_URL||'');
const id=env.KBA_V45_MUTANT,entry=CASES.find(x=>x.id===id);
if(!entry||env.NODE_ENV!=='test'||env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname))
 throw Error('V45_MUTATION_REQUIRES_LOCAL_DISPOSABLE_CLONE');
const owner=path.resolve(__dirname,'../../',entry.source);
const initial=Module._extensions['.js'];
Module._extensions['.js']=function(module,filename){
 if(path.resolve(filename)!==owner)return initial(module,filename);
 Module._extensions['.js']=initial;
 const source=fs.readFileSync(filename,'utf8');
 const modified=mutate(source,id,entry.source);
 env.KBA_V45_MUTANT_APPLIED='YES';
 return module._compile(modified,filename);
};
