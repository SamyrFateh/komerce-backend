/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {openRelayLive,isRelayPage}=require('../../scripts/recette/canonical/relay-live-navigation');
const BASE='https://komerce-backend-production.up.railway.app';
function actor({initial='/login.html',interruption=false,foreign=false}={}){
 let current=BASE+initial;
 const target={waitFor:jest.fn(async()=>{})};
 const page={
  url:jest.fn(()=>current),
  goto:jest.fn(async()=>{
   current=BASE+(foreign?'/login.html':'/admin/relais-live');
   if(interruption)throw Error('page.goto: Navigation to relay-live is interrupted by another navigation');
  }),
  waitForURL:jest.fn(async predicate=>{
   const url=new URL(current);
   if(!predicate(url))throw Error('G6 test: URL is not the expected relay cockpit');
  }),
  waitForLoadState:jest.fn(async()=>{}),
  locator:jest.fn(()=>target)
 };
 return {page,target};
}
describe('G6 canonical relay navigation: same-route Chromium redirect',()=>{
 test('landing on the relay cockpit never starts a second navigation',async()=>{
  const {page,target}=actor({initial:'/admin/relais-live'});
  expect(await openRelayLive(page,{selector:'[data-relay-shipment="SIM-STAGING-EXP-TEST01"]'})).toBe(target);
  expect(page.goto).not.toHaveBeenCalled();
  expect(target.waitFor).toHaveBeenCalledWith({state:'visible',timeout:30000});
 });
 test('navigates to canonical relay page without query string',async()=>{
  const {page}=actor({initial:'/admin/workspaces/shipping-customs?market=KM'});
  await openRelayLive(page,{selector:'[data-manual-pickup-code]'});
  expect(page.goto).toHaveBeenCalledWith('/admin/relais-live',{
   waitUntil:'commit',timeout:20000
  });
 });
 test('interrupted navigation is accepted only if browser reaches exact relay cockpit',async()=>{
  const {page}=actor({interruption:true});
  await expect(openRelayLive(page,{selector:'[data-relay-shipment="SHIP-TEST"]'}))
   .resolves.toBeDefined();
  const bad=actor({interruption:true,foreign:true});
  await expect(openRelayLive(bad.page,{selector:'[data-manual-pickup-code]'}))
   .rejects.toThrow('URL is not the expected relay cockpit');
 });
 test('execute view is entered by clicking « Atelier réception », never by a direct URL',async()=>{
  const {page}=actor({initial:'/admin/relais-live'});
  const link={click:jest.fn(async()=>{}),waitFor:jest.fn(async()=>{}),first(){return this;}};
  const target={waitFor:jest.fn(async()=>{})};
  page.locator=jest.fn((sel)=>sel==='a'?link:target);
  page.evaluate=jest.fn(async()=>({signal:false,ready:true,epoch:null}));
  page.waitForURL=jest.fn(async()=>{});
  link.page=()=>page;
  await openRelayLive(page,{selector:'[data-relay-shipment="S"]',execute:true}).catch(()=>{});
  expect(page.goto).not.toHaveBeenCalled();
  expect(page.locator).toHaveBeenCalledWith('a',{hasText:'Atelier réception'});
 });
 test('foreign origins, login, or blank selector cannot satisfy the proof',async()=>{
  expect(isRelayPage(BASE+'/admin/relais-live')).toBe(true);
  expect(isRelayPage(BASE+'/login.html')).toBe(false);
  expect(isRelayPage('https://untrusted.example/admin/relais-live')).toBe(false);
  await expect(openRelayLive(actor().page,{selector:''})).rejects.toThrow('ARGUMENTS_INVALID');
 });
 test.each(['g6-canonical-relay-receipt-chromium.js',
  'g6-canonical-client-pickup-chromium.js'])(
  '%s compiles and awaits the visible real Chromium control',name=>{
   const s=fs.readFileSync(path.resolve(__dirname,'../../scripts/recette',name),'utf8');
   expect(()=>new vm.Script(s,{filename:name})).not.toThrow();
   expect(s).toContain('await openRelayLive(actor.page');
   expect(s).not.toContain("actor.page.goto('/admin/relais-live?view=execute");
  }
 );
});
