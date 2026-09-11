#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-imagekit-v2
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        curated V1+V2 catalogue, IMAGEKIT_PRIVATE_KEY
 * @outputs       ImageKit-hosted showcase V2 manifest, strict media audit
 * @depends       scripts/showcase-catalog.js, scripts/showcase-media-mirror.js, scripts/showcase-media-audit.js
 * @used-by       staging showcase preparation before any catalogue DB seed
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      curated staging fixtures only; media proof precedes DB mutation
 * @version       2026-09-v1
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
const { uploadImageKitFile } = require('./showcase-media-mirror');
const { audit: auditMedia } = require('./showcase-media-audit');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 40;
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const NAMESPACE = 'showcase-v2';
const MEDIA_PROVIDER = 'imagekit';

function parseArgs(argv) {
  const out = {
    command: null,
    target: DEFAULT_TARGET,
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
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (arg === '--network') out.network = true;
    else if (arg === '--strict') out.strict = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!['prepare', 'audit'].includes(out.command)) {
    throw new Error('Commande requise: prepare | audit');
  }
  if (!Number.isInteger(out.target) || out.target < 1 || out.target > DEFAULT_TARGET) {
    throw new Error(`--target doit être un entier entre 1 et ${DEFAULT_TARGET}`);
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

async function mirrorProduct(product, uploader = uploadImageKitFile) {
  const sourceImages = normalizeImages(product).slice(0, 3);
  if (!sourceImages.length) throw new Error(`${product.product_ref}: aucun média source`);

  const folder = productFolder(product.product_ref);
  const uploaded = [];
  for (let i = 0; i < sourceImages.length; i += 1) {
    const sourceUrl = sourceImages[i];
    // ImageKit accepte une URL distante comme champ `file`; le serveur ImageKit
    // récupère alors l'asset source sans exposer la clé privée au navigateur.
    // eslint-disable-next-line no-await-in-loop
    uploaded.push(await uploader(sourceUrl, {
      folder,
      publicId: uploadSlot(i),
      filename: sourceUrl,
    }));
  }
  return { ...product, image_url: uploaded[0], images: uploaded };
}

async function prepare(options, { uploader = uploadImageKitFile } = {}) {
  const source = readProductInputs(DEFAULT_CURATED_INPUTS);
  assertCuratedSource(source);
  const target = resolveTarget(source, options.target);
  const uploaded = [];

  for (const product of source.slice(0, target)) {
    // Séquentiel volontairement : noms stables + ré-exécution idempotente et
    // pression réseau bornée. Une exécution interrompue peut être rejouée.
    // eslint-disable-next-line no-await-in-loop
    uploaded.push(await mirrorProduct(product, uploader));
    if (uploaded.length % 10 === 0) console.log(`[showcase:imagekit] ${uploaded.length}/${target}`);
  }

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
  DEFAULT_MANIFEST,
  NAMESPACE,
  MEDIA_PROVIDER,
  parseArgs,
  productFolder,
  uploadSlot,
  mirrorProduct,
  prepare,
  audit,
};
