const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const PUB=path.resolve(__dirname,'..','public');
const M={'.css':'text/css','.html':'text/html','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.json':'application/json','.ico':'image/x-icon','.svg':'image/svg+xml'};
// CSP IDENTIQUE à bootstrap/security.js (scriptSrc sans 'unsafe-inline')
const CSP="default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://js.stripe.com https://www.paypal.com https://www.paypalobjects.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: http:; script-src-attr 'none'";

function serve(withCSP){
 return http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);
  if(p.startsWith('/api/')){r.writeHead(200,{'Content-Type':'application/json'});return r.end(JSON.stringify({products:[],items:[],data:[],ok:true}));}
  const f=path.join(PUB,p==='/'?'boutique/index.html':p);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
  const h={'Content-Type':M[path.extname(f)]||'application/octet-stream'};
  if(withCSP) h['Content-Security-Policy']=CSP;
  setTimeout(()=>{r.writeHead(200,h);r.end(fs.readFileSync(f));},path.extname(f)==='.css'?180:40);});
}

async function test(port,label,withCSP){
 const srv=serve(withCSP); await new Promise(r=>srv.listen(port,r));
 const b=await chromium.launch();
 const ctx=await b.newContext({viewport:{width:1440,height:900}});
 await ctx.addInitScript(()=>{window.__t0=performance.now();window.__tr=[];
   const s=()=>{const h=document.querySelector('.k-hero');
     if(h){const r=h.getBoundingClientRect();
       const k=Math.round(r.height)+'|'+document.documentElement.classList.contains('k-home-premium-v1');
       const l=window.__tr[window.__tr.length-1];
       if(!l||l.k!==k) window.__tr.push({k,t:Math.round(performance.now()-window.__t0),
         h:Math.round(r.height),premium:document.documentElement.classList.contains('k-home-premium-v1')});}
     requestAnimationFrame(s);};
   requestAnimationFrame(s);});
 const p=await ctx.newPage();
 let bloques=0; p.on('console',m=>{if(/Content Security Policy/.test(m.text()))bloques++;});
 await p.goto('http://127.0.0.1:'+port+'/boutique/index.html',{waitUntil:'load'});
 await p.waitForTimeout(2500);
 const tr=await p.evaluate(()=>window.__tr);
 const hs=tr.map(x=>x.h);
 const max=Math.max(...hs),fin=hs[hs.length-1];
 console.log('\n── '+label);
 console.log('   scripts inline bloqués par la CSP : '+bloques);
 console.log('   étapes : '+tr.map(x=>x.t+'ms→'+x.h+'px(premium='+x.premium+')').join('  '));
 console.log('   max='+max+'px  final='+fin+'px  '+(max>fin*1.25?'❌ FLASH +'+Math.round((max/fin-1)*100)+'%':'✅ stable'));
 await b.close();srv.close();
 return {max,fin,bloques};
}
(async()=>{
 await test(8101,'SANS CSP (mon bac à sable jusqu\'ici — d\'où l\'échec à reproduire)',false);
 await test(8102,'AVEC la CSP de production (bootstrap/security.js)',true);
})();
