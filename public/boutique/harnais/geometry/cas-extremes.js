const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const PUB=path.resolve(__dirname,'..','public');
const M={'.css':'text/css','.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json'};
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(q.url.split('?')[0]);
 if(p.startsWith('/api/')){r.writeHead(200,{'Content-Type':'application/json'});return r.end('{"ok":true}');}
 const f=p.startsWith('/boutique/')?path.join(PUB,p):path.join(__dirname,p);
 if(!fs.existsSync(f)){r.writeHead(404);return r.end('nf');}
 r.writeHead(200,{'Content-Type':M[path.extname(f)]||'text/plain'});r.end(fs.readFileSync(f));});
async function cas(p,axes,vals,sug,label){
 await p.setViewportSize({width:1440,height:860});
 await p.goto('http://127.0.0.1:8113/scene.html',{waitUntil:'load'});
 await p.evaluate(([na,nv,ns])=>{
  document.getElementById('k-modal-overlay').classList.add('open');
  let h='';for(let a=1;a<=na;a++){h+=`<div class="k-modal-variant-axis"><div class="k-modal-variant-label">Axe ${a}</div><div class="k-modal-variant-values">`;
   for(let i=1;i<=nv;i++)h+=`<button class="k-modal-variant-chip">V${i}</button>`;h+='</div></div>';}
  document.getElementById('k-modal-variants').innerHTML=h;
  const s=document.querySelector('.k-modal-suggestions');s.hidden=false;
  s.innerHTML='<h3>Vous aimerez aussi</h3>'+Array.from({length:ns},(_,i)=>`<div style="height:150px;border:1px solid #ddd;margin:8px 0">S${i+1}</div>`).join('');
 },[axes,vals,sug]);
 await p.waitForTimeout(250);
 const r=await p.evaluate(()=>{
  const s=document.querySelector('.k-modal-scroll'),w=document.querySelector('.k-modal-img-wrap'),z=document.querySelector('.k-modal-product-zone');
  s.style.scrollBehavior='auto';
  const base=s.getBoundingClientRect().top,ov=s.scrollHeight-s.clientHeight;
  const tops=[];const pas=Math.max(1,Math.round(ov/8));
  for(let i=0;i<=8;i++){s.scrollTop=i*pas;void s.offsetHeight;tops.push(Math.round(w.getBoundingClientRect().top-base));}
  s.scrollTop=0;
  const chips=document.querySelectorAll('.k-modal-variant-chip').length;
  return{ov,tops,chips,zoneH:Math.round(z.getBoundingClientRect().height),
   debord:w.getBoundingClientRect().width>z.getBoundingClientRect().width+2};});
 const decroche=r.tops.findIndex(t=>t<-1);
 console.log(`  ${label.padEnd(34)} ${String(r.chips).padStart(4)} chips  zone=${String(r.zoneH).padStart(5)}px  amplitude=${String(r.ov).padStart(5)}px  ${decroche<0?'✅ épinglé partout':'❌ décroche au seuil '+decroche}${r.debord?'  ⚠ débordement largeur':''}`);
}
(async()=>{
 await new Promise(r=>srv.listen(8113,r));
 const b=await chromium.launch();const p=await b.newPage();
 console.log('\n══ CAS LIMITES — variantes importantes, 1440px ══');
 await cas(p,1,2,0,'minimal : 1 axe × 2');
 await cas(p,3,14,6,'réaliste : 3 axes × 14 + 6 sugg.');
 await cas(p,5,30,8,'lourd : 5 axes × 30 + 8 sugg.');
 await cas(p,10,50,10,'extrême : 10 axes × 50 + 10 sugg.');
 await cas(p,20,100,12,'plafond contrat : 20 axes × 100');
 await b.close();srv.close();})();
