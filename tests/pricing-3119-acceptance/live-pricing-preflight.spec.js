'use strict';
/** Strict read-only auth/capability/data preflight on currently deployed staging.
 *  This does NOT certify PR 3119 UI until its exact SHA is deployed.
 */
const {test}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/pricing-3119-live-preflight');fs.mkdirSync(OUT,{recursive:true});
const role=process.env.E2E_ROLE||'admin';
const prefix='E2E_'+role.toUpperCase()+'_';
const email=process.env[prefix+'EMAIL'],password=process.env[prefix+'PASSWORD'];
test('staging pricing permissions and real data are ready for functional acceptance',async({page})=>{
 test.setTimeout(120000);
 const report={role,viewport:'1440x900',sha:null,login:'NOT_TESTED',checks:[],url:null,ready:false};
 const save=()=>fs.writeFileSync(path.join(OUT,role+'.json'),JSON.stringify(report,null,2)+'\n');
 const record=(name,r,body)=>{const result={name,status:r?.status()??null,ok:r?.ok()??false}; if(body&&typeof body==='object'){
   result.keys=Object.keys(body).slice(0,20);
   if(name==='corridor'){result.hasProduct=!!body.product;result.productRef=body.product?.product_ref||null;
     result.hasServerEconomics=!!body.selected?.economics;result.hasServerFloor=body.selected?.economics?.minimum_safe_price_kmf!=null;}
   if(name==='decision'){result.hasDecision=!!body.decision_status;result.decisionStatus=body.decision_status||null;}
   if(name==='pricingMarket'){result.hasCapabilities=!!body.capabilities;result.caps=body.capabilities?Object.keys(body.capabilities).filter(k=>body.capabilities[k]===true).slice(0,35):[];}
   if(name==='preview'){result.hasActivation=!!body.activation;result.activationAllowed=body.activation?.allowed??null;}
  }report.checks.push(result);return result;};
 const get=async(name,url)=>{try{const r=await page.request.get(ORIGIN+url,{timeout:14000});const body=await r.json().catch(()=>null);return record(name,r,body);}catch(e){const x={name,error:String(e).slice(0,140)};report.checks.push(x);return x;}};
 await page.route('**/*',r=>{
  const q=r.request(),u=new URL(q.url());
  if(u.origin!==ORIGIN||['GET','HEAD','OPTIONS'].includes(q.method())||(q.method()==='POST'&&u.pathname==='/api/auth/login'))return r.continue();
  return r.abort('blockedbyclient');
 });
 try{
  if(!email||!password){report.login='BLOCKED_SECRET_MISSING';return;}
  const health=await page.request.get(ORIGIN+'/health/version');const version=await health.json().catch(()=>({}));
  report.sha=version.commit||version.sha||null;
  await page.goto(ORIGIN+'/login.html?next=%2Fadmin%2Fworkspaces%2Fpricing%3Fmarket%3DKM',{waitUntil:'domcontentloaded',timeout:15000});
  await page.locator('#email').fill(email);await page.locator('#password').fill(password);
  const auth=page.waitForResponse(x=>x.url().includes('/api/auth/login')&&x.request().method()==='POST',{timeout:20000}).catch(()=>null);
  await page.locator('#btn-submit').click();
  const response=await auth;
  report.login=response?.status()===200?'AUTHENTICATED':'BLOCKED_'+(response?.status()??'NO_RESPONSE');
  if(report.login!=='AUTHENTICATED')return;
  await get('me','/api/auth/me');
  await get('pricingMarket','/api/admin/workspaces/pricing/market/KM');
  await get('decision','/api/admin/workspaces/pricing/market/KM/decision');
  await get('corridor','/api/admin/workspaces/pricing/market/KM/corridor?product_ref=KPR-000092');
  await get('preview','/api/admin/workspaces/pricing/market/KM/products/KPR-000092/local-price/activation-preview');
  const doc=await page.goto(ORIGIN+'/admin/workspaces/pricing?market=KM&view=products',{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>null);
  report.url=new URL(page.url()).pathname+new URL(page.url()).search;
  report.http=doc?.status()||null;
  await page.screenshot({path:path.join(OUT,role+'-current-staging.png'),fullPage:true,timeout:12000}).catch(()=>{});
  report.ready=report.checks.find(c=>c.name==='pricingMarket')?.status===200&&
    report.checks.find(c=>c.name==='corridor')?.status===200;
 }finally{save();}
});
