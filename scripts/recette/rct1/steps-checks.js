/**
 * @komerce-arch-lite
 * @role          rct1-steps-checks
 * @domain        recette
 * @layer         script
 * @owner         backend-core
 * @purpose       Controles RCT1 en lecture seule (conversion P5, P4 sans prix KM, classification douane) : jamais d'ecriture, ecart classe et non masque.
 * @impact-areas  staging-only, pricing, customs, recette
 */
'use strict';
const { PRODUCTS } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;
// Etape de controle : rien a installer (inspect toujours "done"), le verdict vient de verify.
const check = (id, deps, verify) => ({ id, deps, inspect: async () => ({ done: true }), apply: async () => ({ writes: 0 }), verify });

const conversionCheck = check('check.P5.conversion', ['product.P5'], async ({ db }) => {
  const { projectAmount } = require('../../../utils/currency');
  const exp = PRODUCTS.P5.expected_conversion;
  const observed = {};
  for (const [cur, expected] of Object.entries(exp)) {
    try {
      const raw = Number(await projectAmount(PRODUCTS.P5.price_eur, 'EUR', cur));
      observed[cur] = { expected, raw, rounded: Math.round(raw) };
    } catch (e) { observed[cur] = { expected, error: String(e.message).slice(0, 120) }; }
  }
  const ok = Object.values(observed).every(o => o.rounded === o.expected);
  // Un ecart (ex. 49 196 = parite 491,96) est classe « arbitrage D4 », jamais valide.
  return { ok, observed, classification: ok ? 'CONFORME' : 'ECART_D4' };
});

const p4Check = check('check.P4.no-km-price', ['product.P4'], async ({ db }) => {
  const r = await q1(db, `SELECT COUNT(*)::int AS drafts FROM product_market_price_drafts d JOIN products pr ON pr.id=d.product_id
      JOIN markets m ON m.id=d.market_id WHERE pr.product_ref=$1 AND m.code='KM'`, [PRODUCTS.P4.ref]);
  return { ok: r.drafts === 0, km_price_drafts: r.drafts, expected: 'aucun prix KM : non achetable au marche KM' };
});

// Classification douane : le checkout fige customs_categories.key = products.category ; le chemin canonique d'edition produit
// n'accepte que des categories boutique. Constat systemique (pas propre a RCT1), arbitrage metier : etat OPEN_DECISION (ni PASS ni FAIL).
const classificationCheck = check('check.classification', ['product.P1', 'product.P2', 'product.P3'], async ({ db }) => {
  const { resolveFrozenClassification } = require('../../../services/customs-classification');
  const observed = {};
  for (const k of ['P1', 'P2', 'P3']) observed[k] = (await resolveFrozenClassification(db, PRODUCTS[k].category)).classification_defaulted ? 'DEFAUT' : 'CLASSE';
  const cust = (await db.query("SELECT key FROM customs_categories WHERE is_active")).rows.map(r => r.key);
  const boutique = (await db.query('SELECT key FROM boutique_categories')).rows.map(r => r.key);
  const common = boutique.filter(k => cust.includes(k));
  const defaultPresent = cust.includes('default');
  const real = (await db.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE category IN (SELECT key FROM customs_categories WHERE is_active))::int AS classified
      FROM products WHERE product_ref NOT LIKE 'RCT1-%'`)).rows[0];
  return { ok: null, open_decision: true, observed, boutique_customs_common_keys: common, customs_default_present: defaultPresent, real_products: real,
    note: 'Aucune cle commune boutique/douane et categorie default absente : toute ligne de commande est figee en repli. Arbitrage metier (correspondance boutique -> douane) requis ; aucune categorie inventee.' };
});

// I1 : un colis par commande, lignes de colis = lignes de commande. I2 : expedition groupee de 2 commandes, fret reparti sans double compte.
const parcelsCheck = check('check.I1-I2.parcels', ['ops.shipment.RCT1-SH2'], async ({ db }) => {
  const { rows: parcels } = await db.query(`SELECT o.reference, COUNT(DISTINCT p.id)::int AS parcels,
      (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id=o.id) AS lines, COUNT(pi.*)::int AS parcel_items
      FROM orders o LEFT JOIN parcels p ON p.order_id=o.id LEFT JOIN parcel_items pi ON pi.parcel_id=p.id
     WHERE o.simulation_scope='RCT1' AND o.reference IN ('RCT1-E1','RCT1-F') GROUP BY o.id, o.reference ORDER BY 1`);
  const sh = (await db.query(`SELECT freight_kmf FROM customs_shipments WHERE reference='RCT1-SH2'`)).rows[0];
  const { rows: alloc } = await db.query(`SELECT o.reference, SUM(a.amount_kmf)::numeric AS freight FROM order_item_real_cost_allocations a JOIN orders o ON o.id=a.order_id
     WHERE a.cost_type='freight' AND o.reference IN ('RCT1-E1','RCT1-F') GROUP BY 1 ORDER BY 1`);
  const total = alloc.reduce((t, r) => t + Number(r.freight), 0);
  const ok = parcels.length === 2 && parcels.every(r => r.parcels === 1 && r.parcel_items === r.lines) && !!sh && Number(sh.freight_kmf) === total;
  return { ok, parcels, shipment_freight_kmf: sh && Number(sh.freight_kmf), allocated_freight_kmf: total, note: 'I3 : voir check.I3.split' };
});

// I3 : chaque ligne comptee une fois (une allocation fret par ligne), total = somme des expeditions, aucun doublon (ligne, type, expedition).
const splitCheck = check('check.I3.split', ['split.transit-done'].filter(() => false), async ({ db }) => {
  const { SPLIT } = require('./data');
  const { rows: lines } = await db.query(`SELECT pr.product_ref, COUNT(a.*)::int AS freight_rows, COALESCE(SUM(a.amount_kmf),0)::numeric AS freight
      FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products pr ON pr.id=oi.product_id
      LEFT JOIN order_item_real_cost_allocations a ON a.order_item_id=oi.id AND a.cost_type='freight'
     WHERE o.reference=$1 GROUP BY pr.product_ref ORDER BY 1`, [SPLIT.order]);
  const { rows: dup } = await db.query(`SELECT a.order_item_id, a.cost_type, a.shipment_id, COUNT(*)::int AS n FROM order_item_real_cost_allocations a
      JOIN orders o ON o.id=a.order_id WHERE o.reference=$1 AND a.source<>'manual_entry' GROUP BY 1,2,3 HAVING COUNT(*)>1`, [SPLIT.order]);
  const parcels = (await db.query(`SELECT COUNT(*)::int AS n FROM parcels p JOIN orders o ON o.id=p.order_id WHERE o.reference=$1 AND p.status<>'cancelled'`, [SPLIT.order])).rows[0].n;
  const expected = Object.fromEntries(SPLIT.shipments.map(s => [PRODUCTS[s.product].ref, s.freight_kmf]));
  const ok = parcels === 2 && dup.length === 0 && lines.length === 2 && lines.every(l => l.freight_rows === 1 && Number(l.freight) === expected[l.product_ref]);
  return { ok, parcels, lines, duplicates: dup.length, expected_freight: expected };
});

// Marches : J/K exigent CM et CG (cadrage). Constat d'environnement ; substituer WM est une decision metier explicite.
const marketsCheck = check('check.JK.markets', [], async ({ db }) => {
  const codes = (await db.query("SELECT code FROM markets WHERE is_active ORDER BY code")).rows.map(r => r.code);
  const missing = ['CM', 'CG'].filter(c => !codes.includes(c));
  return { ok: missing.length ? null : true, open_decision: missing.length > 0, active_markets: codes, missing_markets: missing,
    note: missing.length ? 'J (MARKET_MISMATCH) et K (isolation operateur / XAF) non jouables sans CM/CG ; WM non substitue sans decision metier.' : 'CM/CG presents' };
});

// Etat du service REELLEMENT deploye (pas celui du processus du moteur) : /health/version expose les flags non secrets.
const deployedFlagsCheck = check('check.deployed-flags', [], async () => {
  const base = String(process.env.STAGING_BASE_URL || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: 'STAGING_BASE_URL absent' };
  try {
    const r = await fetch(`${base}/health/version`, { signal: AbortSignal.timeout(15000) });
    const body = await r.json();
    const flags = body.flags;
    if (!flags) return { ok: false, commit: body.commit, error: 'flags non exposes : le service deploye n\'a pas encore le correctif' };
    return { ok: flags.order_cost_snapshot_active === true, commit: body.commit, flags,
      e2: flags.stripe_mode === 'test' ? 'Stripe en mode test : E2 realisable (paiement carte de test = action humaine)' : 'Stripe non couvert (mode ' + flags.stripe_mode + ')' };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 120) }; }
});

const steps = [conversionCheck, p4Check, classificationCheck, parcelsCheck, splitCheck, marketsCheck, deployedFlagsCheck];
module.exports = { steps };
