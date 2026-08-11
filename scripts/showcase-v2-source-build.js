#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-source-builder
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        Wikimedia Commons
 * @outputs       data/catalogue-test-raw/showcase-catalog-v2-source.json
 * @depends       scripts/showcase-v2-plan.js, scripts/showcase-catalog.js
 * @used-by       showcase v2 staging deploy
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @version       2026-08-v2
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { TAXONOMY_TARGETS, buildSlots } = require('./showcase-v2-plan');
const { roundKmf, stableInt, localizeTitle } = require('./showcase-catalog');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2-source.json');
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'KomerceShowcaseBot/2.2 (https://komerce.co)';
const API_MIN_DELAY_MS = 650;
const API_RETRIES = 5;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_QUERY = 6;

// Réserve métier : Commons peut être pauvre sur une formulation précise alors
// qu'un vocabulaire voisin contient largement assez de médias. On élargit les
// requêtes, jamais les invariants de licence/résolution/unicité.
const FALLBACK_QUERIES = Object.freeze({
  'Mode & Beauté/Femme': ['women clothing', 'dress', 'blouse', 'skirt', 'women shoes', 'handbag'],
  'Mode & Beauté/Homme': ['men clothing', 'shirt', 'mens jacket', 'trousers', 'men shoes', 'mens fashion'],
  'Mode & Beauté/Enfant': ['children clothing', 'kids clothing', 'children shoes', 'school uniform', 'childrens fashion'],
  'Mode & Beauté/Beauté': ['cosmetics', 'makeup', 'skin care', 'perfume bottle', 'lipstick', 'beauty product'],

  'Maison/Confort': ['home appliance', 'electric fan', 'vacuum cleaner', 'clothes iron', 'space heater', 'household appliance'],
  'Maison/Cuisine': ['kitchen utensil', 'cookware', 'kettle', 'frying pan', 'cutlery', 'kitchen appliance'],
  'Maison/Déco': ['home decoration', 'vase', 'table lamp', 'cushion', 'wall clock', 'decorative object'],
  'Maison/Enfants': ['school supplies', 'children furniture', 'backpack', 'pencil case', 'notebook', 'desk accessory'],

  'Tech/Phones': ['smartphone', 'mobile phone', 'cell phone', 'telephone handset'],
  'Tech/Audio': ['headphones', 'earphones', 'loudspeaker', 'portable speaker', 'radio receiver', 'audio equipment'],
  'Tech/Montres': ['wristwatch', 'smartwatch', 'watch', 'digital watch', 'mechanical watch'],

  'Bricolage/Outillage': ['hand tool', 'power tool', 'screwdriver', 'hammer', 'electric drill', 'pliers'],
  'Bricolage/Electricité': ['electrical connector', 'electric cable', 'electrical socket', 'light switch', 'extension cord', 'electrical equipment'],
  'Bricolage/Sécurité': ['padlock', 'door lock', 'security camera', 'safe lock', 'door security', 'lock hardware'],

  'Créations personnelles/Cérémonie': ['formal dress', 'wedding dress', 'suit clothing', 'ceremonial clothing', 'formal wear'],
  'Créations personnelles/Cadeau': ['gift box', 'souvenir object', 'gift item', 'decorative mug', 'keepsake', 'present box'],
  'Créations personnelles/Impression': ['printed mug', 'printed stationery', 'greeting card', 'poster print', 'printed notebook', 'printed paper product'],

  'Auto/Filtres': ['oil filter', 'air filter automotive', 'automotive filter', 'fuel filter', 'car filter'],
  'Auto/Freinage': ['brake disc', 'brake pad', 'automotive brake', 'disc brake', 'brake caliper'],
  'Auto/Éclairage': ['car headlight', 'automotive lamp', 'tail light', 'vehicle headlamp', 'car light'],
  'Auto/Moto': ['motorcycle part', 'motorcycle accessory', 'motorcycle helmet', 'motorcycle mirror', 'motorcycle light'],
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = { target: 500, output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--output') out.output = path.resolve(next());
    else throw new Error(`Argument inconnu: ${argv[i]}`);
  }
  if (!Number.isInteger(out.target) || out.target !== 500) {
    throw new Error('--target doit être exactement 500 pour la campagne Showcase V2');
  }
  return out;
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response?.headers?.get?.('retry-after') || '', 10);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 30000);
  return Math.min(1000 * (2 ** attempt), 15000);
}

async function fetchJson(url) {
  for (let attempt = 0; attempt <= API_RETRIES; attempt += 1) {
    await sleep(API_MIN_DELAY_MS);
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      redirect: 'follow',
    });
    if (response.ok) {
      const body = await response.json();
      if (body?.error?.code === 'maxlag' && attempt < API_RETRIES) {
        await sleep(Math.min(1200 * (2 ** attempt), 15000));
        continue;
      }
      return body;
    }
    if ((response.status === 429 || response.status === 503) && attempt < API_RETRIES) {
      const waitMs = retryDelayMs(response, attempt);
      console.log(`[showcase-v2-source] ${response.status}; retry ${attempt + 1}/${API_RETRIES} dans ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${new URL(url).hostname} -> HTTP ${response.status}`);
  }
  throw new Error('Wikimedia retries exhausted');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|lt|gt);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReusableLicense(value) {
  const license = String(value || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (!license || license.includes('noncommercial') || license.includes('-nc') || license.includes('-nd')) return false;
  return license.includes('public-domain') || license.includes('publicdomain') || license.includes('cc0') || license.includes('cc-by');
}

function mapPage(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const mime = String(info.mime || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return null;
  const width = Number(info.width || info.thumbwidth || 0);
  const height = Number(info.height || info.thumbheight || 0);
  if (width < 400 || height < 300) return null;
  const ratio = width / height;
  if (ratio < 0.45 || ratio > 2.4) return null;

  const meta = info.extmetadata || {};
  const license = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value);
  if (!isReusableLicense(license)) return null;
  const url = info.thumburl || info.url;
  if (!url) return null;

  return {
    pageid: page.pageid,
    source: `commons:${page.pageid}`,
    source_url: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
    image_url: url,
    images: [url],
    name: localizeTitle(page.title),
    source_description: stripHtml(meta.ImageDescription?.value),
    source_attribution: {
      license,
      artist: stripHtml(meta.Artist?.value || 'Contributeur Wikimedia Commons'),
    },
  };
}

async function searchCommons(query) {
  const rows = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_QUERY; pageIndex += 1) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: String(PAGE_SIZE),
      gsroffset: String(offset),
      prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata',
      iiurlwidth: '900',
      iiextmetadatafilter: 'LicenseShortName|UsageTerms|Artist|ImageDescription',
      maxlag: '5',
      format: 'json',
      formatversion: '2',
    });
    const body = await fetchJson(`${COMMONS_API}?${params}`);
    rows.push(...(body.query?.pages || []).map(mapPage).filter(Boolean));
    const next = body.continue?.gsroffset;
    if (!Number.isInteger(next)) break;
    offset = next;
  }
  return rows;
}

function segmentKey(target) {
  return `${target.category}/${target.subcategory}`;
}

function queriesForTarget(target) {
  const all = [...(target.queries || []), ...(FALLBACK_QUERIES[segmentKey(target)] || [])];
  const seen = new Set();
  return all.filter((query) => {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function decorate(row, slot) {
  const priceKmf = roundKmf(stableInt(`${row.source}:${slot.category}:${slot.subcategory}`, 2500, 85000));
  const promoSeed = stableInt(`${row.source}:promo`, 0, 99);
  return {
    ...row,
    product_ref: slot.product_ref,
    category: slot.category,
    subcategory: slot.subcategory,
    description: row.source_description || `${row.name}. Produit de démonstration issu d'une source traçable pour éprouver la raffinerie Komerce.`,
    source_locale: 'en',
    price_kmf: priceKmf,
    promo_pct: promoSeed < 25 ? stableInt(`${row.source}:promo-pct`, 8, 40) : null,
    stock: stableInt(`${row.source}:stock`, 3, 40),
    sort_order: slot.globalIndex + 500,
    showcase_v2: {
      slot_index: slot.globalIndex,
      rich: slot.rich,
      category: slot.category,
      subcategory: slot.subcategory,
    },
  };
}

async function buildCatalogue() {
  const slots = buildSlots();
  const globalSources = new Set();
  const globalHeroes = new Set();
  const queryCache = new Map();
  const output = [];
  let slotCursor = 0;

  async function candidatesFor(query) {
    if (!queryCache.has(query)) queryCache.set(query, searchCommons(query));
    return queryCache.get(query);
  }

  for (const target of TAXONOMY_TARGETS) {
    const key = segmentKey(target);
    const segment = [];
    const seenSegment = new Set();
    const queries = queriesForTarget(target);

    for (const query of queries) {
      const candidates = await candidatesFor(query);
      let accepted = 0;
      for (const row of candidates) {
        if (segment.length >= target.count) break;
        if (seenSegment.has(row.source) || globalSources.has(row.source) || globalHeroes.has(row.image_url)) continue;
        seenSegment.add(row.source);
        globalSources.add(row.source);
        globalHeroes.add(row.image_url);
        segment.push(row);
        accepted += 1;
      }
      console.log(`[showcase-v2-source] ${key} · "${query}" -> ${candidates.length}, +${accepted}, pool=${segment.length}/${target.count}`);
      if (segment.length >= target.count) break;
    }

    if (segment.length < target.count) {
      throw new Error(`Pool insuffisant ${key}: ${segment.length}/${target.count} après ${queries.length} requêtes`);
    }
    for (const row of segment) {
      output.push(decorate(row, slots[slotCursor++]));
    }
    console.log(`[showcase-v2-source] ✓ ${key}: ${segment.length}`);
  }

  if (output.length !== 500 || globalSources.size !== 500 || globalHeroes.size !== 500) {
    throw new Error(`Invariant V2 cassé: products=${output.length}, sources=${globalSources.size}, heroes=${globalHeroes.size}`);
  }
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const products = await buildCatalogue();
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
  const rich = products.filter((p) => p.showcase_v2?.rich).length;
  console.log(`[showcase-v2-source] manifest: ${products.length}, rich=${rich}, unique heroes=${new Set(products.map((p) => p.image_url)).size}`);
  console.log(`[showcase-v2-source] -> ${options.output}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v2-source] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  FALLBACK_QUERIES,
  parseArgs,
  retryDelayMs,
  stripHtml,
  isReusableLicense,
  mapPage,
  segmentKey,
  queriesForTarget,
  decorate,
};
