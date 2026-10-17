'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {suggest,audit}=require('../../scripts/audit-kir-cj-commercial-proposals');
const pairs=new Set(['Maison/Rangement','Mode & Beauté/Femme','Mode & Beauté/Homme','Enfant/Jouets','Sport/Fitness']);
test('CJ structural variants suggest same existing boutique category without confirmation',()=>{
 const x=suggest('Home, Garden & Furniture > Home Storage > Home Office Storage',pairs);
 const y=suggest('Home & Garden， Furniture / Home Storage / Home Office Storage',pairs);
 expect(x).toMatchObject({status:'PROPOSAL_NEEDS_CONFIRMATION',proposal:{category:'Maison',subcategory:'Rangement'}});
 expect(y.proposal).toEqual(x.proposal);
 expect(suggest('Toys, Kids & Babies > Toys & Hobbies > Stuffed & Plush Animals',pairs).proposal)
   .toEqual({category:'Enfant',subcategory:'Jouets'});
});
test('unsupported or inactive taxonomy remains manual-only',()=>{
 expect(suggest('Devices > Unknown Type',pairs)).toMatchObject({status:'REVIEW_REQUIRED',proposal:null});
 expect(suggest("Men's Clothing > T-Shirts > Print",new Set())).toMatchObject({status:'REVIEW_REQUIRED',proposal:null});
});
test('does not mutate or hide deferred review groups',async()=>{
 const products=Array.from({length:12},(_,i)=>({candidate_ref:'KSC-'+i,status:'REVIEW_REQUIRED',source_path:'Group '+i}));
 const query={query:jest.fn().mockResolvedValue({rows:[...pairs].map(pair=>({category:pair.split('/')[0],subcategory:pair.split('/')[1]}))})};
 const result=await audit('KIR-000008',{query,coverageAudit:async()=>({provider:'CJdropshipping',inspected:12,products})});
 expect(result).toMatchObject({review_groups:12,manual_only_groups:12,deferred_groups:2,writes:0,provider_calls:0});
 expect(result.workpack).toHaveLength(10);
 expect(result.all_groups).toHaveLength(12);
 expect(query.query).toHaveBeenCalledTimes(1);
});

test('women clothing matches female only rather than substring of mens clothing',()=>{
 for(const path of ["Women's Clothing > Tops & Sets > Lady Dresses",
 "Women's Clothing / Tops & Sets / Blouses & Shirts",
 "Women's Clothing > Bottoms > Wide Leg Pants"]) {
  expect(suggest(path,pairs)).toMatchObject({status:'PROPOSAL_NEEDS_CONFIRMATION',
    proposal:{category:'Mode & Beauté',subcategory:'Femme'}});
 }
});
test('home storage absent in active taxonomy has distinct actionable reason',()=>{
 const result=suggest('Home, Garden & Furniture > Home Storage > Home Office Storage',new Set());
 expect(result).toMatchObject({status:'REVIEW_REQUIRED',reason:'BOUTIQUE_PAIR_INACTIVE_OR_MISSING',
  suggested_pair:{category:'Maison',subcategory:'Rangement'}});
});
