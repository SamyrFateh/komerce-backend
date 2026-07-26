const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', 'public');
const MIME = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const file = p.startsWith('/boutique/') ? path.join(ROOT, p) : path.join(__dirname, p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

async function run(page, label, width, variantCount) {
  await page.setViewportSize({ width, height: 860 });
  await page.goto(`http://127.0.0.1:8099/sticky-repro.html?v=${variantCount}`, { waitUntil: 'load' });
  await page.evaluate((n) => {
    const v = document.getElementById('k-modal-variants');
    let h = '';
    const axes = n > 6 ? ['Couleur', 'Taille', 'Pointure'] : ['Couleur'];
    for (const a of axes) {
      h += `<div class="k-modal-variant-axis"><div class="k-modal-variant-label">${a}</div><div class="k-modal-variant-values">`;
      for (let i = 1; i <= n; i++) h += `<button class="k-modal-variant-chip">${a} ${i}</button>`;
      h += '</div></div>';
    }
    v.innerHTML = h;
    document.getElementById('k-modal-desc').textContent = n > 6 ? 'Lorem ipsum. '.repeat(120) : 'Produit court.';
  }, variantCount);
  await page.waitForTimeout(150);

  const r = await page.evaluate(() => {
    const wrap = document.querySelector('.k-modal-img-wrap');
    const scroll = document.querySelector('.k-modal-scroll');
    scroll.style.scrollBehavior = 'auto';
    const cs = getComputedStyle(wrap);
    const base = scroll.getBoundingClientRect().top;
    const overflow = scroll.scrollHeight - scroll.clientHeight;
    const tops = [];
    for (const y of [0, 100, 200, 300, 400]) {
      scroll.scrollTop = y;
      void scroll.offsetHeight;
      tops.push(Math.round(wrap.getBoundingClientRect().top - base));
    }
    scroll.scrollTop = 0;
    return { alignSelf: cs.alignSelf, mt: cs.marginTop, ml: cs.marginLeft, overflow, tops,
             w: Math.round(wrap.getBoundingClientRect().width) };
  });
  const pinned = r.tops.filter((t) => t === 0).length;
  const ok = r.overflow < 10 || pinned >= 2;
  console.log(`\n── ${label}  (${width}px, ${variantCount} variantes/axe)`);
  console.log(`   align-self=${r.alignSelf}  margin-top=${r.mt}  margin-left=${r.ml}  largeur=${r.w}px`);
  console.log(`   amplitude de scroll disponible : ${r.overflow}px`);
  console.log(`   tops @[0,100,200,300,400] = [${r.tops.join(', ')}]`);
  console.log(`   ${ok ? '✅ OK' : '❌ ÉCHEC'}  (${pinned} seuils épinglés à 0)`);
  return ok;
}

(async () => {
  await new Promise((r) => server.listen(8099, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  results.push(await run(page, 'Desktop large — produit à variantes nombreuses', 1440, 12));
  results.push(await run(page, 'Desktop 1024 — variantes nombreuses', 1024, 12));
  results.push(await run(page, 'Desktop 900 — variantes nombreuses', 950, 12));
  results.push(await run(page, 'Desktop large — produit COURT (non-régression)', 1440, 2));
  await browser.close();
  server.close();
  console.log(`\n${results.every(Boolean) ? '✅ TOUS LES CAS PASSENT' : '❌ AU MOINS UN CAS ÉCHOUE'}`);
})();
