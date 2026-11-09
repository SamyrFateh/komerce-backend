/**
 * @komerce-arch-lite
 * @role live-staging-hub-relais-order360-readonly-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Observer Hub Live, Relais Live et Commande 360 pour les quatre commandes certifiées, en lecture seule.
 * @impact-areas dashboard, staging-only
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const ROOT = path.resolve('test-results/staging-chromium/live-proof');
// Jamais de références historiques implicites après une purge staging.
const REFS = String(process.env.E2E_PROOF_ORDER_REFS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const ROLES = {
  admin: ['/admin/hub-live', '/admin/hub-live?view=execute', '/admin/relais-live', '/admin/relais-live?view=orders&list=all'],
  agent_hub: ['/admin/hub', '/admin/hub-live', '/admin/hub-live?view=execute'],
  agent_relais: ['/admin/relais-live', '/admin/relais-live?view=orders&list=all'],
};

test('live screens read-only proof for certified orders', async ({ page }, info) => {
  // La purge staging a retiré les anciens objets E2E-HUB-V1. Sans références
  // explicitement fournies et corrélées au run de recette courant, ce test
  // est NOT_PROVEN : un skip explicite, jamais une preuve d'ordre certifié.
  test.skip(!REFS.length, 'NOT_PROVEN: aucune commande certifiée fournie pour ce staging');
  test.skip(process.env.E2E_AUDIT_QUICK === '1', 'QUICK_READONLY : aucune preuve transactionnelle');
  const role = info.project.name.replace(/-desktop$/, '');
  test.skip(!ROLES[role], 'Only admin, agent_hub and agent_relais are proven here');
  expect(new URL(process.env.E2E_STAGING_BASE_URL || ORIGIN).origin).toBe(ORIGIN);
  fs.mkdirSync(ROOT, { recursive: true });
  const out = { target: ORIGIN, label: 'staging', role, viewport: '1440x900', refs: REFS,
    version: null, screens: [], orders: [], blockedWrites: [], jsErrors: [], apiErrors: [] };
  const save = () => fs.writeFileSync(path.join(ROOT, role + '.json'), JSON.stringify(out, null, 2));
  try {
    await page.route('**/*', route => {
      const r = route.request(), u = new URL(r.url());
      if (u.origin !== ORIGIN || ['GET', 'HEAD', 'OPTIONS'].includes(r.method())
        || (r.method() === 'POST' && u.pathname === '/api/auth/login')) return route.continue();
      out.blockedWrites.push(r.method() + ' ' + u.pathname);
      return route.abort('blockedbyclient');
    });
    page.on('pageerror', e => out.jsErrors.push({ at: new URL(page.url()).pathname, message: String(e.message).slice(0, 160) }));
    page.on('response', r => {
      const u = new URL(r.url());
      if (u.origin === ORIGIN && u.pathname.startsWith('/api/') && r.status() >= 400) {
        out.apiErrors.push({ at: new URL(page.url()).pathname, api: u.pathname, status: r.status() });
      }
    });
    const v = await (await page.request.get('/health/version')).json();
    out.version = v.commit || v.sha || null;
    const prefix = 'E2E_' + role.toUpperCase() + '_';
    const email = process.env[prefix + 'EMAIL'], password = process.env[prefix + 'PASSWORD'];
    expect(email && password).toBeTruthy();
    await page.goto('/login.html?next=' + encodeURIComponent(ROLES[role][0]), { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const login = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
    await page.locator('#btn-submit').click();
    expect((await login).status()).toBe(200);
    await page.waitForURL(u => u.pathname !== '/login.html', { timeout: 15000 });

    const observe = async (target, file) => {
      const resp = await page.goto(ORIGIN + target, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const text = await page.locator('body').innerText();
      const found = {};
      for (const ref of REFS) {
        const i = text.indexOf(ref);
        found[ref] = i < 0 ? null : text.slice(Math.max(0, i - 60), i + ref.length + 140).replace(/\s+/g, ' ');
      }
      const shot = `staging-${role}-${file}.png`;
      await page.screenshot({ path: path.join(ROOT, shot), fullPage: true, timeout: 15000 }).catch(() => {});
      return { target, actual: new URL(page.url()).pathname + new URL(page.url()).search,
        http: resp && resp.status(), textLength: text.length, capture: shot, found };
    };
    let n = 0;
    for (const target of ROLES[role]) { out.screens.push(await observe(target, 'screen-' + (++n))); save(); }
    // Recette activée (admin uniquement) : « Afficher la recette » via ?sim=1 → include_simulation=1.
    out.simulationProof = [];
    if (role === 'admin') {
      const shotText = async (t, f) => {
        const o = await observe(t, f);
        const text = await page.locator('body').innerText();
        o.badges = await page.locator('.lk-sim-badge').count();
        o.toggle = await page.locator('[data-sim-toggle]').getAttribute('aria-checked').catch(() => null);
        o.actifs = (text.match(/(\d+)\s+colis actifs/) || [])[1] || null;
        return o;
      };
      const hubOff = await shotText('/admin/hub-live?view=queue&tab=to_prepare', 'sim-hub-off');
      const hubOn = await shotText('/admin/hub-live?view=queue&tab=to_prepare&sim=1', 'sim-hub-on');
      const relOff = await shotText('/admin/relais-live?view=orders&list=all', 'sim-relais-off');
      const relOn = await shotText('/admin/relais-live?view=orders&list=all&sim=1', 'sim-relais-on');
      const kpiOff = await shotText('/admin/relais-live', 'sim-relais-kpi-off');
      const kpiOn = await shotText('/admin/relais-live?sim=1', 'sim-relais-kpi-on');
      out.simulationProof.push({ hubOff, hubOn, relOff, relOn, kpiOff, kpiOn });
      save();
      for (const o of [hubOff, relOff]) {
        expect(o.toggle, 'filtre désactivé par défaut').toBe('false');
        expect(o.badges).toBe(0);
        for (const ref of REFS) expect(o.found[ref], `${ref} absent sans le filtre`).toBeNull();
      }
      for (const o of [hubOn, relOn]) { expect(o.toggle).toBe('true'); expect(o.badges).toBeGreaterThan(0); }
      // Relais Live : les commandes retirées (KOM-101, KOM-102, LOCAL) ; Hub Live : KOM-103 (reliquat) ;
      // LOCAL n'a jamais de tâche Hub.
      for (const suffix of ['KOM-101', 'KOM-102', 'LOCAL']) {
        const ref = REFS.find((r) => r.endsWith(suffix));
        expect(relOn.found[ref], `${ref} dans Relais Live (recette)`).not.toBeNull();
        expect(relOn.found[ref]).toContain('RECETTE');
      }
      const kom103 = REFS.find((r) => r.endsWith('KOM-103'));
      expect(hubOn.found[kom103], `${kom103} dans Hub Live (recette)`).not.toBeNull();
      expect(hubOn.found[kom103]).toContain('RECETTE');
      expect(hubOn.found[REFS.find((r) => r.endsWith('LOCAL'))], 'LOCAL sans tâche Hub').toBeNull();
      // Compteurs réels inchangés par le filtre.
      expect(kpiOn.actifs).toBe(kpiOff.actifs);
    }
    for (const ref of REFS) {
      const o = await observe('/admin/orders/' + encodeURIComponent(ref), 'order360-' + ref);
      out.orders.push({ ref, ...o, refVisible: Boolean(o.found[ref]) }); save();
    }
    save();
    expect(out.blockedWrites).toEqual([]);
    expect(out.jsErrors).toEqual([]);
  } finally { save(); }
});
