'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const ROOT = require('path').join(__dirname, '..'), PORT = 8097;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/dist/base.css">
<link rel="stylesheet" href="/css/dist/components.css">
<style>body{padding:14px;background:var(--page-bg,#faf7f0)}</style>
</head><body>
<div id="k-group-view" class="k-group-view show"><div id="root"></div></div>
<script type="module">
import { renderOwnerIdentityCard, renderCreatorFinancialSummary, renderCreatorActions, renderProgress, renderCreatorArticlesPanel }
  from '/js/group/group-render-creator.js';

const cart = {
  id: 'c1', title: 'Marie', beneficiary_name_snapshot: 'Ussa',
  status: 'active', total_kmf_snapshot: 33800, contributed_kmf: 11500,
  remaining_kmf: 22300, metadata: {}, delivery_relay_id: 'r1',
};
const items = [
  { product_name: 'Meuble raffiné', quantity: 1, unit_price_kmf: 15000 },
  { product_name: 'Vernis gel 6 teintes', quantity: 1, unit_price_kmf: 5300 },
  { product_name: 'Écouteurs bluetooth', quantity: 1, unit_price_kmf: 13500 },
];
const commitments = [
  { id: 'k1', participant_name: 'Amina B', participant_phone: '+2693332100', amount_kmf: 11200 },
  { id: 'k2', participant_name: 'Karima T', participant_phone: '+2693330977', amount_kmf: 7600 },
  { id: 'k3', participant_name: 'Said M', participant_phone: '+2693334512', amount_kmf: 5500 },
];
const contributions = [{ commitment_id: 'k1', status: 'paid' }];

document.getElementById('root').innerHTML = \`
  <div class="k-group-cockpit">
    <div class="k-group-main-col">
      \${renderOwnerIdentityCard(cart, items.length)}
      \${renderCreatorFinancialSummary(cart, commitments)}
      \${renderCreatorActions(cart)}
      \${renderProgress(cart, contributions, commitments)}
    </div>
    \${renderCreatorArticlesPanel(items, cart)}
  </div>\`;
window.__done = true;
</script></body></html>`;

const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/harness') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const fp = path.join(ROOT, u.slice(1));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch();
  for (const vp of [{ n: 'mobile-360', w: 360, h: 1100 }, { n: 'mobile-390', w: 390, h: 1100 }, { n: 'desktop-1280', w: 1280, h: 1100 }]) {
    const page = await (await b.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 800 })).newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__done === true, { timeout: 5000 }).catch(() => {});
    const checks = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      badge: document.querySelector('.k-group-phase-badge')?.textContent.trim(),
      accordions: [...document.querySelectorAll('.k-group-accordion')].map(d => ({
        sum: d.querySelector('summary')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 44),
        open: d.open,
        sumH: Math.round(d.querySelector('summary').getBoundingClientRect().height),
      })),
      avatars: document.querySelectorAll('.k-group-commitment-avatar').length,
      bars: document.querySelectorAll('.k-group-progress').length,
      offenders: (() => { const vw = window.innerWidth, out = [];
        document.querySelectorAll('body *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > vw + 1 && out.length < 6) {
            out.push({ sel: el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (typeof el.className === 'string' && el.className ? '.'+el.className.trim().split(/\s+/).slice(0,2).join('.') : ''), right: Math.round(r.right), w: Math.round(r.width) });
          }
        }); return out; })(),
      primaryBtn: (() => { const b = document.querySelector('#k-group-open-settlement'); if (!b) return null;
        const r = b.getBoundingClientRect(), c = getComputedStyle(b);
        return { h: Math.round(r.height), w: Math.round(r.width), bg: c.backgroundColor, color: c.color }; })(),
    }));
    await fs.promises.mkdir(path.join(ROOT, 'audit-shots'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'audit-shots', `creator-${vp.n}.png`), fullPage: true });
    console.log(`\n[${vp.n}] overflow=${checks.overflowX} | barres progression=${checks.bars} | avatars=${checks.avatars}`);
    console.log('  badge :', checks.badge);
    checks.accordions.forEach(a => console.log(`  accordéon [${a.open ? 'ouvert' : 'replié'}] h=${a.sumH}px : ${a.sum}`));
    console.log('  bouton principal :', JSON.stringify(checks.primaryBtn));
    (checks.offenders||[]).forEach(o => console.log('  dépasse:', o.sel, 'right='+o.right, 'w='+o.w));
    if (errs.length) console.log('  ERREURS:', errs.slice(0, 2));
    await page.context().close();
  }
  await b.close(); srv.close();
})();
