/**
 * @komerce-arch-lite
 * @role staging-hub-central-ui-probe
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Sonde DOM LECTURE SEULE : chemin UI du Hub central (agent_hub, hub_director) vers les boutons PO ; enregistre pages, boutons visibles et erreurs API, sans clic ecrivant.
 * @impact-areas dashboard, hub, purchasing, authorization, staging-only
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const OUTPUT = path.resolve('test-results/staging-chromium/evidence/hub-central-ui-probe.json');
const PAGES = ['/admin/hub?branch=operational', '/admin/hub?branch=administrative', '/admin/hub-live?view=execute&sim=1', '/admin/hub-live?view=queue&tab=to_prepare&sim=1'];
const LABELS = /Constituer|Pr[ée]parer|Valider l.engagement|Autoriser|R[ée]ceptionner|Soumettre|Enregistrer l.envoi|Confirmation fournisseur/i;
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('sonde DOM Hub central (lecture seule)', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'admin-desktop', 'une seule fois via le projet admin');
  test.skip(!String(process.env.E2E_CHROMIUM_SPEC_FILTER || '').includes('hub-central-ui-probe'), 'opt-in');
  expect(new URL(process.env.E2E_STAGING_BASE_URL || ORIGIN).origin).toBe(ORIGIN);
  const sha = String((await (await request.get(ORIGIN + '/health/version')).json()).commit || '');
  const out = { schema: 'hub-central-ui-probe/1', sha, identities: {}, blocked_writes: 0 };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const save = () => fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
  try {
    for (const [name, prefix] of [['hub_director', 'E2E_HUB_DIRECTOR_'], ['agent_hub', 'E2E_AGENT_HUB_']]) {
      const email = process.env[prefix + 'EMAIL']; const password = process.env[prefix + 'PASSWORD'];
      expect(Boolean(email && password)).toBe(true);
      const ctx = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const apiErrors = [];
      await page.route('**/*', (route) => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin !== ORIGIN || ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || (req.method() === 'POST' && url.pathname === '/api/auth/login')) return route.continue();
        out.blocked_writes++; return route.abort('blockedbyclient');
      });
      page.on('response', async (r) => {
        const u = new URL(r.url());
        if (u.origin === ORIGIN && u.pathname.startsWith('/api/') && r.status() >= 400 && u.pathname !== '/api/auth/login') {
          const j = await r.json().catch(() => ({}));
          apiErrors.push({ method: r.request().method(), path: u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id'), status: r.status(), code: j.code || null, message: String(j.error || '').slice(0, 90) });
        }
      });
      const rec = { pages: [] }; out.identities[name] = rec;
      try {
        await page.goto('/login.html?next=' + encodeURIComponent('/admin/hub'), { waitUntil: 'domcontentloaded' });
        await page.locator('#email').fill(email); await page.locator('#password').fill(password);
        const lr = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
        await page.locator('#btn-submit').click();
        expect((await lr).status()).toBe(200);
        await page.waitForURL((u) => u.pathname !== '/login.html', { timeout: 20000 });
        rec.role = (await (await page.request.get('/api/auth/me')).json()).role;
        for (const p of PAGES) {
          apiErrors.length = 0;
          const resp = await page.goto(p, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(6000);
          const entry = { page: p, http: resp && resp.status(), final_path: new URL(page.url()).pathname };
          const sel = page.locator('select').first();
          if (/hub-live/.test(p) && await sel.count()) {
            entry.market_options = await sel.locator('option').allTextContents();
            const km = entry.market_options.find((t) => t.trim().startsWith('KM'));
            if (km) { await sel.selectOption({ label: km }); await page.waitForTimeout(5000); }
            const supply = page.locator('[data-workspace-view="supply"]');
            if (await supply.count()) { await supply.click(); await page.waitForTimeout(4000); }
          }
          Object.assign(entry, await page.evaluate((labelSrc) => {
            const uniq = (a) => [...new Set(a)].sort();
            const re = new RegExp(labelSrc, 'i');
            return {
              h1: [...document.querySelectorAll('h1')].map((x) => x.textContent.trim()).slice(0, 3),
              active_branch: (document.querySelector('[data-hub-active-branch]') || {}).dataset ? document.querySelector('[data-hub-active-branch]').dataset.hubActiveBranch : null,
              workspace_views: [...document.querySelectorAll('[data-workspace-view]')].map((x) => x.textContent.trim()),
              cockpit: document.querySelectorAll('[data-hub-cockpit]').length,
              needs: document.querySelectorAll('[data-hlc-need]').length, pos: document.querySelectorAll('[data-hlc-po]').length,
              orders: document.querySelectorAll('[data-hlc-order]').length,
              action_keys: uniq([...document.querySelectorAll('[data-hlc-action],[data-workspace-action],[data-hub-action]')].map((x) => x.getAttribute('data-hlc-action') || x.getAttribute('data-workspace-action') || x.getAttribute('data-hub-action'))),
              matching_buttons: uniq([...document.querySelectorAll('button,a,[role="button"]')].map((x) => (x.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)).filter((t) => re.test(t))),
              body_hint: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
            };
          }, LABELS.source));
          entry.api_errors = apiErrors.slice(0, 8);
          rec.pages.push(entry);
        }
      } finally { await ctx.close(); save(); }
    }
    expect(out.blocked_writes).toBe(0);
  } finally { save(); console.log('[hub-central-ui-probe] ' + JSON.stringify(out).slice(0, 4000)); }
});
