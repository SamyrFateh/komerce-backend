/**
 * @komerce-arch
 * @role          economic-engine-market-cost-component-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        resolved_market_id, component_key, market_override_payload, actor_id
 * @outputs       effective_market_cost_components, audited_override_mutations
 * @depends       db.js
 * @used-by       routes/admin-pricing-workspace.js, services/pricing-cdr.js
 * @db-read       cost_components, cost_component_market_overrides
 * @db-write      cost_component_market_overrides, cost_component_market_override_events
 * @db-txn        override_mutations_atomic
 * @doctrine      global_model_is_base_market_override_is_effective_value
 * @impact-areas  pricing, economic-engine, market-authorization
 * @version       2026-09
 */

'use strict';

const db = require('../db');

class MarketCostComponentError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'MarketCostComponentError';
    this.status = status;
    this.code = code;
  }
}

function effectiveRow(row) {
  const hasOverride = Boolean(row.override_id);
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    emoji: row.emoji,
    description: row.description,
    family: row.family,
    category: row.category,
    default_value: hasOverride && row.override_default_value != null
      ? Number(row.override_default_value)
      : Number(row.base_default_value),
    unit: row.unit,
    currency: row.currency,
    scope: row.scope,
    scope_value: row.scope_value,
    allocation_method: row.allocation_method,
    source: hasOverride ? 'market_override' : row.source,
    base_source: row.source,
    confidence: row.confidence,
    base_confidence: row.confidence,
    channel: row.channel,
    island: row.island,
    is_active: hasOverride && row.override_is_active != null
      ? Boolean(row.override_is_active)
      : Boolean(row.base_is_active),
    is_exceptional: Boolean(row.is_exceptional),
    active_from: row.active_from,
    active_until: row.active_until,
    display_order: row.display_order,
    base_default_value: Number(row.base_default_value),
    base_is_active: Boolean(row.base_is_active),
    inherited: !hasOverride,
    notes: row.notes || null,
    override_notes: hasOverride ? row.override_notes || null : null,
    base_updated_at: row.base_updated_at || null,
    override_updated_at: hasOverride ? row.override_updated_at || null : null,
  };
}

async function listEffectiveComponents(marketId, q = db) {
  if (!marketId) throw new MarketCostComponentError(400, 'Marché requis', 'market_cost_market_required');
  const { rows } = await q.query(
    `SELECT cc.id, cc.key, cc.label, cc.emoji, cc.description, cc.family, cc.category,
            cc.default_value AS base_default_value, cc.unit, cc.currency, cc.scope, cc.scope_value,
            cc.allocation_method, cc.source, cc.confidence, cc.channel, cc.island,
            cc.is_active AS base_is_active, cc.is_exceptional, cc.active_from, cc.active_until,
            cc.display_order, cc.notes, cc.updated_at AS base_updated_at,
            o.id AS override_id, o.default_value AS override_default_value,
            o.is_active AS override_is_active, o.notes AS override_notes,
            o.updated_at AS override_updated_at
       FROM cost_components cc
       LEFT JOIN cost_component_market_overrides o
         ON o.component_id = cc.id AND o.market_id = $1
      ORDER BY cc.family, cc.category, cc.display_order, cc.key`,
    [marketId]
  );
  return rows.map(effectiveRow);
}

async function resolveComponentByKey(q, key) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) throw new MarketCostComponentError(400, 'Clé composant requise', 'market_cost_key_required');
  const { rows } = await q.query(
    `SELECT id, key, label, default_value, is_active
       FROM cost_components
      WHERE key = $1
      LIMIT 1`,
    [cleanKey]
  );
  if (!rows.length) throw new MarketCostComponentError(404, 'Composant introuvable', 'market_cost_component_not_found');
  return rows[0];
}

function validateOverride(body = {}) {
  const hasValue = Object.prototype.hasOwnProperty.call(body, 'default_value');
  const hasActive = Object.prototype.hasOwnProperty.call(body, 'is_active');
  if (!hasValue && !hasActive && !Object.prototype.hasOwnProperty.call(body, 'notes')) {
    throw new MarketCostComponentError(400, 'Aucune surcharge à enregistrer', 'market_cost_no_changes');
  }
  if (hasValue) {
    const value = Number(body.default_value);
    if (!Number.isFinite(value) || value < 0) {
      throw new MarketCostComponentError(400, 'Valeur de coût invalide', 'market_cost_value_invalid');
    }
  }
  if (hasActive && typeof body.is_active !== 'boolean') {
    throw new MarketCostComponentError(400, 'is_active doit être booléen', 'market_cost_active_invalid');
  }
}

async function upsertOverride({ marketId, key, body = {}, actorId = null }) {
  validateOverride(body);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const component = await resolveComponentByKey(client, key);
    const { rows: currentRows } = await client.query(
      `SELECT * FROM cost_component_market_overrides
        WHERE market_id = $1 AND component_id = $2
        FOR UPDATE`,
      [marketId, component.id]
    );
    const current = currentRows[0] || null;
    const nextValue = Object.prototype.hasOwnProperty.call(body, 'default_value')
      ? Number(body.default_value)
      : (current ? current.default_value : null);
    const nextActive = Object.prototype.hasOwnProperty.call(body, 'is_active')
      ? body.is_active
      : (current ? current.is_active : null);
    const nextNotes = Object.prototype.hasOwnProperty.call(body, 'notes')
      ? (body.notes || null)
      : (current ? current.notes : null);

    const { rows: [saved] } = await client.query(
      `INSERT INTO cost_component_market_overrides
         (market_id, component_id, default_value, is_active, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (market_id, component_id) DO UPDATE SET
         default_value = EXCLUDED.default_value,
         is_active = EXCLUDED.is_active,
         notes = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [marketId, component.id, nextValue, nextActive, nextNotes, actorId]
    );

    await client.query(
      `INSERT INTO cost_component_market_override_events
         (override_id, market_id, component_id, component_key, event_type, old_value, new_value, notes, triggered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        saved.id,
        marketId,
        component.id,
        component.key,
        current ? 'updated' : 'created',
        current ? JSON.stringify(current) : null,
        JSON.stringify(saved),
        nextNotes,
        actorId,
      ]
    );
    await client.query('COMMIT');
    return {
      key: component.key,
      default_value: saved.default_value == null ? Number(component.default_value) : Number(saved.default_value),
      is_active: saved.is_active == null ? Boolean(component.is_active) : Boolean(saved.is_active),
      base_default_value: Number(component.default_value),
      base_is_active: Boolean(component.is_active),
      inherited: false,
      override_notes: saved.notes || null,
      override_updated_at: saved.updated_at || null,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

async function resetOverride({ marketId, key, actorId = null }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const component = await resolveComponentByKey(client, key);
    const { rows } = await client.query(
      `DELETE FROM cost_component_market_overrides
        WHERE market_id = $1 AND component_id = $2
        RETURNING *`,
      [marketId, component.id]
    );
    const old = rows[0] || null;
    if (old) {
      await client.query(
        `INSERT INTO cost_component_market_override_events
           (override_id, market_id, component_id, component_key, event_type, old_value, new_value, triggered_by)
         VALUES (NULL,$1,$2,$3,'reset',$4,$5,$6)`,
        [
          marketId,
          component.id,
          component.key,
          JSON.stringify(old),
          JSON.stringify({ inherited: true, default_value: Number(component.default_value), is_active: Boolean(component.is_active) }),
          actorId,
        ]
      );
    }
    await client.query('COMMIT');
    return {
      key: component.key,
      default_value: Number(component.default_value),
      is_active: Boolean(component.is_active),
      base_default_value: Number(component.default_value),
      base_is_active: Boolean(component.is_active),
      inherited: true,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MarketCostComponentError,
  effectiveRow,
  listEffectiveComponents,
  upsertOverride,
  resetOverride,
};
