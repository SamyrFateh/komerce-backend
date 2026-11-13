const {chromium}=require('/opt/npm-tools/node_modules/playwright');
const fs=require('fs');
const S='/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad';
const D=S+'/catalogue-ms';
const C=Object.assign({},JSON.parse(fs.readFileSync(S+'/claude-par-keys/creds.json')),JSON.parse(fs.readFileSync(S+'/claude-par-keys/creds-cm-cg.json')));
const B='https://komerce-backend-production.up.railway.app';
const jar={};
async function login(role){
  if(jar[role])return jar[role];
  const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:B},body:JSON.stringify({email:C[role].email,password:C[role].password})});
  const ck=(r.headers.getSetCookie?r.headers.getSetCookie():[]).map(x=>x.split(';')[0]).join('; ');
  jar[role]=ck;return ck;
}
async function api(role,method,path,body,headers={}){
  const ck=await login(role);
  const r=await fetch(B+path,{method,headers:{cookie:ck,origin:B,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const t=await r.text();let j;try{j=JSON.parse(t)}catch(_){j=t.slice(0,500)}
  return {status:r.status,body:j};
}
async function session(role,tag){
  const br=await chromium.launch();
  const ctx=await br.newContext({viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:D+'/video-'+(tag||role),size:{width:1280,height:720}}});
  const p=await ctx.newPage();
  await p.goto(B+'/login.html',{waitUntil:'domcontentloaded'});
  await p.fill('#email',C[role].email);await p.fill('#password',C[role].password);
  await p.click('#btn-submit');await p.waitForTimeout(4000);
  return {br,ctx,p};
}
module.exports={api,session,B,D,C,chromium,fs};
