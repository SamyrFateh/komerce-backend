/**
 * @komerce-arch-lite
 * @role hub-v1-business-film
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose BROUILLON (non validé sur staging) — film métier Hub V1 : vraies interactions UI (Chromium 1440x900) sur une fixture E2E-HUB-V1, un chapitre = une vidéo + une entrée de timeline avec requête canonique et readback serveur.
 * @impact-areas dashboard, hub, purchasing, staging-only, authorization
 */
'use strict';
/*
 * ÉTAT : brouillon. Répétition locale : login, filmage post-login, chiffrement, garde-fous réseau et sélection de marché
 * OK ; l'entrée du cockpit PO pour agent_hub passe aujourd'hui par un workspace marché qui exige une membership
 * (MARKET_MEMBERSHIP_REQUIRED) alors que le Hub central est global (/admin/hub) : le chemin UI central des chapitres 1-4
 * reste À CONFIRMER sur staging par une sonde DOM en lecture seule avant tout film. Aucun chapitre n'est donc PASS ici.
 *
 * Règles : login jamais filmé (contexte jetable puis storageState en mémoire) ; aucune API mockée ; aucun clic synthétique
 * (locator.click uniquement) ; seules les écritures de la liste blanche passent, tout le reste est bloqué et compté ;
 * un chapitre non implémenté ou non exécuté est NOT_PROVEN, jamais PASS ; les titres ajoutés sont des légendes
 * d'overlay, pas du montage. Sorties : WebM chiffré (défaut) ou WebM privé en clair si E2E_FILM_ALLOW_PLAIN=1.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { encryptFile } = require('../../scripts/recette/chromium-video-crypto');

const STAGING = 'https://komerce-backend-production.up.railway.app';
const REHEARSAL = process.env.E2E_FILM_REHEARSAL === '1';
const BASE = process.env.E2E_STAGING_BASE_URL || STAGING;
const RUN8 = String(process.env.E2E_PROOF_RUN8 || '').toUpperCase();
const MARKET = String(process.env.E2E_FILM_MARKET || 'KM').toUpperCase();
const PACE = Number(process.env.E2E_FILM_PACE || 1);
const ALLOW_PLAIN = process.env.E2E_FILM_ALLOW_PLAIN === '1';
const ROOT = path.resolve('test-results/hub-v1-film');
const PRIVATE = path.join(ROOT, 'private');
const OUTPUT = path.join(ROOT, 'out');
const WRITE_ALLOW = [/^\/api\/purchasing\/po\/[0-9a-f-]+\/(authorize-commitment|authorize-payment|submit|sent|confirm)$/i, /^\/api\/purchasing\/po\/prepare$/];
const ROLE_ENV = { agent_hub: 'E2E_AGENT_HUB_', hub_director: 'E2E_HUB_DIRECTOR_' };

test.use({ video: 'off', trace: 'off', screenshot: 'off' });

const hold = (page, ms) => page.waitForTimeout(Math.round(ms * PACE));
async function caption(page, title, sub) {
  await page.evaluate(([t, s]) => {
    let el = document.getElementById('kmc-film-caption');
    if (!el) { el = document.createElement('div'); el.id = 'kmc-film-caption'; el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:10px 20px;background:#0b2b4a;color:#fff;font:600 18px system-ui;pointer-events:none'; document.body.appendChild(el); }
    el.textContent = s ? `${t} — ${s}` : t;
  }, [title, sub || '']);
}

test('Hub V1 film métier — chapitres PO (vrais clics UI)', async ({ browser, request }) => {
  test.skip(process.env.E2E_CHROMIUM_SPEC_FILTER !== 'hub-v1-business-film', 'opt-in explicite uniquement');
  expect(new URL(BASE).origin === STAGING || (REHEARSAL && /^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE))).toBe(true);
  expect(RUN8).toMatch(/^[A-F0-9]{8}$/);
  const expected = String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
  if (!REHEARSAL) expect(expected).toMatch(/^[a-f0-9]{40}$/i);
  const v = await request.get(BASE + '/health/version');
  expect(v.status()).toBe(200);
  const sha = String((await v.json()).commit || '');
  if (!REHEARSAL) expect(sha).toBe(expected);
  fs.mkdirSync(PRIVATE, { recursive: true }); fs.mkdirSync(OUTPUT, { recursive: true });

  const timeline = { schema: 'komerce-business-film/1', sha, run8: RUN8, market: MARKET, viewport: '1440x900', pace: PACE,
    video_mode: ALLOW_PLAIN ? 'PLAIN_PRIVATE' : 'ENCRYPTED', chapters: [], blocked_writes: [], blocked_external: 0, browser_errors: 0,
    never_claims: 'Les chapitres non listés PASS sont NOT_PROVEN ; une vidéo ne prouve pas le circuit local ni les autres marchés.' };
  const save = () => fs.writeFileSync(path.join(OUTPUT, 'film-timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
  const shared = { po: null, dialogs: [] };

  // Session d'un rôle : login hors enregistrement, puis contexte neuf filmé.
  async function openSession(role, chapterKey) {
    const prefix = ROLE_ENV[role];
    const email = process.env[prefix + 'EMAIL']; const password = process.env[prefix + 'PASSWORD'];
    expect(email && password).toBeTruthy();
    const auth = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    let state;
    try {
      const lp = await auth.newPage();
      await lp.goto('/login.html?next=' + encodeURIComponent('/admin/hub-live?view=execute&sim=1'), { waitUntil: 'domcontentloaded' });
      await lp.locator('#email').fill(email); await lp.locator('#password').fill(password);
      const login = lp.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
      await lp.locator('#btn-submit').click();
      expect((await login).status()).toBe(200);
      await lp.waitForURL((u) => u.pathname !== '/login.html', { timeout: 20000 });
      state = await auth.storageState();
    } finally { await auth.close(); }
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, storageState: state, recordVideo: { dir: PRIVATE, size: { width: 1440, height: 900 } } });
    state = null;
    await ctx.route('**/*', (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin !== new URL(BASE).origin) { timeline.blocked_external++; return route.abort('blockedbyclient'); }
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.continue();
      if (WRITE_ALLOW.some((re) => re.test(url.pathname))) return route.continue();
      timeline.blocked_writes.push(`${req.method()} ${url.pathname}`); return route.abort('blockedbyclient');
    });
    await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await ctx.newPage();
    page.on('pageerror', () => timeline.browser_errors++);
    page.on('dialog', async (d) => { shared.dialogs.push(d.message().slice(0, 160)); await hold(page, 1800); await d.accept(); });
    return { ctx, page, role, chapterKey };
  }
  async function closeSession(s) {
    const video = s.page.video();
    const traceFile = path.join(PRIVATE, s.chapterKey + '.trace.zip');
    await s.ctx.tracing.stop({ path: traceFile });
    await s.ctx.close();
    const vf = await video.path();
    const out = {};
    encryptFile(traceFile, path.join(OUTPUT, s.chapterKey + '.trace.zip.enc')); out.trace = s.chapterKey + '.trace.zip.enc';
    if (ALLOW_PLAIN) { fs.copyFileSync(vf, path.join(PRIVATE, s.chapterKey + '.webm')); out.video_plain_private = s.chapterKey + '.webm'; }
    encryptFile(vf, path.join(OUTPUT, s.chapterKey + '.webm.enc')); out.video = s.chapterKey + '.webm.enc';
    for (const f of [traceFile, vf]) { try { fs.rmSync(f); } catch (_) { /* déjà déplacé */ } }
    return out;
  }
  async function openCockpit(page) {
    await page.goto('/admin/hub-live?view=execute&sim=1', { waitUntil: 'domcontentloaded' });
    const sel = page.locator('select').first();
    await expect(sel.locator('option').nth(1)).toBeAttached({ timeout: 30000 });
    const label = await sel.locator('option').evaluateAll((os, code) => (os.find((o) => o.textContent.trim().startsWith(code + ' ·')) || {}).textContent, MARKET);
    if (label) await sel.selectOption({ label });
    await expect(page.locator('h1')).toHaveText('Hub live · Dossiers', { timeout: 30000 });
    await page.locator('[data-workspace-view="supply"]').click();
    await expect(page.locator('[data-hub-cockpit]')).toBeVisible();
  }
  const chapter = async (n, key, title, role, fn) => {
    const entry = { n, key, title, role, status: 'FAIL', actions: [], readback: null, dialogs: [] };
    timeline.chapters.push(entry);
    const s = await openSession(role, `${String(n).padStart(2, '0')}-${key}`);
    try {
      await openCockpit(s.page);
      await caption(s.page, `Chapitre ${n} — ${title}`, `${role} · ${MARKET} · ${RUN8}`);
      await hold(s.page, 3500);
      await fn(s.page, entry);
      entry.status = 'PASS';
    } catch (e) { entry.status = 'FAIL'; entry.error = String(e.message).slice(0, 300); throw e; }
    finally { entry.dialogs = shared.dialogs.splice(0); entry.files = await closeSession(s).catch((x) => ({ error: String(x.message).slice(0, 120) })); save(); }
  };
  // Clic réel + capture de la requête canonique + lecture du statut HTTP.
  async function clickAndCapture(page, entry, locator, matcher, label) {
    const wait = page.waitForResponse((r) => matcher.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 30000 });
    await locator.click();
    const res = await wait;
    const body = await res.json().catch(() => ({}));
    entry.actions.push({ label, method: 'POST', path: new URL(res.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id'), http: res.status() });
    expect(res.status()).toBeLessThan(300);
    await hold(page, 3500);
    return body;
  }
  async function readbackPo(page, entry, id) {
    const r = await page.request.get('/api/purchasing/po/' + encodeURIComponent(id));
    const j = r.ok() ? await r.json().catch(() => ({})) : {};
    const po = j.po || j;
    entry.readback = { http: r.status(), status: po.status || null, step: (po.step && po.step.key) || null, authorizations: po.authorizations ? Object.fromEntries(Object.entries(po.authorizations).map(([k, v]) => [k, Boolean(v)])) : null };
    expect(r.status()).toBe(200);
  }
  const poCard = (page) => page.locator(`[data-hlc-po="${shared.po}"]`);

  await chapter(1, 'prepare-po', 'Préparer l’achat : constituer le PO', 'agent_hub', async (page, entry) => {
    const need = page.locator('[data-hlc-need]').filter({ hasText: `E2E-HUB-V1-${RUN8}` }).first();
    await expect(need).toBeVisible(); await need.click(); await hold(page, 2500);
    const body = await clickAndCapture(page, entry, page.locator('[data-hlc-actions] [data-hlc-action="prepare-po"]').first(), /\/api\/purchasing\/po\/prepare$/, 'Constituer une PO');
    shared.po = body.po_id || body.purchase_order_id || (body.po && body.po.id) || body.id || (body.purchase_order && body.purchase_order.id) || null;
    expect(shared.po).toBeTruthy();
    await readbackPo(page, entry, shared.po);
  });
  await chapter(2, 'commitment', 'Autoriser l’engagement (responsable Hub)', 'hub_director', async (page, entry) => {
    await poCard(page).click(); await hold(page, 2000);
    await page.locator('[data-hlc-actions] [data-hlc-action="authorize-commitment"]').click();
    const form = page.locator('[data-hlc-form="commitment"]');
    await expect(form).toBeVisible();
    await form.locator('input[name="proof_ref"]').fill(`SIM-ENGAGEMENT-${RUN8}`);
    const amount = form.locator('input[name="amount"]'); if (await amount.count()) await amount.fill(String(process.env.E2E_FILM_PO_AMOUNT || '100'));
    const cur = form.locator('input[name="currency"]'); if (await cur.count()) await cur.fill(String(process.env.E2E_FILM_PO_CURRENCY || 'USD'));
    await hold(page, 2500);
    await clickAndCapture(page, entry, form.locator('[data-hlc-action="submit-commitment"]'), /\/authorize-commitment$/, 'Valider l’engagement');
    await readbackPo(page, entry, shared.po);
  });
  await chapter(3, 'submit-and-sent', 'Soumettre la PO puis enregistrer l’envoi simulé', 'agent_hub', async (page, entry) => {
    await poCard(page).click(); await hold(page, 2000);
    await clickAndCapture(page, entry, page.locator('[data-hlc-actions] [data-hlc-action="submit-po"]'), /\/submit$/, 'Soumettre la PO');
    await poCard(page).click();
    await page.locator('[data-hlc-actions] [data-hlc-action="record-sent"]').click();
    const form = page.locator('[data-hlc-form="sent"]'); await expect(form).toBeVisible();
    await hold(page, 2500);
    await clickAndCapture(page, entry, form.locator('[data-hlc-action="submit-sent"]'), /\/sent$/, 'Enregistrer l’envoi (simulé : aucun message fournisseur)');
    await readbackPo(page, entry, shared.po);
  });
  await chapter(4, 'payment-authorization', 'Autorisation distincte du paiement fournisseur (sans débit)', 'hub_director', async (page, entry) => {
    await poCard(page).click(); await hold(page, 2000);
    await page.locator('[data-hlc-actions] [data-hlc-action="authorize-payment"]').click();
    const form = page.locator('[data-hlc-form="payment"]'); await expect(form).toBeVisible();
    await form.locator('input[name="proof_ref"]').fill(`SIM-PAIEMENT-${RUN8}`);
    const amount = form.locator('input[name="amount"]'); if (await amount.count() && !(await amount.inputValue())) await amount.fill(String(process.env.E2E_FILM_PO_AMOUNT || '100'));
    const cur = form.locator('input[name="currency"]'); if (await cur.count() && !(await cur.inputValue())) await cur.fill(String(process.env.E2E_FILM_PO_CURRENCY || 'USD'));
    await hold(page, 2500);
    await clickAndCapture(page, entry, form.locator('[data-hlc-action="submit-payment"]'), /\/authorize-payment$/, 'Autoriser le paiement');
    await readbackPo(page, entry, shared.po);
  });

  // Chapitres NON couverts par ce spec : consignés NOT_PROVEN, jamais PASS.
  for (const [n, key, title] of [[5, 'receipt', 'Confirmation fournisseur et réception physique'], [6, 'identify-bags', 'Identification, scans et sacs clients'], [7, 'kom-box', 'KOM-BOX et rattachement'], [8, 'ship-handover', 'Expédition et remise au transitaire'], [9, 'relay-attestation', 'Réception attestée au relais'], [10, 'pickup', 'Retrait client et reliquat'], [11, 'local-circuit', 'Circuit local sans Hub']]) {
    timeline.chapters.push({ n, key, title, status: 'NOT_PROVEN', reason: 'chapitre UI non implémenté dans ce spec' });
  }
  save();
  expect(timeline.blocked_writes).toEqual([]);
  expect(timeline.browser_errors).toBe(0);
});
