/**
 * @komerce-arch
 * @role          economic-engine-dashboard-finance
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * routes/dashboard-finance.js
 * Refactoré — lot GOD-FILES-3 (2026-05-25)
 *
 * Les handlers délèguent à services/dashboard-finance-metrics.js.
 * SQL extrait vers le service — zéro logique ici.
 *
 * GET /finance              → getFinanceSummary
 * GET /annulations-parcels  → getAnnulationsParcels
 * GET /payments             → getPaymentsDetail
 * GET /sales                → getSalesAnalysis
 */

const express  = require('express');
const router   = express.Router();
const dashboardFinanceMetrics = require('../services/dashboard-finance-metrics');

router.get('/finance', async (req, res, next) => {
  try {
    const data = await dashboardFinanceMetrics.getFinanceSummary(req.query);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/annulations-parcels', async (req, res, next) => {
  try {
    const data = await dashboardFinanceMetrics.getAnnulationsParcels(req.query);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/payments', async (req, res, next) => {
  try {
    const data = await dashboardFinanceMetrics.getPaymentsDetail(req.query);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/sales', async (req, res, next) => {
  try {
    const data = await dashboardFinanceMetrics.getSalesAnalysis(req.query);
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
