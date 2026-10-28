'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {run,parseJSON}=require('../../scripts/cj-object-extract-batch');
test('bounded extractor requires deliberate opt-in, model and secret before network',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-extract-'));
 const file=path.join(dir,'input.jsonl');fs.writeFileSync(file,'');
 try{
  await expect(run([file,path.join(dir,'out.jsonl'),'5','2'],{}))
   .rejects.toThrow('EXPLICIT_OPT_IN_REQUIRED');
  await expect(run([file,path.join(dir,'out.jsonl'),'499','2'],
    {SHADOW_ALLOW_API:'YES'})).rejects.toThrow('Usage:');
  await expect(run([file,path.join(dir,'out.jsonl'),'2','9'],
    {SHADOW_ALLOW_API:'YES'})).rejects.toThrow('Usage:');
  await expect(run([file,path.join(dir,'out.jsonl'),'1','1'],
    {SHADOW_ALLOW_API:'YES',ANTHROPIC_API_KEY:'fake',
      SHADOW_IDENTITY_MODEL:'test',GITHUB_ACTIONS:'true'}))
   .rejects.toThrow('LLM_CALLS_FORBIDDEN_IN_CI');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('single JSON response envelope is parsed without markdown ambiguity',()=>{
 expect(parseJSON('{"identities":[]}')).toEqual({identities:[]});
 expect(parseJSON('\x60\x60\x60json\n{"identities":[]}\n\x60\x60\x60'))
  .toEqual({identities:[]});
 expect(()=>parseJSON('not-json')).toThrow();
});
