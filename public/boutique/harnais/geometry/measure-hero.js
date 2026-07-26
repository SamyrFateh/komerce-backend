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

// bloc hero réel : #k-hero-fixed-wrap → </div> fermant (lignes 190-339 en 1-indexé)
const heroMarkup = require('./extract').hero();

function page(withClass) {
  return `<!DOCTYPE html><html lang=fr${withClass ? ' class="k-home-premium-v1"' : ''}><head><meta charset=utf-8>
<link rel=stylesheet href=/boutique/css/dist/base.css>
<link rel=stylesheet href=/boutique/css/dist/components.css>
<link rel=stylesheet href=/boutique/css/dist/desktop.css>
</head><body>${heroMarkup}</body></html>`;
}

(async () => {
  fs.writeFileSync(path.join(__dirname, 'hero-with.html'), page(true));
  fs.writeFileSync(path.join(__dirname, 'hero-without.html'), page(false));
  await new Promise((r) => server.listen(8099, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  for (const [label, file] of [['AVEC k-home-premium-v1 (état nominal)', 'hero-with.html'],
                               ['SANS k-home-premium-v1 (fallback)', 'hero-without.html']]) {
    for (const w of [900, 1280, 1440, 1920]) {
      await p.setViewportSize({ width: w, height: 900 });
      await p.goto(`http://127.0.0.1:8099/${file}`, { waitUntil: 'load' });
      await p.waitForTimeout(120);
      const r = await p.evaluate(() => {
        const hero = document.querySelector('.k-hero');
        const img = document.querySelector('.k-hero-img');
        const media = document.querySelector('.k-hero-media');
        const cs = img ? getComputedStyle(img) : {};
        return {
          hero: hero ? Math.round(hero.getBoundingClientRect().height) : null,
          img: img ? Math.round(img.getBoundingClientRect().height) : null,
          imgW: img ? Math.round(img.getBoundingClientRect().width) : null,
          mediaDisplay: media ? getComputedStyle(media).display : null,
          ratio: cs.aspectRatio, maxH: cs.maxHeight,
        };
      });
      if (w === 900) console.log(`\n── ${label}`);
      console.log(`   ${String(w).padStart(4)}px → hero=${String(r.hero).padStart(4)}px  img=${String(r.img).padStart(4)}×${r.imgW}  media.display=${r.mediaDisplay}  aspect-ratio=${r.ratio}  max-height=${r.maxH}`);
    }
  }
  await browser.close();
  server.close();
})();
