/**
 * @komerce-arch
 * @role          partner-admin-service
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        partner_filters, validated_partner_payload, partner_id
 * @outputs       partner_rows, partner_stats, partner_mutation_result
 * @depends       db.js
 * @used-by       routes/admin/partners.js, services/sourcing-workspace.js
 * @db-read       partners, suppliers_stats, customs_shipments, orders
 * @db-write      partners
 * @db-txn        none
 * @doctrine      shared_partner_mutation_authority, sourcing_workspace_filters_partner_type
 * @impact-areas  sourcing, partners, logistics, admin-dashboard
 * @version       2026-08
 */

'use strict';

const db = require('../db');

class PartnerAdminError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'PartnerAdminError';
    this.status = status;
    this.code = code;
  }
}

async function listPartners(filters = {}, q = db) {
  const { type, island, country, active } = filters;
  const conditions = ['1=1'];
  const params = [];
  let pi = 1;
  if (type) { conditions.push(`partner_type = $${pi++}`); params.push(type); }
  if (island) { conditions.push(`island = $${pi++}`); params.push(island); }
  if (country) { conditions.push(`country_code = $${pi++}`); params.push(country); }
  if (active !== undefined && active !== null) {
    conditions.push(`is_active = $${pi++}`);
    params.push(Boolean(active));
  }
  const { rows } = await q.query(
    `SELECT * FROM partners WHERE ${conditions.join(' AND ')} ORDER BY partner_type, name`,
    params
  );
  return rows;
}

async function getStats(q = db) {
  try {
    const { rows } = await q.query('SELECT * FROM suppliers_stats');
    return rows;
  } catch (_) {
    return [];
  }
}

async function getPartner(id, q = db) {
  const { rows: [partner] } = await q.query('SELECT * FROM partners WHERE id = $1', [id]);
  if (!partner) return null;
  let stats = null;
  try {
    const { rows: [row] } = await q.query('SELECT * FROM suppliers_stats WHERE partner_id = $1', [id]);
    stats = row || null;
  } catch (_) {}
  return { partner, stats };
}

async function createPartner(body, q = db) {
  const { rows: [partner] } = await q.query(
    `INSERT INTO partners (
       name, partner_type,
       contact_name, contact_phone, contact_email, whatsapp_url, website_url,
       address, island, zone, country_code, country_label,
       currency, lead_time_days, payment_terms, commission_kmf,
       product_categories, pricing_notes, rating, notes, is_active
     ) VALUES (
       $1, $2,
       $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13, $14, $15, $16,
       $17, $18, $19, $20, $21
     ) RETURNING *`,
    [
      body.name, body.partner_type,
      body.contact_name || null, body.contact_phone || null, body.contact_email || null,
      body.whatsapp_url || null, body.website_url || null,
      body.address || null, body.island || null, body.zone || null,
      body.country_code || null, body.country_label || null,
      body.currency || null, body.lead_time_days || null, body.payment_terms || null,
      body.commission_kmf || 0,
      body.product_categories || null, body.pricing_notes || null,
      body.rating || null, body.notes || null,
      body.is_active !== false,
    ]
  );
  return partner;
}

async function updatePartner(id, body, q = db) {
  const fields = [
    'name', 'partner_type',
    'contact_name', 'contact_phone', 'contact_email', 'whatsapp_url', 'website_url',
    'address', 'island', 'zone', 'country_code', 'country_label',
    'currency', 'lead_time_days', 'payment_terms', 'commission_kmf',
    'product_categories', 'pricing_notes', 'rating', 'notes', 'is_active',
  ];
  const updates = [];
  const values = [];
  let pi = 1;
  for (const field of fields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${pi++}`);
      values.push(body[field]);
    }
  }
  if (!updates.length) throw new PartnerAdminError(400, 'Aucun champ à mettre à jour', 'partner_no_changes');
  values.push(id);
  const { rows: [partner] } = await q.query(
    `UPDATE partners SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${pi} RETURNING *`,
    values
  );
  if (!partner) throw new PartnerAdminError(404, 'Partenaire introuvable', 'partner_not_found');
  return partner;
}

async function deletePartner(id, q = db) {
  let linkedShipments = 0;
  let linkedOrders = 0;
  try {
    const { rows: [row] } = await q.query('SELECT COUNT(*)::int AS c FROM customs_shipments WHERE supplier_id = $1', [id]);
    linkedShipments = row.c;
  } catch (_) {}
  try {
    const { rows: [row] } = await q.query('SELECT COUNT(*)::int AS c FROM orders WHERE supplier_id = $1', [id]);
    linkedOrders = row.c;
  } catch (_) {}

  const { rowCount } = await q.query('DELETE FROM partners WHERE id = $1', [id]);
  if (!rowCount) throw new PartnerAdminError(404, 'Partenaire introuvable', 'partner_not_found');
  return {
    deleted: true,
    id,
    links_unset: { shipments: linkedShipments, orders: linkedOrders },
    message: linkedShipments + linkedOrders > 0
      ? `Partenaire supprimé. ${linkedShipments} envois et ${linkedOrders} commandes ont été dissociés.`
      : 'Partenaire supprimé.',
  };
}

module.exports = {
  PartnerAdminError,
  listPartners,
  getStats,
  getPartner,
  createPartner,
  updatePartner,
  deletePartner,
};
