/**
 * @komerce-arch
 * @role          economic-engine-cost-component-admin-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        component_selector, validated_component_payload, actor_id
 * @outputs       component_projection, mutation_result, audit_events
 * @depends       db.js
 * @used-by       routes/admin-cost-components.js, services/pricing-workspace.js
 * @db-read       cost_components, cost_component_events
 * @db-write      cost_components, cost_component_events
 * @db-txn        none
 * @doctrine      single_cost_component_mutation_authority, browser_uses_component_key
 * @impact-areas  pricing, economic-engine, admin-dashboard
 * @version       2026-08
 */

'use strict';

const db = require('../db');

class CostComponentAdminError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'CostComponentAdminError';
    this.status = status;
    this.code = code;
  }
}

const META = Object.freeze({
  families: ['landed_relay', 'business', 'exceptional'],
  categories: {
    landed_relay: ['product_purchase', 'sourcing', 'hub', 'packaging', 'freight', 'customs', 'port_transitary', 'local_distribution', 'relay'],
    business: ['payment', 'risk_provision', 'fixed_overhead'],
    exceptional: ['incident', 'marketing_campaign'],
  },
  units: ['kmf', 'pct', 'kmf_per_kg', 'kmf_per_m3', 'kmf_per_order', 'kmf_per_parcel', 'kmf_per_shipment', 'aed', 'eur', 'usd'],
  scopes: ['global', 'category', 'product', 'order', 'parcel', 'shipment', 'supplier', 'relay'],
  allocation_methods: ['none', 'per_order', 'per_item', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight', 'by_quantity', 'by_category_risk', 'manual'],
  sources: ['default', 'category', 'manual', 'supplier', 'real', 'missing'],
  confidences: ['low', 'medium', 'high'],
  channels: ['cash_relais', 'diaspora', 'mobile_money'],
  islands: ['grande_comore', 'moheli', 'anjouan', 'mayotte'],
});

const UPDATE_FIELDS = [
  'label', 'emoji', 'description', 'family', 'category', 'default_value', 'unit', 'currency',
  'scope', 'scope_value', 'allocation_method', 'source', 'confidence', 'channel', 'island',
  'is_active', 'is_exceptional', 'active_from', 'active_until', 'notes',
];

function validateFamilyCategory(family, category) {
  const allowed = META.categories[family] || [];
  if (!allowed.includes(category)) {
    throw new CostComponentAdminError(
      400,
      `Catégorie "${category}" invalide pour la famille "${family}". Autorisées : ${allowed.join(', ')}`,
      'cost_component_category_invalid'
    );
  }
}

async function listComponents(filters = {}, q = db) {
  const conditions = [];
  const params = [];
  let i = 1;
  for (const field of ['family', 'category', 'channel', 'island', 'scope']) {
    if (filters[field]) {
      conditions.push(`${field} = $${i++}`);
      params.push(filters[field]);
    }
  }
  if (filters.is_active === true || filters.is_active === 'true' || filters.is_active === '1') conditions.push('is_active = TRUE');
  if (filters.is_active === false || filters.is_active === 'false' || filters.is_active === '0') conditions.push('is_active = FALSE');
  if (filters.is_exceptional === true || filters.is_exceptional === 'true' || filters.is_exceptional === '1') conditions.push('is_exceptional = TRUE');
  if (filters.is_exceptional === false || filters.is_exceptional === 'false' || filters.is_exceptional === '0') conditions.push('is_exceptional = FALSE');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await q.query(
    `SELECT * FROM cost_components ${where} ORDER BY family, category, display_order, key`,
    params
  );
  const grouped = { landed_relay: {}, business: {}, exceptional: {} };
  rows.forEach(component => {
    if (!grouped[component.family]) grouped[component.family] = {};
    if (!grouped[component.family][component.category]) grouped[component.family][component.category] = [];
    grouped[component.family][component.category].push(component);
  });
  return { components: rows, grouped, count: rows.length };
}

async function resolveComponent(selector, q = db) {
  const byKey = selector && selector.key;
  const byId = selector && selector.id;
  if (!byKey && !byId) throw new CostComponentAdminError(400, 'Sélecteur composant requis', 'cost_component_selector_required');
  const { rows } = byKey
    ? await q.query('SELECT * FROM cost_components WHERE key = $1', [byKey])
    : await q.query('SELECT * FROM cost_components WHERE id = $1', [byId]);
  if (!rows.length) throw new CostComponentAdminError(404, 'Composant introuvable', 'cost_component_not_found');
  return rows[0];
}

async function getComponent(selector, q = db) {
  const component = await resolveComponent(selector, q);
  const { rows: events } = await q.query(
    `SELECT id, event_type, old_value, new_value, notes, created_at
       FROM cost_component_events
      WHERE component_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [component.id]
  );
  return { component, events };
}

async function createComponent(body = {}, actorId = null, q = db) {
  for (const field of ['key', 'label', 'family', 'category', 'default_value', 'unit']) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw new CostComponentAdminError(400, `Champ requis manquant : ${field}`, 'cost_component_required_field');
    }
  }
  validateFamilyCategory(body.family, body.category);
  let row;
  try {
    const { rows } = await q.query(
      `INSERT INTO cost_components (
         key, label, emoji, description, family, category, default_value, unit, currency,
         scope, scope_value, allocation_method, source, confidence, channel, island,
         is_active, is_exceptional, active_from, active_until, notes, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22
       ) RETURNING *`,
      [
        body.key, body.label, body.emoji || null, body.description || null,
        body.family, body.category, body.default_value, body.unit, body.currency || null,
        body.scope || 'global', body.scope_value || null, body.allocation_method || 'none',
        body.source || 'default', body.confidence || 'medium', body.channel || null, body.island || null,
        body.is_active !== false, !!body.is_exceptional, body.active_from || null, body.active_until || null,
        body.notes || null, actorId || null,
      ]
    );
    row = rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new CostComponentAdminError(409, `Une clé identique existe déjà : ${body.key || ''}`, 'cost_component_key_exists');
    }
    throw error;
  }
  await q.query(
    `INSERT INTO cost_component_events (component_id, component_key, event_type, new_value, notes, triggered_by)
     VALUES ($1, $2, 'created', $3, $4, $5)`,
    [row.id, row.key, JSON.stringify(row), body.notes || null, actorId || null]
  );
  return row;
}

async function updateComponent(selector, body = {}, actorId = null, q = db) {
  const oldComp = await resolveComponent(selector, q);
  if (body.family !== undefined || body.category !== undefined) {
    validateFamilyCategory(body.family !== undefined ? body.family : oldComp.family, body.category !== undefined ? body.category : oldComp.category);
  }
  const sets = [];
  const params = [];
  let i = 1;
  for (const field of UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      sets.push(`${field} = $${i++}`);
      params.push(body[field]);
    }
  }
  if (!sets.length) throw new CostComponentAdminError(400, 'Aucun champ à modifier', 'cost_component_no_changes');
  sets.push(`updated_by = $${i++}`);
  params.push(actorId || null);
  params.push(oldComp.id);
  const { rows } = await q.query(
    `UPDATE cost_components SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  const row = rows[0];
  let eventType = 'updated';
  if (body.default_value !== undefined && Number(body.default_value) !== Number(oldComp.default_value)) eventType = 'value_changed';
  else if (body.is_active === true && !oldComp.is_active) eventType = 'activated';
  else if (body.is_active === false && oldComp.is_active) eventType = 'deactivated';
  else if (body.scope !== undefined && body.scope !== oldComp.scope) eventType = 'scope_changed';
  await q.query(
    `INSERT INTO cost_component_events
       (component_id, component_key, event_type, old_value, new_value, notes, triggered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [oldComp.id, oldComp.key, eventType, JSON.stringify(oldComp), JSON.stringify(row), body.notes || null, actorId || null]
  );
  return row;
}

async function toggleComponent(selector, actorId = null, q = db) {
  const oldComp = await resolveComponent(selector, q);
  const isActive = !oldComp.is_active;
  const { rows } = await q.query(
    'UPDATE cost_components SET is_active = $1, updated_by = $2 WHERE id = $3 RETURNING *',
    [isActive, actorId || null, oldComp.id]
  );
  await q.query(
    `INSERT INTO cost_component_events
       (component_id, component_key, event_type, old_value, new_value, triggered_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [oldComp.id, oldComp.key, isActive ? 'activated' : 'deactivated', JSON.stringify({ is_active: oldComp.is_active }), JSON.stringify({ is_active: isActive }), actorId || null]
  );
  return rows[0];
}

async function deactivateComponent(selector, actorId = null, q = db) {
  const oldComp = await resolveComponent(selector, q);
  await q.query('UPDATE cost_components SET is_active = FALSE, updated_by = $1 WHERE id = $2', [actorId || null, oldComp.id]);
  await q.query(
    `INSERT INTO cost_component_events (component_id, component_key, event_type, old_value, triggered_by)
     VALUES ($1,$2,'deactivated',$3,$4)`,
    [oldComp.id, oldComp.key, JSON.stringify(oldComp), actorId || null]
  );
  return { ok: true, soft: true };
}

async function hardDeleteComponent(selector, actorId = null, q = db) {
  const oldComp = await resolveComponent(selector, q);
  if (!oldComp.is_deletable) throw new CostComponentAdminError(403, 'Ce composant est marqué non supprimable', 'cost_component_not_deletable');
  await q.query('DELETE FROM cost_components WHERE id = $1', [oldComp.id]);
  await q.query(
    `INSERT INTO cost_component_events (component_id, component_key, event_type, old_value, triggered_by)
     VALUES (NULL,$1,'deleted',$2,$3)`,
    [oldComp.key, JSON.stringify(oldComp), actorId || null]
  );
  return { ok: true, hard: true };
}

module.exports = {
  META,
  CostComponentAdminError,
  listComponents,
  resolveComponent,
  getComponent,
  createComponent,
  updateComponent,
  toggleComponent,
  deactivateComponent,
  hardDeleteComponent,
};
