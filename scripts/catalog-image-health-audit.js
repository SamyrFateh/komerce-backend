#!/usr/bin/env node
'use strict';

/**
 * Read-only production audit for Boutique product media.
 *
 * Measures the actual remote health of every image candidate exposed by
 * active + available products. No product row or media row is mutated.
 */

const db = require('../db');

const TIMEOUT_MS = Number(process.env.KOMERCE_IMAGE_AUDIT_TIMEOUT_MS || 5000);
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.KOMERCE_IMAGE_AUDIT_CONCURRENCY || 6)));
const SLOW_MS = Number(process.env.KOMERCE_IMAGE_AUDIT_SLOW_MS || 1500);

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function uniqUrls(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!/^https:\/\//i.test(value) || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

async function probe(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; KomerceCatalogImageAudit/1.0)',
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const latencyMs = Date.now() - started;
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    const healthy = response.ok && (contentType.startsWith('image/') || contentType === 'application/octet-stream');
    return {
      url,
      healthy,
      status: response.status,
      contentType,
      latencyMs,
      slow: latencyMs >= SLOW_MS,
      error: null,
    };
  } catch (error) {
    return {
      url,
      healthy: false,
      status: null,
      contentType: '',
      latencyMs: Date.now() - started,
      slow: true,
      error: error && error.name === 'AbortError' ? 'timeout' : String(error && error.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return results;
}

async function main() {
  const { rows: products } = await db.query(
    `SELECT id, product_ref, name, image_url, images, sort_order, sourcing_source
       FROM products
      WHERE is_active = TRUE
        AND is_available = TRUE
      ORDER BY sort_order ASC, created_at DESC`
  );

  const ids = products.map((product) => product.id);
  let mediaRows = [];
  if (ids.length) {
    const result = await db.query(
      `SELECT product_id, url, role, display_order, created_at
         FROM catalog_media
        WHERE is_active = TRUE
          AND product_id = ANY($1::uuid[])
        ORDER BY product_id, display_order ASC NULLS LAST, created_at ASC`,
      [ids]
    );
    mediaRows = result.rows;
  }

  const mediaByProduct = new Map();
  for (const media of mediaRows) {
    const key = String(media.product_id);
    if (!mediaByProduct.has(key)) mediaByProduct.set(key, []);
    mediaByProduct.get(key).push(media.url);
  }

  const productCandidates = products.map((product) => ({
    product,
    candidates: uniqUrls([
      product.image_url,
      ...toArray(product.images),
      ...(mediaByProduct.get(String(product.id)) || []),
    ]),
  }));

  const uniqueUrls = uniqUrls(productCandidates.flatMap((entry) => entry.candidates));
  const probes = await mapLimit(uniqueUrls, CONCURRENCY, probe);
  const byUrl = new Map(probes.map((result) => [result.url, result]));

  const rows = productCandidates.map(({ product, candidates }) => {
    const results = candidates.map((url) => byUrl.get(url)).filter(Boolean);
    const firstHealthy = results.find((result) => result.healthy) || null;
    const hero = product.image_url ? byUrl.get(String(product.image_url).trim()) : null;
    return {
      id: product.id,
      ref: product.product_ref,
      name: product.name,
      sourcing_source: product.sourcing_source,
      sort_order: product.sort_order,
      candidate_count: candidates.length,
      hero_present: Boolean(product.image_url),
      hero_healthy: Boolean(hero && hero.healthy),
      hero_status: hero ? hero.status : null,
      hero_latency_ms: hero ? hero.latencyMs : null,
      has_healthy_candidate: Boolean(firstHealthy),
      healthy_candidate_url: firstHealthy ? firstHealthy.url : null,
      all_candidates_slow: results.length > 0 && results.every((result) => result.slow),
    };
  });

  const summary = {
    total_exposed: rows.length,
    no_candidate: rows.filter((row) => row.candidate_count === 0).length,
    hero_missing: rows.filter((row) => !row.hero_present).length,
    hero_unhealthy: rows.filter((row) => row.hero_present && !row.hero_healthy).length,
    no_healthy_candidate: rows.filter((row) => !row.has_healthy_candidate).length,
    healthy_with_alternate_only: rows.filter((row) => !row.hero_healthy && row.has_healthy_candidate).length,
    slow_hero: rows.filter((row) => row.hero_healthy && Number(row.hero_latency_ms) >= SLOW_MS).length,
    unique_urls_probed: uniqueUrls.length,
    timeout_ms: TIMEOUT_MS,
    slow_ms: SLOW_MS,
  };

  console.log(`[catalog-image-audit] SUMMARY ${JSON.stringify(summary)}`);
  for (const row of rows.filter((entry) => !entry.hero_healthy || entry.all_candidates_slow)) {
    console.log(`[catalog-image-audit] PRODUCT ${JSON.stringify(row)}`);
  }
}

main()
  .catch((error) => {
    console.error('[catalog-image-audit] FATAL', error && error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (db && typeof db.end === 'function') await db.end().catch(() => {});
  });
