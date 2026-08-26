/**
 * @komerce-arch
 * @role          economic-engine-admin-cost-components
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       middleware/auth.js, services/cost-component-admin-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      thin_facade, single_cost_component_mutation_authority
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const service = require('../services/cost-component-admin-service');

function requireAdminOrFounder(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

function handleError(error, res, next) {
  if (error && error.status) return res.status(error.status).json({ error: error.message });
  return next(error);
}

router.get('/_meta', authenticate, requireAdminOrFounder, (req, res) => {
  res.json(service.META);
});

router.get('/', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    res.json(await service.listComponents(req.query || {}));
  } catch (error) { handleError(error, res, next); }
});

router.get('/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    res.json(await service.getComponent({ id: req.params.id }));
  } catch (error) { handleError(error, res, next); }
});

router.post('/', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const component = await service.createComponent(req.body || {}, req.user?.id || null);
    res.json({ component });
  } catch (error) { handleError(error, res, next); }
});

router.put('/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const component = await service.updateComponent({ id: req.params.id }, req.body || {}, req.user?.id || null);
    res.json({ component });
  } catch (error) { handleError(error, res, next); }
});

router.post('/:id/toggle', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const component = await service.toggleComponent({ id: req.params.id }, req.user?.id || null);
    res.json({ component });
  } catch (error) { handleError(error, res, next); }
});

router.delete('/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const result = req.query.hard === 'true'
      ? await service.hardDeleteComponent({ id: req.params.id }, req.user?.id || null)
      : await service.deactivateComponent({ id: req.params.id }, req.user?.id || null);
    res.json(result);
  } catch (error) { handleError(error, res, next); }
});

module.exports = router;
