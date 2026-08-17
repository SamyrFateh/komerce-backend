/**
 * @komerce-arch
 * @role          economic-engine-apply-pricing-updates
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/pricing-engine.js, services/economic-price-audit-service.js, utils/logger.js
 * @used-by       none
 * @db-read       products
 * @db-write      products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-08
 */

'use strict';

/**
 * I-SWEEP-6B — Application de prix auditée + garde survival serveur.
 *
 * Corrige deux trous G5 :
 * - apply-price dépendait du survival_price_kmf fourni par le client ;
 * - apply-all modifiait les prix sans price_history par item.
 */

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const { recordProductPriceChange } = require('./economic-price-audit-service');
const log = require('../utils/logger').child({ module: 'apply-pricing-updates' });

async function computeServerSurvival(product) {
  try {
    const doctrine = await pricingEngine.recommend({
      product_id: product.id,
      category: product.category,
      channel: 'cash_relais',
      cost_kmf: product.cost_kmf,
      weight_kg: product.weight_kg,
      volume_m3: product.volume_m3 || 0.005,
      current_price_kmf: product.price_kmf,
    });
    const survival = Number(doctrine?.survival_price_kmf || 0);
    return Number.isFinite(survival) && survival > 0 ? survival : null;
  } catch (err) {
    log.warn({ err }, '[pricing-apply] survival compute skipped:');
    return null;
  }
}

async function applySinglePrice({ productId, priceKmf, source = 'manual', scenarioId = null, scenarioLabel = null, levier = null, user }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }
  if (!productId) return { status: 400, body: { error: 'product_id requis' } };

  const newPrice = Number(priceKmf);
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { status: 400, body: { error: 'price_kmf invalide' } };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [product] } = await client.query(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!product) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Produit introuvable' } };
    }

    const survival = await computeServerSurvival(product);
    if (survival && newPrice < survival) {
      await client.query('ROLLBACK');
      return {
        status: 400,
        body: {
          error: 'Prix sous le seuil de survie : refusé par doctrine serveur.',
          code: 'below_survival_server',
          survival_price_kmf: survival,
          attempted_price_kmf: newPrice,
        },
      };
    }

    const oldPrice = Number(product.price_kmf || 0);
    const { rows: [updated] } = await client.query(
      `UPDATE products SET price_kmf = $1, updated_at = NOW()
        WHERE id = $2 RETURNING id, name, price_kmf`,
      [newPrice, product.id]
    );

    const audit = await recordProductPriceChange(client, {
      productId: product.id,
      oldPriceKmf: oldPrice,
      newPriceKmf: newPrice,
      source,
      appliedBy: user.id,
      scenarioId,
      scenarioLabel,
      levier,
      note: 'pricing apply single',
    });

    await client.query('COMMIT');

    return {
      status: 200,
      body: {
        ok: true,
        product: updated,
        old_price_kmf: oldPrice,
        new_price_kmf: newPrice,
        survival_price_kmf: survival,
        audit,
        scenario_id: scenarioId,
        levier,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function applyAllPrices({ items, source = 'batch', user }) {
  if (!user?.id || user.role !== 'admin') {
    return { status: 403, body: { error: 'Accès réservé admin' } };
  }
  if (!Array.isArray(items) || !items.length) {
    return { status: 400, body: { error: 'items array requis' } };
  }
  if (items.length > 500) {
    return { status: 400, body: { error: 'max 500 items par batch' } };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const applied = [];
    const rejected = [];
    const skipped = [];

    for (const it of items) {
      const productId = it.product_id;
      const newPrice = Number(it.price_kmf);
      if (!productId || !Number.isFinite(newPrice) || newPrice <= 0) {
        skipped.push({ product_id: productId || null, reason: 'invalid_item' });
        continue;
      }

      const { rows: [product] } = await client.query(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );
      if (!product) {
        skipped.push({ product_id: productId, reason: 'not_found' });
        continue;
      }

      const survival = await computeServerSurvival(product);
      if (survival && newPrice < survival) {
        rejected.push({
          product_id: productId,
          name: product.name,
          reason: 'below_survival_server',
          survival_price_kmf: survival,
          attempted_price_kmf: newPrice,
        });
        continue;
      }

      const oldPrice = Number(product.price_kmf || 0);
      const { rows: [updated] } = await client.query(
        `UPDATE products SET price_kmf = $1, updated_at = NOW()
          WHERE id = $2 RETURNING id, name, price_kmf`,
        [newPrice, productId]
      );

      const audit = await recordProductPriceChange(client, {
        productId,
        oldPriceKmf: oldPrice,
        newPriceKmf: newPrice,
        source,
        appliedBy: user.id,
        scenarioId: it.scenario_id || null,
        scenarioLabel: it.scenario_label || null,
        levier: it.levier || null,
        note: 'pricing apply all',
      });

      applied.push({
        ...updated,
        old_price_kmf: oldPrice,
        new_price_kmf: newPrice,
        survival_price_kmf: survival,
        audit,
      });
    }

    await client.query('COMMIT');

    return {
      status: rejected.length ? 207 : 200,
      body: {
        ok: rejected.length === 0,
        count: applied.length,
        rejected_count: rejected.length,
        skipped_count: skipped.length,
        products: applied,
        rejected,
        skipped,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { applySinglePrice, applyAllPrices, computeServerSurvival };
