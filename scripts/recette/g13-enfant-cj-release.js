/**
 * @komerce-arch-lite
 * @role g13-enfant-cj-release
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Publish the exact source-proven G13 school backpack on staging.
 * @db-read products,sourcing_candidates,product_skus,product_suppliers,suppliers,catalog_media
 * @db-write none
 * @impact-areas catalog,pricing
 */
'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { stagingEconomicReferenceAmount } = require('./g13-catalogue-seed');

const BASE = 'https://komerce-backend-production.up.railway.app';
const OUT = 'test-results/g13-enfant-cj-release';
const REF = 'KPR-000245';
const env = process.env;
const MEDIA = [
  [
    "2601060946311626300:hero",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/473bb654-7532-48ba-9626-42037829a5a3_trans.jpeg",
    "ee1665a433b40526c94dfdd504b9741490733252ed78f851d63e37303fed7bf2"
  ],
  [
    "2601060946311626300:media:2",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/a9196b75-972d-4559-8dfe-4d46d2e4f15e_trans.jpeg",
    "d418242730136d7db3572083c62ade5d35569a3ca687a791d3f9124d2a803504"
  ],
  [
    "2601060946311626300:media:3",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/a401a795-e502-4a38-aec4-5e282f68bb69_trans.jpeg",
    "a7e44ef13692141a68eba21e509673f23950ccf1235d7c954a9d5d4fc58a7db2"
  ],
  [
    "2601060946311626300:media:4",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/efeff475-2ab9-4384-bbfd-8dc87183df3f_trans.jpeg",
    "b0a9594cd7eb94e81a7a7b42868e86bd553a6fdb86b11b711d322f2da6022f58"
  ],
  [
    "2601060946311626300:media:5",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/25a326dd-038f-4d26-9bb0-3181bf196c6a_trans.jpeg",
    "978e762acfe49b45451e9a8921a365e29c6d742dd5ad091bef7f3ed280b2c1f5"
  ],
  [
    "2601060946311626300:media:6",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/db5e080a-b672-4e30-a0c4-8350cc329219_trans.jpeg",
    "52b4dece7302397236565acfd4a41ae5b6cda88a0e805a64be1958956683430c"
  ],
  [
    "2601060946311626300:media:7",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/67a09a12-65c9-42fd-b141-a73c4d2ecb52_trans.jpeg",
    "7193e91208f3c0c25d3a6902349fbb88b2aabe912faf270c82aa68db8a727cde"
  ],
  [
    "2601060946311626300:media:8",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/71a011c5-90c4-4859-b13f-1e0782ea1013_trans.jpeg",
    "f40a659fafe37f95b3a79a84efc122e062077ec9f0cd59efea4a227bd37140e8"
  ],
  [
    "2601060946311626300:media:9",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/c7178e9e-c83d-44fb-9453-754491bd6142_trans.jpeg",
    "f844a3e74e8d987fa2eaf8484a6b0fbdd4fd3a067fb8591550b455ba73b5f1c1"
  ],
  [
    "2601060946311626300:media:10",
    "https://oss-cf.cjdropshipping.com/product/2026/01/06/09/f3515b42-ebe4-4353-a705-9abd232ee4d3_trans.jpeg",
    "9743e3b91c68e482344b0dd46e0dfbba236a4252dbbe2e4ab4581a3b3dc39ef1"
  ]
];
const CAPTIONS = {
  5: ['Holds all of your; Multi-functional compartments for convenient storage and access to items; Large Capacity Main Compartment',
      'Compartiment principal de grande capacité et poches séparées pour les affaires scolaires.'],
  6: ['Cute and simple color-matching backpack', 'Sac à dos bicolore présenté en rose, lilas, vert et bleu.'],
  7: ['Step-1: Worry-free machine wash', 'Le visuel fournisseur indique que le sac est lavable en machine.'],
  9: ['Pink; Large Size; Suitable for grades 6 and above; Furry Balls + Pencil Case + Lunch Bag; 45 cm × 30 cm × 15 cm',
      'Modèle rose, grand format (45 × 30 × 15 cm), présenté pour les élèves à partir de la sixième avec un pompon, une trousse et un sac-repas.'],
};

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


async function checked(call, trace, key, ...args) {
  const res = await call(...args);
  trace[key] = { http: res.status, code: res.data.code || res.data.body?.code };
  if (!res.ok) {
    trace[key].reason = res.data.error || res.data.body?.error || res.data.reasons;
    throw new Error(key + '_HTTP_' + res.status);
  }
  return res.data;
}

async function prepare(admin, report) {
  const { rows: [product] } = await db.query(
    `SELECT p.id, p.lifecycle_status,
       (SELECT COUNT(*)::int FROM product_skus sku
         WHERE sku.product_id=p.id AND sku.is_active AND sku.stock>0
          AND EXISTS (SELECT 1 FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id
           WHERE ps.product_id=p.id AND ps.supplier_sku=sku.supplier_sku AND ps.is_active
             AND s.is_active AND LOWER(s.platform)='cj')) AS stocked_cj_skus
      FROM products p JOIN sourcing_candidates sc ON sc.product_id=p.id
     WHERE p.product_ref=$1 AND sc.candidate_ref='KSC-000524'
       AND sc.supplier_product_id='2601060946311626300'`, [REF]);
  report.stocked_cj_skus = product?.stocked_cj_skus;
  if (product?.stocked_cj_skus !== 5) throw new Error('FIVE_LINKED_CJ_SKUS_REQUIRED');
  if (product.lifecycle_status === 'active') return;
  const { rows: media } = await db.query(
    'SELECT id, source_media_id, url, option_values FROM catalog_media WHERE product_id=$1 AND is_active',
    [product.id]);
  if (media.length !== MEDIA.length) throw new Error('EXACT_MEDIA_SET_REQUIRED');
  const verified = await Promise.all(MEDIA.map(async ([sourceId, url, digest], index) => {
    const row = media.find(item => item.source_media_id === sourceId && item.url === url);
    if (!row) throw new Error('SOURCE_MEDIA_CHANGED');
    const res = await fetch(url, { redirect: 'error' });
    if (!res.ok || createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') !== digest) {
      throw new Error('REVIEWED_IMAGE_CHANGED');
    }
    return { row, index };
  }));
  for (const { row, index } of verified) {
    const [source, caption] = CAPTIONS[index + 1] || [
      'QY / Fashion (product lettering)',
      'Vue du sac et des accessoires avec le motif lettré visible sur l’article.',
    ];
    await checked(admin, report.steps, row.source_media_id, 'POST',
      '/api/admin/catalog/approval-queue/' + product.id + '/media/' + row.id + '/visual-fr-review', {
        execution_mode: 'AUTOMATED_STAGING', run_id: env.GITHUB_RUN_ID,
        source_media_id: row.source_media_id, source_url: row.url, option_values: row.option_values ?? {},
        text_presence: 'PRESENT', source_transcription: source, french_translation: caption,
        french_presentation: { kind: 'caption', text: caption, reviewed: true },
      });
  }
  await checked(admin, report.steps, 'approve', 'POST', '/api/admin/workspaces/catalog/approval/' + REF + '/approve');
}

async function price(operator, report, market) {
  const base = '/api/admin/workspaces/pricing/market/' + market;
  const step = report.markets[market] = {};
  const { rows: [current] } = await db.query(
    `SELECT d.status, x.commercial_exposure FROM products p
       JOIN product_market_price_drafts d ON d.product_id=p.id
       JOIN markets m ON m.id=d.market_id
       LEFT JOIN product_market_exposure x ON x.product_id=p.id AND x.market_id=m.id
      WHERE p.product_ref=$1 AND m.code=$2 AND d.status='LOCAL_ACTIVE'`, [REF, market]);
  if (current?.commercial_exposure === 'ENABLED') return true;
  const corridor = await checked(operator, step, 'corridor', 'GET', base + '/corridor?product_ref=' + REF);
  const amount = await stagingEconomicReferenceAmount(corridor, market);
  if (!amount) throw new Error('ECONOMIC_REFERENCE_MISSING');
  const reason = 'RECETTE STAGING G13 : repère économique du moteur, run ' + env.GITHUB_RUN_ID;
  const path = base + '/products/' + REF + '/local-price';
  await checked(operator, step, 'draft', 'POST', path, { amount, reason });
  const preview = await checked(operator, step, 'preview', 'GET', path + '/activation-preview');
  if (preview.activation?.allowed !== true) throw new Error('ECONOMIC_GATE_REFUSED');
  await checked(operator, step, 'activate', 'POST', path + '/activate', { reason });
  return true;
}

async function main() {
  const report = { product_ref: REF, verdict: 'NOT_PROVEN', steps: {}, markets: {} };
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
    const operator = await actor(env.E2E_MARKET_OPERATOR_EMAIL, env.E2E_MARKET_OPERATOR_PASSWORD, ['market_operator']);
    await prepare(admin, report);
    for (const market of ['KM', 'CM', 'CG']) {
      try { await price(operator, report, market); }
      catch (error) { report.markets[market].error = error.message; }
    }
    if (Object.values(report.markets).every(market => !market.error)) report.verdict = 'ENFANT_CJ_ACTIVATED';
  } catch (error) {
    report.error = error.message;
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2) + '\n');
    await db.pool.end();
  }
  if (report.verdict !== 'ENFANT_CJ_ACTIVATED') process.exitCode = 1;
}
main();
