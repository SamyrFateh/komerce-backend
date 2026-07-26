const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..','public');
const srv=http.createServer((q,r)=>{const p=q.url.split('?')[0];
  const f=p.startsWith('/boutique/')?path.join(ROOT,p):path.join(__dirname,p);
  if(!fs.existsSync(f)){r.writeHead(404);return r.end('nf');}
  r.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'text/html'});r.end(fs.readFileSync(f));});
const modal = require('./extract').modal();
fs.writeFileSync(path.join(__dirname,'ztest.html'),`<!DOCTYPE html><html class="k-home-premium-v1"><head><meta charset=utf-8>
<link rel=stylesheet href=/boutique/css/dist/base.css><link rel=stylesheet href=/boutique/css/dist/components.css>
<link rel=stylesheet href=/boutique/css/dist/desktop.css></head><body class="modal-open">${modal}
<button id="k-modal-back-top" class="k-modal-back-top visible" aria-label="Retour au produit">↑</button>
<script>document.getElementById('k-modal-overlay').classList.add('open');</script></body></html>`);
(async()=>{await new Promise(r=>srv.listen(8099,r));
const b=await chromium.launch();const p=await b.newPage();
await p.setViewportSize({width:1440,height:860});
await p.goto('http://127.0.0.1:8099/ztest.html',{waitUntil:'load'});await p.waitForTimeout(150);
const r=await p.evaluate(()=>{
  const fab=document.getElementById('k-modal-back-top');
  const cs=getComputedStyle(fab);
  const b=fab.getBoundingClientRect();
  const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
  const ov=document.getElementById('k-modal-overlay');
  return {z:cs.zIndex,display:cs.display,opacity:cs.opacity,pe:cs.pointerEvents,
    w:Math.round(b.width),h:Math.round(b.height),
    overlayZ:getComputedStyle(ov).zIndex,
    hit:hit?(hit.id||hit.className||hit.tagName):'null',
    cliquable:hit===fab||fab.contains(hit)};});
console.log('\n── Bouton « retour en haut » de la modale, modale OUVERTE — classe .visible posée par le JS');
console.log(`   z-index=${r.z}   (overlay modale = ${r.overlayZ})`);
console.log(`   display=${r.display} opacity=${r.opacity} pointer-events=${r.pe} taille=${r.w}×${r.h}`);
console.log(`   élément réellement au point du clic : ${r.hit}`);
console.log(`   ${r.cliquable?'✅ atteignable':'❌ RECOUVERT — bouton inatteignable quand la modale est ouverte'}`);
await b.close();srv.close();})();
