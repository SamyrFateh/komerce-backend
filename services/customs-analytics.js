/**
 * @komerce-arch
 * @role          customs-analytics
 * @domain        douane
 * @layer         service
 * @criticality   low
 * @inputs        shipment filters (date range, status, transitaire)
 * @outputs       écart déclaré/payé par expédition, tendances par période
 * @depends       db.js
 * @used-by       routes/admin-customs-shipments.js
 * @db-read       customs_shipment_parcels, customs_shipments, order_items, parcel_items, parcels
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      douane_declaration_pivot
 * @impact-areas  douane, economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/customs-analytics.js
 *
 * Lot C du keystone douane : dériver et exposer l'écart entre le droit
 * que Komerce attendait (classification figée × valeur) et ce que l'agent
 * a réellement appliqué (customs_paid_kmf global).
 *
 * Doctrine DOUANE_DECLARATION_PIVOT — §4 : "Côté mesure"
 *   On enregistre le réel (appliqué) et on dérive l'attendu (déclaré).
 *   L'écart, expédition après expédition, est la seule connaissance exploitable :
 *   distribution des taux, variance par agent/période, signal d'alerte marge.
 *
 * Lecture seule — aucun effet de bord.
 * Disponible uniquement sur les expéditions en statut 'declared' ou 'confirmed'
 * (le montant réel est connu).
 *
 * Items sans classification figée (order_items.douane_pct IS NULL) :
 *   → exclus du calcul attendu, comptés dans 'unclassified_items'
 *   → signalent les commandes créées avant migration 091
 *
 * Exports :
 *   getShipmentAnalytics(db, shipmentId)
 *     → écart pour une expédition spécifique
 *
 *   listShipmentsAnalytics(db, { from, to, status, transitaire })
 *     → liste d'expéditions avec leur écart, triée par date
 *
 *   getTrendAnalytics(db, { months })
 *     → agrégats mensuels : taux effectif moyen, variance moyenne, confiance
 */

const db = require('../db');

// ─── Requête de base : droit attendu par expédition ──────────────────────────
//
// Droit attendu par ligne = price_kmf * quantity * douane_pct / 100
//   (douane_pct est figé sur order_items depuis migration 091 — Lot A)
// Droit attendu par expédition = SUM sur tous les items de tous les colis
//
// NOTE : items sans douane_pct (pré-091, classification inconnue) sont exclus
// du calcul mais comptés séparément pour mesurer la confiance du calcul.

const BASE_ANALYTICS_QUERY = `
  SELECT
    cs.id                                             AS shipment_id,
    cs.reference,
    cs.shipment_date,
    cs.transitaire_name,
    cs.transport_mode,
    cs.status,
    cs.declared_at,

    -- Réel payé (décision de l'agent)
    COALESCE(cs.customs_paid_kmf, 0)                  AS actual_customs_kmf,
    cs.effective_rate_pct                              AS actual_rate_pct,

    -- CIF déclaré (valeur sur laquelle l'agent a travaillé)
    COALESCE(cs.cif_value_kmf, 0)                     AS declared_cif_kmf,

    -- Droit attendu d'après la classification figée (Lot A)
    -- NULL si aucun item classifié (expéditions pré-091)
    SUM(
      CASE WHEN oi.douane_pct IS NOT NULL
        THEN (oi.price_kmf * pi.quantity * oi.douane_pct / 100.0)
        ELSE NULL
      END
    )                                                  AS expected_customs_kmf,

    -- Taux déclaré moyen pondéré par valeur
    ROUND(
      SUM(
        CASE WHEN oi.douane_pct IS NOT NULL
          THEN oi.price_kmf * pi.quantity * oi.douane_pct
          ELSE NULL
        END
      ) / NULLIF(
        SUM(
          CASE WHEN oi.douane_pct IS NOT NULL
            THEN oi.price_kmf * pi.quantity
            ELSE NULL
          END
        ), 0
      ), 2
    )                                                  AS declared_avg_rate_pct,

    -- Couverture : valeur classifiée vs valeur totale
    SUM(
      CASE WHEN oi.douane_pct IS NOT NULL
        THEN oi.price_kmf * pi.quantity
        ELSE 0
      END
    )                                                  AS classified_cif_kmf,

    SUM(oi.price_kmf * pi.quantity)                   AS total_items_cif_kmf,

    -- Nombre de lignes item
    COUNT(*)                                           AS total_items,
    COUNT(*) FILTER (WHERE oi.douane_pct IS NULL)      AS unclassified_items,
    COUNT(*) FILTER (WHERE oi.classification_defaulted = TRUE) AS defaulted_items,

    -- Nombre de colis
    COUNT(DISTINCT csp.parcel_id)                      AS parcel_count

  FROM customs_shipments cs
  JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
  JOIN parcel_items pi              ON pi.parcel_id     = csp.parcel_id
  JOIN order_items  oi              ON oi.id            = pi.order_item_id
  WHERE cs.status IN ('declared', 'confirmed')
    AND cs.is_active = TRUE
`;

/**
 * Calcule l'écart entre droit attendu et réel pour une expédition donnée.
 *
 * @param {import('pg').Pool} pool
 * @param {string} shipmentId
 * @returns {Promise<object|null>}
 */
async function getShipmentAnalytics(pool, shipmentId) {
  const { rows: [row] } = await pool.query(
    `${BASE_ANALYTICS_QUERY} AND cs.id = $1 GROUP BY cs.id`,
    [shipmentId]
  );

  if (!row) return null;
  return _enrichRow(row);
}

/**
 * Liste les expéditions déclarées avec leur écart, filtrées par période/transitaire.
 *
 * @param {import('pg').Pool} pool
 * @param {{ from?: string, to?: string, transitaire?: string }} opts
 * @returns {Promise<object[]>}
 */
async function listShipmentsAnalytics(pool, { from, to, transitaire } = {}) {
  const conds  = [];
  const params = [];
  let   pi     = 1;

  if (from) { conds.push(`cs.shipment_date >= $${pi++}`); params.push(from); }
  if (to)   { conds.push(`cs.shipment_date <= $${pi++}`); params.push(to); }
  if (transitaire) {
    conds.push(`cs.transitaire_name ILIKE $${pi++}`);
    params.push(`%${transitaire}%`);
  }

  const where = conds.length ? ` AND ${conds.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `${BASE_ANALYTICS_QUERY}${where} GROUP BY cs.id ORDER BY cs.shipment_date DESC`,
    params
  );

  return rows.map(_enrichRow);
}

/**
 * Agrégats mensuels : variance moyenne, taux effectif moyen, confiance.
 * Utile pour calibrer le tampon douane dans le pricing.
 *
 * @param {import('pg').Pool} pool
 * @param {{ months?: number }} opts  — par défaut 12 derniers mois
 * @returns {Promise<object[]>}
 */
async function getTrendAnalytics(pool, { months = 12 } = {}) {
  const { rows } = await pool.query(`
    WITH base AS (
      ${BASE_ANALYTICS_QUERY}
        AND cs.shipment_date >= NOW() - ($1 || ' months')::interval
      GROUP BY cs.id
    )
    SELECT
      TO_CHAR(shipment_date, 'YYYY-MM')            AS month,
      COUNT(*)                                      AS shipments,
      ROUND(AVG(actual_rate_pct), 2)                AS avg_actual_rate_pct,
      ROUND(AVG(declared_avg_rate_pct), 2)          AS avg_declared_rate_pct,
      ROUND(AVG(
        actual_customs_kmf - COALESCE(expected_customs_kmf, 0)
      ), 0)                                         AS avg_ecart_kmf,
      ROUND(AVG(
        CASE WHEN COALESCE(expected_customs_kmf, 0) > 0
          THEN ((actual_customs_kmf - expected_customs_kmf)
                / expected_customs_kmf * 100)
          ELSE NULL
        END
      ), 1)                                         AS avg_ecart_pct,
      -- Confiance : % des items classifiés (pré-091 = 0%)
      ROUND(AVG(
        CASE WHEN total_items > 0
          THEN (total_items - unclassified_items)::numeric / total_items * 100
          ELSE 0
        END
      ), 1)                                         AS avg_classification_coverage_pct
    FROM base
    GROUP BY month
    ORDER BY month DESC
  `, [months]);

  return rows;
}

// ─── Enrichissement d'une ligne brute ────────────────────────────────────────

function _enrichRow(row) {
  const actual   = Number(row.actual_customs_kmf)  || 0;
  const expected = row.expected_customs_kmf != null ? Number(row.expected_customs_kmf) : null;
  const total    = Number(row.total_items)          || 0;
  const unclass  = Number(row.unclassified_items)   || 0;

  // Écart : positif = agent a taxé plus que prévu, négatif = moins
  const ecart_kmf = expected != null ? actual - expected : null;
  const ecart_pct = expected != null && expected > 0
    ? Math.round((ecart_kmf / expected) * 10000) / 100
    : null;

  // Confiance du calcul : 0% si aucun item classifié, 100% si tous classifiés
  const coverage_pct = total > 0
    ? Math.round(((total - unclass) / total) * 1000) / 10
    : 0;

  return {
    shipment_id:           row.shipment_id,
    reference:             row.reference,
    shipment_date:         row.shipment_date,
    transitaire_name:      row.transitaire_name,
    transport_mode:        row.transport_mode,
    status:                row.status,
    declared_at:           row.declared_at,
    parcel_count:          Number(row.parcel_count),

    // Réel
    actual_customs_kmf:    actual,
    actual_rate_pct:       Number(row.actual_rate_pct) || 0,
    declared_cif_kmf:      Number(row.declared_cif_kmf) || 0,

    // Attendu (null si aucun item classifié)
    expected_customs_kmf:  expected,
    declared_avg_rate_pct: row.declared_avg_rate_pct != null
      ? Number(row.declared_avg_rate_pct) : null,

    // Écart
    ecart_kmf,
    ecart_pct,
    ecart_direction: ecart_kmf == null ? 'unknown'
      : ecart_kmf > 0 ? 'agent_above_declared'   // agent a taxé plus
      : ecart_kmf < 0 ? 'agent_below_declared'   // agent a taxé moins
      : 'on_target',

    // Couverture classification
    coverage: {
      pct:              coverage_pct,
      total_items:      total,
      unclassified:     unclass,
      defaulted:        Number(row.defaulted_items) || 0,
      classified_cif_kmf: Number(row.classified_cif_kmf) || 0,
      total_cif_kmf:    Number(row.total_items_cif_kmf) || 0,
    },

    // Interprétation lisible
    confidence: coverage_pct >= 90 ? 'high'
      : coverage_pct >= 50 ? 'medium'
      : 'low',
  };
}

module.exports = {
  getShipmentAnalytics,
  listShipmentsAnalytics,
  getTrendAnalytics,
};
