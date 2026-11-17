/**
 * @komerce-arch-lite
 * @role          g6-a-buyer-price-snapshot-diagnostic
 * @domain        catalog
 * @layer         test
 * @owner         catalog
 * @purpose       Explain BUYER_PRICE_SNAPSHOT_NOT_UNIQUE without touching business data.
 * @db-read       products, markets, product_market_exposure, product_market_price_drafts, product_skus
 * @db-write      none
 * @impact-areas  staging-only, catalog
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');

const OUT = path.resolve('test-results/g6-a-diagnosis');
const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const ID = '76dacd6c-c1d8-4313-9455-f0d8f063835b';
const REF = 'KPR-000099';

const report = {
  verdict: 'NOT_PROVEN', product_ref: REF, staging_sha: null,
  expected_sha: null, market: 'KM', counts: {},
  note: 'READ ONLY inventory; does not certify buyer checkout or correct a fixture',
};

async function main() {
  try {
    if (process.env.NODE_ENV !== 'test' || process.env.KOMERCE_ENV !== 'staging'
      || process.env.STAGING_BASE_URL !== ORIGIN
      || !String(process.env.PGOPTIONS || '').includes('default_transaction_read_only=on')
      || process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER
      || process.env.GITHUB_EVENT_NAME !== 'issues') {
      throw Error('OWNER_STAGING_READONLY_GUARD');
    }
    const target = await confirmTarget({ db, env: process.env });
    if (!target.confirmed) throw Error('STAGING_DB_TARGET_NOT_CONFIRMED');
    const res = await fetch(ORIGIN + '/health/version', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw Error('STAGING_SHA_HTTP_' + res.status);
    const version = await res.json();
    const sha = String(version.commit || '');
    if (!/^[0-9a-f]{40}$/.test(sha) || sha !== process.env.E2E_EXPECTED_DEPLOY_SHA) {
      throw Error('STAGING_DEPLOY_SHA_CHANGED');
    }
    report.staging_sha = sha;
    report.expected_sha = process.env.E2E_EXPECTED_DEPLOY_SHA;
    // Independent counts rather than a SELECT with joins that loses the reason
    // for a 0-row result. Never use LIMIT 1 to conceal a duplicate.
    const sql = `
      SELECT
        (SELECT COUNT(*)::int FROM products p WHERE p.id=$1) AS product_by_id,
        (SELECT COUNT(*)::int FROM products p WHERE p.product_ref=$2) AS product_by_ref,
        (SELECT COUNT(*)::int FROM markets m WHERE m.code='KM') AS km_markets,
        (SELECT COUNT(*)::int FROM markets m WHERE m.code='KM' AND m.is_active=TRUE) AS km_active,
        (SELECT COUNT(*)::int FROM product_market_exposure e
          JOIN markets m ON m.id=e.market_id AND m.code='KM'
          WHERE e.product_id=$1) AS exposure_rows,
        (SELECT COUNT(*)::int FROM product_market_price_drafts d
          JOIN markets m ON m.id=d.market_id AND m.code='KM'
          WHERE d.product_id=$1 AND d.status='LOCAL_ACTIVE') AS km_active_prices,
        (SELECT COUNT(*)::int FROM product_skus s
          WHERE s.product_id=$1 AND s.is_active=TRUE AND s.stock>0) AS sku_with_stock,
        (SELECT COUNT(*)::int
         FROM products p
         JOIN markets m ON m.code='KM' AND m.is_active=TRUE
         LEFT JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id
         LEFT JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id
           AND d.status='LOCAL_ACTIVE'
         WHERE p.id=$1) AS snapshot_join_rows
    `;
    const { rows } = await db.query(sql, [ID, REF]);
    if (rows.length !== 1) throw Error('DIAG_COUNTS_INVALID');
    report.counts = rows[0];
    const n = Number(rows[0].snapshot_join_rows);
    report.verdict = n === 1 ? 'SNAPSHOT_ROW_UNIQUE__BROWSER_NOT_PROVEN' :
      n === 0 ? 'SNAPSHOT_ZERO_ROWS__BROWSER_BLOCKED' : 'SNAPSHOT_MULTIPLE_ROWS__BROWSER_BLOCKED';
    if (n !== 1) process.exitCode = 2;
  } catch (error) {
    report.verdict = 'BLOCKED';
    report.error = String(error.message || error).slice(0, 200);
    process.exitCode = 2;
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    await db.pool.end();
  }
}
if (require.main === module) main();
module.exports = { main };
