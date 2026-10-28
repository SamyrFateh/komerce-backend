'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {run,validateArgs,parseJSON,URL}=require('../../scripts/cj-object-extract-batch');
const inputHash='a'.repeat(64);
const inputRow={ref:'X1',title:'Plush Dinosaur Backpack',
 source_path:'Toys > Plush',provider:'CJdropshipping',
 attributes:{},input_hash:inputHash};
test('local model required; CI never calls model; paid key alone does not enable anything',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-local-'));
 const file=path.join(dir,'input.jsonl');fs.writeFileSync(file,JSON.stringify(inputRow)+'\n');
 try{
  const args=[file,path.join(dir,'out.jsonl'),'1','1'];
  expect(()=>validateArgs(args,{ANTHROPIC_API_KEY:'paid-secret'}))
   .toThrow('LOCAL_MODEL_REQUIRED');
  expect(()=>validateArgs(args,{GITHUB_ACTIONS:'true',SHADOW_LOCAL_MODEL:'qwen2.5:3b'}))
   .toThrow('LOCAL_LLM_FORBIDDEN_IN_CI');
  expect(()=>validateArgs([file,args[1],'499','1'],{SHADOW_LOCAL_MODEL:'qwen2.5:3b'}))
   .toThrow('Usage:');
  expect(()=>validateArgs([file,args[1],'1','6'],{SHADOW_LOCAL_MODEL:'qwen2.5:3b'}))
   .toThrow('Usage:');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('local-only endpoint, strict source evidence, cache, and resumability',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-local-'));
 const file=path.join(dir,'input.jsonl'),out=path.join(dir,'output.jsonl');
 fs.writeFileSync(file,JSON.stringify(inputRow)+'\n');
 let calls=0;
 const fakeFetch=async(url,options)=>{
  calls++;
  expect(url).toBe('http://127.0.0.1:11434/api/generate');
  expect(options.headers).not.toHaveProperty('x-api-key');
  expect(JSON.parse(options.body).stream).toBe(false);
  return {ok:true,json:async()=>({
   response:JSON.stringify({identities:[{ref:'X1',objet:'sac à dos',
    preuve:'Backpack',role:'principal',public:'inconnu',accessoire_de:null,
    ambigu:false,raison_ambiguite:null}]}),
   prompt_eval_count:180,eval_count:68})};
 };
 try{
  const args=[file,out,'1','1'],env={SHADOW_LOCAL_MODEL:'qwen2.5:3b'};
  const a=await run(args,env,fakeFetch);
  expect(a).toMatchObject({mode:'OFFLINE_OLLAMA_NO_API_KEY',validated:1,rejected:0});
  expect(a.usage).toMatchObject({calls:1,prompt_tokens:180,output_tokens:68});
  const b=await run(args,env,async()=>{throw Error('cache_miss')});
  expect(b.validated).toBe(1);expect(b.usage.calls).toBe(0);expect(calls).toBe(1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid model proof is quarantined and cannot become a family placement',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-local-'));
 const file=path.join(dir,'input.jsonl'),out=path.join(dir,'output.jsonl');
 fs.writeFileSync(file,JSON.stringify(inputRow)+'\n');
 try{
  const a=await run([file,out,'1','1'],{SHADOW_LOCAL_MODEL:'qwen2.5:3b'},
    async()=>({ok:true,json:async()=>({response:JSON.stringify({identities:[{
      ref:'X1',objet:'sac à dos',preuve:'handbag',role:'principal',public:'inconnu',
      accessoire_de:null,ambigu:false,raison_ambiguite:null
    }]})})}));
  expect(a.validated).toBe(0);expect(a.rejected).toBe(1);
  expect(a.invalid[0].reason).toBe('EVIDENCE_NOT_IN_SOURCE_TITLE');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('only JSON envelopes parsed',()=>{
 expect(parseJSON('{"identities":[]}')).toEqual({identities:[]});
 expect(parseJSON('\x60\x60\x60json\n{"identities":[]}\n\x60\x60\x60')).toEqual({identities:[]});
 expect(()=>parseJSON('not-json')).toThrow();
});
