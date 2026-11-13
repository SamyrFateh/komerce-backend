const {chromium}=require('/opt/npm-tools/node_modules/playwright');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json'});
const rl=await (await ctx.request.get(B+'/api/relais?market=KM',{headers:{origin:B}})).text();console.log(rl.slice(0,300));
const m=JSON.parse(rl);const arr=m.relais||m.relays||m;const c=arr.find(x=>/CLAUDE-PAR/.test(x.name));console.log(c&&c.id,c&&c.name);
const ids=['a16c7ade-d317-445d-9489-6cf233612a47','21bc5285-7b1a-47c5-a914-7656790816c5','fe2c8a44-d385-45ff-ae5b-8acbd3bf8534','af3e5584-a71a-4dbe-b09c-11d9a0849376','91c94beb-f706-40be-ac05-5d13d6d716dd'];
const q='relais_id='+c.id+'&product_id=21bc5285-7b1a-47c5-a914-7656790816c5&quantity='+process.env.Q;
const r=await ctx.request.get(B+'/api/local-stock/checkout-preview?'+q,{headers:{origin:B}});console.log(r.status(),(await r.text()).slice(0,1500));
await br.close()})();
