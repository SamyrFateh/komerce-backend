/**
 * @komerce-arch-lite
 * @role g13-hub-manual-fixtures
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Complete bounded fictitious Hub fixtures using staging operator APIs.
 * @db-read products,suppliers,product_market_price_drafts,product_market_exposure,markets
 * @db-write none
 * @impact-areas catalog,pricing
 */
'use strict';

const fs = require('node:fs');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');

const env = process.env;
const BASE = 'https://komerce-backend-production.up.railway.app';
const OUT = 'test-results/g13-hub-manual-fixtures';
const MARKETS = ['KM', 'CM', 'CG'];
const ITEMS = [
  { ref: 'KPR-000251', stock: 12, weight: 0.4, cost: 2400, km: 4990, xaf: 6790,
    description: 'Lot fictif de trois torchons de cuisine à carreaux. Utilisez les torchons pour essuyer la vaisselle et les surfaces de cuisine. Les caractéristiques et le stock sont simulés pour la recette staging.',
    image: 'https://cf.cjdropshipping.com/quick/product/212239e1-886d-4834-8c1c-a8f86bd2af76.jpg' },
  { ref: 'KPR-000252', stock: 8, weight: 0.45, cost: 3300, km: 7490, xaf: 9990,
    description: 'Coffret fictif de tournevis de précision destiné aux petites réparations domestiques. Les embouts illustrent différents types de vis. Le stock et les caractéristiques sont simulés pour la recette staging.',
    image: 'https://cf.cjdropshipping.com/1619763271006.jpg' },
  { ref: 'KPR-000253', stock: 10, weight: 0.4, cost: 1600, km: 3990, xaf: 5490,
    description: 'Mug fictif à motif damier avec anse, présenté comme idée cadeau. Le visuel illustre le style de l’article. Le stock et les caractéristiques sont simulés pour la recette staging.',
    image: 'https://cf.cjdropshipping.com/fe869a7f-e261-437d-b179-bbda4295a3f2.jpg' },
];

async function actor(email, password, allowedRoles) {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error('AUTH_HTTP_' + login.status);
  const headers = { origin: BASE, cookie: login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
  const me = await fetch(BASE + '/api/auth/me', { headers });
  const data = await me.json();
  if (!me.ok || !allowedRoles.includes(data.role || data.user?.role)) throw new Error('ROLE_NOT_PROVEN');
  return async (method, path, body) => {
    const multipart = body instanceof FormData;
    const res = await fetch(BASE + path, {
      method,
      headers: body === undefined || multipart ? headers : { ...headers, 'content-type': 'application/json' },
      body: body === undefined || multipart ? body : JSON.stringify(body),
    });
    return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
  };
}

async function product(ref) {
  const { rows: [row] } = await db.query(
    `SELECT p.id, p.product_ref, p.name, p.image_url, p.stock, p.price_kmf,
            p.is_active, p.is_available, s.system_key
       FROM products p JOIN suppliers s ON s.id = p.procurement_supplier_id
      WHERE p.product_ref = $1`, [ref]
  );
  if (row?.system_key !== 'central_hub' || !row.name.startsWith('[G13-HUB] ')) {
    throw new Error('FIXTURE_IDENTITY_NOT_PROVEN');
  }
  return row;
}

async function checked(call, steps, key, ...args) {
  const result = await call(...args);
  steps[key] = { status: result.status };
  if (!result.ok) {
    steps[key].error = result.data.code || result.data.error || result.data.message;
    throw new Error(key + '_HTTP_' + result.status);
  }
  return result.data;
}

async function currentMarkets(id) {
  const { rows } = await db.query(
    `SELECT m.code, d.status, x.commercial_exposure
       FROM product_market_price_drafts d JOIN markets m ON m.id = d.market_id
       LEFT JOIN product_market_exposure x ON x.market_id = m.id AND x.product_id = d.product_id
      WHERE d.product_id = $1 AND m.code = ANY($2::text[])`, [id, MARKETS]
  );
  return rows;
}

async function complete(item, entry, admin, operator) {
  const before = await product(item.ref);
  const steps = entry.steps;
  const path = '/api/admin/workspaces/catalog/products/' + item.ref + '/update';
  if (!before.image_url) {
    const res = await fetch(item.image, { redirect: 'error' });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error('ILLUSTRATION_UNAVAILABLE');
    const blob = await res.blob();
    const form = new FormData();
    form.set('image', blob, 'recette-illustration.jpg');
    // The canonical upload route requires an active product. Keep it unavailable during upload.
    await checked(admin, steps, 'prepare', 'POST', path, {
      description: item.description, weight_kg: item.weight, stock: item.stock,
      price_kmf: item.km, is_active: true, is_available: false,
    });
    await checked(admin, steps, 'image', 'POST', '/api/products/' + before.id + '/image', form);
  }
  await checked(admin, steps, 'catalogue', 'POST', path, {
    description: item.description, weight_kg: item.weight, stock: item.stock,
    price_kmf: item.km, is_active: true, is_available: true,
  });
  const after = await product(item.ref);
  entry.catalogue = { image_url: after.image_url, stock: after.stock, active: after.is_active, available: after.is_available };
  entry.catalogue_passed = Boolean(after.image_url && Number(after.stock) === item.stock && after.is_active && after.is_available);
  if (!entry.catalogue_passed) throw new Error('CATALOGUE_READBACK_FAILED');
  const existing = await currentMarkets(after.id);
  for (const market of MARKETS) {
    if (existing.some(row => row.code === market && row.status === 'LOCAL_ACTIVE')) continue;
    const endpoint = '/api/admin/workspaces/pricing/market/' + market + '/products/' + item.ref + '/local-price';
    const amount = market === 'KM' ? item.km : item.xaf;
    const reason = 'RECETTE STAGING G13 — prix fictif manuel, run ' + env.GITHUB_RUN_ID;
    try {
      await checked(operator, steps, market + '_draft', 'POST', endpoint, { amount, reason });
      const preview = await checked(operator, steps, market + '_preview', 'GET', endpoint + '/activation-preview');
      if (preview.activation?.allowed !== true) {
        steps[market + '_preview'].activation = preview.activation;
        continue;
      }
      await checked(operator, steps, market + '_activation', 'POST', endpoint + '/activate', { reason });
    } catch (error) {
      steps[market + '_error'] = error.message;
    }
  }
  entry.markets = await currentMarkets(after.id);
  entry.passed = MARKETS.every(market => entry.markets.some(
    row => row.code === market && row.status === 'LOCAL_ACTIVE' && row.commercial_exposure === 'ENABLED'
  ));
}

async function main() {
  const report = { scope: 'FICTITIOUS_STAGING_ONLY', verdict: 'NOT_PROVEN', entries: [] };
  try {
    if (env.GITHUB_ACTIONS !== 'true' || !env.GITHUB_REPOSITORY_OWNER || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
        env.KOMERCE_ENV !== 'staging' || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging' ||
        env.STAGING_BASE_URL !== BASE || !String(env.PGOPTIONS).includes('default_transaction_read_only=on')) {
      throw new Error('STAGING_GUARD_REFUSED');
    }
    const target = await confirmTarget({ db, env });
    if (!target.confirmed) throw new Error('TARGET_NOT_CONFIRMED');
    report.db_fingerprint = target.fingerprint;
    const admin = await actor(env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASSWORD, ['admin']);
    const operator = await actor(env.E2E_MARKET_OPERATOR_EMAIL, env.E2E_MARKET_OPERATOR_PASSWORD, ['market_operator', 'admin']);
    for (const item of ITEMS) {
      const entry = { ref: item.ref, illustrative_media: item.image, simulated_cost_kmf: item.cost, steps: {} };
      report.entries.push(entry);
      try {
        await complete(item, entry, admin, operator);
      } catch (error) {
        entry.error = error.message;
      }
    }
    report.verdict = report.entries.every(entry => entry.passed) ? 'HUB_MARKETS_PASS_NOT_G13_GO' : 'HUB_PARTIAL';
  } catch (error) {
    report.error = error.message;
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
    await db.pool.end();
  }
  if (report.verdict !== 'HUB_MARKETS_PASS_NOT_G13_GO') process.exitCode = 1;
}

main();
