#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          seed-market-test-data-cli
 * @domain        admin-dashboard
 * @layer         script
 * @owner         backend-core
 * @purpose       Générer un lot de commandes réalistes non-production,
 *                strictement scopées par Market ID, pour éprouver les vues,
 *                le catalogue local et les décisions pricing sans fuite
 *                inter-marchés.
 * @impact-areas  staging-only, market, catalog, market-autonomy, pricing-tests
 *
 * Toutes les lignes créées utilisent un namespace par marché
 * (`SEEDTEST-<MARKET>-...`) afin qu'un seed/cleanup CM ne puisse jamais
 * toucher les fixtures CG/KM ni les fixtures ITEST- d'intégration.
 *
 * Usage :
 *   node scripts/seed-market-test-data.js --market CM --orders 60
 *   node scripts/seed-market-test-data.js --market CM --orders 60 --dry-run
 *   node scripts/seed-market-test-data.js --market CM --cleanup
 *
 * Garde-fous :
 *   - refuse explicitement production ;
 *   - --market est obligatoire, y compris pour --cleanup ;
 *   - le marché doit déjà exister dans markets ;
 *   - orders.market_id est écrit explicitement comme snapshot du relais ;
 *   - relais et produits de seed sont namespacés par code marché ;
 *   - chaque produit de seed est explicitement ENABLED dans
 *     product_market_exposure pour CE market_id ;
 *   - chaque produit reçoit une décision locale DRAFT_PENDING_GATE dans la
 *     devise serveur du marché ; le seed ne contourne jamais le gate pour
 *     fabriquer artificiellement un LOCAL_ACTIVE ;
 *   - cleanup exige à la fois le tag du marché ET le market_id canonique.
 */

'use strict';

const db = require('../db');
const catalogExposure = require('../services/catalog-market-exposure-service');
const marketCommercialPrice = require('../services/market-commercial-price-service');
const { projectAmount, roundToMinorUnit } = require('../utils/currency');

const TAG = 'SEEDTEST';
const PRICE_SOURCE = 'staging_market_seed';

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
    productNamePrefix: `${TAG} ${code} produit`,
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

function isProductionRuntime() {
  return [process.env.NODE_ENV, process.env.KOMERCE_ENV]
    .some(value => String(value || '').trim().toLowerCase() === 'production');
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

async function ensureProducts(count, marketCode) {
  const tags = marketTags(marketCode);
  const { rows: existing } = await db.query(
    'SELECT * FROM products WHERE name LIKE $1 ORDER BY name',
    [`${tags.productNamePrefix}%`]
  );
  if (existing.length >= count) return existing.slice(0, count);

  const toCreate = count - existing.length;
  const created = [];
  for (let i = existing.length; i < existing.length + toCreate; i++) {
    const priceKmf = randomInt(2000, 45000);
    const { rows } = await db.query(
      `INSERT INTO products (name, price_kmf, price_eur, stock, category, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [
        `${tags.productNamePrefix} ${i + 1}`,
        priceKmf,
        Math.round((priceKmf / 750) * 100) / 100,
        randomInt(20, 200),
        'seed-test',
      ]
    );
    created.push(rows[0]);
  }
  return [...existing, ...created];
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

    // catalog reste propriétaire de la projection product x market.
    await catalogExposure.setExposure(
      product.id,
      market.id,
      catalogExposure.EXPOSURE.ENABLED,
      null
    );
    exposed++;

    // Le seed crée uniquement la décision locale. L'autorisation économique et
    // l'activation acheteur restent la responsabilité du gate canonique.
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

  const items = chosen.map(p => ({
    product_id: p.id,
    quantity: randomInt(1, 3),
    price_kmf: p.price_kmf,
  }));
  const totalKmf = items.reduce((s, it) => s + it.quantity * it.price_kmf, 0);

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
      Math.round((totalKmf / 750) * 100) / 100,
      'cash_relais',
      statusChoice === 'cancelled' || statusChoice === 'refunded' ? 'pending' : 'paid',
      statusChoice,
    ]
  );

  for (const it of items) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_kmf)
       VALUES ($1, $2, $3, $4)`,
      [order.id, it.product_id, it.quantity, it.price_kmf]
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
  const orderIds = orders.map(o => o.id);
  console.log(`[cleanup:${tags.code}] ${orderIds.length} commande(s) SEEDTEST trouvée(s).`);

  if (orderIds.length > 0) {
    await db.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
    await db.query(
      'DELETE FROM orders WHERE id = ANY($1::uuid[]) AND market_id = $2',
      [orderIds, market.id]
    );
  }

  // product_market_exposure et product_market_price_* référencent product_id
  // en ON DELETE CASCADE. Le namespace garantit que seuls les produits
  // techniques de CE marché — et leurs projections locales — disparaissent.
  await db.query('DELETE FROM products WHERE name LIKE $1', [`${tags.productNamePrefix}%`]);
  await db.query(
    'DELETE FROM relais WHERE name = $1 AND market_id = $2',
    [tags.relaisName, market.id]
  );
  console.log(`[cleanup:${tags.code}] Terminé — aucune donnée d'un autre marché n'a été ciblée.`);
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(__doc_usage());
    return;
  }

  if (isProductionRuntime()) {
    console.error('❌ Refusé : runtime production. Ce script est réservé aux environnements de test/staging.');
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

  const tags = marketTags(market.code);
  if (args.dryRun) {
    console.log(`[dry-run] Créerait ${args.orders} commande(s) sur le relais "${tags.relaisName}" (marché ${market.code}).`);
    console.log(`[dry-run] Préparerait 15 produits exposés avec prix local DRAFT_PENDING_GATE en ${market.currency}.`);
    console.log('[dry-run] Aucune écriture effectuée.');
    return;
  }

  const relais = await ensureRelais(market);
  console.log(`[seed] Relais : ${relais.name} (${relais.id})`);

  const products = await ensureProducts(15, market.code);
  console.log(`[seed] ${products.length} produit(s) ${TAG}-${market.code} disponible(s).`);

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
  console.log(`[seed] Pour nettoyer ${market.code} : node scripts/seed-market-test-data.js --market ${market.code} --cleanup`);
}

function __doc_usage() {
  return `Usage :
  node scripts/seed-market-test-data.js --market CM --orders 60
  node scripts/seed-market-test-data.js --market CM --orders 60 --dry-run
  node scripts/seed-market-test-data.js --market CM --cleanup`;
}

if (require.main === module) {
  main()
    .then(() => {
      if (process.exitCode) return;
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Erreur :', err.message);
      process.exit(1);
    });
}

module.exports = {
  TAG,
  PRICE_SOURCE,
  MARKET_TEST_PROFILES,
  normalizeMarketCode,
  marketTags,
  marketProfile,
  parseArgs,
  isProductionRuntime,
  ensureMarket,
  ensureRelais,
  ensureProducts,
  localDraftAmountForProduct,
  prepareProductsForMarket,
  createOrder,
  cleanup,
  main,
};
