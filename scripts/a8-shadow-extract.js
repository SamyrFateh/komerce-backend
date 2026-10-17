#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          governance-a8-shadow-extract
 * @domain        economic-engine
 * @layer         script
 * @criticality   medium
 * @inputs        process.env.DATABASE_URL
 * @outputs       response_or_domain_result
 * @depends       db, services/cost-allocation/real-margin-shadow.js
 * @used-by       none
 * @db-read       markets, orders, order_items, order_item_cost_imputations, order_item_real_cost_allocations, refunds, purchase_lines, purchase_orders, supplier_execution_payments, supplier_payment_settlements, customs_shipments, customs_shipment_parcels, parcels
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-10
 */
'use strict';

/**
 * KOMERCE — A8 : extraction LECTURE SEULE shadow vs legacy.
 *
 * Usage (aucune saisie, aucun UUID) :
 *   railway run --service Postgres node scripts/a8-shadow-extract.js
 *   railway run node scripts/a8-shadow-extract.js --days=365 --max-orders=3000 --out=a8.json
 *
 * Garanties :
 *   - session PostgreSQL forcée en lecture seule (default_transaction_read_only=on),
 *     vérifiée au démarrage : arrêt immédiat sinon ; aucune écriture possible ;
 *   - n'appelle que computeOrderRealMarginShadow / listRealMarginShadow (lecture) ;
 *   - ne logge jamais DATABASE_URL.
 *
 * Résultats : 1) complétude des marges (final / provisional / incomplete / not_applicable),
 *             2) écarts shadow − legacy (points de marge),
 *             3) les 10 plus gros écarts.
 */

// Lecture seule imposée AVANT le chargement de db.js (pg lit PGOPTIONS).
process.env.PGOPTIONS = `${process.env.PGOPTIONS ? process.env.PGOPTIONS + ' ' : ''}-c default_transaction_read_only=on`;

// Résolution de l'URL (aucun log de l'URL). Priorité : A8_DATABASE_URL > DATABASE_PUBLIC_URL (si l'URL
// courante est interne Railway) > DATABASE_URL. L'URL interne (*.railway.internal) est injoignable hors Railway.
function resolveDatabaseUrl(env) {
  if (env.A8_DATABASE_URL) return { url: env.A8_DATABASE_URL };
  const cur = env.DATABASE_URL || '';
  if (/\.railway\.internal/.test(cur)) {
    if (env.DATABASE_PUBLIC_URL) return { url: env.DATABASE_PUBLIC_URL };
    return {
      error: 'URL interne Railway injoignable depuis ce poste. Relancez avec le service Postgres : '
        + '`railway run --service Postgres node scripts/a8-shadow-extract.js --out=a8.json` '
        + '(ou définissez A8_DATABASE_URL avec la DATABASE_PUBLIC_URL).',
    };
  }
  return { url: cur };
}
const resolved = resolveDatabaseUrl(process.env);
if (!resolved.error && resolved.url) process.env.DATABASE_URL = resolved.url;

const fs = require('fs');

function parseArgs(argv) {
  const o = { days: 365, maxOrders: 5000, out: null };
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) continue;
    if (m[1] === 'days') o.days = Math.max(1, parseInt(m[2], 10) || 365);
    else if (m[1] === 'max-orders') o.maxOrders = Math.max(1, parseInt(m[2], 10) || 5000);
    else if (m[1] === 'out') o.out = m[2];
  }
  return o;
}

const absMax = (a, b) => Math.abs(b.delta_pct_points) - Math.abs(a.delta_pct_points);

async function extract({ db, listRealMarginShadow, days, maxOrders }) {
  const { rows: [ro] } = await db.query('SHOW default_transaction_read_only');
  if (ro.default_transaction_read_only !== 'on') {
    throw new Error('Session non lecture seule : arrêt (garde-fou A8).');
  }
  const { rows: markets } = await db.query('SELECT id, code FROM markets ORDER BY code');
  const completeness = { total: {}, by_market: {} };
  const items = [];
  for (const m of markets) {
    const cm = {};
    for (let off = 0; off < maxOrders; off += 200) {
      const page = await listRealMarginShadow({ marketId: m.id, limit: 200, offset: off, sinceDays: days });
      for (const it of page.items) {
        cm[it.completeness] = (cm[it.completeness] || 0) + 1;
        completeness.total[it.completeness] = (completeness.total[it.completeness] || 0) + 1;
        items.push({ market: m.code, ...it });
      }
      if (page.items.length < 200) break;
    }
    completeness.by_market[m.code] = cm;
  }

  const withDelta = items.filter((i) => i.delta_pct_points != null);
  const sum = withDelta.reduce((s, i) => s + i.delta_pct_points, 0);
  const abs = (t) => withDelta.filter((i) => Math.abs(i.delta_pct_points) > t).length;
  const deltas = {
    orders_total: items.length,
    orders_with_legacy_margin: items.filter((i) => i.legacy_margin_real_pct != null).length,
    orders_with_both: withDelta.length,
    legacy_only_shadow_unknown: items.filter((i) => i.legacy_margin_real_pct != null && i.shadow_pct == null).length,
    shadow_only_legacy_missing: items.filter((i) => i.legacy_margin_real_pct == null && i.shadow_pct != null).length,
    avg_delta_pct_points: withDelta.length ? Number((sum / withDelta.length).toFixed(2)) : null,
    shadow_lower_than_legacy: withDelta.filter((i) => i.delta_pct_points < 0).length,
    abs_gt_5_pts: abs(5),
    abs_gt_10_pts: abs(10),
    abs_gt_20_pts: abs(20),
  };
  const top10 = [...withDelta].sort(absMax).slice(0, 10).map((i) => ({
    market: i.market, order_id: i.order_id, completeness: i.completeness, status: i.status_order,
    shadow_pct: i.shadow_pct, legacy_pct: i.legacy_margin_real_pct, delta_pct_points: i.delta_pct_points,
    basis: i.basis, unknown_types: i.unknown_types,
  }));
  return { generated_at: new Date().toISOString(), since_days: days, completeness, deltas, top10 };
}

async function main() {
  if (resolved.error) throw new Error(resolved.error);
  const args = parseArgs(process.argv.slice(2));
  const db = require('../db');
  const { listRealMarginShadow } = require('../services/cost-allocation/real-margin-shadow');
  try {
    const result = await extract({ db, listRealMarginShadow, days: args.days, maxOrders: args.maxOrders });
    const json = JSON.stringify(result, null, 2);
    if (args.out) fs.writeFileSync(args.out, json);
    process.stdout.write(`${json}\n`);
  } finally {
    if (db.end) await db.end().catch(() => {});
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { process.stderr.write(`A8 extract: ${e.message}\n`); process.exit(1); });
}

module.exports = { extract, parseArgs, resolveDatabaseUrl };
