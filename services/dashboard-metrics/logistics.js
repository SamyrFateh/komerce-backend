/**
 * @komerce-arch
 * @role          dashboard-metrics-logistics
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers, ./control-tower (getColisEnTransit, INV-3)
 * @used-by       services/dashboard-metrics/index.js
 * @db-read       orders, parcels
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      server_market_scope_is_authority
 * @impact-areas  dashboard, admin-dashboard, orders-logistics
 * @version       2026-08
 */

/**
 * KOMERCE — Dashboard Metrics — Logistics (7 KPIs + 1 alias)
 */

'use strict';

const db = require('../../db');
const { buildFiltersClause, computeDelta, makeKpi } = require('./_helpers');
const { getColisEnTransit } = require('./control-tower');

async function getCmdsAujourdhui(filters = {}) {
  // Historiquement ce KPI ignore from/to/island/etc. car il signifie strictement
  // "aujourd'hui". LOT 2C lui ajoute uniquement le scope d'autorité marché.
  const scopeFilters = filters.market_id ? { market_id: filters.market_id } : {};
  const { where, params } = buildFiltersClause(scopeFilters);

  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.created_at >= CURRENT_DATE
      AND o.created_at < CURRENT_DATE + INTERVAL '1 day'
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  const ySql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.created_at >= CURRENT_DATE - INTERVAL '1 day'
      AND o.created_at < CURRENT_DATE
  `;
  const yR = await db.query(ySql, params);
  const delta = computeDelta(value, Number(yR.rows[0].value), 'hier');

  return makeKpi('cmds_aujourdhui', 'Commandes aujourd\'hui', value, 'count', { delta });
}

async function getPaiementsEnAttente(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'pending'
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('paiements_en_attente', 'Paiements en attente', value, 'count', {
    drillTo: '/admin/orders-logistics?payment_status=pending',
  });
}

async function getColisPreparation(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.status = 'preparation'
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('colis_preparation', 'Colis préparation', value, 'count');
}

async function getColisTransit(filters) { return getColisEnTransit(filters); }

async function getDisponiblesRelais(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.status = 'available'
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('disponibles_relais', 'Disponibles relais', value, 'count', {
    drillTo: '/admin/orders-logistics?parcel_status=available',
  });
}

async function getRetardsCritiques(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.shipped_at IS NOT NULL
      AND p.shipped_at < NOW() - INTERVAL '14 days'
      AND p.status NOT IN ('available', 'collected', 'cancelled')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('retards_critiques', 'Retards critiques', value, 'count', {
    warning: value > 0 ? `${value} colis en retard de plus de 14 jours` : null,
  });
}

async function getTauxCollecteRelais(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'collected')::int AS collected,
      COUNT(*) FILTER (WHERE p.status IN ('available', 'collected'))::int AS available_or_collected
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
  `;
  const r = await db.query(sql, params);
  const collected = Number(r.rows[0].collected) || 0;
  const total = Number(r.rows[0].available_or_collected) || 0;
  const value = total > 0 ? Number(((collected / total) * 100).toFixed(2)) : null;

  return makeKpi('taux_collecte_relais', 'Taux collecte relais', value, '%', {
    itemsTotal: total,
    itemsWithData: collected,
    completeness: total > 0 ? 'complete' : 'provisional',
  });
}

module.exports = {
  getCmdsAujourdhui,
  getPaiementsEnAttente,
  getColisPreparation,
  getColisTransit,
  getDisponiblesRelais,
  getRetardsCritiques,
  getTauxCollecteRelais,
};
