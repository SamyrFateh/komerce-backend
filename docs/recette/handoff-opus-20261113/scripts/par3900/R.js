const {chromium}=require('/opt/npm-tools/node_modules/playwright');const fs=require('fs');
const S=__dirname;const C=JSON.parse(fs.readFileSync(S+'/../claude-par-keys/creds.json'));const B='https://komerce-backend-production.up.railway.app';
async function run(role,fn,{video=true}={}){
 const br=await chromium.launch();
 const ctx=await br.newContext({viewport:{width:1440,height:900},locale:'fr-FR',...(video?{recordVideo:{dir:S+'/video-'+role,size:{width:1280,height:720}}}:{})});
 const p=await ctx.newPage();const log=[];let pi=0;
 const hook=pg=>{
  pg.on('response',async r=>{if(r.request().method()!=='GET'&&r.url().includes('/api/'))log.push(r.status()+' '+r.request().method()+' '+r.url().replace(B,'')+' '+(await r.text().catch(()=>'')).slice(0,220).replace(/\s+/g,' '))});
  pg.on('dialog',d=>{log.push('DIALOG '+d.type()+' '+d.message());if(d.type()==='prompt'){const a=(process.env.PROMPTS||'').split(';');d.accept(a[pi++]||'')}else d.accept()});
 };hook(p);
 await p.goto(B+'/login.html',{waitUntil:'domcontentloaded'});await p.fill('#email',C[role].email);await p.fill('#password',C[role].password);await p.click('#btn-submit');await p.waitForTimeout(5000);
 const shot=n=>p.screenshot({path:S+'/shots/'+n+'.png'});
 const txt=async(sel='body',n=1500)=>(await p.locator(sel).first().innerText()).replace(/\s+/g,' ').slice(0,n);
 const btns=()=>p.evaluate(()=>[...document.querySelectorAll('button,a[role=button]')].filter(e=>e.offsetParent&&!e.disabled).map(e=>e.innerText.trim().slice(0,45)).filter(Boolean));
 try{await fn({p,ctx,log,shot,txt,btns,B,S,hook})}catch(e){console.log('ERR',String(e).split('\n').slice(0,4).join(' / '));await shot('ERR-'+role).catch(()=>{})}
 console.log(JSON.stringify(log,null,0).replace(/","/g,'"\n"'));
 await ctx.close();await br.close();
}
module.exports={run,B,S,C};
