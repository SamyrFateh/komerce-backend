const {chromium}=require('/opt/npm-tools/node_modules/playwright');
const fs=require('fs');
const S='/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad';
const C=JSON.parse(fs.readFileSync(S+'/claude-par-keys/creds.json'));
const B='https://komerce-backend-production.up.railway.app';
const D=S+'/parcours-km';
async function apiGet(role,path){
  const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:B},body:JSON.stringify({email:C[role].email,password:C[role].password})});
  const ck=(r.headers.getSetCookie?r.headers.getSetCookie():[]).map(x=>x.split(';')[0]).join('; ');
  const g=await fetch(B+path,{headers:{cookie:ck,origin:B}});
  const t=await g.text();return {status:g.status,body:t};
}
async function session(role,{video=true}={}){
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:1440,height:900},locale:'fr-FR',...(video?{recordVideo:{dir:D+'/video-'+role,size:{width:1280,height:720}}}:{})});
  const p=await ctx.newPage();
  if(role){await p.goto(B+'/login.html',{waitUntil:'domcontentloaded'});
  await p.fill('#email',C[role].email);await p.fill('#password',C[role].password);
  await p.click('#btn-submit');await p.waitForTimeout(5000);}
  return {br,ctx,p};
}
module.exports={apiGet,session,B,D,C,chromium,fs};
