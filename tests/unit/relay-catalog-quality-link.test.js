'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const quality=require('../../services/catalog-product-quality-service');
const relay=require('../../services/relay-return-request-service');

const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const relayId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const item='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actor={role:'agent_relais',id,relais_id:relayId};

test('une remarque Relais est une note Catalogue scellée à l’article remis, jamais un gel',async()=>{
  const calls=[];
  const executor={query:jest.fn(async(sql,params)=>{
    calls.push({sql,params});
    return {rows:[{id,product_ref:'KPR-000458',created_at:'2026-11-08'}]};
  })};
  const result=await relay.addRemark({
    actor,reference:'KOM-00458',orderItemId:item,
    note:'La batterie du téléphone surchauffe',executor,
  });
  expect(result.product_ref).toBe('KPR-000458');
  expect(calls).toHaveLength(1);
  expect(calls[0].params.slice(0,4)).toEqual([item,'KOM-00458',relayId,id]);
  expect(calls[0].sql).toMatch(/o\.relais_id=\$3::uuid/);
  expect(calls[0].sql).toMatch(/oi\.qty_collected > 0/);
  expect(calls[0].sql).toContain("SELECT e.product_id,$4::uuid,$5,'relay',e.order_item_id");
  expect(calls[0].sql).not.toMatch(/catalog_product_sale_holds|wallet|refunds/);
});

test('si la preuve de remise ou le rattachement au relais manque, aucune remarque ne naît',async()=>{
  const executor={query:jest.fn(async()=>({rows:[]}))};
  await expect(quality.addRelayObservation({
    actorId:id,relayId,reference:'KOM-00458',orderItemId:item,note:'Article incohérent'
  },executor)).rejects.toMatchObject({code:'QUALITY_RELAY_ITEM_FORBIDDEN',status:403});
});

test('un agent ne peut pas envoyer une remarque sur un autre relais',async()=>{
  const executor={query:jest.fn()};
  await expect(relay.addRemark({
    actor:{role:'market_operator',id,relais_id:relayId},
    reference:'KOM-00458',orderItemId:item,note:'Anomalie',executor
  })).rejects.toMatchObject({code:'RETURN_ROLE_FORBIDDEN',status:403});
  expect(executor.query).not.toHaveBeenCalled();
});

test('source de la note conservée et UI séparée de la demande de retour',()=>{
  const migration=read('migrations/400_catalog_product_quality_holds.sql');
  const workspace=read('public/dashboards/canonical/js/operations-workspace.js');
  const route=read('routes/relay-dashboard.js');
  expect(migration).toContain("source text NOT NULL DEFAULT 'catalog'");
  expect(migration).toContain("source='relay' AND order_item_id IS NOT NULL");
  expect(workspace).toContain('data-relay-quality-remark');
  expect(workspace).toContain("'/api/relay/returns/remarks'");
  expect(route).toContain("router.post('/returns/remarks', ...relayReturnActors");
});
