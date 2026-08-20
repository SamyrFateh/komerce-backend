#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          showcase-v2-media-realism
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        scripts/showcase-v2-source-build.js, OpenAI Image API
 * @outputs       ImageKit hero.jpg assets, JSON execution report
 * @depends       scripts/showcase-v2-source-build.js, scripts/showcase-media-mirror.js
 * @used-by       .github/workflows/showcase-v2-media-realism.yml
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @version       2026-08-v1
 *
 * SHOWCASE V2 — couche de réalisme média post-promotion.
 *
 * Ne relance ni la Raffinerie, ni Luna, ni la promotion. Elle remplace seulement
 * les SVG de fixture déjà hébergés dans ImageKit en écrasant le hero.jpg au même
 * chemin canonique. Les URLs déjà publiées restent donc stables.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildCatalogue } = require('./showcase-v2-source-build');
const { uploadImageKitFile } = require('./showcase-media-mirror');

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const IMAGEKIT_PURGE_URL = 'https://api.imagekit.io/v1/files/purge';
const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_QUALITY = 'medium';
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 150_000;
const MAX_ATTEMPTS = 4;
const BULK_CONFIRMATION = 'GENERATE-500';
const DEFAULT_OUTPUT = path.resolve(process.cwd(), 'artifacts', 'showcase-v2-media-realism-report.json');

function parseArgs(argv) {
  const out = {
    apply: false,
    scope: 'pilot',
    refs: [],
    model: DEFAULT_MODEL,
    quality: DEFAULT_QUALITY,
    size: DEFAULT_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    confirmAll: null,
    output: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--apply') out.apply = true;
    else if (key === '--scope') out.scope = String(next()).trim().toLowerCase();
    else if (key === '--refs') out.refs = String(next()).split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
    else if (key === '--model') out.model = String(next()).trim();
    else if (key === '--quality') out.quality = String(next()).trim().toLowerCase();
    else if (key === '--size') out.size = String(next()).trim().toLowerCase();
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (key === '--confirm-all') out.confirmAll = String(next()).trim();
    else if (key === '--output') out.output = path.resolve(next());
    else throw new Error(`Argument inconnu: ${argv[i]}`);
  }

  if (!['pilot', 'all'].includes(out.scope)) throw new Error('--scope doit être pilot ou all');
  if (!['low', 'medium', 'high'].includes(out.quality)) throw new Error('--quality doit être low, medium ou high');
  if (!/^\d+x\d+$/.test(out.size)) throw new Error('--size doit être au format LARGEURxHAUTEUR');
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 4) {
    throw new Error('--concurrency doit être un entier entre 1 et 4');
  }
  return out;
}

function segmentKey(product) {
  return `${product.category}/${product.subcategory}`;
}

function selectPilotProducts(products) {
  const seen = new Set();
  const selected = [];
  for (const product of products) {
    const key = segmentKey(product);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(product);
  }
  return selected;
}

function selectTargets(products, options) {
  const byRef = new Map(products.map((product) => [String(product.product_ref).toUpperCase(), product]));
  let selected;
  if (options.refs.length > 0) {
    selected = options.refs.map((ref) => {
      const product = byRef.get(ref);
      if (!product) throw new Error(`Référence Showcase V2 inconnue: ${ref}`);
      return product;
    });
  } else {
    selected = options.scope === 'all' ? products.slice() : selectPilotProducts(products);
  }

  if (options.apply && selected.length > 21 && options.confirmAll !== BULK_CONFIRMATION) {
    throw new Error(`Garde bulk: ${selected.length} images demandées. Ajouter --confirm-all=${BULK_CONFIRMATION}`);
  }
  return selected;
}

function splitSourceTitle(product) {
  const [identity, series] = String(product.source_title || product.name || '').split(/\s+—\s+/, 2);
  return {
    identity: identity || String(product.name || product.product_ref),
    series: series || null,
  };
}

function buildImagePrompt(product) {
  const { identity, series } = splitSourceTitle(product);
  const line = series ? `Commercial line/style: ${series}. Use it only as a subtle design cue; do not render this word.` : '';
  return [
    `Create a photorealistic e-commerce hero photograph of this sellable product: ${identity}.`,
    line,
    `Catalogue context: ${product.category} / ${product.subcategory}.`,
    'Show exactly one primary product, or the coherent set/pair/kit only when the product name explicitly describes a set, pair or kit.',
    'Center the full product in frame, with a clean three-quarter view when appropriate and a soft realistic contact shadow.',
    'Use a seamless white or very light warm-neutral studio background. Keep generous breathing room around the object.',
    'The product must be generic and unbranded: no logos, no brand marks, no labels, no readable text, no watermark and no promotional badges.',
    'No people, no hands, no faces, no lifestyle scene and no unrelated props. For garments, use a clean product-only presentation without a visible human model.',
    'Use realistic materials, plausible proportions, commercially attractive lighting and marketplace-ready product photography.',
    'Do not add text anywhere in the image.',
  ].filter(Boolean).join(' ');
}

function imageKitTarget(productRef) {
  const ref = String(productRef).toLowerCase();
  return {
    folder: `komerce/staging/showcase-v2/${ref}`,
    publicId: 'hero',
    filename: 'hero.jpg',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  return Math.min(30_000, 1500 * (2 ** attempt));
}

async function generateJpeg(product, options, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const sleepImpl = deps.sleepImpl || sleep;
  const apiKey = deps.openAiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY requis pour --apply');
  const prompt = buildImagePrompt(product);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(OPENAI_IMAGE_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          prompt,
          size: options.size,
          quality: options.quality,
          output_format: 'jpeg',
          output_compression: 88,
          background: 'opaque',
          n: 1,
        }),
      });
    } catch (error) {
      clearTimeout(timer);
      if (attempt + 1 >= MAX_ATTEMPTS) throw error;
      await sleepImpl(Math.min(30_000, 1500 * (2 ** attempt)));
      continue;
    }
    clearTimeout(timer);

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = body?.error?.code || null;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt + 1 < MAX_ATTEMPTS) {
        await sleepImpl(retryDelayMs(response, attempt));
        continue;
      }
      const err = new Error(`OpenAI Image API ${response.status}: ${code || body?.error?.message || 'unknown error'}`);
      err.code = code || 'IMAGE_GENERATION_FAILED';
      err.status = response.status;
      throw err;
    }

    const encoded = body?.data?.[0]?.b64_json;
    if (!encoded) throw new Error('OpenAI Image API: réponse sans data[0].b64_json');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 10_000) throw new Error(`Image générée anormalement petite: ${bytes.length} octets`);
    return {
      bytes,
      prompt,
      requestId: response.headers.get('x-request-id') || null,
    };
  }
  throw new Error('OpenAI Image API: retries exhausted');
}

function showcaseNamespacePurgeUrl(uploadedUrl) {
  const url = new URL(uploadedUrl);
  const marker = '/komerce/staging/showcase-v2/';
  const index = url.pathname.indexOf(marker);
  if (index < 0) throw new Error(`URL ImageKit hors namespace Showcase V2: ${uploadedUrl}`);
  url.pathname = `${url.pathname.slice(0, index)}/komerce/staging/showcase-v2/*`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function purgeImageKitNamespace(uploadedUrl, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const privateKey = deps.imageKitPrivateKey || process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) throw new Error('IMAGEKIT_PRIVATE_KEY requis pour purge CDN');
  const url = showcaseNamespacePurgeUrl(uploadedUrl);
  const response = await fetchImpl(IMAGEKIT_PURGE_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${privateKey}:`, 'utf8').toString('base64')}`,
    },
    body: JSON.stringify({ url }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ImageKit purge ${response.status}: ${body?.message || 'unknown error'}`);
  return { url, requestId: body.requestId || null };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function applyProduct(product, options, deps = {}) {
  const generated = await generateJpeg(product, options, deps);
  const target = imageKitTarget(product.product_ref);
  const upload = deps.uploadImpl || uploadImageKitFile;
  const blob = new Blob([generated.bytes], { type: 'image/jpeg' });
  const url = await upload(blob, target, { fetchImpl: deps.fetchImpl });
  return {
    product_ref: product.product_ref,
    category: product.category,
    subcategory: product.subcategory,
    source_title: product.source_title,
    imagekit_url: url,
    bytes: generated.bytes.length,
    openai_request_id: generated.requestId,
    prompt: generated.prompt,
    status: 'generated',
  };
}

function planRow(product) {
  const target = imageKitTarget(product.product_ref);
  return {
    product_ref: product.product_ref,
    category: product.category,
    subcategory: product.subcategory,
    source_title: product.source_title,
    imagekit_folder: target.folder,
    imagekit_filename: target.filename,
    prompt: buildImagePrompt(product),
    status: 'planned',
  };
}

function writeReport(output, report) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const products = buildCatalogue();
  const targets = selectTargets(products, options);
  const baseReport = {
    version: '2026-08-v1',
    mode: options.apply ? 'apply' : 'plan',
    scope: options.refs.length ? 'refs' : options.scope,
    model: options.model,
    quality: options.quality,
    size: options.size,
    count: targets.length,
    created_at: new Date().toISOString(),
  };

  if (!options.apply) {
    const report = { ...baseReport, items: targets.map(planRow) };
    writeReport(options.output, report);
    console.log(`[showcase-v2-media-realism] plan ${targets.length} -> ${options.output}`);
    return report;
  }

  const items = await mapWithConcurrency(targets, options.concurrency, async (product, index) => {
    console.log(`[showcase-v2-media-realism] ${index + 1}/${targets.length} ${product.product_ref} ${product.source_title}`);
    return applyProduct(product, options);
  });

  let purge = null;
  if (items.length > 0) purge = await purgeImageKitNamespace(items[0].imagekit_url);
  const report = { ...baseReport, purge, items };
  writeReport(options.output, report);
  console.log(`[showcase-v2-media-realism] generated ${items.length}/${targets.length}; purge=${purge?.requestId || 'submitted'} -> ${options.output}`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v2-media-realism] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  BULK_CONFIRMATION,
  DEFAULT_MODEL,
  DEFAULT_QUALITY,
  DEFAULT_SIZE,
  parseArgs,
  segmentKey,
  selectPilotProducts,
  selectTargets,
  splitSourceTitle,
  buildImagePrompt,
  imageKitTarget,
  retryDelayMs,
  generateJpeg,
  showcaseNamespacePurgeUrl,
  purgeImageKitNamespace,
  mapWithConcurrency,
  applyProduct,
  planRow,
  main,
};
