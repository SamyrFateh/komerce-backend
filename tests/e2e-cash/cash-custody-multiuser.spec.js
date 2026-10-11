'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires postgres
 */

/**
 * Recette cash multi-utilisateurs : 100 000 encaissés → 60 000 transférés puis clôturés
 * + 40 000 toujours en garde, avec un navigateur indépendant par acteur, le vrai dashboard
 * Finance et la vraie authentification (aucune API simulée, aucun JWT forgé). Voir support.js.
 *
 *   E2E_BASE_URL=http://localhost:3911 E2E_ADMIN_PASSWORD=… DATABASE_URL=… npm run test:e2e:cash
 */

const fs = require('fs');
const path = require('path');
const { test, expect, request: pwRequest } = require('@playwright/test');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { createMarketDelegationFixture, READ_ONLY_CAPABILITIES } = require('../helpers/marketDelegationE2EKit');
const { projectAssignment, LEGACY_VIEWER_CAPABILITIES } = require('../../services/market-scope-projector');
const { PREFIX, PASSWORD, rnd, target, api, login } = require('./support');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'cash-e2e');
const report = { target: null, started_at: new Date().toISOString(), steps: [], refusals: [], fixtures: {} };
const digits = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f.,]?');
const asRegex = (label, n) => new RegExp(`${label}[\\s\\S]{0,40}?${digits(n)}`);
const q = (sql, p) => db.query(sql, p);

let fx; let base; let admin; const who = {}; const sessions = {}; const ids = {};
const MARKET = () => fx.marketA.code;

async function seed() {
  fx = await createMarketDelegationFixture(db);
  const tag = rnd();
  const { rows: [relais] } = await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2690000000','Adresse recette',$2) RETURNING id`, [`${PREFIX} Relais ${tag}`, fx.marketA.id]);
  ids.relais = relais.id;
  const { rows: [agent] } = await q(
    `INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,'agent_relais',$4) RETURNING id, email`,
    [`${PREFIX} Agent ${tag}`, `${PREFIX}.agent.${tag}@e2e-cash.test`.toLowerCase(), `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`, relais.id]);
  const { rows: [controller] } = await q(
    `INSERT INTO users(full_name,email,phone,role) VALUES ($1,$2,$3,'client') RETURNING id, email`,
    [`${PREFIX} Controleur ${tag}`, `${PREFIX}.controleur.${tag}@e2e-cash.test`.toLowerCase(), `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
  const { rows: [member] } = await q(
    `INSERT INTO assignment_memberships(assignment_id,user_id,status,granted_by) VALUES ($1,$2,'ACTIVE',$3) RETURNING id`,
    [fx.assignmentA.id, controller.id, fx.central.id]);
  // Socle de lecture du Market (sans lequel le dashboard refuse tout contexte) + capacités propres à chaque rôle.
  const baseline = [...new Set([...READ_ONLY_CAPABILITIES, ...LEGACY_VIEWER_CAPABILITIES])].filter(c => fx.liveCapabilities.includes(c));
  for (const capability of [...new Set([...baseline, 'finance.act', 'cash_control.policy.manage', 'cash.custody.receive'])]) {
    await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,$2,$3)`, [member.id, capability, fx.central.id]);
  }
  const { rows: [agentMember] } = await q(
    `INSERT INTO assignment_memberships(assignment_id,user_id,status,granted_by) VALUES ($1,$2,'ACTIVE',$3) RETURNING id`,
    [fx.assignmentA.id, agent.id, fx.central.id]);
  for (const capability of baseline) {
    await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,$2,$3)`, [agentMember.id, capability, fx.central.id]);
  }
  await projectAssignment(db, fx.assignmentA.id);
  // Plafond de garde de la personne qui réceptionne la preuve : volontairement bas (refus de dépassement).
  await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by,limit_amount) VALUES ($1,'cash.custody.receive',$2,25000)`, [fx.viewerAMembership.id, fx.central.id]);
  const { rows: [order] } = await q(
    `INSERT INTO orders(reference,relais_id,total_kmf,payment_mode,market_id,status) VALUES ($1,$2,100000,'cash_relais',$3,'collected') RETURNING id`,
    [`${PREFIX}-${tag}`, relais.id, fx.marketA.id]);
  await q(`INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,100000,$2,$3,NOW()-INTERVAL '2 days')`, [order.id, agent.id, relais.id]);
  who.agent = { id: agent.id, email: agent.email, role: 'agent_relais', name: `${PREFIX} Agent ${tag}` };
  who.collector = { id: fx.managerA.id, email: fx.managerA.email, scope: 'manager' };
  who.receiver = { id: fx.viewerA.id, email: fx.viewerA.email, scope: 'viewer' };
  who.controller = { id: controller.id, email: controller.email, scope: 'viewer' };
  who.wrongMarket = { id: fx.managerB.id, email: fx.managerB.email, scope: 'manager', market: fx.marketB.code };
  who.stranger = { id: fx.outsider.id, email: fx.outsider.email };
  // Les emails de la fixture contiennent des espaces (invalides pour le login) : identifiants propres et reconnaissables.
  for (const [key, u] of Object.entries(who)) {
    if (!u.email.includes('e2e-cash.test')) {
      u.email = `${PREFIX}.${key}.${tag}@e2e-cash.test`.toLowerCase();
      await q('UPDATE users SET email = $2 WHERE id = $1', [u.id, u.email]);
    }
  }
  report.fixtures = { market: fx.marketA.code, order_ref: `${PREFIX}-${tag}`, users: Object.fromEntries(Object.entries(who).map(([k, v]) => [k, v.email])) };
}

async function provision() {
  // Les comptes de fixture naissent sans mot de passe ; la route admin de réinitialisation exige un hash existant
  // (compare(null) → 500 : défaut constaté, hors périmètre). Hash jetable aléatoire, remplacé aussitôt par la route officielle.
  const throwaway = bcrypt.hashSync(rnd() + rnd(), 4);
  await q('UPDATE users SET password_hash = $2 WHERE id = ANY($1::uuid[])', [Object.values(who).map(u => u.id), throwaway]);
  // Mots de passe et rôles par les routes admin officielles ; destination finale par la route de garde officielle.
  for (const [key, u] of Object.entries(who)) {
    const pw = await api(admin, 'PUT', `/api/admin/users/${u.id}/password`, { password: PASSWORD });
    if (pw.status !== 200) throw new Error(`password ${key} → ${pw.status} ${JSON.stringify(pw.json)}`);
    if (u.scope) {
      const role = await api(admin, 'PUT', `/api/admin/users/${u.id}/role`, { role: 'market_operator', market_scope: { market_code: u.market || MARKET(), scope_role: u.scope } });
      if (role.status !== 200) throw new Error(`role ${key} → ${role.status} ${JSON.stringify(role.json)}`);
    }
  }
}

async function open(browser, key) {
  const context = await browser.newContext({ baseURL: base });
  await login(context.request, who[key].email, PASSWORD);
  const page = await context.newPage();
  sessions[key] = { context, page };
  return page;
}

function dialogs(page, answers) {
  page.removeAllListeners('dialog');
  page.on('dialog', async dialog => {
    if (process.env.E2E_CASH_DEBUG) console.log(`[dialog ${dialog.type()}]`, dialog.message().split('\n')[0]);
    if (dialog.type() === 'confirm') return dialog.accept();
    const next = answers.shift();
    const value = typeof next === 'function' ? next(dialog.message()) : next;
    return value == null ? dialog.dismiss() : dialog.accept(String(value));
  });
}
const pick = needle => message => {
  const line = message.split('\n').find(l => l.includes(needle));
  if (!line) throw new Error(`option introuvable « ${needle} » dans : ${message}`);
  return line.split('.')[0];
};

async function goto(key) {
  const { page } = sessions[key];
  await page.goto(`/admin/workspaces/accounting?market=${MARKET()}`);
  await expect(page.getByText('Rapprochement cash').first()).toBeVisible({ timeout: 15000 });
  return page;
}
async function shot(key, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await sessions[key].page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
const step = (name, detail = {}) => report.steps.push({ name, ok: true, ...detail });
async function declareViaUi(key, targetNeedle, currency, amount) {
  const page = sessions[key].page;
  dialogs(page, [pick(targetNeedle), currency, String(amount), '', '']);
  const created = page.waitForResponse(r => /\/deposits$/.test(r.url()) && r.request().method() === 'POST');
  await page.locator('[data-workspace-action="create-cash-deposit"]').click();
  const res = await created;
  expect(res.status()).toBe(201);
  const ref = JSON.stringify(await res.json()).match(/KDP-\d+/)[0];
  return ref;
}
const rowOf = (page, ref) => page.locator('tr', { hasText: ref }).first();
async function act(key, ref, action, answers, urlPart) {
  const page = sessions[key].page;
  dialogs(page, answers);
  const done = page.waitForResponse(r => r.url().includes(urlPart) && r.request().method() === 'POST');
  await rowOf(page, ref).locator(`[data-workspace-action="${action}"]`).click();
  return done;
}
const refused = async (name, response, code) => {
  // Accepte une Response Playwright (action UI) ou {status, json} (appel API d'une session réelle).
  const isResponse = typeof response.status === 'function';
  const status = isResponse ? response.status() : response.status;
  const body = isResponse ? await response.json().catch(() => ({})) : (response.json || {});
  expect([403, 409, 422], `${name}: ${status} ${JSON.stringify(body)}`).toContain(status);
  if (code) expect(body.code, name).toBe(code);
  report.refusals.push({ name, status, code: body.code || null });
};
const num = text => Number(String(text).replace(/[^\d-]/g, '')) || 0;
async function recon(page) {
  const table = page.locator('table', { hasText: 'DÉTENU MAINTENANT' }).first();
  const heads = (await table.locator('th').allInnerTexts()).map(t => t.trim().toUpperCase());
  const cells = await table.locator('tbody tr').first().locator('td').allInnerTexts();
  const at = label => num(cells[heads.findIndex(h => h.startsWith(label))]);
  return { collected: at('COLLECTÉ'), transferred: at('TRANSFÉRÉ'), closed: at('CLÔTURÉ'), lost: at('PERTE'), held: at('DÉTENU') };
}
const post = (key, urlPath, data) => api(sessions[key].context.request, 'POST', urlPath, data);
const marketApi = suffix => `/api/admin/workspaces/accounting/market/${MARKET()}/${suffix}`;

test.describe.serial('Chaîne de garde cash — acteurs réels', () => {
  test.beforeAll(async () => {
    const t = target();
    base = t.base; report.target = t.host;
    if (!process.env.E2E_ADMIN_PASSWORD) throw new Error('E2E_ADMIN_PASSWORD requis (compte admin de test, jamais journalisé)');
    await seed();
    admin = await pwRequest.newContext({ baseURL: base });
    await login(admin, process.env.E2E_ADMIN_EMAIL || 'admin@komerce.km', process.env.E2E_ADMIN_PASSWORD);
    await provision();
  });

  test.afterAll(async () => {
    for (const s of Object.values(sessions)) await s.context.close().catch(() => {});
    await admin?.dispose();
    report.finished_at = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const md = ['# Recette cash multi-utilisateurs', '', `Cible : ${report.target} — Market ${report.fixtures.market}`, '',
      '## Étapes', ...report.steps.map(s => `- ✅ ${s.name}${s.detail ? ` — ${s.detail}` : ''}`), '',
      '## Refus vérifiés', ...report.refusals.map(r => `- ✅ ${r.name} → ${r.status}${r.code ? ` (${r.code})` : ''}`), '',
      '## Fixtures (identifiables, faits financiers conservés)', '```json', JSON.stringify(report.fixtures, null, 2), '```'];
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
    await db.end?.();
  });

  test('0 · navigateurs indépendants et destination finale (proposée puis activée par deux personnes distinctes)', async ({ browser }) => {
    for (const key of ['agent', 'collector', 'receiver', 'controller', 'wrongMarket', 'stranger']) await open(browser, key);
    const custodyApi = suffix => `/api/market-delegation/markets/${MARKET()}/cash-custody/${suffix}`;
    const proposed = await api(sessions.collector.context.request, 'POST', custodyApi('destinations'),
      { kind: 'BANK', label: `${PREFIX} Banque`, currency: 'XAF', account_ref: `IBAN-${PREFIX}-${rnd()}` });
    expect(proposed.status, JSON.stringify(proposed.json)).toBe(201);
    const activated = await api(sessions.controller.context.request, 'POST', custodyApi(`destinations/${proposed.json.destination.id}/activate`), {});
    expect(activated.status, JSON.stringify(activated.json)).toBe(200);
    step('6 navigateurs indépendants, vraies sessions ; destination finale proposée par le collecteur, activée par le contrôleur');
  });

  test('1 · l’agent voit 100 000 en garde et annonce 60 000 au collecteur (aucun solde ne bouge)', async () => {
    const page = await goto('agent');
    await expect(page.locator('body')).toContainText('100 000');
    ids.t1 = await declareViaUi('agent', 'Manager A', 'KMF', 60000);
    await goto('agent');
    await expect(rowOf(page, ids.t1)).toContainText('Annoncée');
    expect(await recon(page)).toMatchObject({ collected: 100000, held: 100000, closed: 0 });
    await shot('agent', '1-agent-annonce');
    step('Agent : 100 000 encaissés, 60 000 annoncés, détenu inchangé', { detail: ids.t1 });
  });

  test('2 · le collecteur accepte 60 000 : la responsabilité lui est transférée, rien n’est clôturé', async () => {
    const page = await goto('collector');
    await expect(rowOf(page, ids.t1)).toContainText('Annoncée');
    const res = await act('collector', ids.t1, 'record-custody-receipt', ['60000', ''], `/custody/${ids.t1}/receipt`);
    expect(res.status()).toBeLessThan(300);
    await goto('collector');
    await expect(rowOf(page, ids.t1)).toContainText('Acceptée (intermédiaire');
    expect(await recon(page)).toMatchObject({ transferred: 60000, closed: 0, held: 100000 });
    await shot('collector', '2-collecteur-accepte');
    step('Collecteur : 60 000 acceptés (intermédiaire), détenu total inchangé, clôturé 0');
  });

  test('3 · le collecteur remet 60 000 KMF (80 000 XAF) à la destination finale', async () => {
    const page = sessions.collector.page;
    ids.t2 = await declareViaUi('collector', `${PREFIX} Banque`, 'XAF', 80000);
    await goto('collector');
    await expect(rowOf(page, ids.t2)).toContainText('Preuve de réception finale manquante');
    step('Remise finale annoncée : preuve manquante, rien de clôturé', { detail: ids.t2 });
  });

  test('4 · la preuve de réception finale est saisie par une autre personne que le remettant', async () => {
    const page = await goto('receiver');
    const res = await act('receiver', ids.t2, 'record-custody-receipt', ['80000', `BORD-${PREFIX}-1`], `/custody/${ids.t2}/receipt`);
    expect(res.status()).toBeLessThan(300);
    await goto('receiver');
    await expect(rowOf(page, ids.t2)).toContainText('contrôle indépendant à faire');
    expect(await recon(page)).toMatchObject({ closed: 0 });
    await shot('receiver', '4-preuve-finale');
    step('Preuve finale reçue : « contrôle indépendant à faire », toujours rien de clôturé');
  });

  test('5 · un contrôleur indépendant clôture : 60 000 clôturés, 40 000 toujours en garde', async () => {
    const page = await goto('controller');
    const res = await act('controller', ids.t2, 'control-final-reception', ['60000'], `/custody/${ids.t2}/control`);
    expect(res.status()).toBeLessThan(300);
    await goto('controller');
    await expect(rowOf(page, ids.t2)).toContainText('Clôturée');
    const r = await recon(page);
    expect(r).toMatchObject({ collected: 100000, closed: 60000, held: 40000, lost: 0 });
    await shot('controller', '5-controle-cloture');
    await goto('agent');
    expect(await recon(sessions.agent.page)).toMatchObject({ closed: 60000, held: 40000 });
    await expect(sessions.agent.page.locator('body')).toContainText(who.agent.name);
    step('Contrôle indépendant : clôturé 60 000, détenu 40 000 (même vérité chez l’agent et le contrôleur)', r);
  });

  test('6 · réception partielle : 10 000 annoncés, 8 000 reçus, écart de 2 000 reste chez l’agent', async () => {
    ids.t3 = await declareViaUi('agent', 'Manager A', 'KMF', 10000);
    await goto('collector');
    const res = await act('collector', ids.t3, 'record-custody-receipt', ['8000', ''], `/custody/${ids.t3}/receipt`);
    expect(res.status()).toBeLessThan(300);
    await goto('collector');
    await expect(rowOf(sessions.collector.page, ids.t3)).toContainText('partiellement');
    expect(await recon(sessions.collector.page)).toMatchObject({ closed: 60000, held: 40000 });
    step('Réception partielle : écart ouvert de 2 000 conservé, total détenu inchangé', { detail: ids.t3 });
  });

  test('7 · refus : plafond dépassé, auto-validation, personne non habilitée, mauvais Market', async () => {
    // Plafond (25 000) de la personne destinataire.
    ids.t4 = await declareViaUi('agent', 'Viewer A', 'KMF', 30000);
    await goto('receiver');
    const over = await act('receiver', ids.t4, 'record-custody-receipt', ['30000', ''], `/custody/${ids.t4}/receipt`);
    await refused('plafond de garde du destinataire dépassé', over, 'custody_holding_ceiling_exceeded');

    // Auto-validation : le remettant ne reçoit pas sa propre remise ni ne prouve sa propre remise finale.
    await refused('le remettant ne peut pas recevoir sa propre remise', await post('agent', marketApi(`custody/${ids.t1}/receipt`), { outcome: 'received', received_amount: 1 }));
    const f2 = await post('agent', marketApi('deposits'), { destination_id: (await q('SELECT id FROM market_cash_destinations WHERE market_id=$1 AND label=$2', [fx.marketA.id, `${PREFIX} Banque`])).rows[0].id, declared_amount: 1000, declared_currency: 'XAF' });
    expect(f2.status, JSON.stringify(f2.json)).toBe(201);
    ids.t5 = JSON.stringify(f2.json).match(/KDP-\d+/)[0];
    await refused('le remettant ne peut pas prouver sa propre remise finale', await post('agent', marketApi(`custody/${ids.t5}/receipt`), { outcome: 'received', received_amount: 1000, proof_ref: 'x' }));
    expect((await post('controller', marketApi(`custody/${ids.t5}/receipt`), { outcome: 'received', received_amount: 1000, proof_ref: `BORD-${PREFIX}-2` })).status).toBeLessThan(300);
    await refused('celui qui a prouvé ne peut pas aussi contrôler', await post('controller', marketApi(`custody/${ids.t5}/control`), {}));

    // Personne non habilitée / mauvais Market.
    const stranger = await post('agent', marketApi('deposits'), { recipient_user_id: who.stranger.id, declared_amount: 100, declared_currency: 'KMF' });
    await refused('destinataire non habilité du Market', stranger, 'custody_recipient_not_authorized');
    await refused('utilisateur sans habilitation : lecture du workspace interdite', await api(sessions.stranger.context.request, 'GET', marketApi('').replace(/\/$/, '')));
    await refused('mauvais Market : lecture interdite', await api(sessions.wrongMarket.context.request, 'GET', marketApi('').replace(/\/$/, '')));
    await refused('mauvais Market : réception interdite', await post('wrongMarket', marketApi(`custody/${ids.t1}/receipt`), { outcome: 'received', received_amount: 1 }));
    step(`${report.refusals.length} refus vérifiés avec le code métier attendu`);
  });

  test('8 · bilan final identique pour tous les acteurs', async () => {
    const seen = {};
    for (const key of ['agent', 'collector', 'receiver', 'controller']) {
      const page = await goto(key);
      seen[key] = await recon(page);
      expect(seen[key]).toMatchObject({ collected: 100000, closed: 60000, held: 40000, lost: 0 });
    }
    await shot('controller', '8-bilan-final');
    step('Bilan : encaissé 100 000 = clôturé 60 000 + détenu 40 000 + perdu 0, identique pour les 4 acteurs', seen.agent);
  });
});
