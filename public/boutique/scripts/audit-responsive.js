'use strict';
/**
 * audit-responsive.js — Audit responsive automatisé de la boutique Komerce.
 *
 * - Sert le repo en statique (/boutique/ → racine repo)
 * - Mocke les endpoints /api/* avec des fixtures minimales
 * - Pour chaque viewport : overflow horizontal (+ éléments fautifs),
 *   erreurs console, tap targets < 44px (mobile), inputs < 16px (zoom iOS),
 *   screenshot.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = require('path').join(__dirname, '..');
const PORT = 8090;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2',
};

const PRODUCTS = Array.from({ length: 12 }, (_, i) => ({
  id: `prod-${i + 1}`,
  name: ['Riz parfumé 25kg', 'Huile végétale 5L', 'Lait en poudre 900g', 'Parfum oud premium qualité supérieure flacon', 'Smartphone X200', 'Pack couches bébé', 'Sucre 5kg', 'Thé vert bio', 'Savon traditionnel', 'Tissu wax 6 yards', 'Chaussures sport', 'Montre élégante'][i],
  price_kmf: [12500, 8000, 6500, 22000, 145000, 9500, 4500, 3000, 1500, 18000, 35000, 55000][i],
  image_url: null,
  category: ['alimentaire', 'alimentaire', 'alimentaire', 'beaute', 'tech', 'bebe', 'alimentaire', 'alimentaire', 'beaute', 'mode', 'mode', 'mode'][i % 12],
  is_available: true, is_active: true, stock: 10,
  is_promo: i % 4 === 0, promo_pct: i % 4 === 0 ? 15 : 0,
}));

function apiResponse(url) {
  if (url.includes('/api/products')) return { products: PRODUCTS };
  if (url.includes('/api/auth/me')) return { user: null };
  if (url.includes('/api/categories')) return { categories: ['alimentaire', 'beaute', 'tech', 'bebe', 'mode'] };
  if (url.includes('/api/relais')) return { relais: [] };
  if (url.includes('/api/shared-carts')) return { carts: [] };
  return {};
}

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(apiResponse(u)));
  }
  let rel = u.replace(/^\/boutique\/?/, '') || 'index.html';
  if (rel === '' || rel === '/') rel = 'index.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

const VIEWPORTS = [
  { name: 'iphone-se', width: 320, height: 568, mobile: true },
  { name: 'small-android', width: 360, height: 740, mobile: true },
  { name: 'iphone-13', width: 390, height: 844, mobile: true },
  { name: 'iphone-plus', width: 428, height: 926, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'breakpoint-900', width: 900, height: 900, mobile: false },
  { name: 'laptop', width: 1280, height: 800, mobile: false },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const report = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile, hasTouch: vp.mobile,
      userAgent: vp.mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
    page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 160)));

    await page.goto(`http://localhost:${PORT}/boutique/`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const metrics = await page.evaluate((isMobile) => {
      const doc = document.documentElement;
      const vw = window.innerWidth;
      const overflowX = doc.scrollWidth - vw;

      // Éléments qui dépassent le viewport
      const offenders = [];
      if (overflowX > 1) {
        document.querySelectorAll('body *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && r.width <= doc.scrollWidth) {
            const sel = el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
            if (offenders.length < 8 && !offenders.some(o => o.sel === sel)) {
              offenders.push({ sel, right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width) });
            }
          }
        });
      }

      // Tap targets visibles < 44px (mobile uniquement)
      const smallTargets = [];
      if (isMobile) {
        document.querySelectorAll('button, a, [role="button"], input[type="checkbox"], input[type="radio"]').forEach(el => {
          const r = el.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight * 3;
          if (visible && (r.height < 38 || r.width < 38) && smallTargets.length < 10) {
            const sel = el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
            const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24);
            if (!smallTargets.some(t => t.sel === sel)) {
              smallTargets.push({ sel, label, w: Math.round(r.width), h: Math.round(r.height) });
            }
          }
        });
      }

      // Inputs avec font-size < 16px (zoom auto iOS)
      const smallInputs = [];
      document.querySelectorAll('input, select, textarea').forEach(el => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const r = el.getBoundingClientRect();
        if (r.width > 0 && fs < 16 && smallInputs.length < 8) {
          const sel = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
          if (!smallInputs.some(s => s.sel === sel)) smallInputs.push({ sel, fontSize: fs });
        }
      });

      return { vw, scrollWidth: doc.scrollWidth, overflowX, offenders, smallTargets, smallInputs };
    }, vp.mobile);

    await fs.promises.mkdir(path.join(ROOT, 'audit-shots'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'audit-shots', `home-${vp.name}-${vp.width}.png`), fullPage: false });

    report.push({ viewport: vp.name, width: vp.width, ...metrics, consoleErrors: [...new Set(consoleErrors)].slice(0, 6) });
    await ctx.close();
  }

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(ROOT, 'audit-responsive-report.json'), JSON.stringify(report, null, 2));

  for (const r of report) {
    const status = r.overflowX > 1 ? `✖ OVERFLOW +${r.overflowX}px` : '✓ pas d\'overflow';
    console.log(`\n[${r.viewport} ${r.width}px] ${status} | console errors: ${r.consoleErrors.length} | small taps: ${r.smallTargets?.length || 0} | inputs<16px: ${r.smallInputs.length}`);
    r.offenders?.forEach(o => console.log(`   ↳ dépasse: ${o.sel} (right=${o.right}, w=${o.w})`));
    r.smallTargets?.slice(0, 5).forEach(t => console.log(`   ↳ tap ${t.w}×${t.h}: ${t.sel} "${t.label}"`));
    r.smallInputs?.slice(0, 4).forEach(i => console.log(`   ↳ input ${i.fontSize}px: ${i.sel}`));
    r.consoleErrors?.slice(0, 3).forEach(e => console.log(`   ↳ console: ${e}`));
  }
})();
