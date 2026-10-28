#!/usr/bin/env node
/** @komerce-arch-lite
 * @role object-identity-llm-batch-shadow
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Opt-in bounded AI extraction with source proof and resumable cache.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,offline-rd
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateIdentity}=require('./cj-object-shadow-v2');
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const PROMPT_VERSION='object-id-fr-v1';
const PROMPT=[
 'Tu extrais UNIQUEMENT l identité de l objet principal des produits fournisseurs.',
 'Aucune catégorie commerciale, aucun score de confiance, aucun jugement de vendabilité.',
 'Pour chaque ref: objet (lemme canonique FR), preuve (extrait EXACT du titre source),',
 'role: principal|accessoire|kit|piece; public: femme|homme|enfant|bebe|mixte|inconnu;',
 'accessoire_de: objet FR ou null; ambigu: booléen; raison_ambiguite: texte si ambigu sinon null.',
 'Distingue matériau, objet principal, accessoire, pièce et contenu de kit.',
 'Chemin fournisseur = contexte bruité et non preuve. Utilise inconnu si non spécifié.',
 'Retour exclusivement JSON valide: {"identities":[...]} sans commentaire.'
].join('\n');
function parseJSON(raw){
 return JSON.parse(String(raw).trim().replace(/^\x60{3}(?:json)?\s*/i,'')
   .replace(/\s*\x60{3}$/,''));
}
async function batchCall(batch,model,key){
 const response=await fetch('https://api.anthropic.com/v1/messages',{
  method:'POST',headers:{'content-type':'application/json','x-api-key':key,
   'anthropic-version':'2023-06-01'},
  body:JSON.stringify({model,max_tokens:2500,temperature:0,system:PROMPT,
   messages:[{role:'user',content:JSON.stringify(batch.map(x=>({
     ref:x.ref,title:x.title,source_path:x.source_path,attributes:x.attributes
   })))}]})
 });
 if(!response.ok)throw Error('PROVIDER_STATUS_'+response.status);
 const data=await response.json();
 const result=parseJSON((data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'));
 if(!Array.isArray(result.identities)||result.identities.length!==batch.length)
  throw Error('PROVIDER_BATCH_CARDINALITY_MISMATCH');
 return {identities:result.identities,usage:data.usage||{}};
}
async function run(argv,env=process.env){
 const [inputFile,outFile,maxArg,batchArg]=argv;
 const max=Number(maxArg||20),batchSize=Number(batchArg||5);
 if(!inputFile||!outFile||!Number.isInteger(max)||max<1||max>498
   ||!Number.isInteger(batchSize)||batchSize<1||batchSize>8)
  throw Error('Usage: <identity-input.jsonl> <out.jsonl> [max-products 1..498] [batch-size 1..8]');
 if(env.SHADOW_ALLOW_API!=='YES'||!env.ANTHROPIC_API_KEY||!env.SHADOW_IDENTITY_MODEL)
  throw Error('EXPLICIT_OPT_IN_REQUIRED: SHADOW_ALLOW_API=YES, ANTHROPIC_API_KEY and SHADOW_IDENTITY_MODEL');
 if(env.GITHUB_ACTIONS==='true')throw Error('LLM_CALLS_FORBIDDEN_IN_CI');
 const rows=fs.readFileSync(inputFile,'utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
 const target=rows.slice(0,max),cacheDir=path.join(path.dirname(outFile),'.identity-cache');
 fs.mkdirSync(cacheDir,{recursive:true});
 const done=new Map(),bad=[],pending=[],usage={input_tokens:0,output_tokens:0,calls:0};
 if(fs.existsSync(outFile)){
  for(const line of fs.readFileSync(outFile,'utf8').split(/\r?\n/).filter(Boolean)){
   const row=JSON.parse(line);done.set(row.ref,row);
  }
 }
 for(const row of target){
  const cached=path.join(cacheDir,SHA(env.SHADOW_IDENTITY_MODEL+'|'+PROMPT_VERSION+'|'+row.input_hash)+'.json');
  if(fs.existsSync(cached)){
   try{
    const existing=JSON.parse(fs.readFileSync(cached,'utf8'));
    validateIdentity(existing,row);done.set(row.ref,existing);continue;
   }catch(_){fs.unlinkSync(cached);}
  }
  if(done.has(row.ref)){
   try{validateIdentity(done.get(row.ref),row);continue;}
   catch(_){done.delete(row.ref);}
  }
  pending.push(row);
 }
 for(let i=0;i<pending.length;i+=batchSize){
  const batch=pending.slice(i,i+batchSize);
  const response=await batchCall(batch,env.SHADOW_IDENTITY_MODEL,env.ANTHROPIC_API_KEY);
  usage.calls++;usage.input_tokens+=Number(response.usage.input_tokens||0);
  usage.output_tokens+=Number(response.usage.output_tokens||0);
  const found=new Map(response.identities.map(x=>[x.ref,x]));
  if(found.size!==batch.length)throw Error('PROVIDER_DUPLICATE_OR_MISSING_REFS');
  for(const row of batch){
   try{
    const proposal={...found.get(row.ref),input_hash:row.input_hash};
    const checked=validateIdentity(proposal,row);
    const output={...checked,input_hash:row.input_hash};
    done.set(row.ref,output);
    const f=path.join(cacheDir,SHA(env.SHADOW_IDENTITY_MODEL+'|'+PROMPT_VERSION+'|'+row.input_hash)+'.json');
    fs.writeFileSync(f,JSON.stringify(output)+'\n');
   }catch(e){bad.push({ref:row.ref,reason:e.message});}
  }
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  fs.writeFileSync(outFile,[...done.values()].map(x=>JSON.stringify(x)).join('\n')+'\n');
 }
 return {target:target.length,extracted:target.filter(x=>done.has(x.ref)).length,
  rejected:bad.length,rejections:bad,usage,model:env.SHADOW_IDENTITY_MODEL,
  prompt_version:PROMPT_VERSION,
  note:'API use explicit and bounded. Token counts measured; accuracy and money cost not inferred.'};
}
if(require.main===module){run(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r)))
 .catch(e=>{console.error('[OBJECT_EXTRACT] '+e.message);process.exitCode=1;});}
module.exports={run,parseJSON};
