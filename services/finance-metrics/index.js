/**
 * @komerce-arch
 * @role          economic-engine-dashboard-finance-metrics
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       ./finance-summary, ./annulations, ./payments, ./sales-analysis
 * @used-by       routes/dashboard-finance.js
 * @db-read       finance_config, order_items, orders, parcel_items, parcels, products, recipients, refunds, relais, store_credits, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */
'use strict';
/**
 * services/finance-metrics/index.js — barrel (Lot B7 — 2026-06-28)
 * Découpage de services/dashboard-finance-metrics.js (1064L monolithe)
 */
const { getFinanceSummary }    = require('./finance-summary');
const { getAnnulationsParcels } = require('./annulations');
const { getPaymentsDetail }     = require('./payments');
const { getSalesAnalysis }      = require('./sales-analysis');

module.exports = { getFinanceSummary, getAnnulationsParcels, getPaymentsDetail, getSalesAnalysis };
