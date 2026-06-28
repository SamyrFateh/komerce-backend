/**
 * @komerce-arch
 * @role          dashboard-metrics-workspaces
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers
 * @used-by       services/dashboard-metrics/index.js
 * @db-read       collective_payment_sessions, collective_workspace_contributions, collective_workspace_items, collective_workspaces, orders
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard, event-workspaces
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Metrics — Workspaces collectifs (8 KPIs) — Lot C3
 * ════════════════════════════════════════════════════════════════════════
 * Extrait de services/dashboard-metrics.js (1081L) — Lot B/C Refacto.
 * INV-5 : cmds_creees_workspace ⊂ cmds_creees (voir control-tower.js)
 */

'use strict';

const db = require('../../db');
const { buildFiltersClause, makeKpi } = require('./_helpers');

// ═══════════════════════════════════════════════════════════════════════
// WORKSPACES — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

async function getWorkspacesActifs(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM collective_workspaces
    WHERE status IN ('conception', 'payment_pending')
      ${filters.from ? 'AND created_at >= $1' : ''}
      ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('workspaces_actifs', 'Workspaces actifs', value, 'count', {
    drillTo: '/admin/event-workspaces?status=active',
  });
}


async function getSessionsOuvertes(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM collective_payment_sessions
    WHERE status = 'open'
      AND (expires_at IS NULL OR expires_at > NOW())
  `;
  const r = await db.query(sql);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('sessions_ouvertes', 'Sessions paiement ouvertes', value, 'count');
}


async function getTauxCompletion(filters = {}) {
  // Ratio orders crees / sessions lancees (sur periode)
  const sql = `
    SELECT
      (SELECT COUNT(*)::int FROM collective_workspaces
       WHERE order_id IS NOT NULL
         ${filters.from ? 'AND created_at >= $1' : ''}
         ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
      ) AS items_with_data,
      (SELECT COUNT(*)::int FROM collective_payment_sessions
       WHERE 1=1
         ${filters.from ? 'AND created_at >= $1' : ''}
         ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
      ) AS items_total
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  return makeKpi('taux_completion', 'Taux complétion', value, '%', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}


async function getMontantTotalEvenements(filters = {}) {
  const sql = `
    SELECT COALESCE(SUM(workspace_total_kmf), 0)::bigint AS value
    FROM (
      SELECT
        cw.id,
        COALESCE(SUM(COALESCE(cwi.price_snapshot_kmf, 0) * COALESCE(cwi.quantity, 1)), 0) AS workspace_total_kmf
      FROM collective_workspaces cw
      LEFT JOIN collective_workspace_items cwi ON cwi.workspace_id = cw.id
      WHERE cw.status IN ('conception', 'payment_pending', 'order_created', 'session_ended')
        ${filters.from ? 'AND cw.created_at >= $1' : ''}
        ${filters.to ? `AND cw.created_at <= $${filters.from ? 2 : 1}` : ''}
      GROUP BY cw.id
    ) totals
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('montant_total_evenements', 'Montant total événements', value, 'KMF');
}


async function getSessionsSansCommande(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM collective_payment_sessions cps
    JOIN collective_workspaces cw ON cw.id = cps.workspace_id
    WHERE cps.status = 'ended'
      AND cw.order_id IS NULL
      ${filters.from ? 'AND cps.ended_at >= $1' : ''}
      ${filters.to   ? `AND cps.ended_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('sessions_sans_commande', 'Sessions terminées sans commande', value, 'count', {
    warning: value > 0 ? 'Sessions a relancer eventuellement' : null,
  });
}


async function getCmdsCreeesWorkspace(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(DISTINCT o.id)::int AS value
    FROM orders o
    JOIN collective_workspaces cw ON cw.order_id = o.id
    WHERE ${where}
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('cmds_creees_workspace', 'Commandes créées (workspace)', value, 'count', {
    drillTo: '/admin/orders-logistics?origin=workspace',
  });
}


async function getPanierMoyEvenement(filters = {}) {
  const sql = `
    SELECT
      COALESCE(AVG(workspace_total_kmf), 0)::bigint AS value,
      COUNT(*)::int AS items_total
    FROM (
      SELECT
        cw.id,
        COALESCE(SUM(COALESCE(cwi.price_snapshot_kmf, 0) * COALESCE(cwi.quantity, 1)), 0) AS workspace_total_kmf
      FROM collective_workspaces cw
      LEFT JOIN collective_workspace_items cwi ON cwi.workspace_id = cw.id
      WHERE cw.status IN ('conception', 'payment_pending', 'order_created', 'session_ended')
        ${filters.from ? 'AND cw.created_at >= $1' : ''}
        ${filters.to ? `AND cw.created_at <= $${filters.from ? 2 : 1}` : ''}
      GROUP BY cw.id
    ) totals
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('panier_moy_evenement', 'Panier moyen événement', value, 'KMF', {
    itemsTotal,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}


async function getParticipantsMoy(filters = {}) {
  // Moyenne du nombre de participants uniques par workspace
  // Déduplication : email normalisé > téléphone normalisé > nom normalisé > id contribution
  const sql = `
    SELECT COALESCE(AVG(participant_count), 0)::numeric AS value,
           COUNT(*)::int AS items_total
    FROM (
      SELECT
        cw.id,
        COUNT(DISTINCT
          COALESCE(
            NULLIF(LOWER(TRIM(cwc.contributor_email)), ''),
            NULLIF(REGEXP_REPLACE(cwc.contributor_phone, '\\D', '', 'g'), ''),
            NULLIF(LOWER(TRIM(cwc.contributor_name)), ''),
            cwc.id::text
          )
        ) AS participant_count
      FROM collective_workspaces cw
      LEFT JOIN collective_workspace_contributions cwc ON cwc.workspace_id = cw.id
      WHERE cw.status IN ('conception', 'payment_pending', 'order_created', 'session_ended')
        ${filters.from ? 'AND cw.created_at >= $1' : ''}
        ${filters.to ? `AND cw.created_at <= $${filters.from ? 2 : 1}` : ''}
      GROUP BY cw.id
    ) sub
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  let r;
  try {
    r = await db.query(sql, params);
  } catch (err) {
    // collective_workspace_contributions ou colonnes introuvables
    return makeKpi('participants_moy', 'Participants moyens', null, 'count', {
      completeness: 'provisional',
      warning: 'Donnees indisponibles : ' + err.message,
    });
  }
  const value = Number(Number(r.rows[0].value).toFixed(2));
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('participants_moy', 'Participants moyens', value, 'count', {
    itemsTotal,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}

module.exports = {
  getWorkspacesActifs,
  getSessionsOuvertes,
  getTauxCompletion,
  getMontantTotalEvenements,
  getSessionsSansCommande,
  getCmdsCreeesWorkspace,
  getPanierMoyEvenement,
  getParticipantsMoy,
};
