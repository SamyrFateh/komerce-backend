#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-media-refresh
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        deterministic SHOWCASE-V2 French fixtures, ImageKit staging
 * @outputs       refreshed V2 image_url/images only
 * @depends       db.js, scripts/showcase-v2-source-build.js, scripts/showcase-media-mirror.js
 * @used-by       one-off staging media refresh / future media-only repairs
 * @db-read       products
 * @db-write      products.image_url, products.images, products.updated_at
 * @db-txn        yes
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @version       2026-09-v1
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const { buildCatalogue } = require('./showcase-v2-source-build');
const { uploadImageKitFile } = require('./showcase-media-mirror');
const { isCanonicalImageKitUrl } = require('./showcase-media-provider');

const V1_PATTERN = 'SHOWCASE-V1-%';
const V2_PATTERN = 'SHOWCASE-V2-%';
const EXPECTED_V2 = 500;

function assertStaging() {
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: refresh média Showcase V2 interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!process.env.IMAGEKIT_PRIVATE_KEY) throw new Error('IMAGEKIT_PRIVATE_KEY requis');
}

function mediaVersion(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 12);
}

function versionedHeroId(product) {
  return `hero-${mediaVersion(product.image_url)}`;
}

function validateSource(products) {
  if (!Array.isArray(products) || products.length !== EXPECTED_V2) {
    throw new Error(`Source V2 invalide: ${Array.isArray(products) ? products.length : 'non-array'}/${EXPECTED_V2}`);
  }
  const refs = new Set();
  for (const product of products) {
    if (!/^SHOWCASE-V2-\d{4}$/.test(product.product_ref || '')) {
      throw new Error(`Référence V2 invalide: ${product.product_ref}`);
    }
    if (refs.has(product.product_ref)) throw new Error(`Référence V2 dupliquée: ${product.product_ref}`);
    refs.add(product.product_ref);
    if (String(product.source_locale || '').toLowerCase() !== 'fr') {
      throw new Error(`Locale source non FR: ${product.product_ref}`);
    }
    if (!String(product.name || '').trim() || product.name !== product.source_title) {
      throw new Error(`Identité éditoriale incohérente: ${product.product_ref}`);
    }
    if (!String(product.image_url || '').startsWith('data:image/svg+xml;base64,')) {
      throw new Error(`Fixture SVG attendue: ${product.product_ref}`);
    }
    const decoded = Buffer.from(String(product.image_url).split(',', 2)[1] || '', 'base64').toString('utf8');
    if (!decoded.includes(String(product.source_title))) {
      throw new Error(`Le SVG n'embarque pas le titre FR courant: ${product.product_ref}`);
    }
  }
  return products;
}

async function uploadFrenchMedia(products) {
  const uploaded = [];
  for (const product of products) {
    const folder = `komerce/staging/showcase-v2/${product.product_ref.toLowerCase()}`;
    const url = await uploadImageKitFile(product.image_url, {
      folder,
      publicId: versionedHeroId(product),
      filename: `${versionedHeroId(product)}.jpg`,
    });
    if (!isCanonicalImageKitUrl(url, 'showcase-v2')) {
      throw new Error(`URL ImageKit non canonique: ${product.product_ref} -> ${url}`);
    }
    uploaded.push({
      product_ref: product.product_ref,
      source_title: product.source_title,
      image_url: url,
      images: [url],
    });
    if (uploaded.length % 25 === 0) {
      console.log(`[showcase-v2-media-refresh] ImageKit ${uploaded.length}/${EXPECTED_V2}`);
    }
  }
  return uploaded;
}

async function snapshot(client) {
  const { rows: [row] } = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $1) AS v1_total,
       (SELECT COUNT(*)::int FROM products WHERE is_active=TRUE AND product_ref LIKE $1) AS v1_active,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE $2) AS v2_total,
       (SELECT COUNT(*)::int FROM products WHERE is_active=TRUE AND product_ref LIKE $2) AS v2_active,
       (SELECT COUNT(*)::int FROM products WHERE product_ref LIKE 'GOLDEN-%') AS golden_total,
       (SELECT COUNT(*)::int FROM products WHERE is_active=TRUE AND product_ref LIKE 'GOLDEN-%') AS golden_active`,
    [V1_PATTERN, V2_PATTERN],
  );
  return row;
}

async function applyMedia(uploaded) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const before = await snapshot(client);
    if (before.v2_total !== EXPECTED_V2 || before.v2_active !== EXPECTED_V2) {
      throw new Error(`V2 staging inattendu avant refresh: total=${before.v2_total}, active=${before.v2_active}`);
    }

    let updated = 0;
    for (const media of uploaded) {
      const result = await client.query(
        `UPDATE products
            SET image_url=$2,
                images=$3::jsonb,
                updated_at=NOW()
          WHERE product_ref=$1
            AND product_ref LIKE $4`,
        [media.product_ref, media.image_url, JSON.stringify(media.images), V2_PATTERN],
      );
      if (result.rowCount !== 1) throw new Error(`Produit V2 introuvable: ${media.product_ref}`);
      updated += result.rowCount;
    }

    const { rows: [mediaAudit] } = await client.query(
      `SELECT
         COUNT(*)::int AS v2_rows,
         COUNT(*) FILTER (
           WHERE image_url LIKE 'https://ik.imagekit.io/%/komerce/staging/showcase-v2/%/hero-%'
         )::int AS versioned_rows,
         COUNT(*) FILTER (
           WHERE images IS NULL OR jsonb_array_length(images)=0
         )::int AS missing_images
       FROM products
       WHERE product_ref LIKE $1`,
      [V2_PATTERN],
    );

    const after = await snapshot(client);
    if (updated !== EXPECTED_V2) throw new Error(`Refresh média incomplet: ${updated}/${EXPECTED_V2}`);
    if (mediaAudit.v2_rows !== EXPECTED_V2 || mediaAudit.versioned_rows !== EXPECTED_V2 || mediaAudit.missing_images !== 0) {
      throw new Error(`Audit média V2 invalide: ${JSON.stringify(mediaAudit)}`);
    }
    if (after.v1_total !== before.v1_total || after.v1_active !== before.v1_active) {
      throw new Error(`Invariant V1 cassé: avant=${JSON.stringify(before)}, après=${JSON.stringify(after)}`);
    }
    if (after.v2_total !== before.v2_total || after.v2_active !== before.v2_active) {
      throw new Error(`Invariant V2 cassé: avant=${JSON.stringify(before)}, après=${JSON.stringify(after)}`);
    }
    if (after.golden_total !== before.golden_total || after.golden_active !== before.golden_active) {
      throw new Error(`Invariant Golden cassé: avant=${JSON.stringify(before)}, après=${JSON.stringify(after)}`);
    }

    await client.query('COMMIT');
    const result = { before, updated, mediaAudit, after };
    console.log(`[showcase-v2-media-refresh] ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function refreshShowcaseV2Media() {
  assertStaging();
  const products = validateSource(buildCatalogue());
  const uploaded = await uploadFrenchMedia(products);
  await applyMedia(uploaded);
  return uploaded;
}

async function main() {
  try {
    await refreshShowcaseV2Media();
  } finally {
    await db.pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v2-media-refresh] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_V2,
  assertStaging,
  mediaVersion,
  versionedHeroId,
  validateSource,
  snapshot,
  uploadFrenchMedia,
  applyMedia,
  refreshShowcaseV2Media,
};
