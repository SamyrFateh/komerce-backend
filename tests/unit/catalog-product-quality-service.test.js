'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),getClient:jest.fn()}));
const db=require('../../db');
const quality=require('../../services/catalog-product-quality-service');

const ACTOR={id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',role:'admin'};
const PRODUCT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOLD='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function setup({ active=false, missing=false }={}){
  const calls=[];
  const client={release:jest.fn(),query:jest.fn(async(sql,params)=>{
    calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.includes('SELECT id,product_ref,is_active,is_available'))return {rows:missing?[]:[{
      id:PRODUCT,product_ref:'KPR-000458',is_active:true,is_available:true
    }]};
    if(sql.includes('SELECT id FROM catalog_product_sale_holds'))return {rows:active?[{id:HOLD}]:[]};
    if(sql.includes('INSERT INTO catalog_product_quality_notes'))return {rows:[{id:HOLD,created_at:'2026-11-08'}]};
    if(sql.includes('INSERT INTO catalog_product_sale_holds'))return {rows:[{id:HOLD,frozen_at:'2026-11-08'}]};
    if(sql.includes('UPDATE catalog_product_sale_holds'))return {rows:[{id:HOLD,released_at:'2026-11-08'}]};
    throw Error('Unexpected SQL: '+sql);
  })};
  db.getClient.mockResolvedValue(client);
  return {client,calls};
}
afterEach(()=>jest.clearAllMocks());
const action=(kind,override={})=>({actor:ACTOR,productRef:'KPR-000458',action:kind,
 comment:'Défaut confirmé à examiner',reason:'defect',...override});

test('aucune observation ou décision sans admin global et commentaire explicite',async()=>{
  const {calls}=setup();
  await expect(quality.change(action('freeze',{actor:{role:'agent_relais',id:ACTOR.id}})))
    .rejects.toMatchObject({code:'QUALITY_AUTHORITY_REQUIRED',status:403});
  await expect(quality.change(action('freeze',{comment:'non'})))
    .rejects.toMatchObject({code:'QUALITY_COMMENT_REQUIRED'});
  await expect(quality.change(action('freeze',{reason:'free_access'})))
    .rejects.toMatchObject({code:'QUALITY_REASON_INVALID'});
  expect(calls).toHaveLength(0);
});

test('gel effectif : produit verrouillé et historique créé, sans toucher stock ou prix',async()=>{
  const {calls,client}=setup();
  const result=await quality.change(action('freeze'));
  expect(result.action).toBe('freeze');
  expect(calls.some(x=>x.sql.includes('FROM products WHERE product_ref=$1 FOR UPDATE'))).toBe(true);
  expect(calls.some(x=>x.sql.includes('INSERT INTO catalog_product_sale_holds'))).toBe(true);
  expect(calls.some(x=>x.sql==='COMMIT')).toBe(true);
  expect(calls.some(x=>/UPDATE products|UPDATE product_skus|wallet_transactions|refund/.test(x.sql))).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('un second gel est refusé ; dégel exige une trace explicite',async()=>{
  const {calls}=setup({active:true});
  await expect(quality.change(action('freeze')))
    .rejects.toMatchObject({code:'QUALITY_ALREADY_FROZEN',status:409});
  expect(calls.some(x=>x.sql==='ROLLBACK')).toBe(true);
  const done=await quality.change(action('release',{reason:undefined,
    comment:'Revue qualité complète, contrôle levé'}));
  expect(done.action).toBe('release');
  expect(calls.some(x=>x.sql.includes('release_comment=$3'))).toBe(true);
});

test('remarque seule ne bloque jamais les ventes',async()=>{
  const {calls}=setup();
  const result=await quality.change(action('note',{comment:'La couleur est parfois différente'}));
  expect(result.action).toBe('note');
  expect(calls.some(x=>x.sql.includes('INSERT INTO catalog_product_quality_notes'))).toBe(true);
  expect(calls.some(x=>x.sql.includes('INSERT INTO catalog_product_sale_holds'))).toBe(false);
});

test('ne peut dégeler une référence qui n’est pas gelée',async()=>{
  const {calls}=setup();
  await expect(quality.change(action('release')))
    .rejects.toMatchObject({code:'QUALITY_NOT_FROZEN',status:409});
  expect(calls.some(x=>x.sql==='ROLLBACK')).toBe(true);
});

test('aucune action sur référence absente, rollback de la décision',async()=>{
  const {calls}=setup({missing:true});
  await expect(quality.change(action('freeze')))
    .rejects.toMatchObject({code:'QUALITY_PRODUCT_NOT_FOUND',status:404});
  expect(calls.some(x=>x.sql==='ROLLBACK')).toBe(true);
});


test('signal produit : les retours et commentaires sont visibles, mais ne gèlent pas sans décision explicite', async()=>{
  db.query
    .mockResolvedValueOnce({rows:[{id:PRODUCT,product_ref:'KPR-000458',name:'Produit test'}]})
    .mockResolvedValueOnce({rows:[]})
    .mockResolvedValueOnce({rows:[{note:'Batterie faible',created_at:'2026-11-08'}]})
    .mockResolvedValueOnce({rows:[{reports:2,active_reports:1}]});
  const state=await quality.qualityByRef('KPR-000458');
  expect(state.frozen).toBe(false);
  expect(state.reports).toBe(2);
  expect(state.active_reports).toBe(1);
  expect(state.notes[0].note).toBe('Batterie faible');
  expect(db.query).toHaveBeenCalledTimes(4);
});

test('signal agrégé Catalogue : seulement les références demandées, sans changer le gel', async()=>{
  db.query.mockResolvedValueOnce({rows:[{
    product_ref:'KPR-000458',quality_frozen:true,
    quality_note_count:3,quality_return_count:2,
  }]});
  const batch=await quality.batchSignals(['KPR-000458','KPR-000458']);
  expect(batch.get('KPR-000458')).toEqual({
    quality_frozen:true,quality_note_count:3,quality_return_count:2,
  });
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][1]).toEqual([['KPR-000458']]);
});
