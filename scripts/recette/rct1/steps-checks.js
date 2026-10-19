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

const classificationCheck = check('check.classification', ['product.P1', 'product.P2', 'product.P3'], async ({ db }) => {
  const { resolveFrozenClassification } = require('../../../services/customs-classification');
  const out = {};
  for (const k of ['P1', 'P2', 'P3']) out[k] = (await resolveFrozenClassification(db, PRODUCTS[k].category)).classification_defaulted ? 'DEFAUT' : 'CLASSE';
  // Constat brut : P1 attendu « classe » par le cadrage ; tout produit de categorie sans cle douane tombe en repli.
  return { ok: out.P1 === 'CLASSE' && out.P2 === 'DEFAUT', observed: out };
});

const steps = [conversionCheck, p4Check, classificationCheck];
module.exports = { steps };
