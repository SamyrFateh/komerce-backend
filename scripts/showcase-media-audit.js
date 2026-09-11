#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-media-audit
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        canonical_showcase_manifest, media_provider
 * @outputs       strict_media_audit
 * @depends       scripts/showcase-catalog.js, scripts/showcase-media-provider.js
 * @used-by       staging showcase deployment
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      DOCTRINE_CATALOGUE.md, staging-only realistic fixtures
 * @version       2026-09-v2
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeImages, verifyImageUrl } = require('./showcase-catalog');
const { resolveMediaProvider, isCanonicalMediaUrl } = require('./showcase-media-provider');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 500;
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const NETWORK_MAX_ATTEMPTS = 5;
const NETWORK_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 10000, 20000]);

function parseArgs(argv) {
  const out = {
    target: DEFAULT_TARGET,
    manifest: DEFAULT_MANIFEST,
    mediaProvider: resolveMediaProvider(),
    namespace: 'showcase-v2',
    network: false,
    strict: false,
    concurrency: 10,
  };
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [key, inline] = arg.split('=', 2);
    const next = () => inline ?? args[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else if (key === '--media-provider') out.mediaProvider = resolveMediaProvider(next());
    else if (key === '--namespace') out.namespace = String(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--network') out.network = true;
    else if (arg === '--strict') out.strict = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > 1000) {
    throw new Error('--target doit être un entier entre 1 et 1000');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 25) {
    throw new Error('--concurrency doit être un entier entre 1 et 25');
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableNetworkResult(result) {
  if (!result || result.ok) return false;
  const status = Number(result.status);
  if (!Number.isFinite(status) || status <= 0) return true;
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function verifyMediaUrlWithRetry(url, options = {}) {
  const verifier = options.verifier || verifyImageUrl;
  const sleepImpl = options.sleepImpl || sleep;
  const maxAttempts = options.maxAttempts ?? NETWORK_MAX_ATTEMPTS;
  const delays = options.delays || NETWORK_RETRY_DELAYS_MS;
  let result = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    result = await verifier(url);
    if (result && result.ok) return { ...result, attempts: attempt + 1 };
    if (!retryableNetworkResult(result) || attempt + 1 >= maxAttempts) {
      return { ...(result || { ok: false, reason: 'unknown' }), attempts: attempt + 1 };
    }
    const delay = delays[Math.min(attempt, delays.length - 1)] || 0;
    console.warn(`[showcase:media:audit] média indisponible ${result.status || result.reason || 'réseau'} — retry ${attempt + 1}/${maxAttempts} dans ${delay}ms: ${url}`);
    // eslint-disable-next-line no-await-in-loop
    await sleepImpl(delay);
  }
  return { ...(result || { ok: false, reason: 'unknown' }), attempts: maxAttempts };
}

async function pooledMap(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, worker));
  return results;
}

function staticAudit(products, options) {
  const allImages = products.flatMap(normalizeImages);
  const invalidProvider = [];
  const malformed = [];
  const missingHero = [];

  products.forEach((product, index) => {
    if (!product.image_url) missingHero.push({ index, ref: product.product_ref || null });
    for (const url of normalizeImages(product)) {
      try {
        new URL(url);
      } catch {
        malformed.push({ index, ref: product.product_ref || null, url });
        continue;
      }
      if (!isCanonicalMediaUrl(url, options.mediaProvider, options.namespace)) {
        invalidProvider.push({ index, ref: product.product_ref || null, url });
      }
    }
  });

  return {
    products: products.length,
    images: allImages.length,
    uniqueImages: new Set(allImages).size,
    duplicateRefs: allImages.length - new Set(allImages).size,
    missingHero,
    invalidProvider,
    malformed,
    targetShortfall: Math.max(0, options.target - products.length),
  };
}

async function audit(options) {
  if (!fs.existsSync(options.manifest)) throw new Error(`Manifest absent: ${options.manifest}`);
  const products = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  const report = staticAudit(products, options);
  const urls = [...new Set(products.flatMap(normalizeImages))];
  report.networkFailures = options.network
    ? (await pooledMap(urls, options.concurrency, async (url) => ({ url, ...(await verifyMediaUrlWithRetry(url)) }))).filter((row) => !row.ok)
    : [];

  console.log(JSON.stringify({
    provider: options.mediaProvider,
    namespace: options.namespace,
    products: report.products,
    images: report.images,
    unique_images: report.uniqueImages,
    duplicate_refs: report.duplicateRefs,
    missing_hero: report.missingHero.length,
    invalid_provider_urls: report.invalidProvider.length,
    malformed: report.malformed.length,
    network_failures: report.networkFailures.length,
    network_failure_samples: report.networkFailures.slice(0, 5),
    target_shortfall: report.targetShortfall,
  }, null, 2));

  const errors = [
    ...report.missingHero.map((v) => `missing hero #${v.index}`),
    ...report.invalidProvider.map((v) => `non-${options.mediaProvider} ${v.url}`),
    ...report.malformed.map((v) => `malformed ${v.url}`),
    ...report.networkFailures.map((v) => `network ${v.url}: ${v.reason || v.status} after ${v.attempts || 1} attempt(s)`),
  ];
  if (report.targetShortfall) errors.push(`target shortfall: ${report.targetShortfall}`);
  if (options.strict && errors.length) {
    throw new Error(`Audit média strict en échec (${errors.length})\n${errors.slice(0, 20).map((v) => `  - ${v}`).join('\n')}`);
  }
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await audit(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-media-audit] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  NETWORK_MAX_ATTEMPTS,
  NETWORK_RETRY_DELAYS_MS,
  parseArgs,
  retryableNetworkResult,
  verifyMediaUrlWithRetry,
  staticAudit,
  audit,
};
