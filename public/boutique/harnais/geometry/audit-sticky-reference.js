const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUB = path.resolve(__dirname, '..', 'public');
const M = { '.css':'text/css','.html':'text/html','.js':'text/javascript','.webp':'image/webp',
            '.png':'image/png','.json':'application/json','.ico':'image/x-icon','.svg':'image/svg+xml' };
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (p.startsWith('/api/')) { r.writeHead(200,{'Content-Type':'application/json'}); return r.end('{"ok":true,"products":[],"items":[],"data":[]}'); }
  const f = p.startsWith('/boutique/') ? path.join(PUB, p) : path.join(__dirname, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, {'Content-Type': M[path.extname(f)] || 'application/octet-stream'});
  r.end(fs.readFileSync(f));
});

// markup réel de la modale, extrait par marqueurs
function modalMarkup() {
  const s = fs.readFileSync(path.join(PUB,'boutique/index.html'),'utf8');
  const a = s.indexOf('<div class="k-modal-overlay" id="k-modal-overlay">');
  const b = s.indexOf('/#k-modal-overlay');
  return s.slice(a, b > a ? s.indexOf('>', b) + 1 : a + 12000);
}

async function mesure(page, nbVariantes, nbSuggestions, label) {
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto('http://127.0.0.1:8110/scene.html', { waitUntil: 'load' });
  await page.evaluate(([nv, ns]) => {
    document.getElementById('k-modal-overlay').classList.add('open');
    document.getElementById('k-modal-name').textContent = 'Produit de test';
    document.getElementById('k-modal-price').textContent = '29 500 KMF';
    const v = document.getElementById('k-modal-variants');
    if (v) {
      let h = '';
      const axes = nv > 8 ? ['Couleur','Taille','Finition'] : ['Couleur'];
      for (const a of axes) {
        h += `<div class="k-modal-variant-axis"><div class="k-modal-variant-label">${a}</div><div class="k-modal-variant-values">`;
        for (let i=1;i<=nv;i++) h += `<button class="k-modal-variant-chip">${a} ${i}</button>`;
        h += '</div></div>';
      }
      v.innerHTML = h;
    }
    const d = document.getElementById('k-modal-desc');
    if (d) d.textContent = 'Description produit. '.repeat(nv > 8 ? 40 : 6);
    const sug = document.querySelector('.k-modal-suggestions');
    if (sug && ns) {
      sug.innerHTML = '<div class="k-modal-sug-title">À associer avec</div>' +
        Array.from({length:ns},(_,i)=>`<div class="k-modal-sug-card" style="height:150px;border:1px solid #ddd;margin:8px 0">Suggestion ${i+1}</div>`).join('');
      sug.hidden = false;
    }
  }, [nbVariantes, nbSuggestions]);
  await page.waitForTimeout(150);

  const r = await page.evaluate(() => {
    const scroll = document.querySelector('.k-modal-scroll');
    const zone   = document.querySelector('.k-modal-product-zone');
    const wrap   = document.querySelector('.k-modal-img-wrap');
    const sug    = document.querySelector('.k-modal-suggestions');
    if (!scroll || !wrap) return null;
    scroll.style.scrollBehavior = 'auto';

    // la rangée 2 de la grille existe-t-elle réellement ?
    const cs = getComputedStyle(zone);
    const rows = cs.gridTemplateRows;
    const sugDansZone = !!(sug && zone.contains(sug));

    const base = scroll.getBoundingClientRect().top;
    const overflow = scroll.scrollHeight - scroll.clientHeight;
    const tops = [];
    const pas = Math.max(1, Math.round(overflow / 6));
    for (let i = 0; i <= 6; i++) {
      scroll.scrollTop = i * pas;
      void scroll.offsetHeight;
      tops.push({ y: i*pas, top: Math.round(wrap.getBoundingClientRect().top - base) });
    }
    scroll.scrollTop = 0;
    return {
      rows, sugDansZone,
      zoneH: Math.round(zone.getBoundingClientRect().height),
      wrapH: Math.round(wrap.getBoundingClientRect().height),
      sugH: sug ? Math.round(sug.getBoundingClientRect().height) : 0,
      overflow, tops,
    };
  });

  if (!r) { console.log(`  ${label} : éléments introuvables`); return; }
  const colles = r.tops.filter(t => t.top <= 1).length;
  const decroche = r.tops.find(t => t.top < -1);
  console.log(`\n── ${label}`);
  console.log(`   grid-template-rows = ${r.rows}   suggestions DANS la zone : ${r.sugDansZone ? 'oui' : 'NON'}`);
  console.log(`   zone=${r.zoneH}px  image=${r.wrapH}px  suggestions=${r.sugH}px  amplitude scroll=${r.overflow}px`);
  console.log(`   tops : ${r.tops.map(t => `${t.y}→${t.top}`).join('  ')}`);
  console.log(`   ${colles >= 2 ? `✅ collé sur ${colles}/7 seuils` : '❌ jamais collé'}` +
              (decroche ? `  ⚠ décroche (top ${decroche.top}) dès scroll ${decroche.y}` : ''));
  return r;
}

(async () => {
  fs.writeFileSync(path.join(__dirname,'scene.html'),
`<!DOCTYPE html><html lang=fr class="k-home-premium-v1"><head><meta charset=utf-8>
<link rel=stylesheet href=/boutique/css/dist/base.css>
<link rel=stylesheet href=/boutique/css/dist/components.css>
<link rel=stylesheet href=/boutique/css/dist/desktop.css>
</head><body class="modal-open">${modalMarkup()}</body></html>`);
  await new Promise(r => srv.listen(8110, r));
  const b = await chromium.launch();
  const p = await b.newPage();

  console.log('\n══ STICKY HERO — DESKTOP 1440px, contre la référence canonique ══');
  await mesure(p,  2,  0, 'A. produit simple, sans suggestion');
  await mesure(p, 14,  0, 'B. 42 variantes (3 axes × 14), sans suggestion');
  await mesure(p,  2,  6, 'C. produit simple + 6 suggestions');
  await mesure(p, 14,  6, 'D. 42 variantes + 6 suggestions  ← cas limite réel');

  await b.close(); srv.close();
})();
