'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const ROOT = path.join(__dirname, '..'), PORT = 8099;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const body = u.includes('products')
      ? { products: Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: 'Produit ' + i, price_kmf: 1000 * (i + 1), is_available: true, stock: 5, category: 'alimentaire' })) }
      : u.includes('shared-carts') && u.includes('mine') ? { carts: [{ id: 'c1', title: 'Mariage Aicha', status: 'active', total_kmf_snapshot: 33800, contributed_kmf: 0, remaining_kmf: 33800, metadata: {}, expires_at: new Date(Date.now() + 86400000).toISOString() }] }
      : u.includes('shared-carts') ? { cart: { id: 'c1', title: 'Mariage Aicha', status: 'active', total_kmf_snapshot: 33800, contributed_kmf: 0, remaining_kmf: 33800, metadata: {}, expires_at: new Date(Date.now() + 86400000).toISOString() }, items: [], cart_items: [], contributions: [], commitments: [{ id: 'k1', participant_name: 'Amina', participant_phone: '+2693332100', amount_kmf: 11200 }, { id: 'k2', participant_name: 'Karima', participant_phone: '+2693330977', amount_kmf: 7600 }] }
      : u.includes('orders') ? { orders: [] }
      : {};
    return res.end(JSON.stringify(body));
  }
  let rel = u.replace(/^\/boutique\/?/, ''); if (!rel || rel === '/') rel = 'index.html';
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
});

async function snapshot(page, label) {
  const m = await page.evaluate(() => {
    const vh = window.innerHeight;
    const doc = document.documentElement;
    // Quel élément est le scroller principal ?
    const cand = ['#k-page-scroll', 'body', 'html'].map(s => {
      const el = s === 'html' ? document.documentElement : (s === 'body' ? document.body : document.querySelector(s));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { s, scrollH: el.scrollHeight, clientH: el.clientHeight, overflowY: cs.overflowY, position: cs.position, height: cs.height };
    }).filter(Boolean);

    // Le "vide" : dernier élément VISIBLE avec un bottom max vs scrollHeight doc
    let maxBottom = 0, maxEl = null;
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.height > 0 && cs.visibility !== 'hidden' && cs.position !== 'fixed') {
        const b = r.bottom + window.scrollY;
        if (b > maxBottom) { maxBottom = b; maxEl = el; }
      }
    });
    const sel = el => el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') : null;

    // Éléments (même invisibles) qui dépassent le bas du dernier visible
    const ghosts = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.height > 0 && cs.position !== 'fixed') {
        const b = r.bottom + window.scrollY;
        if (b > maxBottom + 2 && ghosts.length < 8) {
          ghosts.push({ sel: sel0(el), bottom: Math.round(b), h: Math.round(r.height),
            vis: cs.visibility, disp: cs.display, op: cs.opacity });
        }
      }
    });
    function sel0(el){ return el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (typeof el.className==='string'&&el.className ? '.'+el.className.trim().split(/\s+/).slice(0,2).join('.') : ''); }

    const header = document.getElementById('k-header');
    const bnav = document.querySelector('.k-bnav') || document.getElementById('k-bnav');
    const hcs = header ? getComputedStyle(header) : null;
    const bcs = bnav ? getComputedStyle(bnav) : null;

    return {
      bodyClass: document.body.className,
      docScrollH: doc.scrollHeight, bodyScrollH: document.body.scrollHeight, vh,
      void_px: doc.scrollHeight - Math.ceil(maxBottom),
      lastVisible: sel(maxEl), lastBottom: Math.round(maxBottom),
      scrollers: cand,
      header: hcs ? { pos: hcs.position, top: hcs.top, h: Math.round(header.getBoundingClientRect().height) } : null,
      bnav: bcs ? { pos: bcs.position, bottom: bcs.bottom, h: Math.round(bnav.getBoundingClientRect().height) } : null,
      ghosts,
      pagerActive: !!document.querySelector('#k-page-scroll.k-pager-active'),
      spacers: ['#k-header-spacer', '#k-bar-sentinel', '#k-hero-fixed-wrap', '#k-catalog-section', '#k-page-scroll'].map(s => {
        const el = document.querySelector(s); if (!el) return { s, missing: true };
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return { s, display: cs.display, h: Math.round(r.height), minH: cs.minHeight, padB: cs.paddingBottom, marB: cs.marginBottom };
      }),
    };
  });
  console.log(`\n══ ${label} ══`);
  console.log(` body: ${m.bodyClass} | pager: ${m.pagerActive}`);
  console.log(` scrollHeight doc=${m.docScrollH} body=${m.bodyScrollH} | viewport=${m.vh}`);
  console.log(` dernier élément visible: ${m.lastVisible} bottom=${m.lastBottom} → VIDE=${m.void_px}px`);
  console.log(` header: ${JSON.stringify(m.header)} | bnav: ${JSON.stringify(m.bnav)}`);
  m.scrollers.forEach(s => console.log('  scroller?', JSON.stringify(s)));
  (m.ghosts||[]).forEach(g => console.log('  FANTÔME ', JSON.stringify(g)));
  m.spacers.forEach(s => console.log('  spacer  ', JSON.stringify(s)));
  return m;
}

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch();
  const page = await (await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  })).newPage();
  await page.goto(`http://localhost:${PORT}/boutique/`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);

  await snapshot(page, 'BOUTIQUE (initial)');

  await page.click('.k-bnav-item[data-tab="komerce"]').catch(e => console.log('click komerce fail', e.message));
  await page.waitForTimeout(400);
  await page.click('#k-kmc-listes-btn').catch(e => console.log('click mes-listes fail', e.message));
  await page.waitForTimeout(1200);
  await snapshot(page, 'ONGLET GROUPE');
  // Scroll window résiduel simulé AVANT bascule (déjà fait), maintenant : scroller la vue
  const scrollState = await page.evaluate(async () => {
    window.scrollTo(0, 250);
    await new Promise(r => setTimeout(r, 250));
    const h = document.getElementById('k-header').getBoundingClientRect();
    const b = (document.querySelector('.k-bnav') || {}).getBoundingClientRect?.() || {};
    return { winY: window.scrollY, headerTop: Math.round(h.top), bnavBottom: Math.round((b.bottom || 0) - window.innerHeight) };
  });
  console.log(' après scroll window 250px → header.top=' + scrollState.headerTop + ' (attendu 0) | bnav.bottom-vh=' + scrollState.bnavBottom + ' (attendu 0) | winY=' + scrollState.winY);
  // Simuler un scroll résiduel puis re-basculer pour tester le reset
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.click('.k-bnav-item[data-tab="shop"]');
  await page.waitForTimeout(900);
  // §2.1 — l'onglet Groupe n'existe plus : re-basculer via Mon Komerce > Mes listes
  await page.click('.k-bnav-item[data-tab="komerce"]');
  await page.waitForTimeout(400);
  await page.click('#k-kmc-listes-btn');
  await page.waitForTimeout(900);
  const resetCheck = await page.evaluate(() => ({ winY: window.scrollY, psTop: document.getElementById('k-page-scroll')?.scrollTop || 0 }));
  console.log(' re-bascule shop→groupe : window.scrollY=' + resetCheck.winY + ' (attendu 0) | ps.scrollTop=' + resetCheck.psTop);
  await page.screenshot({ path: path.join(ROOT, 'audit-shots', 'tab-group-390.png'), fullPage: true });

  await page.click('.k-bnav-item[data-tab="track"]').catch(e => console.log('click track fail', e.message));
  await page.waitForTimeout(1200);
  await snapshot(page, 'ONGLET SUIVI');
  await page.screenshot({ path: path.join(ROOT, 'audit-shots', 'tab-track-390.png'), fullPage: true });

  await b.close(); srv.close();
})();
