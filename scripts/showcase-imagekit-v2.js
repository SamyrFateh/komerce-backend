#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-imagekit-v2
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        curated showcase fixture, IMAGEKIT_PRIVATE_KEY
 * @outputs       ImageKit-hosted showcase manifest, strict media audit
 * @depends       scripts/showcase-catalog.js, scripts/showcase-media-mirror.js, scripts/showcase-media-audit.js
 * @used-by       staging showcase preparation before any catalogue DB seed
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      curated staging fixtures only; remote media is materialized and validated before provider upload; media proof precedes DB mutation
 * @version       2026-09-v4
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_CURATED_INPUTS,
  readProductInputs,
  assertCuratedSource,
  resolveTarget,
  normalizeImages,
} = require('./showcase-catalog');
const {
  uploadImageKitFile,
  downloadWikimediaMedia,
  isWikimediaMediaUrl,
  mediaFilename,
} = require('./showcase-media-mirror');
const { audit: auditMedia } = require('./showcase-media-audit');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 40;
const MAX_TARGET = 500;
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const NAMESPACE = 'showcase-v2';
const MEDIA_PROVIDER = 'imagekit';
const REMOTE_MEDIA_MAX_ATTEMPTS = 4;
const REMOTE_MEDIA_TIMEOUT_MS = 25000;
const REMOTE_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const REMOTE_MEDIA_RETRY_DELAYS_MS = Object.freeze([1000, 2500, 5000]);
const REMOTE_MEDIA_USER_AGENT = 'KomerceShowcaseBuilder/3.5 (https://komerce.co)';

function parseInput(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => path.resolve(entry));
}

function parseArgs(argv) {
  const out = {
    command: null,
    target: DEFAULT_TARGET,
    input: DEFAULT_CURATED_INPUTS,
    manifest: DEFAULT_MANIFEST,
    network: false,
    strict: false,
    concurrency: 10,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) out.command = args.shift();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [key, inline] = arg.split('=', 2);
    const next = () => inline ?? args[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--input') out.input = parseInput(next());
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--network') out.network = true;
    else if (arg === '--strict') out.strict = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!['prepare', 'audit'].includes(out.command)) {
    throw new Error('Commande requise: prepare | audit');
  }
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > MAX_TARGET) {
    throw new Error(`--target doit être un entier entre 1 et ${MAX_TARGET}`);
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 25) {
    throw new Error('--concurrency doit être un entier entre 1 et 25');
  }
  return out;
}

function productFolder(productRef) {
  const ref = String(productRef || '').trim().toLowerCase();
  if (!/^kpr-\d{6,}$/.test(ref)) throw new Error(`product_ref canonique requis: ${productRef || '(vide)'}`);
  return `komerce/staging/${NAMESPACE}/${ref}`;
}

function uploadSlot(index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('index média invalide');
  return index === 0 ? 'hero' : `gallery-${String(index).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remoteRetryDelay(attempt) {
  return REMOTE_MEDIA_RETRY_DELAYS_MS[Math.min(attempt, REMOTE_MEDIA_RETRY_DELAYS_MS.length - 1)];
}

function retryableRemoteStatus(status) {
  return status === 429 || status === 408 || status >= 500;
}

async function downloadRemoteSourceMedia(sourceUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const maxAttempts = options.maxAttempts ?? REMOTE_MEDIA_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? REMOTE_MEDIA_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? REMOTE_MEDIA_MAX_BYTES;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(sourceUrl, {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          'User-Agent': REMOTE_MEDIA_USER_AGENT,
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt + 1 >= maxAttempts) throw error;
      // eslint-disable-next-line no-await-in-loop
      await sleepImpl(remoteRetryDelay(attempt));
      continue;
    }
    clearTimeout(timer);

    if (!response.ok) {
      lastError = new Error(`Source media failed (${response.status}): ${sourceUrl}`);
      if (!retryableRemoteStatus(response.status) || attempt + 1 >= maxAttempts) throw lastError;
      // eslint-disable-next-line no-await-in-loop
      await sleepImpl(remoteRetryDelay(attempt));
      continue;
    }

    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) {
      throw new Error(`Source media non-image (${type || 'unknown content-type'}): ${sourceUrl}`);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Source media trop volumineux (${declaredLength} bytes): ${sourceUrl}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength <= 64) throw new Error(`Source media trop petit (${bytes.byteLength} bytes): ${sourceUrl}`);
    if (bytes.byteLength > maxBytes) throw new Error(`Source media trop volumineux (${bytes.byteLength} bytes): ${sourceUrl}`);
    return {
      blob: new Blob([bytes], { type }),
      filename: mediaFilename(sourceUrl),
      bytes: bytes.byteLength,
      type,
    };
  }

  throw lastError || new Error(`Source media retries exhausted: ${sourceUrl}`);
}

async function downloadSourceMedia(sourceUrl, options = {}) {
  if (isWikimediaMediaUrl(sourceUrl)) {
    const wikimediaDownloader = options.wikimediaDownloader || downloadWikimediaMedia;
    return wikimediaDownloader(sourceUrl);
  }
  return downloadRemoteSourceMedia(sourceUrl, options);
}

async function uploadSourceImage(
  sourceUrl,
  uploadOptions,
  { uploader = uploadImageKitFile, downloader = downloadSourceMedia } = {},
) {
  // ImageKit peut accepter une URL distante puis ne jamais matérialiser l'objet.
  // Le showcase staging privilégie donc une preuve forte : Komerce récupère d'abord
  // les octets et le MIME, puis envoie un Blob réellement possédé au provider.
  const downloaded = await downloader(sourceUrl);
  return uploader(downloaded.blob, {
    ...uploadOptions,
    filename: downloaded.filename,
  });
}

async function mirrorProduct(product, uploader = uploadImageKitFile, downloader = downloadSourceMedia) {
  const sourceImages = normalizeImages(product).slice(0, 3);
  if (!sourceImages.length) throw new Error(`${product.product_ref}: aucun média source`);

  const folder = productFolder(product.product_ref);
  const uploaded = [];
  for (let i = 0; i < sourceImages.length; i += 1) {
    const sourceUrl = sourceImages[i];
    // eslint-disable-next-line no-await-in-loop
    uploaded.push(await uploadSourceImage(sourceUrl, {
      folder,
      publicId: uploadSlot(i),
    }, { uploader, downloader }));
  }
  return { ...product, image_url: uploaded[0], images: uploaded };
}

async function pooledMirror(products, concurrency, uploader, downloader) {
  const results = new Array(products.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= products.length) return;
      results[index] = await mirrorProduct(products[index], uploader, downloader);
      completed += 1;
      if (completed % 25 === 0 || completed === products.length) {
        console.log(`[showcase:imagekit] ${completed}/${products.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, products.length)) }, worker));
  return results;
}

async function prepare(options, { uploader = uploadImageKitFile, downloader = downloadSourceMedia } = {}) {
  const source = readProductInputs(options.input || DEFAULT_CURATED_INPUTS);
  assertCuratedSource(source);
  const target = resolveTarget(source, options.target);
  const selected = source.slice(0, target);
  const uploaded = await pooledMirror(selected, options.concurrency || 10, uploader, downloader);

  fs.mkdirSync(path.dirname(options.manifest), { recursive: true });
  fs.writeFileSync(options.manifest, `${JSON.stringify(uploaded, null, 2)}\n`, 'utf8');
  console.log(`[showcase:imagekit] manifeste: ${uploaded.length} -> ${options.manifest}`);
  return uploaded;
}

async function audit(options) {
  return auditMedia({
    target: options.target,
    manifest: options.manifest,
    mediaProvider: MEDIA_PROVIDER,
    namespace: NAMESPACE,
    network: options.network,
    strict: options.strict,
    concurrency: options.concurrency,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'prepare') await prepare(options);
  else await audit(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-imagekit-v2] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TARGET,
  MAX_TARGET,
  DEFAULT_MANIFEST,
  NAMESPACE,
  MEDIA_PROVIDER,
  REMOTE_MEDIA_MAX_ATTEMPTS,
  REMOTE_MEDIA_TIMEOUT_MS,
  REMOTE_MEDIA_MAX_BYTES,
  parseInput,
  parseArgs,
  productFolder,
  uploadSlot,
  remoteRetryDelay,
  retryableRemoteStatus,
  downloadRemoteSourceMedia,
  downloadSourceMedia,
  uploadSourceImage,
  mirrorProduct,
  pooledMirror,
  prepare,
  audit,
};