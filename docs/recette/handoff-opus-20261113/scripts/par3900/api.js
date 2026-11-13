const fs=require('fs');const S='/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad';
const C=JSON.parse(fs.readFileSync(S+'/claude-par-keys/creds.json'));const B='https://komerce-backend-production.up.railway.app';
const ck={};
async function login(role,cred){const c=cred||C[role];const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:B},body:JSON.stringify({email:c.email,password:c.password||c.pw})});ck[role]=(r.headers.getSetCookie?r.headers.getSetCookie():[]).map(x=>x.split(';')[0]).join('; ');return r.status}
async function api(role,method,path,body){if(!ck[role])await login(role);const r=await fetch(B+path,{method,headers:{cookie:ck[role],origin:B,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j}}
module.exports={api,login,B,C,S,ck,fs};
