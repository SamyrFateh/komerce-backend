/**
 * @komerce-arch
 * @role          economic-engine-dashboard-finance-metrics
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       services/finance-metrics/index.js
 * @used-by       routes/dashboard-finance.js
 * @db-read       finance_config, order_items, orders, parcel_items, parcels, products, recipients, refunds, relais, store_credits, users
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */
'use strict';
/**
 * services/dashboard-finance-metrics.js — barrel (Lot B7 — 2026-06-28)
 *
 * Le monolithe original (1064L) a été découpé en services/finance-metrics/.
 * Ce fichier redirige tous les appelants existants sans changement d'interface.
 *
 * @see services/finance-metrics/finance-summary.js    getFinanceSummary
 * @see services/finance-metrics/annulations.js        getAnnulationsParcels
 * @see services/finance-metrics/payments.js           getPaymentsDetail
 * @see services/finance-metrics/sales-analysis.js     getSalesAnalysis
 */
module.exports = require('./finance-metrics/index');
