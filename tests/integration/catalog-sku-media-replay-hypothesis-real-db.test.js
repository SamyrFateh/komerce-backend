'use strict';
/**
 * Independent R&D hypothesis, not a regression fix: updated supplier
 * sellable_units[].media_refs -> canonical SKU media -> checkout image.
 * Uses real promotion service, actual Postgres and always ROLLBACK.
 * No Railway or external provider traffic.
 */
const ci=process.env.GITHUB_ACTIONS==='true'
 &&process.env.NODE_ENV==='test'
 &&process.env.KOMERCE_DISABLE_CRONS==='true'
 &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!ci){
 describe.skip('SKU media mutation replay — disposable PostgreSQL CI only',()=>{
   test('CI only',()=>{});
 });
}else{
 const {randomUUID}=require('node:crypto');
 const {Pool}=require('pg');
 const {promoteCatalog}=require('../../services/catalog-promotion');
 const {resolveSellableUnit}=require('../../services/product-sellable-service');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const productId=randomUUID();
 let client;
 const media=[
  {supplier_media_id:'CI-IMG-A',url:'https://example.org/ci-catalog-image-a.jpg',role:'PRODUCT'},
  {supplier_media_id:'CI-IMG-B',url:'https://example.org/ci-catalog-image-b.jpg',role:'PRODUCT'},
 ];
 const contract=refs=>({
  schema_version:'2',product_name:'CI audit multicolor product',
  supplier_name:'CI Supplier',currency:'AED',
  media,option_axes:[{key:'couleur',display_name:'Couleur',values:['Rouge']}],
  sellable_units:[{supplier_sku:'CI-SKU-A',option_values:{couleur:'Rouge'},
    stock_available:10,media_refs:refs}]
 });
 const query=async()=>{
  const {rows}=await client.query(
    "SELECT cm.source_media_id,cm.url,psm.sku_id FROM product_sku_media psm JOIN catalog_media cm ON cm.id=psm.media_id JOIN product_skus sku ON sku.id=psm.sku_id WHERE sku.product_id=$1 AND sku.supplier_sku='CI-SKU-A' ORDER BY cm.source_media_id",
    [productId]);
  const {rows:[sku]}=await client.query(
    "SELECT id,is_active,stock FROM product_skus WHERE product_id=$1 AND supplier_sku='CI-SKU-A'",
    [productId]);
  return {rows,sku};
 };
 const evidence=(mode,expected,observed,invariantOK)=>console.log('BLIND_CATALOG_TRIAL '+JSON.stringify({
  hypothesis:'SKU_MEDIA_LINKS_SYNCHRONIZED_TO_EXPLICIT_SOURCE_REFS',mode,
  service:'catalog-promotion.promoteCatalog -> product_sku_media -> product-sellable-service.resolveSellableUnit',
  db:'POSTGRES_REAL',expected,observed,invariantOK
 }));
 beforeAll(async()=>{
  client=await pool.connect();
  await client.query('BEGIN');
  await client.query(
   "INSERT INTO products(id,name,price_kmf,stock,is_active,inventory_model) VALUES($1,'CI audit SKU media replay',15000,10,TRUE,'SKU')",
   [productId]
  );
  await client.query('SAVEPOINT seed');
 });
 afterAll(async()=>{
  if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
  await pool.end();
 });
 beforeEach(async()=>{await client.query('ROLLBACK TO SAVEPOINT seed');});
 test('NOMINAL: identical supplier replay keeps one association and a stable SKU',async()=>{
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-A'])});
  const first=await query();
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-A'])});
  const second=await query();
  expect(first.rows.map(x=>x.source_media_id)).toEqual(['CI-IMG-A']);
  expect(second.rows.map(x=>x.source_media_id)).toEqual(['CI-IMG-A']);
  expect(second.sku.id).toBe(first.sku.id);
  evidence('NOMINAL',{refs:['CI-IMG-A'],unique:true,stableSku:true},
   {refs:second.rows.map(x=>x.source_media_id),unique:second.rows.length===1,stableSku:second.sku.id===first.sku.id},true);
 });
 test('DEVIATION: supplier changes sole explicit media A to B but old association remains',async()=>{
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-A'])});
  const first=await query();
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-B'])});
  const second=await query();
  expect(second.sku.id).toBe(first.sku.id);
  expect(second.rows.map(x=>x.source_media_id)).toEqual(['CI-IMG-A','CI-IMG-B']);
  evidence('DEVIATION',{refs:['CI-IMG-B'],stableSku:true},
   {refs:second.rows.map(x=>x.source_media_id),stableSku:second.sku.id===first.sku.id},false);
 });
 test('NEGATIVE CONTROL: additive supplier media change A -> [A,B] legitimately keeps both',async()=>{
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-A'])});
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-A','CI-IMG-B'])});
  const state=await query();
  expect(state.rows.map(x=>x.source_media_id)).toEqual(['CI-IMG-A','CI-IMG-B']);
  evidence('NEGATIVE_ADDITIVE',{refs:['CI-IMG-A','CI-IMG-B']},
   {refs:state.rows.map(x=>x.source_media_id)},true);
 });
 test('NEGATIVE CONTROL: fresh SKU with only B displays B (resolver itself is correct)',async()=>{
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-B'])});
  const resolved=await resolveSellableUnit(client,{productId,variantCombo:{couleur:'Rouge'},quantity:1});
  expect(resolved.image_url).toBe('https://example.org/ci-catalog-image-b.jpg');
  evidence('NEGATIVE_FRESH_B',{chosenImage:'https://example.org/ci-catalog-image-b.jpg'},
   {chosenImage:resolved.image_url},true);
 });
 test('DOWNSTREAM: real checkout resolver may choose the superseded first image',async()=>{
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-A'])});
  await promoteCatalog(client,{productId,normalizedSourceContract:contract(['CI-IMG-B'])});
  const resolved=await resolveSellableUnit(client,{productId,variantCombo:{couleur:'Rouge'},quantity:1});
  expect(resolved.image_url).toBe('https://example.org/ci-catalog-image-a.jpg');
  evidence('DOWNSTREAM',{chosenImage:'https://example.org/ci-catalog-image-b.jpg'},
   {chosenImage:resolved.image_url,skuId:resolved.sku_id},false);
 });
}
