/**
 * @komerce-arch-lite
 * @role eight-demo-products-selective-deletion-preview
 * @deprecated 2026-11 (LOT 1) : remplace par scripts/recette/staging-reset.js (classification exhaustive, fixtures, verification). Conserve sans suppression ; ne plus utiliser pour un reset Staging.
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Inventory exact SQL demo candidates, all direct FKs and non-FK product references before deletion decisions.
 * @db-read products, sourcing_candidates, pg_catalog, information_schema, product dependencies
 * @db-write none
 * @impact-areas catalog, sourcing, staging-only
 */
'use strict';
const fs = require('fs'), path = require('path');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const HOST = 'https://komerce-backend-production.up.railway.app';
const REFS = Object.freeze(Array.from({ length: 8 }, (_, i) => 'KPR-' + String(84 + i).padStart(6, '0')));
const OUT = path.resolve('test-results/staging-demo-cleanup/preview.json');
const ident = s => '"' + String(s).replace(/"/g, '""') + '"';
function classify(row, usages) {
  const relevant = usages.filter(u => (u.by_ref[row.product_ref] || 0) > 0);
  const hard = relevant.filter(u => /^(order_items|orders|shared_cart_items|purchase_lines|purchase_orders|payments|wallet|stock_moves|invoices|refunds|shipments|disputes|fulfillment)/i.test(u.table));
  const sources = relevant.filter(u => u.table === 'sourcing_candidates' || /^(sourcing_|import_runtime_|supplier_catalog_)/.test(u.table));
  return {
    external_business_links: hard.map(u => ({ table: u.table, count: u.by_ref[row.product_ref] })),
    canonical_source_links: sources.map(u => ({ table: u.table, count: u.by_ref[row.product_ref] })),
    direct_related_tables: relevant.length,
    linked_rows: relevant.reduce((n, u) => n + u.by_ref[row.product_ref], 0),
    decision: hard.length ? 'HOLD_BUSINESS_DEPENDENCIES'
      : sources.length ? 'HOLD_SOURCE_LINKED_REVIEW_REQUIRED'
      : relevant.length ? 'HOLD_DEPENDENCY_PLAN_REQUIRED' : 'ROOT_ONLY_CANDIDATE_NOT_APPROVED'
  };
}
async function main() {
  const record = { kind: 'STAGING_SQL_DEMO_DELETION_PREVIEW_V1',
    created_at: new Date().toISOString(), target: HOST, refs: REFS,
    deletion_performed: false, deletion_allowed: false, status: 'BLOCKED',
    roots: [], dependencies: [], opaque_relations: [], missing_refs: [], issues: [],
    policy: 'Read-only exact refs. SOURCE LINK IS NOT PROOF OF SQL CREATION. Never cascade/delete business history or source evidence.' };
  let client = null;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  try {
    if (process.env.KOMERCE_ENV !== 'staging' || process.env.NODE_ENV === 'production'
      || process.env.STAGING_BASE_URL !== HOST) throw Error('CLEANUP_PREVIEW_STAGING_ONLY');
    const target = await confirmTarget({ db });
    if (!target?.confirmed) throw Error('CLEANUP_PREVIEW_TARGET_NOT_CONFIRMED');
    client = await db.pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const roots = (await client.query(
      'SELECT id,product_ref,lifecycle_status,is_active FROM products WHERE product_ref=ANY($1::text[]) ORDER BY product_ref',
      [REFS])).rows;
    record.missing_refs = REFS.filter(ref => !roots.some(row => row.product_ref === ref));
    if (!roots.length) {
      record.status = 'EMPTY_SCOPE_NO_DELETION';
      return;
    }
    const ids = roots.map(r => r.id), byId = new Map(roots.map(r => [String(r.id), r.product_ref]));
    const usages = [];
    const seenColumns = new Set();
    const fks = (await client.query([
      'SELECT child_ns.nspname AS schema_name, child.relname AS table_name, con.conname AS constraint_name,',
      'con.confdeltype AS delete_action,',
      'array_to_json(ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(num, ord)',
      'JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.num ORDER BY k.ord)) AS child_columns,',
      'array_to_json(ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY AS k(num, ord)',
      'JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.num ORDER BY k.ord)) AS parent_columns',
      'FROM pg_constraint con',
      'JOIN pg_class child ON child.oid=con.conrelid',
      'JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace',
      "WHERE con.contype='f' AND con.confrelid='public.products'::regclass",
      'ORDER BY child_ns.nspname,child.relname,con.conname'
    ].join(' '))).rows;
    async function measure(schema, table, column, kind, relation, meta = {}) {
      const key = [schema, table, column].join('.');
      if (seenColumns.has(key)) return;
      seenColumns.add(key);
      if (schema !== 'public' || (kind !== 'uuid' && kind !== 'text')) {
        record.opaque_relations.push({ schema, table, column, relation, reason: 'UNSAFE_OR_UNSUPPORTED_FIELD' });
        return;
      }
      const name = ident(schema) + '.' + ident(table);
      const col = ident(column);
      const type = kind === 'uuid' ? 'uuid' : 'text';
      const targets = kind === 'uuid' ? ids : REFS;
      try {
        const result = await client.query(
          'SELECT ' + col + '::text AS marker, COUNT(*)::int AS n FROM ' + name +
          ' WHERE ' + col + '=ANY($1::' + type + '[]) GROUP BY ' + col, [targets]
        );
        const counts = {};
        for (const item of result.rows) {
          const ref = kind === 'uuid' ? byId.get(item.marker) : item.marker;
          if (ref && REFS.includes(ref)) counts[ref] = item.n;
        }
        const n = Object.values(counts).reduce((v, c) => v + c, 0);
        if (n > 0 || relation === 'FOREIGN_KEY') usages.push({
          schema, table, column, relation, count: n, by_ref: counts, ...meta
        });
      } catch (err) {
        // A failed SQL statement aborts this READ ONLY transaction: fail the entire preview.
        throw Error('DEMO_DEPENDENCY_SCAN_FAILED:' + schema + '.' + table + '.' + column + ':' +
          String(err.code || err.message).slice(0, 65));
      }
    }
    for (const fk of fks) {
      if (fk.child_columns.length !== 1 || fk.parent_columns.length !== 1 ||
        !['id', 'product_ref'].includes(fk.parent_columns[0])) {
        record.opaque_relations.push({ schema: fk.schema_name, table: fk.table_name,
          constraint: fk.constraint_name, reason: 'COMPOSITE_OR_DIFFERENT_PARENT_COLUMN' });
        continue;
      }
      await measure(fk.schema_name, fk.table_name, fk.child_columns[0],
        fk.parent_columns[0] === 'id' ? 'uuid' : 'text', 'FOREIGN_KEY',
        { constraint: fk.constraint_name, delete_action: fk.delete_action });
    }
    const columns = (await client.query(
      "SELECT table_schema,table_name,column_name,udt_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('product_id','product_ref') ORDER BY table_name,column_name"
    )).rows;
    for (const col of columns) {
      if (col.table_name === 'products') continue;
      const kind = col.udt_name === 'uuid' ? 'uuid' :
        ['text', 'varchar', 'bpchar'].includes(col.udt_name) ? 'text' : 'unsupported';
      await measure(col.table_schema, col.table_name, col.column_name, kind, 'NON_FK_REFERENCE');
    }
    record.dependencies = usages;
    record.roots = roots.map(r => ({
      product_ref: r.product_ref, id: r.id,
      lifecycle_status: r.lifecycle_status, is_active: r.is_active,
      ...classify(r, usages)
    }));
    if (record.opaque_relations.length) record.issues.push('UNINSPECTED_RELATIONS');
    if (record.missing_refs.length) record.issues.push('EXACT_SET_INCOMPLETE');
    if (record.roots.some(r => r.external_business_links.length))
      record.issues.push('BUSINESS_LINKS_MUST_BE_PRESERVED');
    if (record.roots.some(r => r.canonical_source_links.length))
      record.issues.push('SOURCING_PROVENANCE_MUST_BE_PRESERVED');
    record.status = 'PREVIEW_ONLY_REVIEW_REQUIRED';
  } catch (error) {
    record.status = 'BLOCKED';
    record.issues.push(String(error.code || error.message).slice(0, 200));
    process.exitCode = 2;
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* never commit */ }
      client.release();
    }
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ status: record.status,
      roots: record.roots.length, missing: record.missing_refs,
      issues: record.issues, related: record.dependencies.length,
      removed: 0, artifact: OUT }));
    await db.pool.end();
  }
}
if (require.main === module) main();
module.exports = { REFS, classify };
