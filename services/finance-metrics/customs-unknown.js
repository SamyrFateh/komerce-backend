/**
 * @komerce-arch
 * @role          economic-engine-customs-unknown-predicate
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       none
 * @used-by       services/finance-metrics/finance-summary.js, services/cost-allocation/real-margin-shadow.js
 * @db-read       customs_shipment_parcels, customs_shipments, order_items, parcel_items, parcels
 * @db-write      none
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-10
 */
'use strict';

// Douane inconnue : expédition douane active encore pending ou sans montant payé
// (même prédicat que recomputeCustomsCosts / #2554). cost_douane_kmf étant
// NOT NULL DEFAULT 0, il n'exprime pas l'inconnu : ces commandes sont exclues
// des coûts/marges et comptées à part (nb_douane_inconnue).
// Fragment SQL pur (aucun accès DB ici) extrait tel quel de finance-summary.js.
const customsUnknownSql = (alias) => `EXISTS (
        SELECT 1 FROM parcels p
          JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
          JOIN customs_shipments cs ON cs.id = csp.shipment_id
         WHERE p.order_id = ${alias}.id AND cs.is_active
           AND (cs.status = 'pending' OR cs.customs_paid_kmf IS NULL))`;

// Ligne importée (fulfillment_source ≠ LOCAL_STOCK) : douane attendue.
const customsExpectedSql = (alias) => `EXISTS (
        SELECT 1 FROM order_items oi
         WHERE oi.order_id = ${alias}.id
           AND oi.fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK')`;

// Douane inconnue au niveau ligne (marge) : prédicat expédition ci-dessus, OU une
// ligne importée dont aucun colis n'est encore dans une expédition active déclarée
// avec montant connu (pas encore groupée = douane INCONNUE, jamais 0).
const customsUnknownForLinesSql = (alias) => `(${customsUnknownSql(alias)} OR EXISTS (
        SELECT 1 FROM order_items oi
         WHERE oi.order_id = ${alias}.id
           AND oi.fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK'
           AND NOT EXISTS (
             SELECT 1 FROM parcel_items pi
               JOIN customs_shipment_parcels csp ON csp.parcel_id = pi.parcel_id
               JOIN customs_shipments cs ON cs.id = csp.shipment_id
              WHERE pi.order_item_id = oi.id AND cs.is_active
                AND cs.status <> 'pending' AND cs.customs_paid_kmf IS NOT NULL)))`;

module.exports = { customsUnknownSql, customsExpectedSql, customsUnknownForLinesSql };
