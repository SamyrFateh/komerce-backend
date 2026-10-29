'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { recoverSourceMedia } = require('../../services/catalog-media-recovery');

const PRODUCT={id:'bbbbbbbb-0000-0000-0000-000000000001',
  product_ref:'KPR-123',lifecycle_status:'candidate',is_active:false};
const ACTOR={id:'cccccccc-0000-0000-0000-000000000001'};
const SOURCE={candidate_ref:'KSC-123', normalized_source_contract:{
  schema_version:'2',media:[{supplier_media_id:'S-IMAGE-1',url:'https://supplier.test/img.jpg'}],
}};

function fixture({product=PRODUCT,source=SOURCE,total=0,after=1}={}) {
  const queries=[];
  const client={
    release:jest.fn(), query:jest.fn(async (sql,args=[])=>{
      queries.push([sql,args]);
      if (/^SELECT id, product_ref, lifecycle_status, is_active/.test(sql.trim()))
        return {rows:product?[product]:[]};
      if (sql.includes('AS total'))return {rows:[{total,active:0}]};
      if (sql.includes('SELECT candidate_ref'))return {rows:source?[source]:[]};
      if (sql.includes('AS active FROM catalog_media'))return {rows:[{active:after}]};
      return {rows:[]};
    }),
  };
  const database={getClient:jest.fn(async()=>client)};
  const promotionService={restoreSourceMediaOnly:jest.fn(async()=>['S-IMAGE-1'])};
  return {database,client,promotionService,queries};
}

test('nominal: restaure, audite et ne touche ni activation ni marché',async()=>{
  const f=fixture();
  await expect(recoverSourceMedia('KPR-123',ACTOR,f)).resolves.toMatchObject({
    media_recovered:1,audit_recorded:true,catalog_approved:false,market_exposure_changed:false,
  });
  const statements=f.queries.map(x=>x[0]);
  expect(statements[0]).toBe('BEGIN');
  expect(statements).toContain('COMMIT');
  expect(statements).not.toContain('ROLLBACK');
  expect(statements.some(s=>s.includes('INSERT INTO catalog_media_recovery_audit'))).toBe(true);
  const audit=f.queries.find(([sql])=>sql.includes('INSERT INTO catalog_media_recovery_audit'));
  expect(audit[1][3]).toBe(ACTOR.id);
  expect(audit[1][4]).toEqual(['S-IMAGE-1']);
  expect(audit[1][5]).toMatch(/^[a-f0-9]{64}$/);
  expect(f.promotionService.restoreSourceMediaOnly).toHaveBeenCalledTimes(1);
  expect(f.client.release).toHaveBeenCalledTimes(1);
});

test('rejets de l’acteur manquant avant lecture DB',async()=>{
 const f=fixture();
 await expect(recoverSourceMedia('KPR-123',null,f)).rejects.toMatchObject({
   code:'catalog_media_actor_required',status:403,
 });
 expect(f.database.getClient).not.toHaveBeenCalled();
});
test.each([
 ['produit absent',{product:null},'catalog_product_not_found'],
 ['actif',{product:{...PRODUCT,is_active:true}},'catalog_media_not_draft'],
 ['hors brouillon',{product:{...PRODUCT,lifecycle_status:'active'}},'catalog_media_not_draft'],
 ['média canonique déjà présent',{total:1},'catalog_media_existing_review_required'],
 ['source sans lien',{source:null},'catalog_media_source_handoff_missing'],
 ['contrat V1',{source:{...SOURCE,normalized_source_contract:{schema_version:'1',media:[{}]}}},'catalog_media_source_v2_required'],
 ['aucune source image',{source:{...SOURCE,normalized_source_contract:{schema_version:'2',media:[]}}},'catalog_media_source_v2_required'],
 ['réintégration partielle',{after:0},'catalog_media_recovery_unproven'],
])('%s refuse et rollback sans audit',async (_label,scenario,code)=>{
 const f=fixture(scenario);
 await expect(recoverSourceMedia('KPR-123',ACTOR,f)).rejects.toMatchObject({code});
 expect(f.queries.map(x=>x[0])).toContain('ROLLBACK');
 expect(f.queries.map(x=>x[0])).not.toContain('COMMIT');
 expect(f.queries.some(([q])=>q.includes('INSERT INTO catalog_media_recovery_audit'))).toBe(false);
 expect(f.client.release).toHaveBeenCalledTimes(1);
});

test('erreur de la promotion canonique : transaction annulée, pas de succès fictif',async()=>{
 const f=fixture();
 f.promotionService.restoreSourceMediaOnly.mockRejectedValue(
   Object.assign(new Error('bad snapshot'),{status:422,code:'invalid_snapshot'})
 );
 await expect(recoverSourceMedia('KPR-123',ACTOR,f)).rejects.toMatchObject({code:'invalid_snapshot'});
 expect(f.queries.map(x=>x[0])).toContain('ROLLBACK');
 expect(f.queries.some(([q])=>q.includes('INSERT INTO catalog_media_recovery_audit'))).toBe(false);
});
