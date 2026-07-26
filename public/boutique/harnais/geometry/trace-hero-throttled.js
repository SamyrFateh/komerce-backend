const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUB = path.resolve(__dirname, '..', 'public');
const MIME = { '.css':'text/css','.html':'text/html','.js':'text/javascript','.webp':'image/webp',
               '.png':'image/png','.svg':'image/svg+xml','.json':'application/json',
               '.woff2':'font/woff2','.ico':'image/x-icon' };

// Latence artificielle par type : reproduit l'ordre d'arrivée réel en production.
const DELAY = { '.css': 220, '.js': 160, '.webp': 90, default: 40 };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ products: [], items: [], data: [], ok: true }));
  }
  const f = path.join(PUB, p === '/' ? 'boutique/index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  const ext = path.extname(f);
  setTimeout(() => {
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(fs.readFileSync(f));
  }, DELAY[ext] ?? DELAY.default);
});

const RECORDER = () => {
  window.__trace = [];
  const t0 = performance.now();
  window.__sample = (tag) => {
    const h = document.querySelector('.k-hero');
    const img = document.querySelector('.k-hero-img');
    const media = document.querySelector('.k-hero-media');
    if (!h && !img) return;
    const hr = h && h.getBoundingClientRect();
    const ir = img && img.getBoundingClientRect();
    window.__trace.push({
      t: +(performance.now() - t0).toFixed(0), tag,
      hero: hr ? Math.round(hr.height) : null,
      img: ir ? Math.round(ir.height) : null,
      imgW: ir ? Math.round(ir.width) : null,
      premium: document.documentElement.classList.contains('k-home-premium-v1'),
      media: media ? getComputedStyle(media).display : null,
      sheets: document.styleSheets.length,
    });
  };
  const loop = () => { window.__sample('frame'); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  document.addEventListener('DOMContentLoaded', () => window.__sample('DOMContentLoaded'));
  window.addEventListener('load', () => window.__sample('load'));
};

async function run(page, w, label) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto('http://127.0.0.1:8099/boutique/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__sample('final'));
  const tr = await page.evaluate(() => window.__trace);

  const out = []; let prev = null;
  for (const s of tr) {
    const k = `${s.hero}|${s.img}|${s.premium}|${s.media}`;
    if (k !== prev || s.tag !== 'frame') { out.push(s); prev = k; }
  }
  const hs = out.map(s => s.hero).filter(v => v != null);
  if (!hs.length) { console.log(`\n── ${label} (${w}px) : hero introuvable`); return; }
  const max = Math.max(...hs), fin = hs[hs.length - 1];
  const flash = max > fin * 1.25;

  console.log(`\n── ${label} — ${w}px  ${flash ? `❌ FLASH +${Math.round((max/fin-1)*100)}%` : '✅ stable'}   (max ${max} → final ${fin})`);
  for (const s of out.slice(0, 10)) {
    console.log(`     ${String(s.t).padStart(5)}ms  ${String(s.tag).padEnd(16)} hero=${String(s.hero).padStart(4)}  img=${String(s.img).padStart(4)}×${String(s.imgW).padEnd(5)} premium=${String(s.premium).padEnd(5)} media=${String(s.media).padEnd(6)} feuilles=${s.sheets}`);
  }
  return flash;
}

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch();

  for (const w of [1920, 1440, 1280, 1024, 920, 900, 899, 768, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript(RECORDER);
    const page = await ctx.newPage();
    await run(page, w, 'chargement à froid');
    await ctx.close();
  }

  await browser.close();
  server.close();
})();
