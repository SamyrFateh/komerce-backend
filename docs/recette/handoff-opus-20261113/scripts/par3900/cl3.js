const {chromium}=require('/opt/npm-tools/node_modules/playwright');const fs=require('fs');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json'});
const get=async()=>{const r=await ctx.request.get(B+'/api/pickup/reveal-once/daefd587-60f7-4f15-9d10-5e72e5021164',{headers:{origin:B}});const t=await r.text();let j={};try{j=JSON.parse(t)}catch{};return [r.status(),j]};
const [s1,j1]=await get();const c=j1.code||j1.pickup_code||j1.secret;
console.log('reveal#1',s1,Object.keys(j1),c?('len '+String(c).length):'');
if(c){fs.writeFileSync(S+'/.code',String(c),{mode:0o600});const a=fs.readFileSync(S+'/.code.admin','utf8');console.log('egal au code admin:',a.replace(/-/g,'')===String(c).replace(/-/g,''))}
const [s2,j2]=await get();console.log('reveal#2',s2,j2.error||'');
await br.close()})();
