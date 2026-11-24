'use strict';
// Explicit staging-only demonstration; not commercial publication.
const assert = require('node:assert/strict');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { applyManualDiscoveryContent, validateManifest } = require('../apply-manual-discovery-content');
const { setPhysicalOfferOptions, isPhysicalOfferExposable } = require('../../services/providers-service');
const optionData = require('../../docs/ops/local-offer-options.5245.json');
const baseManifests = [
  require('../../docs/ops/manual-discovery-content.cm-5245.json'),
  require('../../docs/ops/manual-discovery-content.cg-5245.json'),
];
const images = { CM:'/boutique/images/local-demo-baleba.svg', CG:'/boutique/images/local-demo-koyamba.svg' };

async function plan(base) {
  const p = base.providers[0], o = base.local_products[0], d = optionData.markets[base.market];
  assert.equal(d.offer_id,o.id); assert.equal(d.currency,'XAF');
  const {rows:[market]} = await db.query('SELECT id FROM markets WHERE code=$1 AND is_active=true',[base.market]);
  assert.ok(market);
  const {rows:[provider]} = await db.query('SELECT * FROM providers WHERE id=$1',[p.id]);
  const {rows:[offer]} = await db.query('SELECT * FROM physical_offers WHERE id=$1',[o.id]);
  assert.ok(provider && offer);
  assert.equal(provider.market_id,market.id); assert.equal(offer.market_id,market.id);
  assert.equal(provider.phone,p.phone); assert.equal(offer.provider_id,p.id);
  assert.equal(offer.title,o.title); assert.equal(offer.zone,o.zone);
  const examples=d.options.map(x=>x.label+' : '+String(x.demo_price).replace(/\B(?=(\d{3})+(?!\d))/g,' ')+' XAF').join(' ; ');
  const enriched=o.description+' Exemples de prix STRICTEMENT FICTIFS pour recette, sans valeur commerciale : '+examples+'.';
  const description=o.description+' Illustration de démonstration non contractuelle. Les prix des configurations sont fictifs ; demande d’information uniquement.';
  const stagedName='[STAGING] '+p.name;
  const draft=provider.name===p.name && provider.status==='pending' && offer.status==='draft' && offer.commercial_exposure==='DISABLED' && offer.description===enriched && offer.image_ref===null;
  const active=provider.name===stagedName && provider.status==='active' && offer.status==='active' && offer.commercial_exposure==='ENABLED' && offer.description===description && offer.image_ref===images[base.market];
  assert.ok(draft||active,'Refuse to overwrite unexpected provider/offer state');
  const options=d.options.map(x=>({...x,currency:d.currency,demo:true}));
  const manifest={...base, providers:[{...p,name:stagedName,status:'active'}],local_products:[{...o,description,image_ref:images[base.market],status:'active',expose:true}]};
  assert.ok(validateManifest(manifest).ok);
  return {marketId:market.id,manifest,options};
}
async function main(){
  assert.equal(process.env.KOMERCE_ENV,'staging');
  assert.equal(process.env.KOMERCE_TARGET_ENV,'staging');
  assert.equal(process.env.MANUAL_DISCOVERY_WRITE_ENABLED,'true');
  await confirmTarget({db});
  const plans=await Promise.all(baseManifests.map(plan));
  for(const {marketId,manifest,options} of plans){
    const id=manifest.local_products[0].id;
    const row=await setPhysicalOfferOptions(id,marketId,options);
    assert.deepEqual(row.offer_options,options);
    await applyManualDiscoveryContent(manifest);
    assert.equal(await isPhysicalOfferExposable(id,marketId),true);
    for(const other of plans.filter(x=>x.marketId!==marketId)) assert.equal(await isPhysicalOfferExposable(id,other.marketId),false);
    const {rows:[km]}=await db.query("SELECT id FROM markets WHERE code='KM'");
    if(km) assert.equal(await isPhysicalOfferExposable(id,km.id),false);
    console.log(JSON.stringify({market:manifest.market,offer:id,options:row.offer_options.length,exposed:true,mode:'STAGING_DEMO'}));
  }
  console.log('DEMO_OFFERS_PERSISTED — stage-only; storefront and Chromium verification separate');
}
main().catch(e=>{console.error('Showcase refused:',e.message);process.exitCode=1;}).finally(()=>db.pool.end());
