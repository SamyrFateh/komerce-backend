const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', 'public');
const MIME = { '.css': 'text/css', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const file = p.startsWith('/boutique/') ? path.join(ROOT, p) : path.join(__dirname, p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

const HTML = `<!DOCTYPE html><html lang=fr class="k-home-premium-v1"><head><meta charset=utf-8>
<link rel=stylesheet href=/boutique/css/dist/base.css>
<link rel=stylesheet href=/boutique/css/dist/components.css>
<link rel=stylesheet href=/boutique/css/dist/desktop.css>
</head><body>
  <div class="k-section"><div class="k-sec-header"><h2>Titre section</h2></div>
    <div class="k-sec-subcats"><button class="k-sec-subchip">Sous-cat</button></div>
  </div>
  <button class="k-modal-back-top">↑</button>
  <div class="k-hero-mini-slogan"><span>slogan</span></div>
  <div class="k-hero-bubble">👀</div>
</body></html>`;

const CASES = [
  ['body',                'overflowY',   'auto vs visible — un body scroll-container casserait tout sticky descendant'],
  ['body',                'overflowX',   'promotion implicite si un seul axe est non-visible'],
  ['.k-sec-header',       'display',     'none vs flex — en-têtes de section desktop'],
  ['.k-sec-subcats',      'display',     'none vs flex — rail sous-catégories desktop'],
  ['.k-sec-subchip',      'display',     'inline-flex vs none — chips de sous-catégorie'],
  ['.k-modal-back-top',   'display',     'none vs flex'],
  ['.k-modal-back-top',   'zIndex',      '420 vs 10 — passe-t-il au-dessus de la modale ?'],
  ['.k-hero-mini-slogan', 'display',     'flex vs none'],
  ['.k-hero-bubble',      'display',     'flex vs none'],
];

(async () => {
  fs.writeFileSync(path.join(__dirname, 'conflicts.html'), HTML);
  await new Promise((r) => server.listen(8099, r));
  const browser = await chromium.launch();
  const p = await browser.newPage();

  for (const w of [1440, 700]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto('http://127.0.0.1:8099/conflicts.html', { waitUntil: 'load' });
    await p.waitForTimeout(100);
    console.log(`\n${'═'.repeat(78)}\nViewport ${w}px ${w >= 900 ? '(desktop)' : '(mobile)'}`);
    for (const [sel, prop, note] of CASES) {
      const v = await p.evaluate(([s, pr]) => {
        const el = document.querySelector(s) || (s === 'body' ? document.body : null);
        return el ? getComputedStyle(el)[pr] : 'ABSENT';
      }, [sel, prop]);
      console.log(`  ${sel.padEnd(20)} ${prop.padEnd(11)} = ${String(v).padEnd(12)} ${note}`);
    }
  }

  // Test décisif : un sticky descendant de body colle-t-il ?
  await p.setViewportSize({ width: 1440, height: 600 });
  await p.goto('http://127.0.0.1:8099/conflicts.html', { waitUntil: 'load' });
  const stickyOk = await p.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<div id=stk style="position:sticky;top:0;height:40px;background:red"></div>'
                + '<div style="height:3000px"></div>';
    document.body.appendChild(d);
    const el = document.getElementById('stk');
    const before = el.getBoundingClientRect().top;
    window.scrollTo(0, 500);
    const after = el.getBoundingClientRect().top;
    return { before: Math.round(before), after: Math.round(after),
             bodyOverflow: getComputedStyle(document.body).overflow,
             htmlOverflow: getComputedStyle(document.documentElement).overflow };
  });
  console.log(`\n${'═'.repeat(78)}\nTest décisif — sticky descendant de <body> à 1440px`);
  console.log(`  html overflow=${stickyOk.htmlOverflow}   body overflow=${stickyOk.bodyOverflow}`);
  console.log(`  top avant scroll=${stickyOk.before}  après scroll(500)=${stickyOk.after}`);
  console.log(`  ${stickyOk.after <= 1 ? '✅ le sticky colle — body n\'est PAS un scroll-container'
                                       : '❌ le sticky ne colle pas'}`);

  await browser.close();
  server.close();
})();
