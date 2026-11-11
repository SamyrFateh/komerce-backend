#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role claude-par-km-crossrelay-probe
 * @domain orders
 * @layer tooling
 * @purpose Sonde d'isolation inter-relais apres restauration de l'agent E2E (marqueur CLAUDE-PAR-20261111). Lecture DB + refus HTTP attendus.
 */
const fs = require('fs');
const db = require('../../db');
const BASE = 'https://komerce-backend-production.up.railway.app';
const P = 'test-results/claude-par-km-returns/evidence.json';
const OUT = 'test-results/claude-par-km-returns/crossrelay.json';
(async () => {
  const r = { schema: 'claude-par-km-crossrelay/1', rows: [] };
  try {
    const ev = JSON.parse(fs.readFileSync(P, 'utf8'));
    const orders = Object.values(ev.orders || {}).filter(o => o && o.dispute);
    if (!orders.length) throw new Error('aucun dossier a sonder (spec non aboutie)');
    const [a] = (await db.query("SELECT relais_id FROM users WHERE lower(email)=lower($1)", [process.env.E2E_AGENT_RELAIS_EMAIL])).rows;
    r.agent_relais_now = String(a.relais_id); r.fixture_relais = String(ev.fixture.relais_id);
    if (r.agent_relais_now === r.fixture_relais) throw new Error('agent toujours sur le relais fixture : sonde non pertinente');
    const lg = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.E2E_AGENT_RELAIS_EMAIL, password: process.env.E2E_AGENT_RELAIS_PASSWORD }) });
    if (lg.status !== 200) throw new Error('login ' + lg.status);
    const cookie = lg.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
    const call = async (m, p, body) => { const x = await fetch(BASE + p, { method: m, headers: { origin: BASE, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await x.json(); } catch (_) {} return { status: x.status, body: b }; };
    const cnt = async () => ({ receipts: (await db.query('SELECT count(*)::int n FROM relay_product_return_receipts')).rows[0].n,
      disputes: (await db.query("SELECT count(*)::int n FROM disputes WHERE type='product_return'")).rows[0].n });
    const before = await cnt();
    const list = await call('GET', '/api/relay/returns');
    const ids = new Set((list.body && list.body.requests || []).map(x => x.id));
    r.rows.push({ id: 'CL-7 liste SAV autre relais ne contient pas nos dossiers', verdict: orders.every(o => !ids.has(o.dispute)) ? 'PASS' : 'FAIL', http: list.status });
    for (const o of orders) {
      const el = await call('GET', '/api/relay/returns/eligible?reference=' + encodeURIComponent(o.reference));
      r.rows.push({ id: 'CL-7 eligibilite ' + o.reference + ' depuis autre relais', verdict: [403, 404].includes(el.status) ? 'PASS' : 'FAIL', http: el.status, code: el.body && el.body.code });
      const cr = await call('POST', '/api/relay/returns', { order_reference: o.reference, order_item_id: '00000000-0000-4000-8000-000000000000', quantity: 1, reason: 'defective' });
      r.rows.push({ id: 'CL-7 demande depuis autre relais ' + o.reference, verdict: [403, 404].includes(cr.status) ? 'PASS' : 'FAIL', http: cr.status, code: cr.body && cr.body.code });
      const it = await call('POST', '/api/relay/returns/intake', { request_id: o.dispute, condition_code: 'opened', observation: 'CLAUDE-PAR-20261111 tentative autre relais' });
      r.rows.push({ id: 'CL-7 reprise depuis autre relais ' + o.reference, verdict: [403, 404].includes(it.status) ? 'PASS' : 'FAIL', http: it.status, code: it.body && it.body.code });
    }
    const after = await cnt();
    r.rows.push({ id: 'CL-7 aucun effet en base', verdict: JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL', before, after });
  } catch (e) { r.rows.push({ id: 'CL-7 sonde', verdict: 'BLOQUE', detail: String(e.message).slice(0, 300) }); }
  finally { fs.mkdirSync('test-results/claude-par-km-returns', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify(r.rows.map(x => x.id + ':' + x.verdict))); await db.pool?.end?.(); }
})();
