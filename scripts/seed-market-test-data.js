#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          seed-market-test-data-cli
 * @domain        admin-dashboard
 * @layer         script
 * @owner         backend-core
 * @purpose       Générer un lot de commandes réalistes en staging (relais,
 *                produits, order_items en distribution variée) pour que les
 *                requêtes de viabilité pricing (panier moyen, mono-article,
 *                cf. docs/doctrine/DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md)
 *                aient un volume statistiquement lisible.
 * @impact-areas  staging-only — ne touche jamais un environnement où
 *                NODE_ENV=production
 *
 * Toutes les lignes créées sont taguées ('SEEDTEST-' en préfixe de reference/
 * name) pour rester identifiables et supprimables sans toucher aux données
 * réelles ou aux fixtures ITEST- des tests d'intégration.
 *
 * Usage :
 *   node scripts/seed-market-test-data.js --market CM --orders 60
 *   node scripts/seed-market-test-data.js --market CM --orders 60 --dry-run
 *   node scripts/seed-market-test-data.js --market CM --cleanup
 *
 * Garde-fous :
 *   - Refuse de tourner si NODE_ENV=production (vérification explicite,
 *     même si ce script ne devrait jamais être pointé sur la prod).
 *   - Le marché doit déjà exister (markets.code) — ce script ne crée pas
 *     de marché, il seed des commandes dessus.
 *   - Idempotent au sens : relançable sans dédoublonner le relais/produits
 *     taguée SEEDTEST (réutilisés s'ils existent déjà), mais chaque run
 *     ajoute de nouvelles commandes (pas de dédup sur les commandes —
 *     utilise --cleanup avant de relancer si tu veux repartir propre).
 */

'use strict';

const db = require('../db');

const TAG = 'SEEDTEST';
const REF_PREFIX = `${TAG}-`;
const RELAIS_NAME = `${TAG} relais`;
const PRODUCT_NAME_PREFIX = `${TAG} produit`;

// Distribution volontairement réaliste et non uniforme : beaucoup de
// commandes à 1-2 articles, une traîne plus courte vers 3-6, quelques
// commandes "grosses" à 8-12 — pour éviter qu'une seule commande atypique
// ne pilote la moyenne comme observé sur les 5 commandes actuelles.
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

async function ensureMarket(code) {
  const { rows } = await db.query('SELECT id, code, name, currency FROM markets WHERE code = $1', [code]);
  if (rows.length === 0) {
    const { rows: all } = await db.query('SELECT code FROM markets ORDER BY code');
    throw new Error(
      `Marché "${code}" introuvable. Marchés existants : ${all.map(r => r.code).join(', ') || '(aucun)'}. ` +
      `Ce script ne crée pas de marché — seed d'abord la table markets.`
    );
  }
  return rows[0];
}

async function ensureRelais(marketId) {
  const { rows } = await db.query(
    `SELECT * FROM relais WHERE name = $1 AND market_id = $2 LIMIT 1`,
    [RELAIS_NAME, marketId]
  );
  if (rows.length > 0) return rows[0];

  const { rows: created } = await db.query(
    `INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING *`,
    [
      RELAIS_NAME,
      `${TAG} agent`,
      `+269${randomInt(3000000, 3999999)}`,
      `${TAG} adresse de test`,
      'Ngazidja',
      marketId,
    ]
  );
  return created[0];
}

async function ensureProducts(count) {
  const { rows: existing } = await db.query(
    `SELECT * FROM products WHERE name LIKE $1 ORDER BY name`,
    [`${PRODUCT_NAME_PREFIX}%`]
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
        `${PRODUCT_NAME_PREFIX} ${i + 1}`,
        priceKmf,
        Math.round((priceKmf / 750) * 100) / 100, // conversion approx KMF->EUR pour cohérence d'affichage
        randomInt(20, 200),
        'seed-test',
      ]
    );
    created.push(rows[0]);
  }
  return [...existing, ...created];
}

async function createOrder({ relaisId, products }) {
  const statusChoice = pickWeighted(STATUS_WEIGHTS).status;
  const itemCount = pickWeighted(ITEM_COUNT_WEIGHTS).n;
  const ref = `${REF_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Sélection de N produits distincts (ou avec remise si le pool est petit)
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
       (reference, relais_id, total_kmf, total_eur, payment_mode, payment_status, status, created_at)
     VALUES ($1, $2, $3, $4, $5::public.payment_mode, $6::public.payment_status, $7::public.order_status,
             now() - (random() * interval '90 days'))
     RETURNING *`,
    [
      ref,
      relaisId,
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

async function cleanup() {
  const { rows: orders } = await db.query(`SELECT id FROM orders WHERE reference LIKE $1`, [`${REF_PREFIX}%`]);
  const orderIds = orders.map(o => o.id);
  console.log(`[cleanup] ${orderIds.length} commande(s) SEEDTEST trouvée(s).`);
  if (orderIds.length > 0) {
    await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
  }
  await db.query(`DELETE FROM products WHERE name LIKE $1`, [`${PRODUCT_NAME_PREFIX}%`]);
  await db.query(`DELETE FROM relais WHERE name = $1`, [RELAIS_NAME]);
  console.log('[cleanup] Terminé — relais, produits et commandes SEEDTEST supprimés.');
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(__doc_usage());
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusé : NODE_ENV=production. Ce script est réservé au staging.');
    process.exitCode = 1;
    return;
  }

  if (args.cleanup) {
    await cleanup();
    return;
  }

  if (!args.market) {
    console.error('❌ --market est requis (ex: --market CM). Utilise --help pour la liste des options.');
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(args.orders) || args.orders <= 0) {
    console.error('❌ --orders doit être un entier positif.');
    process.exitCode = 1;
    return;
  }

  const market = await ensureMarket(args.market);
  console.log(`[seed] Marché : ${market.code} — ${market.name}`);

  if (args.dryRun) {
    console.log(`[dry-run] Créerait ${args.orders} commande(s) sur le relais "${RELAIS_NAME}" (marché ${market.code}).`);
    console.log('[dry-run] Aucune écriture effectuée.');
    return;
  }

  const relais = await ensureRelais(market.id);
  console.log(`[seed] Relais : ${relais.name} (${relais.id})`);

  const products = await ensureProducts(15);
  console.log(`[seed] ${products.length} produit(s) SEEDTEST disponible(s).`);

  let monoArticle = 0;
  let totalLignes = 0;
  for (let i = 0; i < args.orders; i++) {
    const { itemCount } = await createOrder({ relaisId: relais.id, products });
    totalLignes += itemCount;
    if (itemCount === 1) monoArticle++;
  }

  console.log(`[seed] ✅ ${args.orders} commande(s) créée(s).`);
  console.log(`[seed]    Panier moyen (lignes) : ${(totalLignes / args.orders).toFixed(2)}`);
  console.log(`[seed]    Mono-article : ${monoArticle}/${args.orders} (${((100 * monoArticle) / args.orders).toFixed(1)}%)`);
  console.log('[seed] Relance la requête panier-moyen-mono-article.sql pour la vue exacte incluant status/exclusions.');
  console.log(`[seed] Pour nettoyer : node scripts/seed-market-test-data.js --cleanup`);
}

function __doc_usage() {
  return `Usage :
  node scripts/seed-market-test-data.js --market CM --orders 60
  node scripts/seed-market-test-data.js --market CM --orders 60 --dry-run
  node scripts/seed-market-test-data.js --cleanup`;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(err => {
    console.error('❌ Erreur :', err.message);
    process.exit(1);
  });
