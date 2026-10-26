'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {clickDiscoveredLink}=require('../../tests/staging-canonical/link-replay');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const SRC='/admin/operations', DEST='/admin/orders/AUDIT-NORMAL';
const pathname=value=>new URL(String(value),ORIGIN).pathname;
function fakePage({reappear=true,click=true,asyncNavigation=true}={}){
  const events=[];
  let at=ORIGIN+SRC;
  const locator={
    first:()=>locator,
    waitFor:jest.fn(async options=>{
      events.push('await-visible');
      expect(options.state).toBe('visible');
      if(!reappear)throw Error('anchor not found after revisit');
    }),
    click:jest.fn(async()=>{
      events.push('click');
      if(!click)throw Error('intercepted pointer');
      if(!asyncNavigation)at=ORIGIN+DEST;
    }),
  };
  const page={
    locator:jest.fn(()=>locator),
    url:()=>at,
    waitForURL:jest.fn(async predicate=>{
      events.push('await-destination');
      if(!asyncNavigation)throw Error('should not wait when changed synchronously');
      at=ORIGIN+DEST;
      expect(predicate(new URL(at))).toBe(true);
    }),
  };
  return {page,locator,events};
}
test('nominal: waits for anchor to reappear BEFORE clicking the snapshot target',async()=>{
  const {page,events,locator}=fakePage();
  const outcome=await clickDiscoveredLink(page,{href:DEST,sourcePath:SRC,pathname});
  expect(outcome).toMatchObject({kind:'CLICKED',actual:DEST});
  expect(events).toEqual(['await-visible','click','await-destination']);
  expect(locator.waitFor).toHaveBeenCalledTimes(1);
});
test('if link vanished after revisit, do not call it a click failure',async()=>{
  const {page,locator}=fakePage({reappear:false});
  const outcome=await clickDiscoveredLink(page,{href:DEST,sourcePath:SRC,pathname});
  expect(outcome).toMatchObject({kind:'LINK_MISSING_AFTER_REVISIT',actual:SRC});
  expect(locator.click).not.toHaveBeenCalled();
});
test('visible but unclickable is separately a real CLICK_FAILED signal',async()=>{
  const {page,events}=fakePage({click:false});
  const outcome=await clickDiscoveredLink(page,{href:DEST,sourcePath:SRC,pathname});
  expect(outcome.kind).toBe('CLICK_FAILED_ON_VISIBLE_LINK');
  expect(events).toEqual(['await-visible','click']);
});
test('synchronous navigations do not waste a timeout waiting again',async()=>{
  const {page,events}=fakePage({asyncNavigation:false});
  const outcome=await clickDiscoveredLink(page,{href:DEST,sourcePath:SRC,pathname});
  expect(outcome.actual).toBe(DEST);
  expect(events).toEqual(['await-visible','click']);
});
