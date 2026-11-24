/** @e2e Hub QR label center — real Chromium DOM, mocked read-only API, no staging writes. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {test,expect}=require('@playwright/test');
const ORIGIN='http://komerce.test';
const MODULE=fs.readFileSync(path.resolve(__dirname,'../../public/dashboards/canonical/js/hub-label-center.js'),'utf8');
const labels=[
 {type:'ARTICLE',target_id:'33333333-3333-4333-8333-333333333333',quantity:3,reference:'KABC123',relay_code:'YA01',box_state:null},
 {type:'COMBOX',target_id:'44444444-4444-4444-8444-444444444444',quantity:1,reference:'BOX-CERT',relay_code:'YA01',box_state:'DISPATCHED'}
];
async function mount(page,logs){
 await page.route(ORIGIN+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  logs.push(req.method()+' '+url.pathname);
  if(url.pathname==='/qr-demo')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"></head><body><main id="qr"></main><script src="/module.js"></script><script>window.KomerceHubLabelCenter.mount({host:document.getElementById('qr'),doc:document,marketCode:'KM',fetchFn:fetch.bind(window),fillable:[],act:()=>Promise.reject(Error('no writes'))});</script></body></html>`});
  if(url.pathname==='/module.js')return route.fulfill({contentType:'application/javascript',body:MODULE});
  if(url.pathname.endsWith('/labels/index'))return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,market:'KM',labels})});
  if(url.pathname.endsWith('/pdf'))return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n%%EOF\n')});
  return route.fulfill({status:404,body:'not found'});
 });
 await page.goto(ORIGIN+'/qr-demo');
}
test('the PDF station is immediately visible and finds already dispatched COMBOX by reference',async({page})=>{
 const log=[];await mount(page,log);
 await expect(page.locator('[data-hub-label-center]')).toBeVisible();
 await expect(page.getByText('Étiquettes QR · ARTICLE et COMBOX')).toBeVisible();
 await expect(page.getByText('ARTICLE · KABC123')).toBeVisible();
 await expect(page.getByText('COMBOX · BOX-CERT')).toBeVisible();
 await expect(page.getByText('DISPATCHED')).toBeVisible();
 await page.getByRole('searchbox',{name:'Rechercher les étiquettes QR'}).fill('BOX-CERT');
 await expect(page.getByText('COMBOX · BOX-CERT')).toBeVisible();
 await expect(page.getByText('ARTICLE · KABC123')).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Rechercher les étiquettes QR'}).fill('');
 await page.getByRole('combobox',{name:'Type d’étiquette QR'}).selectOption('ARTICLE');
 await expect(page.getByText('ARTICLE · KABC123')).toBeVisible();
 await expect(page.getByText('COMBOX · BOX-CERT')).toHaveCount(0);
 expect(log.filter(x=>x.startsWith('POST '))).toEqual([]);
});
test('the A4 PDF is fetched over authenticated HTTP, without an implicit stock mutation',async({page})=>{
 const log=[];await mount(page,log);
 const a=page.locator('[data-hub-label-pdf="ARTICLE-a4"]');
 await expect(a).toBeVisible();
 const [download]=await Promise.all([page.waitForEvent('download'),a.click()]);
 expect(download.suggestedFilename()).toBe('KOMERCE-ARTICLE-KM-a4.pdf');
 expect(log).toContain('GET /api/admin/workspaces/operations/market/KM/labels/articles/33333333-3333-4333-8333-333333333333/pdf');
 expect(log.filter(x=>x.startsWith('POST '))).toEqual([]);
});
