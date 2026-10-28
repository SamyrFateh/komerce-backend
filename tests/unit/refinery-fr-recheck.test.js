'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockUpsertOverrides=jest.fn();
jest.mock('../../services/catalog-overrides',()=>({
  upsertOverrides:(...args)=>mockUpsertOverrides(...args),
}));
const {correctActiveFrench,RefineryFrenchRecheckError,_test}
  =require('../../services/refinery-fr-recheck');

const french={
  name:'Coque de protection pour téléphone Samsung',
  description:'Cette coque de protection souple protège votre téléphone contre les rayures et les chocs du quotidien. Elle reste facile à installer.',
};
const before={
  id:93,product_ref:'KPR-000093',name:'Carplay Player',
  description:null,source_locale:'en',content_source:'connector_raw',
  lifecycle_status:'active',is_active:true,needs_review:true,
};
function executor(product=before,handoff=true) {
  const calls=[];
  const q={ query:jest.fn(async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('SELECT * FROM products WHERE product_ref'))return {rows:product?[product]:[]};
    if(sql.includes("FROM sourcing_candidates WHERE"))return {rows:handoff?[{exists:1}]:[]};
    if(sql.includes('UPDATE products'))return {rows:[{
      product_ref:'KPR-000093',is_active:true,lifecycle_status:'active',
      content_source:'manual',needs_review:false,
    }]};
    throw new Error('unexpected_sql:'+sql);
  })};
  return {q,calls};
}
beforeEach(()=>{jest.clearAllMocks();mockUpsertOverrides.mockResolvedValue({
  overridden:['name','description'],product:{...before,content_source:'manual',needs_review:false},
});});

test('réexamen FR actif : corrige seulement titre/description via overrides tracés',async()=>{
  const {q,calls}=executor();
  const result=await correctActiveFrench(before.product_ref,french,{id:12},q);
  expect(result).toMatchObject({
    status:'editorial_recheck_saved',publication_changed:false,
    approval_granted:false,market_exposure_changed:false,source_preserved:true,
  });
  expect(mockUpsertOverrides).toHaveBeenCalledWith(q,93,french,expect.objectContaining({
    setBy:12,reason:expect.stringContaining('Raffinerie'),
  }));
  expect(calls.map(x=>x.sql).join('\n')).not.toMatch(/UPDATE (?:.*)product_market_exposure/i);
  expect(calls.at(-1).sql).toContain("WHERE id=$1 AND lifecycle_status='active' AND is_active=TRUE");
  expect(calls.at(-1).sql).not.toContain('is_available');
  expect(calls.at(-1).sql).not.toContain('price');
});

test('réexamen FR : interdit candidat inactif et absence de remise Sourcing',async()=>{
  const {q}=executor({...before,is_active:false,lifecycle_status:'candidate'});
  await expect(correctActiveFrench(before.product_ref,french,{id:12},q))
    .rejects.toMatchObject({code:'refinery_active_recheck_only',status:409});
  const missing=executor(before,false);
  await expect(correctActiveFrench(before.product_ref,french,{id:12},missing.q))
    .rejects.toMatchObject({code:'refinery_handoff_required',status:409});
  expect(mockUpsertOverrides).not.toHaveBeenCalled();
});

test('réexamen FR : défaut déjà corrigé interdit une seconde validation',async()=>{
  const ready=executor({...before,description:'Description française',
    source_locale:'fr',content_source:'manual',needs_review:false});
  await expect(correctActiveFrench(before.product_ref,french,{id:12},ready.q))
    .rejects.toMatchObject({code:'refinery_fr_already_ready'});
});

test('réexamen FR : champs et acteur requis ; anglais pur refusé',async()=>{
  const {q}=executor();
  await expect(correctActiveFrench('KPR-000093',{name:'',description:''},{id:12},q))
    .rejects.toMatchObject({code:'refinery_fr_fields_required',status:422});
  await expect(correctActiveFrench('KPR-000093',french,null,q))
    .rejects.toMatchObject({code:'refinery_fr_actor_required',status:403});
  expect(_test.isEditorialIncomplete(before)).toBe(true);
});

test('réexamen FR : erreurs sémantiques et statut sans mutation implicite',()=>{
  expect(new RefineryFrenchRecheckError('x','y',422)).toMatchObject({code:'x',status:422});
  expect(_test.isEditorialIncomplete({...before,content_source:'manual',source_locale:'fr',description:'Fiche FR',needs_review:false})).toBe(false);
});
