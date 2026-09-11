#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          seed-market-test-data-cli
 * @domain        admin-dashboard
 * @layer         script
 * @owner         backend-core
 * @purpose       Générer un lot de commandes réalistes non-production,
 *                strictement scopées par Market ID, à partir d'un catalogue
 *                global curaté partagé entre les marchés.
 * @impact-areas  staging-only, market, catalog, market-autonomy, pricing-tests
 *
 * Doctrine staging :
 *   - le produit est global ; le Market ID décide exposition + prix local ;
 *   - aucune copie `SEEDTEST <PAYS> produit N` n'est créée ;
 *   - le catalogue curaté doit passer un quality gate statique avant écriture ;
 *   - cleanup d'un marché ne supprime jamais le catalogue global ;
 *   - chaque produit exposé reçoit seulement un DRAFT_PENDING_GATE : aucun
 *     LOCAL_ACTIVE n'est fabriqué artificiellement par le seed ;
 *   - KOMERCE_ENV est la vérité business de runtime et prime NODE_ENV ;
 *   - toute écriture exige MARKET_STAGING_SEED_ENABLED=true.
 *
 * Usage :
 *   MARKET_STAGING_SEED_ENABLED=true node scripts/seed-market-test-data.js --market CM --orders 60
 *   node scripts/seed-market-test-data.js --market CM --orders 60 --dry-run
 *   MARKET_STAGING_SEED_ENABLED=true node scripts/seed-market-test-data.js --market CM --cleanup
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const catalogExposure = require('../services/catalog-market-exposure-service');
const marketCommercialPrice = require('../services/market-commercial-price-service');
const { projectAmount, roundToMinorUnit } = require('../utils/currency');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

const TAG = 'SEEDTEST';
const PRICE_SOURCE = 'staging_market_seed';
const FLAG = 'MARKET_STAGING_SEED_ENABLED';
const DEFAULT_PRODUCT_COUNT = 40;
const CURATED_CATALOG_PATH = path.join(__dirname, '..', 'data', 'staging-market-catalog-curated-v1.json');
const CURATED_CATALOG_PATHS = Object.freeze([
  CURATED_CATALOG_PATH,
  path.join(__dirname, '..', 'data', 'staging-market-catalog-curated-v2-additions.json'),
]);
const REQUIRED_CATEGORIES = Object.freeze(['Beauté', 'Mode', 'Tech', 'Maison', 'Sport', 'Enfant']);
const COMMONS_LICENSES = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-3.0']);

const MARKET_TEST_PROFILES = Object.freeze({
  KM: Object.freeze({ phonePrefix: '+269', area: 'Ngazidja' }),
  CM: Object.freeze({ phonePrefix: '+237', area: 'Cameroun' }),
  CG: Object.freeze({ phonePrefix: '+242', area: 'Congo' }),
});

const ITEM_COUNT_WEIGHTS = [
  { n: 1, weight: 35 },
  { n: 2, weight: 25 },
  { n: 3, weight: 15 },
  { n: 4, weight: 10 },
  { n: 5, weight: 6 },
  { n: 6, weight: 4 },
  { n: 8, weight: 3 },
  { n: 12, weight: 2 },
];

const STATUS_WEIGHTS = [
  { status: 'collected', weight: 40 },
  { status: 'available', weight: 15 },
  { status: 'shipped', weight: 15 },
  { status: 'in_transit', weight: 10 },
  { status: 'preparation', weight: 8 },
  { status: 'confirmed', weight: 7 },
  { status: 'cancelled', weight: 3 },
  { status: 'refunded', weight: 2 },
];

function normalizeMarketCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new Error('market code must be ISO alpha-2');
  return code;
}

function marketTags(marketCode) {
  const code = normalizeMarketCode(marketCode);
  return {
    code,
    refPrefix: `${TAG}-${code}-`,
    relaisName: `${TAG} ${code} relais`,
  };
}

function marketProfile(market) {
  const code = normalizeMarketCode(market.code);
  return MARKET_TEST_PROFILES[code] || {
    phonePrefix: '+999',
    area: market.name || code,
  };
}

function parseArgs(argv) {
  const args = { orders: 60, market: null, dryRun: false, cleanup: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--market') args.market = argv[++i];
    else if (a === '--orders') args.orders = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--cleanup') args.cleanup = true;
    else if (a === '--help') args.help = true;
  }
  return args;
}

function pickWeighted(list) {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of list) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return list[list.length - 1];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function runtimeSeedGuard({ requireOptIn = true } = {}) {
  const { env, source } = resolveRuntimeEnvironment();
  const optIn = isTruthy(process.env[FLAG]);
  return {
    env,
    source,
    optIn,
    allowed: env === 'staging' && (!requireOptIn || optIn),
  };
}

function isProductionRuntime() {
  return resolveRuntimeEnvironment().env === 'production';
}

function loadCuratedCatalog(filePaths = CURATED_CATALOG_PATHS) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  const catalog = [];
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) throw new Error(`Catalogue curaté absent: ${filePath}`);
    const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`Catalogue curaté invalide: ${filePath}`);
    catalog.push(...rows);
  }
  validateCuratedCatalog(catalog);
  return catalog;
}

function validateCuratedCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length < DEFAULT_PRODUCT_COUNT) {
    throw new Error(`Catalogue curaté insuffisant: minimum ${DEFAULT_PRODUCT_COUNT} produits requis`);
  }

  const refs = new Set();
  const names = new Set();
  const heroes = new Set();
  const sources = new Set();
  const categories = new Set();

  catalog.forEach((product, index) => {
    const label = `catalog[${index}]`;
    const ref = String(product.product_ref || '').trim();
    const name = String(product.name || '').trim();
    const description = String(product.description || '').trim();
    const category = String(product.category || '').trim();
    const subcategory = String(product.subcategory || '').trim();
    const imageUrl = String(product.image_url || '').trim();
    const source = String(product.source || '').trim();
    const images = Array.isArray(product.images) ? product.images.map(v => String(v || '').trim()).filter(Boolean) : [];

    if (!/^KPR-\d{6,}$/.test(ref)) throw new Error(`${label}: product_ref canonique invalide`);
    if (refs.has(ref)) throw new Error(`${label}: product_ref dupliqué ${ref}`);
    refs.add(ref);

    if (name.length < 6 || /^SEEDTEST\b/i.test(name) || /^(Produit|Article)\s+\d+$/i.test(name)) {
      throw new Error(`${label}: nom produit non curaté`);
    }
    const normalizedName = name.toLocaleLowerCase('fr');
    if (names.has(normalizedName)) throw new Error(`${label}: nom dupliqué ${name}`);
    names.add(normalizedName);

    if (description.length < 45 || /Raw test product:/i.test(description)) {
      throw new Error(`${label}: description insuffisante ou brute`);
    }
    if (!category || !subcategory) throw new Error(`${label}: catégorie/sous-catégorie requise`);
    categories.add(category);

    if (!Number.isFinite(Number(product.price_kmf)) || Number(product.price_kmf) <= 0) {
      throw new Error(`${label}: price_kmf doit être > 0`);
    }
    if (!Number.isInteger(Number(product.stock)) || Number(product.stock) < 0) {
      throw new Error(`${label}: stock doit être un entier >= 0`);
    }
    if (!product.curated) throw new Error(`${label}: curated=true requis`);

    const dummySource = /^dummyjson:\d+$/.test(source);
    const commonsSource = /^commons:[^\s]+$/i.test(source);
    if (!dummySource && !commonsSource) throw new Error(`${label}: source traçable requise`);
    if (sources.has(source)) throw new Error(`${label}: source dupliquée ${source}`);
    sources.add(source);

    if (commonsSource) {
      const sourceUrl = String(product.source_url || '').trim();
      const sourceAuthor = String(product.source_author || '').trim();
      const license = String(product.license || '').trim();
      if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/i.test(sourceUrl)) {
        throw new Error(`${label}: page source Commons requise`);
      }
      if (!sourceAuthor) throw new Error(`${label}: auteur Commons requis`);
      if (!COMMONS_LICENSES.has(license)) throw new Error(`${label}: licence Commons non autorisée`);
    }

    try {
      const hero = new URL(imageUrl);
      if (hero.protocol !== 'https:') throw new Error('https required');
    } catch (_) {
      throw new Error(`${label}: image_url HTTPS invalide`);
    }
    if (!images.length || !images.includes(imageUrl)) throw new Error(`${label}: galerie doit contenir le hero`);
    for (const url of images) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') throw new Error('https required');
      } catch (_) {
        throw new Error(`${label}: image galerie HTTPS invalide`);
      }
    }
    if (heroes.has(imageUrl)) throw new Error(`${label}: hero dupliqué`);
    heroes.add(imageUrl);
  });

  const missingCategories = REQUIRED_CATEGORIES.filter(category => !categories.has(category));
  if (missingCategories.length) {
    throw new Error(`Catalogue curaté incomplet: catégories manquantes ${missingCategories.join(', ')}`);
  }

  return {
    count: catalog.length,
    categories: [...categories].sort(),
  };
}

function selectCuratedProducts(catalog, count = DEFAULT_PRODUCT_COUNT) {
  if (!Number.isInteger(count) || count <= 0) throw new Error('count doit être un entier positif');
  if (count > catalog.length) throw new Error(`Catalogue curaté: ${count} produits demandés, ${catalog.length} disponibles`);

  const buckets = new Map(REQUIRED_CATEGORIES.map(category => [category, []]));
  const others = [];
  for (const product of catalog) {
    if (buckets.has(product.category)) buckets.get(product.category).push(product);
    else others.push(product);
  }

  const selected = [];
  let round = 0;
  while (selected.length < count) {
    let added = false;
    for (const category of REQUIRED_CATEGORIES) {
      const candidate = buckets.get(category)[round];
      if (candidate && selected.length < count) {
        selected.push(candidate);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }

  if (selected.length < count) {
    const selectedRefs = new Set(selected.map(product => product.product_ref));
    const remainder = [...catalog, ...others].filter(product => !selectedRefs.has(product.product_ref));
    selected.push(...remainder.slice(0, count - selected.length));
  }
  return selected;
}

async function ensureMarket(rawCode) {
  const code = normalizeMarketCode(rawCode);
  const { rows } = await db.query(
    'SELECT id, code, name, currency, minor_unit FROM markets WHERE code = $1',
    [code]
  );
  if (rows.length === 0) {
    const { rows: all } = await db.query('SELECT code FROM markets ORDER BY code');
    throw new Error(
      `Marché "${code}" introuvable. Marchés existants : ${all.map(r => r.code).join(', ') || '(aucun)'}. ` +
      `Ce script ne crée pas de marché — seed d'abord la table markets.`
    );
  }
  return rows[0];
}

async function ensureRelais(market) {
  const tags = marketTags(market.code);
  const profile = marketProfile(market);
  const { rows } = await db.query(
    'SELECT * FROM relais WHERE name = $1 AND market_id = $2 LIMIT 1',
    [tags.relaisName, market.id]
  );
  if (rows.length > 0) return rows[0];

  const { rows: created } = await db.query(
    `INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING *`,
    [
      tags.relaisName,
      `${TAG} ${tags.code} agent`,
      `${profile.phonePrefix}${randomInt(3000000, 9999999)}`,
      `${TAG} ${tags.code} adresse de test`,
      profile.area,
      market.id,
    ]
  );
  return created[0];
}

async function ensureProducts(count = DEFAULT_PRODUCT_COUNT) {
  const catalog = loadCuratedCatalog();
  const selected = selectCuratedProducts(catalog, count);
  const rows = [];

  for (let index = 0; index < selected.length; index++) {
    const product = selected[index];
    const { rows: upserted } = await db.query(
      `INSERT INTO products (
         product_ref, name, description, category, subcategory, price_kmf,
         promo_pct, image_url, images, stock, is_active, is_available, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, TRUE, TRUE, $11)
       ON CONFLICT (product_ref) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         subcategory = EXCLUDED.subcategory,
         price_kmf = EXCLUDED.price_kmf,
         promo_pct = EXCLUDED.promo_pct,
         image_url = EXCLUDED.image_url,
         images = EXCLUDED.images,
         stock = EXCLUDED.stock,
         is_active = TRUE,
         is_available = TRUE,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()
       RETURNING *`,
      [
        product.product_ref,
        product.name,
        product.description,
        product.category,
        product.subcategory,
        product.price_kmf,
        product.promo_pct,
        product.image_url,
        JSON.stringify(product.images),
        product.stock,
        9000 + index,
      ]
    );
    rows.push(upserted[0]);
  }
  return rows;
}

async function localDraftAmountForProduct(product, market) {
  if (!product?.product_ref) {
    throw new Error(`Produit de seed sans product_ref canonique (${product?.id || 'unknown'})`);
  }
  const projected = await projectAmount(Number(product.price_kmf), 'KMF', market.currency);
  const amount = roundToMinorUnit(projected, Number(market.minor_unit) || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Projection de prix locale invalide pour ${product.product_ref} (${market.code})`);
  }
  return amount;
}

async function prepareProductsForMarket(products, market) {
  if (!market?.id || !market?.code || !market?.currency) {
    throw new Error('prepareProductsForMarket: canonical market is required');
  }

  let exposed = 0;
  let drafts = 0;
  for (const product of products) {
    const localAmount = await localDraftAmountForProduct(product, market);

    await catalogExposure.setExposure(
      product.id,
      market.id,
      catalogExposure.EXPOSURE.ENABLED,
      null
    );
    exposed++;

    await marketCommercialPrice.setMarketPriceDraft({
      market,
      productRef: product.product_ref,
      amount: localAmount,
      reason: `${TAG} ${market.code} prix local de test`,
      source: PRICE_SOURCE,
      actorId: null,
    });
    drafts++;
  }

  return { exposed, drafts };
}

async function createOrder({ marketId, marketCode, relaisId, products }) {
  if (!marketId) throw new Error('createOrder: marketId is required');
  const tags = marketTags(marketCode);
  const statusChoice = pickWeighted(STATUS_WEIGHTS).status;
  const itemCount = pickWeighted(ITEM_COUNT_WEIGHTS).n;
  const ref = `${tags.refPrefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const chosen = [];
  for (let i = 0; i < itemCount; i++) {
    chosen.push(products[randomInt(0, products.length - 1)]);
  }

  const items = chosen.map(product => ({
    product_id: product.id,
    quantity: randomInt(1, 3),
    price_kmf: product.price_kmf,
  }));
  const totalKmf = items.reduce((sum, item) => sum + item.quantity * item.price_kmf, 0);
  const totalEurProjected = await projectAmount(totalKmf, 'KMF', 'EUR');
  const totalEur = roundToMinorUnit(totalEurProjected, 2);

  const { rows: [order] } = await db.query(
    `INSERT INTO orders
       (reference, relais_id, market_id, total_kmf, total_eur,
        payment_mode, payment_status, status, created_at)
     VALUES ($1, $2, $3, $4, $5,
             $6::public.payment_mode, $7::public.payment_status, $8::public.order_status,
             now() - (random() * interval '90 days'))
     RETURNING *`,
    [
      ref,
      relaisId,
      marketId,
      totalKmf,
      totalEur,
      'cash_relais',
      statusChoice === 'cancelled' || statusChoice === 'refunded' ? 'pending' : 'paid',
      statusChoice,
    ]
  );

  for (const item of items) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_kmf)
       VALUES ($1, $2, $3, $4)`,
      [order.id, item.product_id, item.quantity, item.price_kmf]
    );
  }

  return { order, itemCount };
}

async function cleanup(market) {
  if (!market?.id) throw new Error('cleanup: canonical market is required');
  const tags = marketTags(market.code);
  const { rows: orders } = await db.query(
    'SELECT id FROM orders WHERE reference LIKE $1 AND market_id = $2',
    [`${tags.refPrefix}%`, market.id]
  );
  const orderIds = orders.map(order => order.id);
  console.log(`[cleanup:${tags.code}] ${orderIds.length} commande(s) SEEDTEST trouvée(s).`);

  if (orderIds.length > 0) {
    await db.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
    await db.query(
      'DELETE FROM orders WHERE id = ANY($1::uuid[]) AND market_id = $2',
      [orderIds, market.id]
    );
  }

  const catalog = loadCuratedCatalog();
  const refs = catalog.map(product => product.product_ref);
  const { rows: products } = await db.query(
    'SELECT id, product_ref FROM products WHERE product_ref = ANY($1::text[])',
    [refs]
  );
  for (const product of products) {
    await catalogExposure.setExposure(
      product.id,
      market.id,
      catalogExposure.EXPOSURE.DISABLED,
      null
    );
    try {
      await marketCommercialPrice.resetMarketPriceDraft({
        market,
        productRef: product.product_ref,
        reason: `${TAG} ${market.code} cleanup staging`,
        source: PRICE_SOURCE,
        actorId: null,
      });
    } catch (error) {
      if (error?.code !== 'market_price_draft_not_found') throw error;
    }
  }

  await db.query(
    'DELETE FROM relais WHERE name = $1 AND market_id = $2',
    [tags.relaisName, market.id]
  );
  console.log(`[cleanup:${tags.code}] Terminé — catalogue global préservé, projection marché retirée.`);
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(__doc_usage());
    return;
  }

  const guard = runtimeSeedGuard({ requireOptIn: !args.dryRun });
  if (guard.env !== 'staging') {
    console.error(`❌ Refusé : runtime ${guard.env || 'inconnu'} via ${guard.source}. Ce script exige KOMERCE_ENV=staging.`);
    process.exitCode = 1;
    return;
  }
  if (!args.dryRun && !guard.optIn) {
    console.error(`❌ Refusé : ${FLAG}=true est requis pour toute écriture staging.`);
    process.exitCode = 1;
    return;
  }

  if (!args.market) {
    console.error('❌ --market est requis, y compris avec --cleanup (ex: --market CM).');
    process.exitCode = 1;
    return;
  }

  let market;
  try {
    market = await ensureMarket(args.market);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[seed] Marché : ${market.code} — ${market.name} (${market.currency})`);

  if (args.cleanup) {
    await cleanup(market);
    return;
  }

  if (!Number.isInteger(args.orders) || args.orders <= 0) {
    console.error('❌ --orders doit être un entier positif.');
    process.exitCode = 1;
    return;
  }

  const catalog = loadCuratedCatalog();
  const selected = selectCuratedProducts(catalog, DEFAULT_PRODUCT_COUNT);
  const categories = [...new Set(selected.map(product => product.category))].join(', ');
  const tags = marketTags(market.code);

  if (args.dryRun) {
    console.log(`[dry-run] Créerait ${args.orders} commande(s) sur le relais "${tags.relaisName}" (marché ${market.code}).`);
    console.log(`[dry-run] Catalogue curaté global: ${selected.length} produits (${categories}).`);
    console.log(`[dry-run] Les exposerait avec prix local DRAFT_PENDING_GATE en ${market.currency}.`);
    console.log('[dry-run] Aucune écriture effectuée.');
    return;
  }

  const relais = await ensureRelais(market);
  console.log(`[seed] Relais : ${relais.name} (${relais.id})`);

  const products = await ensureProducts(DEFAULT_PRODUCT_COUNT);
  console.log(`[seed] Catalogue curaté global : ${products.length} produit(s), sans duplication par pays.`);

  const prepared = await prepareProductsForMarket(products, market);
  console.log(`[seed] Catalogue ${market.code} : ${prepared.exposed} exposé(s), ${prepared.drafts} prix local(aux) en attente de gate.`);

  let monoArticle = 0;
  let totalLignes = 0;
  for (let i = 0; i < args.orders; i++) {
    const { itemCount } = await createOrder({
      marketId: market.id,
      marketCode: market.code,
      relaisId: relais.id,
      products,
    });
    totalLignes += itemCount;
    if (itemCount === 1) monoArticle++;
  }

  console.log(`[seed] ✅ ${args.orders} commande(s) créée(s) pour ${market.code}.`);
  console.log(`[seed]    Panier moyen (lignes) : ${(totalLignes / args.orders).toFixed(2)}`);
  console.log(`[seed]    Mono-article : ${monoArticle}/${args.orders} (${((100 * monoArticle) / args.orders).toFixed(1)}%)`);
  console.log('[seed] Relance la requête panier-moyen-mono-article.sql pour la vue exacte incluant status/exclusions.');
  console.log(`[seed] Pour nettoyer ${market.code} : ${FLAG}=true node scripts/seed-market-test-data.js --market ${market.code} --cleanup`);
}

function __doc_usage() {
  return `Usage :
  ${FLAG}=true node scripts/seed-market-test-data.js --market CM --orders 60
  node scripts/seed-market-test-data.js --market CM --orders 60 --dry-run
  ${FLAG}=true node scripts/seed-market-test-data.js --market CM --cleanup`;
}

if (require.main === module) {
  main()
    .then(() => {
      if (process.exitCode) return;
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Erreur :', error.message);
      process.exit(1);
    });
}

module.exports = {
  TAG,
  PRICE_SOURCE,
  FLAG,
  DEFAULT_PRODUCT_COUNT,
  CURATED_CATALOG_PATH,
  CURATED_CATALOG_PATHS,
  REQUIRED_CATEGORIES,
  MARKET_TEST_PROFILES,
  normalizeMarketCode,
  marketTags,
  marketProfile,
  parseArgs,
  isTruthy,
  runtimeSeedGuard,
  isProductionRuntime,
  loadCuratedCatalog,
  validateCuratedCatalog,
  selectCuratedProducts,
  ensureMarket,
  ensureRelais,
  ensureProducts,
  localDraftAmountForProduct,
  prepareProductsForMarket,
  createOrder,
  cleanup,
  main,
};