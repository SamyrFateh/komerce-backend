'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {inputRecord,validateIdentity,familyKey,analyse,splitGroup,prepare}
 =require('../../scripts/cj-object-shadow-v2');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const first={ref:'X1',provider:'CJdropshipping',supplier_id:'1',
 title:'Plush Dinosaur Backpack',source_path:'Toys > Plush',attributes:{},
 v1:{status:'CATEGORY_CLASSIFIED',category:'Maison',subcategory:null}};
const second={ref:'X2',provider:'CJdropshipping',supplier_id:'2',
 title:'Solar Mug Press with Ceramic Mugs',source_path:'Home > Kitchen',attributes:{},
 v1:{status:'REVIEW_REQUIRED',category:null,subcategory:null}};
function extract(row,objet,preuve,other={}){
 return {ref:row.ref,input_hash:inputRecord(row).input_hash,objet,preuve,
 role:'principal',public:'inconnu',accessoire_de:null,ambigu:false,raison_ambiguite:null,...other};
}
test('object proof has to be an actual quote in the source title',()=>{
 const i=inputRecord(first),e=extract(first,'sac a dos','Backpack');
 expect(validateIdentity(e,i).objet).toBe('sac a dos');
 expect(()=>validateIdentity({...e,preuve:'handbag'},i))
  .toThrow('EVIDENCE_NOT_IN_SOURCE_TITLE');
 expect(()=>validateIdentity({...e,input_hash:'stale'},i))
  .toThrow('STALE_OR_WRONG_EXTRACTION');
});
test('roles, public and accessory target separate commercial families',()=>{
 const e=validateIdentity(extract(first,'sac a dos','Backpack'),inputRecord(first));
 expect(familyKey(e)).toBe('sac a dos|inconnu|principal|-');
 expect(familyKey({...e,role:'accessoire',accessoire_de:'sac'}))
  .not.toBe(familyKey(e));
});
test('full-title duplicates always remain in the same blind partition',()=>{
 expect(splitGroup('USB-C   Cable')).toBe(splitGroup('usb c cable'));
});
test('unapproved identity cannot generate even a parent-level placement',()=>{
 const r=analyse([first,second],[extract(first,'sac a dos','Backpack'),
  extract(second,'presse','Mug Press')]);
 expect(r.report.valid).toBe(2);
 expect(r.report.families).toBe(2);
 expect(r.report.proposals).toBe(0);
 expect(r.report.precision).toBeNull();
 expect(r.report.human_minutes).toBeNull();
});
test('approved human family still requires supplier and V1 disagreement review',()=>{
 const i=extract(first,'sac a dos','Backpack');
 const key=familyKey(validateIdentity(i,inputRecord(first)));
 const rule={key,category:'Mode & Beauté',status:'APPROVED',
   reviewed_by:'human',version:'1',observed_suppliers:['CJdropshipping']};
 expect(analyse([first],[i],[rule]).report.proposals).toBe(0);
 const result=analyse([first],[i],[{...rule,v1_disagreement_reviewed:true}]);
 expect(result.report.proposals).toBe(1);
 expect(result.decisions[0].shadow.category).toBe('Mode & Beauté');
});
test('new supplier or ambiguous product cannot inherit a rule blindly',()=>{
 const i=extract(first,'sac a dos','Backpack',{ambigu:true,raison_ambiguite:'kit uncertainty'});
 const key=familyKey(validateIdentity(i,inputRecord(first)));
 const rule={key,category:'Maison',status:'APPROVED',
    reviewed_by:'human',version:'1',observed_suppliers:['CJdropshipping']};
 expect(analyse([first],[i],[rule]).report.proposals).toBe(0);
 const other={...first,provider:'Allegro'};
 const e2=extract(other,'sac a dos','Backpack',{ambigu:false,raison_ambiguite:null});
 expect(analyse([other],[e2],[rule]).report.proposals).toBe(0);
});
test('invalid and duplicated extractions quarantined',()=>{
 const e=extract(first,'sac a dos','Backpack');
 const r=analyse([first],[e,e,{...e,ref:'X0'}]);
 expect(r.report.invalid).toBe(2);
 expect(r.report.valid).toBe(1);
});
test('annotation split is always blind and keeps normalized duplicates together',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadow-v2-'));
 try{
  const r=prepare([first,{...first,ref:'X3',supplier_id:'3',title:' Plush   dinosaur backpack '}],dir);
  expect(r.duplicate_groups).toBe(1);
  const gold=fs.readFileSync(path.join(dir,'blind-'+splitGroup(first.title)+'.csv'),'utf8');
  expect(gold).toContain('X1');expect(gold).toContain('X3');
  expect(gold).not.toContain('CATEGORY_CLASSIFIED');expect(gold).not.toContain('"Maison"');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
