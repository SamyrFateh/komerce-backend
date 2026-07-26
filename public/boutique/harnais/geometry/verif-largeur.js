const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const PUB=path.resolve(__dirname,'..','public');
const M={'.css':'text/css','.html':'text/html','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.json':'application/json','.ico':'image/x-icon'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http:";
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);
 if(p.startsWith('/api/')){r.writeHead(200,{'Content-Type':'application/json'});return r.end('{"products":[],"items":[],"data":[],"ok":true}');}
 const f=path.join(PUB,p==='/'?'boutique/index.html':p);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
 // les gros bundles JS arrivent TARD : c'est la fenêtre où le flash se produisait
 const d=path.extname(f)==='.css'?150:(f.includes('/js/')&&!f.includes('anti-fouc')?2500:40);
 setTimeout(()=>{r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream','Content-Security-Policy':CSP});r.end(fs.readFileSync(f));},d);});
(async()=>{
await new Promise(r=>srv.listen(8104,r));
const b=await chromium.launch();
const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto('http://127.0.0.1:8104/boutique/index.html',{waitUntil:'commit'});
await p.waitForTimeout(1000);   // JS applicatif PAS encore arrivé
const m=()=>p.evaluate(()=>{const i=document.querySelector('.k-hero-img'),md=document.querySelector('.k-hero-media'),h=document.querySelector('.k-hero');
 if(!i||!md)return null;const r=i.getBoundingClientRect();
 return{premium:document.documentElement.classList.contains('k-home-premium-v1'),media:getComputedStyle(md).display,
  w:Math.round(r.width),hh:Math.round(h.getBoundingClientRect().height)};});
const t1=await m();
await p.waitForTimeout(4500);   // après arrivée du JS applicatif
const t2=await m();
console.log('\n  fenêtre critique (JS applicatif pas encore chargé) :');
console.log('     premium='+t1.premium+'  media='+t1.media+'  image largeur='+t1.w+'px  hero='+t1.hh+'px');
console.log('  état final :');
console.log('     premium='+t2.premium+'  media='+t2.media+'  image largeur='+t2.w+'px  hero='+t2.hh+'px');
console.log('\n  '+(t1.w===t2.w&&t1.hh===t2.hh?'✅ AUCUN SAUT — le hero est correct dès la première peinture':'❌ saut de '+t1.w+'→'+t2.w+'px'));
await b.close();srv.close();})();
