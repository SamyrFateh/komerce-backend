#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-m038-legacy-catalog-purge
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        db/seed-products-v2.json, staging DATABASE_URL
 * @outputs       physical removal of exact Migration 038 legacy catalogue rows
 * @depends       db.js
 * @used-by       .github/workflows/staging-catalog-ops.yml
 * @db-read       products, sourcing_candidates, order_items
 * @db-write      order_items, products
 * @db-txn        yes
 * @doctrine      staging_only, exact_legacy_signature_only, fail_closed
 * @impact-areas  staging-catalog
 * @version       2026-09
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

const LEGACY_FILE = path.join(__dirname, '..', 'db', 'seed-products-v2.json');
const LEGACY_MARKER = '__M038_CATALOG_V2__';

function assertStaging() {
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: purge M038 interdite en production');
  }
  if (process.env.KOMERCE_ENV !== 'staging') {
    throw new Error('KOMERCE_ENV=staging requis');
  }
  if (process.env.KOMERCE_ALLOW_M038_PURGE !== '1') {
    throw new Error('KOMERCE_ALLOW_M038_PURGE=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function loadLegacySignatures() {
  const rows = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  if (!Array.isArray(rows) || rows.length !== 467) {
    throw new Error(`Signature M038 inattendue: ${Array.isArray(rows) ? rows.length : 'invalid'} lignes`);
  }
  return rows.map((row) => ({
    name: String(row.name || ''),
    image_url: String(row.image_url || ''),
  }));
}

async function purge() {
  assertStaging();
  const signatures = loadLegacySignatures();
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { rows: matches } = await client.query(
      `WITH legacy AS (
         SELECT x.name, x.image_url
           FROM jsonb_to_recordset($1::jsonb) AS x(name text, image_url text)
       )
       SELECT p.id, p.product_ref, p.name, p.image_url, p.is_active
         FROM products p
         JOIN legacy l ON l.name = p.name AND l.image_url = p.image_url
        ORDER BY p.created_at NULLS LAST, p.id`,
      [JSON.stringify(signatures)]
    );

    const ids = matches.map((row) => row.id);
    const activeBefore = matches.filter((row) => row.is_active).length;

    if (ids.length > 467) {
      throw new Error(`REFUS: ${ids.length} produits matchent M038 (>467)`);
    }

    const { rows: [linked] } = ids.length
      ? await client.query(
          `SELECT COUNT(*)::int AS count
             FROM sourcing_candidates
            WHERE product_id = ANY($1::uuid[])`,
          [ids]
        )
      : { rows: [{ count: 0 }] };

    if (linked.count !== 0) {
      throw new Error(
        `REFUS: ${linked.count} candidats sourcing sont liés à des produits M038; audit requis avant suppression`
      );
    }

    const orderItems = ids.length
      ? await client.query(
          `DELETE FROM order_items
            WHERE product_id = ANY($1::uuid[])
            RETURNING id`,
          [ids]
        )
      : { rowCount: 0 };

    const products = ids.length
      ? await client.query(
          `DELETE FROM products
            WHERE id = ANY($1::uuid[])
            RETURNING id`,
          [ids]
        )
      : { rowCount: 0 };

    const marker = await client.query(
      `DELETE FROM products
        WHERE name = $1
        RETURNING id`,
      [LEGACY_MARKER]
    );

    const { rows: [remaining] } = await client.query(
      `WITH legacy AS (
         SELECT x.name, x.image_url
           FROM jsonb_to_recordset($1::jsonb) AS x(name text, image_url text)
       )
       SELECT COUNT(*)::int AS count
         FROM products p
         JOIN legacy l ON l.name = p.name AND l.image_url = p.image_url`,
      [JSON.stringify(signatures)]
    );

    if (remaining.count !== 0) {
      throw new Error(`Purge incomplète: ${remaining.count} produits M038 subsistent`);
    }

    await client.query('COMMIT');

    const result = {
      matched: ids.length,
      active_before: activeBefore,
      linked_sourcing_candidates: linked.count,
      deleted_order_items: orderItems.rowCount,
      deleted_products: products.rowCount,
      deleted_marker: marker.rowCount,
      remaining: remaining.count,
    };
    console.log(`[purge-m038-staging] ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  purge()
    .then(() => db.pool.end().catch(() => {}))
    .catch(async (error) => {
      console.error('[purge-m038-staging] FAILED:', error.message);
      await db.pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { LEGACY_MARKER, assertStaging, loadLegacySignatures, purge };
