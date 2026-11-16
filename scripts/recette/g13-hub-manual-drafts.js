/**
 * @komerce-arch-lite
 * @role g13-hub-manual-drafts
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Create three inactive manual Hub fixtures through the staging Catalog API.
 * @db-read products,suppliers
 * @db-write none
 * @impact-areas catalog,purchasing
 */
'use strict';

const fs = require('node:fs');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');

const BASE = 'https://komerce-backend-production.up.railway.app';
const OUT = 'test-results/g13-hub-manual-drafts/report.json';
const names = [
  ['Torchons de cuisine à carreaux', 'Maison', 'Cuisine', 'Lot de torchons pour essuyer la vaisselle et les surfaces de cuisine.'],
  ['Coffret de tournevis de précision', 'Bricolage', 'Outillage', 'Coffret de tournevis destiné aux petites réparations.'],
  ['Mug à motif damier', 'Créations personnelles', 'Cadeau', 'Mug à motif damier avec anse, présenté comme idée cadeau.'],
];
const env = process.env;

async function findDraft(name) {
  const { rows } = await db.query(
    `SELECT p.product_ref, p.category, p.subcategory, p.is_active, p.is_available,
            p.price_kmf, p.stock, s.system_key
       FROM products p LEFT JOIN suppliers s ON s.id = p.procurement_supplier_id
      WHERE p.name = $1 ORDER BY p.product_ref LIMIT 2`,
    [name]
  );
  if (rows.length > 1) throw new Error('DUPLICATE_DRAFT_NAME');
  return rows[0];
}

async function main() {
  const report = { verdict: 'NOT_PROVEN', entries: [] };
  try {
    if (env.GITHUB_ACTIONS !== 'true' || !env.GITHUB_REPOSITORY_OWNER ||
        env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
        env.KOMERCE_ENV !== 'staging' || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging' ||
        env.STAGING_BASE_URL !== BASE ||
        !String(env.PGOPTIONS).includes('default_transaction_read_only=on')) {
      throw new Error('STAGING_GUARD_REFUSED');
    }
    const target = await confirmTarget({ db, env });
    if (!target.confirmed) throw new Error('TARGET_NOT_CONFIRMED');
    report.db_fingerprint = target.fingerprint;

    const login = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
    });
    if (!login.ok) throw new Error('AUTH_HTTP_' + login.status);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const headers = { cookie, origin: BASE, 'content-type': 'application/json' };
    const me = await fetch(BASE + '/api/auth/me', { headers });
    const actor = await me.json();
    if (!me.ok || (actor.role || actor.user?.role) !== 'admin') throw new Error('ADMIN_NOT_PROVEN');

    for (const [title, category, subcategory, description] of names) {
      const name = '[G13-HUB] ' + title;
      const entry = { name, category, subcategory };
      report.entries.push(entry);
      const before = await findDraft(name);
      entry.action = before ? 'REPLAY' : 'CREATE';
      if (!before) {
        const res = await fetch(BASE + '/api/admin/workspaces/catalog/products', {
          method: 'POST', headers,
          body: JSON.stringify({
            name, category, subcategory, description, price_kmf: 0, stock: 0,
            is_active: false, is_available: false,
          }),
        });
        entry.http_status = res.status;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          entry.error = body.code || body.error || 'CREATE_REFUSED';
          continue;
        }
      }
      const row = await findDraft(name);
      entry.readback = row;
      entry.passed = Boolean(row?.product_ref && row.system_key === 'central_hub' &&
        row.category === category && row.subcategory === subcategory &&
        row.is_active === false && row.is_available === false &&
        Number(row.price_kmf) === 0 && Number(row.stock) === 0);
    }
    report.verdict = report.entries.every(entry => entry.passed) ? 'THREE_MANUAL_DRAFTS_PROVEN' : 'DRAFTS_INCOMPLETE';
  } catch (error) {
    report.error = error.message;
  } finally {
    fs.mkdirSync('test-results/g13-hub-manual-drafts', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    await db.pool.end();
  }
  if (report.verdict !== 'THREE_MANUAL_DRAFTS_PROVEN') process.exitCode = 1;
}

main();
