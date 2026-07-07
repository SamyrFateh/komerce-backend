/**
 * @komerce-arch
 * @role          dashboard-dashboard-clients
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * routes/dashboard-clients.js — Façade R9
 * Toute la logique est dans services/dashboard-clients-queries.js
 */

const express = require('express');
const router  = express.Router();
const log     = require('../utils/logger').child({ module: 'dashboard' });
const { cached, setCache } = require('./dashboard-shared');
const {
  getClientsAnalysis,
  getClientsList,
  getClientDetail,
  getHistory,
  getRelais,
} = require('../services/dashboard-clients-queries');

// GET /clients
router.get('/clients', async (req, res, next) => {
  try {
    const top          = Math.min(50, Math.max(1, parseInt(req.query.top) || 20));
    const debut        = req.query.debut || '2024-01-01';
    const fin          = req.query.fin   || new Date().toISOString().split('T')[0];
    const seuilVipKmf  = parseInt(req.query.vip_threshold || '200000');

    const cacheKey = `clients_v2_${debut}_${fin}_${top}_${seuilVipKmf}`;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    const result = await getClientsAnalysis({ top, debut, fin, seuilVipKmf });
    setCache(cacheKey, result);
    res.json(result);
  } catch(err) { next(err); }
});

// GET /clients/list
router.get('/clients/list', async (req, res, next) => {
  try {
    const page        = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize    = Math.min(100, Math.max(10, parseInt(req.query.page_size) || 25));
    const search      = (req.query.search || '').trim();
    const segment     = req.query.segment || 'all';
    const island      = req.query.island || null;
    const seuilVipKmf = parseInt(req.query.vip_threshold || '200000');

    res.json(await getClientsList({ page, pageSize, search, segment, island, seuilVipKmf }));
  } catch(err) { next(err); }
});

// GET /clients/detail
router.get('/clients/detail', async (req, res, next) => {
  try {
    const phone = (req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone parameter required' });

    const result = await getClientDetail(phone);
    if (!result) return res.status(404).json({ error: 'Client not found', phone });
    res.json(result);
  } catch(err) { next(err); }
});

// GET /history
router.get('/history', async (req, res, next) => {
  try {
    const nbMois = Math.min(24, Math.max(1, parseInt(req.query.mois) || 6));
    res.json(await getHistory(nbMois));
  } catch(err) { next(err); }
});

// GET /relais
router.get('/relais', async (req, res, next) => {
  try {
    const hit = cached('relais');
    if (hit) return res.json(hit);

    const result = await getRelais();
    setCache('relais', result);
    res.json(result);
  } catch(err) { next(err); }
});

module.exports = router;
