#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-media-mirror
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        showcase source manifest, Wikimedia Commons, Cloudinary
 * @outputs       canonical Cloudinary showcase manifest
 * @depends       scripts/showcase-catalog.js, Node fetch/FormData/Blob/crypto/fs/path
 * @used-by       staging showcase deployment
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      DOCTRINE_CATALOGUE.md, staging-only realistic fixtures
 * @version       2026-08-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizeImages,
  cloudinarySignature,
} = require('./showcase-catalog');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 500;
const DEFAULT_SOURCE_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1-source.json');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v1.json');
const WIKIMEDIA_MEDIA_HOST = 'upload.wikimedia.org';
const WIKIMEDIA_USER_AGENT = 'KomerceShowcaseBot/2.1 (https://komerce.co)';
const COMMONS_MIN_DELAY_MS = 1200;
const COMMONS_MAX_ATTEMPTS = 4;
const COMMONS_TIMEOUT_MS = 30000;

let lastCommonsRequestAt = 0;

function parseArgs(argv) {
  const out = {
    target: DEFAULT_TARGET,
    sourceManifest: DEFAULT_SOURCE_MANIFEST,
    manifest: DEFAULT_MANIFEST,
  };
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const [key, inline] = args[i].split('=', 2);
    const next = () => inline ?? args[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--source-manifest') out.sourceManifest = path.resolve(next());
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else throw new Error(`Argument inconnu: ${args[i]}`);
  }
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > 1000) {
    throw new Error('--target doit être un entier entre 1 et 1000');
  }
  return out;
}

function isWikimediaMediaUrl(value) {
  try { return new URL(value).hostname === WIKIMEDIA_MEDIA_HOST; }
  catch { return false; }
}

function mediaFilename(value) {
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    const name = path.basename(pathname).replace(/[^a-zA-Z0-9._-]+/g, '-');
    return name || 'commons-image';
  } catch {
    return 'commons-image';
  }
}

function retryAfterMs(value, attempt = 0, now = Date.now()) {
  if (value != null && String(value).trim() !== '') {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const at = Date.parse(String(value));
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return Math.min(30000, 1000 * (2 ** attempt));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCommonsSlot({ sleepImpl = sleep, nowImpl = Date.now, minDelayMs = COMMONS_MIN_DELAY_MS } = {}) {
  const waitMs = Math.max(0, lastCommonsRequestAt + minDelayMs - nowImpl());
  if (waitMs > 0) await sleepImpl(waitMs);
  lastCommonsRequestAt = nowImpl();
}

async function downloadWikimediaMedia(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const nowImpl = options.nowImpl || Date.now;
  const minDelayMs = options.minDelayMs ?? COMMONS_MIN_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? COMMONS_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? COMMONS_TIMEOUT_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForCommonsSlot({ sleepImpl, nowImpl, minDelayMs });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          'User-Agent': WIKIMEDIA_USER_AGENT,
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (attempt + 1 >= maxAttempts) throw error;
      await sleepImpl(retryAfterMs(null, attempt, nowImpl()));
      continue;
    }
    clearTimeout(timer);

    if ((response.status === 429 || response.status === 503) && attempt + 1 < maxAttempts) {
      await sleepImpl(retryAfterMs(response.headers.get('retry-after'), attempt, nowImpl()));
      continue;
    }

    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.startsWith('image/')) {
      throw new Error(`Wikimedia media failed (${response.status}): ${type || 'unknown content-type'}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength <= 64) throw new Error(`Wikimedia media too small: ${bytes.byteLength} bytes`);
    return {
      blob: new Blob([bytes], { type }),
      filename: mediaFilename(url),
      bytes: bytes.byteLength,
      type,
    };
  }
  throw new Error('Wikimedia media retries exhausted');
}

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET sont requis');
  }
  return { cloudName, apiKey, apiSecret };
}

async function uploadCloudinaryFile(file, { folder, publicId, filename = null }) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, overwrite: 'true', public_id: publicId, timestamp };
  const form = new FormData();
  if (file instanceof Blob) form.set('file', file, filename || 'source-image');
  else form.set('file', file);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('folder', folder);
  form.set('public_id', publicId);
  form.set('overwrite', 'true');
  form.set('signature', cloudinarySignature(params, apiSecret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.secure_url) {
    throw new Error(`Cloudinary upload failed (${response.status}): ${body.error?.message || 'unknown error'}`);
  }
  return body.secure_url;
}

async function mirrorSourceImage(url, uploadOptions) {
  if (!isWikimediaMediaUrl(url)) return uploadCloudinaryFile(url, uploadOptions);
  const downloaded = await downloadWikimediaMedia(url);
  return uploadCloudinaryFile(downloaded.blob, { ...uploadOptions, filename: downloaded.filename });
}

async function mirrorProduct(product) {
  const folder = `komerce/staging/showcase-v1/${product.product_ref.toLowerCase()}`;
  const sourceImages = normalizeImages(product).slice(0, 3);
  const uploaded = [];
  for (let i = 0; i < sourceImages.length; i += 1) {
    uploaded.push(await mirrorSourceImage(sourceImages[i], {
      folder,
      publicId: i === 0 ? 'hero' : `gallery-${String(i).padStart(2, '0')}`,
    }));
  }
  return { ...product, image_url: uploaded[0], images: uploaded };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.sourceManifest)) throw new Error(`Source manifest absent: ${options.sourceManifest}`);
  const source = JSON.parse(fs.readFileSync(options.sourceManifest, 'utf8'));
  if (source.length < options.target) throw new Error(`Source manifest sous cible: ${source.length}/${options.target}`);

  const uploaded = [];
  for (const product of source.slice(0, options.target)) {
    uploaded.push(await mirrorProduct(product));
    if (uploaded.length % 25 === 0) console.log(`[showcase] Cloudinary ${uploaded.length}/${options.target}`);
  }

  fs.mkdirSync(path.dirname(options.manifest), { recursive: true });
  fs.writeFileSync(options.manifest, JSON.stringify(uploaded, null, 2) + '\n', 'utf8');
  console.log(`[showcase] Cloudinary manifest: ${uploaded.length} -> ${options.manifest}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-media-mirror] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  isWikimediaMediaUrl,
  mediaFilename,
  retryAfterMs,
  downloadWikimediaMedia,
};
