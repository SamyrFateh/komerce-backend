/**
 * @komerce-arch-lite
 * @role          rct1-steps-pricing
 * @domain        pricing
 * @layer         script
 * @owner         backend-core
 * @purpose       Etapes RCT1 de prix local par marche (brouillon, gate economique, activation, exposition) via services proprietaires.
 * @impact-areas  staging-only, pricing, catalog, recette
 */
'use strict';
const { PRODUCTS, ACTORS, P3_PRICE_KMF } = require('./data');

const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0] || null;

// Memes appels que la route admin-pricing-workspace (draft -> activation -> exposition marche).
const LOCAL_PRICES = Object.freeze([
  { market: 'KM', product: 'P1', amount: 15000 },
  { market: 'KM', product: 'P2', amount: 25000 },
  { market: 'KM', product: 'P3', amount: P3_PRICE_KMF },
]);

const localPriceStep = (lp) => {
  const p = PRODUCTS[lp.product];
  return {
    id: `price.${lp.market}.${lp.product}`, deps: ['admin.resolve', `product.${lp.product}`, `actor.operator-${lp.market.toLowerCase()}`],
    inspect: async ({ db }) => {
      const row = await q1(db, `SELECT d.status, d.amount, COALESCE(e.commercial_exposure,'DISABLED') AS exposure
          FROM products pr JOIN markets m ON m.code=$2
          LEFT JOIN product_market_price_drafts d ON d.product_id=pr.id AND d.market_id=m.id
          LEFT JOIN product_market_exposure e ON e.product_id=pr.id AND e.market_id=m.id
         WHERE pr.product_ref=$1`, [p.ref, lp.market]);
      const done = !!row && row.status === 'LOCAL_ACTIVE' && Number(row.amount) === lp.amount && row.exposure === 'ENABLED';
      return { done, detail: row };
    },
    apply: async ({ db }) => {
      // Le prix local est une decision du manager du marche (capabilities pricing.decide/activate, catalog.expose).
      const op = ACTORS.find(a => a.key === `operator-${lp.market.toLowerCase()}`);
      const operator = await q1(db, 'SELECT id FROM users WHERE email=$1', [op.email]);
      const shared = { adminId: operator.id };
      const market = await q1(db, 'SELECT id, code, name, currency, minor_unit FROM markets WHERE code=$1 AND is_active', [lp.market]);
      const pricing = require('../../../services/market-commercial-price-service');
      const activation = require('../../../services/market-local-price-activation-service');
      const catalog = require('../../../services/market-delegation-catalog-service');
      const reason = 'RCT1 recette staging : prix local de test (donnee T)';
      let writes = 0;
      const cur = await q1(db, `SELECT d.status, d.amount FROM product_market_price_drafts d
          JOIN products pr ON pr.id=d.product_id JOIN markets m ON m.id=d.market_id WHERE pr.product_ref=$1 AND m.code=$2`, [p.ref, lp.market]);
      if (!cur || Number(cur.amount) !== lp.amount || cur.status === 'LOCAL_ACTIVE' && Number(cur.amount) !== lp.amount) {
        await pricing.setMarketPriceDraft({ market, productRef: p.ref, amount: lp.amount, reason, source: 'rct1_recette', actorId: shared.adminId });
        writes++;
      }
      await activation.activateLocalPrice({ market, productRef: p.ref, actorId: shared.adminId, reason, source: 'rct1_recette' });
      writes++;
      const prod = await q1(db, 'SELECT id FROM products WHERE product_ref=$1', [p.ref]);
      const exp = await q1(db, `SELECT commercial_exposure FROM product_market_exposure WHERE product_id=$1 AND market_id=$2`, [prod.id, market.id]);
      if (!exp || exp.commercial_exposure !== 'ENABLED') {
        await catalog.setExposure(require('../../../db'), { marketCode: lp.market, actorUserId: shared.adminId, productId: prod.id, exposure: 'ENABLED' });
        writes++;
      }
      return { writes };
    },
  };
};

const steps = LOCAL_PRICES.map(localPriceStep);
module.exports = { steps, localPriceStep, LOCAL_PRICES };
