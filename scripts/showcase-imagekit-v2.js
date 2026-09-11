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
 * @doctrine      curated staging fixtures only; media proof precedes DB mutation
 * @version       2026-09-v3
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
} = require('./showcase-media-mirror');
const { audit: auditMedia } = require('./showcase-media-audit');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 40;
const MAX_TARGET = 500;
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const NAMESPACE = 'showcase-v2';
const MEDIA_PROVIDER = 'imagekit';

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

async function uploadSourceImage(
  sourceUrl,
  uploadOptions,
  { uploader = uploadImageKitFile, downloader = downloadWikimediaMedia } = {},
) {
  try {
    return await uploader(sourceUrl, { ...uploadOptions, filename: sourceUrl });
  } catch (error) {
    if (!isWikimediaMediaUrl(sourceUrl)) throw error;
    console.warn(`[showcase:imagekit] remote fetch Wikimedia refusé, fallback Blob: ${sourceUrl}`);
    const downloaded = await downloader(sourceUrl);
    return uploader(downloaded.blob, {
      ...uploadOptions,
      filename: downloaded.filename,
    });
  }
}

async function mirrorProduct(product, uploader = uploadImageKitFile, downloader = downloadWikimediaMedia) {
  const sourceImages = normalizeImages(product).slice(0, 3);
  if (!sourceImages.length) throw new Error(`${product.product_ref}: aucun média source`);

  const folder = productFolder(product.product_ref);
  const uploaded = [];
  for (let i = 0; i < sourceImages.length; i += 1) {
    const sourceUrl = sourceImages[i];
    // Fast path: ImageKit fetch distant. Pour Wikimedia seulement, si le provider
    // refuse le remote fetch, Komerce télécharge l'objet avec sa politique dédiée
    // (User-Agent, Retry-After, MIME/taille) puis envoie le Blob à ImageKit.
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

async function prepare(options, { uploader = uploadImageKitFile, downloader = downloadWikimediaMedia } = {}) {
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
  parseInput,
  parseArgs,
  productFolder,
  uploadSlot,
  uploadSourceImage,
  mirrorProduct,
  pooledMirror,
  prepare,
  audit,
};
