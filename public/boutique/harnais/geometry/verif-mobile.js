const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const PUB=path.resolve(__dirname,'..','public');
const M={'.css':'text/css','.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json'};
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);
 if(p.startsWith('/api/')){r.writeHead(200,{'Content-Type':'application/json'});return r.end('{"ok":true}');}
 const f=p.startsWith('/boutique/')?path.join(PUB,p):path.join(__dirname,p);
 if(!fs.existsSync(f)){r.writeHead(404);return r.end('nf');}
 r.writeHead(200,{'Content-Type':M[path.extname(f)]||'text/plain'});r.end(fs.readFileSync(f));});
(async()=>{
await new Promise(r=>srv.listen(8112,r));
const b=await chromium.launch();
for(const w of [390,768,899,900,1024,1440]){
 const p=await (await b.newContext({viewport:{width:w,height:800}})).newPage();
 await p.goto('http://127.0.0.1:8112/scene.html',{waitUntil:'load'});
 await p.evaluate(()=>{document.getElementById('k-modal-overlay').classList.add('open');
  const s=document.querySelector('.k-modal-suggestions');s.hidden=false;
  s.innerHTML='<h3>Vous aimerez aussi</h3><div style="height:120px;border:1px solid #ccc">S1</div>';});
 await p.waitForTimeout(120);
 const r=await p.evaluate(()=>{
  const z=document.querySelector('.k-modal-product-zone'),s=document.querySelector('.k-modal-suggestions'),
        d=document.querySelector('.k-modal-details'),i=document.querySelector('.k-modal-img-wrap');
  const rs=s.getBoundingClientRect(),rd=d.getBoundingClientRect(),ri=i.getBoundingClientRect();
  return{zone:getComputedStyle(z).display,
   ordreOk: ri.top<=rd.top+2 && rd.top<=rs.top+2,
   img:Math.round(ri.top),det:Math.round(rd.top),sug:Math.round(rs.top),
   sugLargeur:Math.round(rs.width),modalLargeur:Math.round(document.querySelector('.k-modal-scroll').getBoundingClientRect().width)};});
 console.log(`  ${String(w).padStart(4)}px  zone=${r.zone.padEnd(9)} ordre image→détails→suggestions : ${r.ordreOk?'✅':'❌'}  (tops ${r.img}/${r.det}/${r.sug})  suggestions ${r.sugLargeur}/${r.modalLargeur}px`);
 }
await b.close();srv.close();})();
