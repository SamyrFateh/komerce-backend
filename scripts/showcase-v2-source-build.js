#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-source-builder
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        Wikimedia Commons, catalog_exclusions
 * @outputs       data/catalogue-test-raw/showcase-catalog-v2-source.json
 * @depends       db.js, services/catalog-eligibility.js, scripts/showcase-v2-plan.js, scripts/showcase-catalog.js
 * @used-by       showcase v2 staging deploy
 * @db-read       catalog_exclusions
 * @db-write      none
 * @db-txn        no
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_CATALOGUE.md
 * @version       2026-08-v8
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const catalogEligibility = require('../services/catalog-eligibility');
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
const DESCRIPTION_MAX_LENGTH = 10000;

const FALLBACK_QUERIES = Object.freeze({
  'Mode & Beauté/Femme': ['dress isolated', 'blouse isolated', 'skirt isolated', 'women shoes product', 'handbag product', 'women jacket product'],
  'Mode & Beauté/Homme': ['shirt isolated', 'mens jacket product', 'trousers isolated', 'men shoes product', 'suit isolated', 'mens belt product'],
  'Mode & Beauté/Enfant': ['children clothing product', 'kids shirt isolated', 'children shoes product', 'school uniform product', 'kids jacket product', 'children backpack product'],
  'Mode & Beauté/Beauté': ['cosmetics product', 'makeup product', 'skin care product', 'perfume bottle', 'lipstick product', 'beauty product'],
  'Maison/Confort': ['home appliance product', 'electric fan product', 'vacuum cleaner product', 'clothes iron product', 'space heater product', 'household appliance product'],
  'Maison/Cuisine': ['kitchen utensil product', 'cookware product', 'kettle product', 'frying pan product', 'cutlery product', 'kitchen appliance product'],
  'Maison/Déco': ['home decoration product', 'vase product', 'table lamp product', 'cushion product', 'wall clock product', 'decorative object product'],
  'Maison/Enfants': ['school supplies product', 'children furniture product', 'backpack product', 'pencil case product', 'notebook product', 'desk accessory product'],
  'Tech/Phones': ['smartphone product', 'mobile phone product', 'cell phone product', 'telephone handset product'],
  'Tech/Audio': ['headphones product', 'earphones product', 'loudspeaker product', 'portable speaker product', 'radio receiver product', 'audio equipment product'],
  'Tech/Montres': ['wristwatch product', 'smartwatch product', 'watch product', 'digital watch product', 'mechanical watch product'],
  'Bricolage/Outillage': ['hand tool product', 'power tool product', 'screwdriver product', 'hammer product', 'electric drill product', 'pliers product'],
  'Bricolage/Electricité': ['electrical connector product', 'electric cable product', 'electrical socket product', 'light switch product', 'extension cord product', 'electrical equipment product'],
  'Bricolage/Sécurité': ['padlock product', 'door lock product', 'security camera product', 'safe lock product', 'door security product', 'lock hardware product'],
  'Créations personnelles/Cérémonie': ['formal dress product', 'wedding dress product', 'suit clothing product', 'ceremonial dress product', 'tuxedo product', 'formal wear product'],
  'Créations personnelles/Cadeau': ['gift box product', 'souvenir object product', 'gift item product', 'decorative mug product', 'keepsake product', 'present box product'],
  'Créations personnelles/Impression': ['printed mug product', 'printed stationery product', 'greeting card product', 'poster print product', 'printed notebook product', 'printed paper product'],
  'Auto/Filtres': ['oil filter product', 'air filter automotive product', 'automotive filter product', 'fuel filter product', 'car filter product'],
  'Auto/Freinage': ['brake disc product', 'brake pad product', 'automotive brake product', 'disc brake product', 'brake caliper product'],
  'Auto/Éclairage': ['car headlight product', 'automotive lamp product', 'tail light product', 'vehicle headlamp product', 'car light product'],
  'Auto/Moto': ['motorcycle part product', 'motorcycle accessory product', 'motorcycle helmet product', 'motorcycle mirror product', 'motorcycle light product'],
});

const PRODUCT_TERMS = Object.freeze({
  'Mode & Beauté/Femme': ['dress', 'blouse', 'skirt', 'shirt', 'jacket', 'coat', 'trousers', 'pants', 'shoe', 'shoes', 'handbag', 'purse', 'sandal', 'sandals', 'boot', 'boots'],
  'Mode & Beauté/Homme': ['shirt', 'jacket', 'coat', 'trousers', 'pants', 'shoe', 'shoes', 'suit', 'blazer', 'tie', 'belt', 'boot', 'boots'],
  'Mode & Beauté/Enfant': ['shirt', 't-shirt', 'tshirt', 'jacket', 'trousers', 'pants', 'dress', 'skirt', 'shoe', 'shoes', 'uniform', 'backpack', 'sweater'],
  'Mode & Beauté/Beauté': ['cosmetic', 'cosmetics', 'makeup', 'lipstick', 'perfume', 'lotion', 'cream', 'mascara', 'foundation', 'skincare', 'skin care', 'soap'],
  'Maison/Confort': ['fan', 'vacuum cleaner', 'iron', 'heater', 'appliance', 'humidifier', 'air conditioner', 'pillow'],
  'Maison/Cuisine': ['kettle', 'pan', 'pot', 'knife', 'knives', 'cutlery', 'spoon', 'fork', 'cookware', 'utensil', 'plate', 'bowl', 'mug', 'blender', 'toaster'],
  'Maison/Déco': ['vase', 'lamp', 'cushion', 'clock', 'candle', 'frame', 'decoration', 'decorative', 'ornament'],
  'Maison/Enfants': ['backpack', 'pencil case', 'notebook', 'desk', 'chair', 'stationery', 'pencil', 'pen', 'ruler', 'school bag'],
  'Tech/Phones': ['smartphone', 'phone', 'telephone', 'handset', 'mobile'],
  'Tech/Audio': ['headphone', 'headphones', 'earphone', 'earphones', 'speaker', 'loudspeaker', 'radio', 'microphone', 'headset', 'earbud', 'earbuds'],
  'Tech/Montres': ['watch', 'wristwatch', 'smartwatch', 'timepiece'],
  'Bricolage/Outillage': ['tool', 'screwdriver', 'hammer', 'drill', 'pliers', 'wrench', 'spanner', 'saw'],
  'Bricolage/Electricité': ['connector', 'cable', 'socket', 'switch', 'cord', 'plug', 'outlet', 'adapter', 'electrical'],
  'Bricolage/Sécurité': ['padlock', 'lock', 'camera', 'safe', 'latch', 'alarm', 'security'],
  'Créations personnelles/Cérémonie': ['dress', 'gown', 'suit', 'tuxedo', 'tie', 'veil', 'formal wear', 'ceremonial dress'],
  'Créations personnelles/Cadeau': ['gift box', 'gift', 'souvenir', 'keepsake', 'mug', 'present', 'box'],
  'Créations personnelles/Impression': ['mug', 'stationery', 'greeting card', 'poster', 'notebook', 'print', 'printed', 'card'],
  'Auto/Filtres': ['filter', 'oil filter', 'air filter', 'fuel filter'],
  'Auto/Freinage': ['brake', 'brake disc', 'brake pad', 'disc brake', 'rotor', 'caliper'],
  'Auto/Éclairage': ['headlight', 'headlamp', 'lamp', 'tail light', 'taillight', 'car light'],
  'Auto/Moto': ['motorcycle', 'motorbike', 'helmet', 'mirror', 'scooter', 'motorcycle light'],
});

const EDITORIAL_MARKERS = Object.freeze([
  'portrait', 'headshot', 'fashion show', 'fashion week', 'runway', 'red carpet',
  'press conference', 'selfie', 'group photo', 'team photo', 'model wearing',
  'model in', 'models wearing', 'modelled by', 'modeled by', 'bride and groom',
  'wedding ceremony', 'dress rehearsal', 'dressing room', 'award ceremony',
  'product launch', 'television broadcast', 'tv broadcast', 'on stage',
  'on the stage', 'performance',
]);

const HUMAN_MEDIA_MARKERS = Object.freeze([
  'woman wearing', 'women wearing', 'man wearing', 'men wearing', 'girl wearing',
  'girls wearing', 'boy wearing', 'boys wearing', 'person wearing', 'people wearing',
  'woman in a', 'woman in the', 'man in a', 'man in the', 'girl in a', 'boy in a',
  'woman holding', 'women holding', 'man holding', 'men holding', 'person holding',
  'people holding', 'woman applying', 'women applying', 'man applying', 'men applying',
  'person applying', 'people applying', 'using mobile phone', 'using a mobile phone',
  'using phone', 'using a phone', 'actor in', 'actors in',
]);

const V2_TITLE_REPLACEMENTS = [
  [/\bblouse\b/gi, 'blouse'], [/\bskirt\b/gi, 'jupe'], [/\bjacket\b/gi, 'veste'],
  [/\bcoat\b/gi, 'manteau'], [/\btrousers?\b/gi, 'pantalon'], [/\bpants\b/gi, 'pantalon'],
  [/\bhandbag\b/gi, 'sac à main'], [/\bpurse\b/gi, 'sac à main'], [/\bsandals?\b/gi, 'sandales'],
  [/\bboots?\b/gi, 'bottes'], [/\bsuit\b/gi, 'costume'], [/\bblazer\b/gi, 'blazer'],
  [/\btie\b/gi, 'cravate'], [/\bbelt\b/gi, 'ceinture'], [/\bmakeup\b/gi, 'maquillage'],
  [/\bcosmetics?\b/gi, 'cosmétique'], [/\blotion\b/gi, 'lotion'], [/\bmascara\b/gi, 'mascara'],
  [/\bfoundation\b/gi, 'fond de teint'], [/\bsoap\b/gi, 'savon'], [/\bfan\b/gi, 'ventilateur'],
  [/\bvacuum cleaner\b/gi, 'aspirateur'], [/\bheater\b/gi, 'chauffage'], [/\bpillow\b/gi, 'oreiller'],
  [/\bkettle\b/gi, 'bouilloire'], [/\bfrying pan\b/gi, 'poêle'], [/\bpan\b/gi, 'poêle'],
  [/\bknife\b/gi, 'couteau'], [/\bknives\b/gi, 'couteaux'], [/\bcutlery\b/gi, 'couverts'],
  [/\bspoon\b/gi, 'cuillère'], [/\bfork\b/gi, 'fourchette'], [/\bbowl\b/gi, 'bol'],
  [/\bblender\b/gi, 'mixeur'], [/\btoaster\b/gi, 'grille-pain'], [/\bcushion\b/gi, 'coussin'],
  [/\bclock\b/gi, 'horloge'], [/\bcandle\b/gi, 'bougie'], [/\bbackpack\b/gi, 'sac à dos'],
  [/\bpencil case\b/gi, 'trousse'], [/\bnotebook\b/gi, 'carnet'], [/\bheadphones?\b/gi, 'casque audio'],
  [/\bearphones?\b/gi, 'écouteurs'], [/\bspeaker\b/gi, 'enceinte'], [/\bmicrophone\b/gi, 'microphone'],
  [/\bscrewdriver\b/gi, 'tournevis'], [/\bhammer\b/gi, 'marteau'], [/\bdrill\b/gi, 'perceuse'],
  [/\bpliers\b/gi, 'pince'], [/\bpadlock\b/gi, 'cadenas'], [/\bfilter\b/gi, 'filtre'],
  [/\bbrake disc\b/gi, 'disque de frein'], [/\bbrake pad\b/gi, 'plaquette de frein'],
  [/\bheadlight\b/gi, 'phare'], [/\bheadlamp\b/gi, 'phare'], [/\bmotorcycle\b/gi, 'moto'],
  [/\bhelmet\b/gi, 'casque'], [/\bmirror\b/gi, 'rétroviseur'],
];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseArgs(argv) {
  const out = { target: 500, output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--output') out.output = path.resolve(next());
    else throw new Error(`Argument inconnu: ${argv[i]}`);
  }
  if (!Number.isInteger(out.target) || out.target !== 500) throw new Error('--target doit être exactement 500 pour la campagne Showcase V2');
  return out;
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response?.headers?.get?.('retry-after') || '', 10);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 30000);
  return Math.min(1000 * (2 ** attempt), 15000);
}

function isRetryableHttpStatus(status) {
  const code = Number(status);
  return code === 429 || (code >= 500 && code <= 599);
}

async function fetchJson(url) {
  for (let attempt = 0; attempt <= API_RETRIES; attempt += 1) {
    await sleep(API_MIN_DELAY_MS);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'follow' });
    if (response.ok) {
      const body = await response.json();
      if (body?.error?.code === 'maxlag' && attempt < API_RETRIES) {
        await sleep(Math.min(1200 * (2 ** attempt), 15000));
        continue;
      }
      return body;
    }
    if (isRetryableHttpStatus(response.status) && attempt < API_RETRIES) {
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
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|lt|gt);/gi, ' ').replace(/\s+/g, ' ').trim();
}

function cleanSourceTitle(title) {
  return String(title || '').replace(/^File:/i, '').replace(/[_-]+/g, ' ').replace(/\.(jpe?g|png|webp|gif|tiff?)$/i, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function localizeV2Title(title) {
  let value = localizeTitle(title);
  for (const [pattern, replacement] of V2_TITLE_REPLACEMENTS) value = value.replace(pattern, replacement);
  return value.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Produit Komerce';
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
    source_title: cleanSourceTitle(page.title),
    name: localizeV2Title(page.title),
    source_description: stripHtml(meta.ImageDescription?.value),
    source_attribution: { license, artist: stripHtml(meta.Artist?.value || 'Contributeur Wikimedia Commons') },
  };
}

async function searchCommons(query) {
  const rows = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_QUERY; pageIndex += 1) {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: String(PAGE_SIZE), gsroffset: String(offset),
      prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '900',
      iiextmetadatafilter: 'LicenseShortName|UsageTerms|Artist|ImageDescription', maxlag: '5', format: 'json', formatversion: '2',
    });
    const body = await fetchJson(`${COMMONS_API}?${params}`);
    rows.push(...(body.query?.pages || []).map(mapPage).filter(Boolean));
    const next = body.continue?.gsroffset;
    if (!Number.isInteger(next)) break;
    offset = next;
  }
  return rows;
}

function segmentKey(target) { return `${target.category}/${target.subcategory}`; }

function identityQueriesForTarget(target) {
  return (PRODUCT_TERMS[segmentKey(target)] || []).slice(0, 8).map((term) => `intitle:${term.includes(' ') ? `"${term}"` : term}`);
}

function queriesForTarget(target) {
  // La preuve la plus forte est un terme produit dans le titre Wikimedia.
  // On privilégie donc les requêtes intitle avant les recherches de secours.
  const all = [...identityQueriesForTarget(target), ...(target.queries || []), ...(FALLBACK_QUERIES[segmentKey(target)] || [])];
  const seen = new Set();
  return all.filter((query) => {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function productIdentityFor(row, target) {
  const key = segmentKey(target);
  const sourceTitle = String(row?.source_title || row?.name || '');
  const description = String(row?.source_description || '');
  const context = `${sourceTitle} ${description}`;
  const terms = PRODUCT_TERMS[key] || [];
  const titleTerm = terms.find((candidate) => catalogEligibility.keywordMatches(sourceTitle, candidate));
  if (!titleTerm) {
    const descriptionTerm = terms.find((candidate) => catalogEligibility.keywordMatches(description, candidate));
    if (descriptionTerm) {
      return { ok: false, reason: 'product-term-description-only', term: descriptionTerm, term_source: 'description', editorial: null };
    }
    return { ok: false, reason: 'missing-product-term', term: null, term_source: null, editorial: null };
  }

  const editorial = EDITORIAL_MARKERS.find((marker) => catalogEligibility.keywordMatches(context, marker));
  if (editorial) return { ok: false, reason: 'editorial-media', term: titleTerm, term_source: 'title', editorial };

  // Une scène humaine n'est pas une photo produit, quelle que soit la catégorie.
  const human = HUMAN_MEDIA_MARKERS.find((marker) => catalogEligibility.keywordMatches(context, marker));
  if (human) return { ok: false, reason: 'human-media', term: titleTerm, term_source: 'title', editorial: human };

  return { ok: true, reason: null, term: titleTerm, term_source: 'title', editorial: null };
}

function isProductLike(row, target) { return productIdentityFor(row, target).ok; }

function boundedDescription(row, target) {
  const title = row?.name || 'Produit Komerce';
  const category = target?.category || 'Catalogue';
  const subcategory = target?.subcategory || 'Produit';
  return `${title}. Article de démonstration classé ${category} · ${subcategory}, sélectionné depuis une source traçable pour éprouver la raffinerie Komerce.`.slice(0, DESCRIPTION_MAX_LENGTH);
}

function eligibilityCandidate(row, target) {
  return {
    product_name: row.source_title || row.name || null,
    description: row.source_description || null,
    supplier_category: `${target.category} / ${target.subcategory}`,
    komerce_category: target.category,
  };
}

function absoluteExclusionFor(row, target, activeExclusions) {
  const verdict = catalogEligibility.checkEligibility(eligibilityCandidate(row, target), activeExclusions || []);
  return verdict?.layer === 'absolute' ? verdict : null;
}

function decorate(row, slot) {
  const priceKmf = roundKmf(stableInt(`${row.source}:${slot.category}:${slot.subcategory}`, 2500, 85000));
  const promoSeed = stableInt(`${row.source}:promo`, 0, 99);
  const identity = productIdentityFor(row, slot);
  return {
    ...row,
    product_ref: slot.product_ref,
    category: slot.category,
    subcategory: slot.subcategory,
    description: boundedDescription(row, slot),
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
      product_identity_term: identity.term,
      product_identity_source: identity.term_source,
    },
  };
}

async function buildCatalogue(activeExclusions = []) {
  const slots = buildSlots();
  const globalSources = new Set();
  const globalHeroes = new Set();
  const queryCache = new Map();
  const output = [];
  let slotCursor = 0;
  let excludedAbsoluteTotal = 0;
  let rejectedProductIdentityTotal = 0;

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
      let excludedAbsolute = 0;
      let rejectedProductIdentity = 0;
      for (const row of candidates) {
        if (segment.length >= target.count) break;
        if (seenSegment.has(row.source) || globalSources.has(row.source) || globalHeroes.has(row.image_url)) continue;

        const identity = productIdentityFor(row, target);
        if (!identity.ok) {
          rejectedProductIdentity += 1;
          rejectedProductIdentityTotal += 1;
          continue;
        }

        const exclusion = absoluteExclusionFor(row, target, activeExclusions);
        if (exclusion) {
          excludedAbsolute += 1;
          excludedAbsoluteTotal += 1;
          continue;
        }

        seenSegment.add(row.source);
        globalSources.add(row.source);
        globalHeroes.add(row.image_url);
        segment.push(row);
        accepted += 1;
      }
      console.log(`[showcase-v2-source] ${key} · "${query}" -> ${candidates.length}, +${accepted}, non-product=${rejectedProductIdentity}, excluded=${excludedAbsolute}, pool=${segment.length}/${target.count}`);
      if (segment.length >= target.count) break;
    }

    if (segment.length < target.count) throw new Error(`Pool insuffisant ${key}: ${segment.length}/${target.count} après ${queries.length} requêtes`);
    for (const row of segment) output.push(decorate(row, slots[slotCursor++]));
    console.log(`[showcase-v2-source] ✓ ${key}: ${segment.length}`);
  }

  if (output.length !== 500 || globalSources.size !== 500 || globalHeroes.size !== 500) {
    throw new Error(`Invariant V2 cassé: products=${output.length}, sources=${globalSources.size}, heroes=${globalHeroes.size}`);
  }
  console.log(`[showcase-v2-source] médias sans identité produit rejetés avant miroir: ${rejectedProductIdentityTotal}`);
  console.log(`[showcase-v2-source] exclusions absolues filtrées avant miroir: ${excludedAbsoluteTotal}`);
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis pour charger les exclusions actives de la raffinerie');
  try {
    const activeExclusions = await catalogEligibility.loadActiveExclusions();
    console.log(`[showcase-v2-source] exclusions actives Railway: ${activeExclusions.length}`);
    const products = await buildCatalogue(activeExclusions);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
    const rich = products.filter((p) => p.showcase_v2?.rich).length;
    console.log(`[showcase-v2-source] manifest: ${products.length}, rich=${rich}, unique heroes=${new Set(products.map((p) => p.image_url)).size}`);
    console.log(`[showcase-v2-source] -> ${options.output}`);
  } finally {
    await db.pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v2-source] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DESCRIPTION_MAX_LENGTH,
  FALLBACK_QUERIES,
  PRODUCT_TERMS,
  EDITORIAL_MARKERS,
  HUMAN_MEDIA_MARKERS,
  parseArgs,
  retryDelayMs,
  isRetryableHttpStatus,
  stripHtml,
  cleanSourceTitle,
  localizeV2Title,
  isReusableLicense,
  mapPage,
  segmentKey,
  identityQueriesForTarget,
  queriesForTarget,
  productIdentityFor,
  isProductLike,
  boundedDescription,
  eligibilityCandidate,
  absoluteExclusionFor,
  decorate,
};