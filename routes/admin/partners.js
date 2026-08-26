/**
 * @komerce-arch
 * @role          dashboard-partners
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       middleware/auth.js, middleware/validate.js, validators, services/partner-admin-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated_to_partner_admin_service
 * @doctrine      legacy_http_contract_preserved, single_partner_mutation_authority
 * @impact-areas  dashboard, admin-dashboard, partners
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { admin } = require('../../validators');
const partnerAdmin = require('../../services/partner-admin-service');

const guard = [authenticate, requireRole(['admin'])];

function handlePartnerError(err, res, next) {
  if (err instanceof partnerAdmin.PartnerAdminError || err?.status) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  return next(err);
}

router.get('/partners', ...guard, async (req, res) => {
  try {
    const active = req.query.active === undefined
      ? undefined
      : (req.query.active === 'true' || req.query.active === '1');
    res.json(await partnerAdmin.listPartners({
      type: req.query.type,
      island: req.query.island,
      country: req.query.country,
      active,
    }));
  } catch (_) {
    res.json([]);
  }
});

router.get('/partners/stats', ...guard, async (req, res) => {
  try {
    res.json(await partnerAdmin.getStats());
  } catch (_) {
    res.json([]);
  }
});

router.get('/partners/:id', ...guard, async (req, res, next) => {
  try {
    const result = await partnerAdmin.getPartner(req.params.id);
    if (!result) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/partners', ...guard, validate(admin.createPartner), async (req, res, next) => {
  try {
    res.status(201).json(await partnerAdmin.createPartner(req.body));
  } catch (err) { handlePartnerError(err, res, next); }
});

router.put('/partners/:id', ...guard, validate(admin.updatePartner), async (req, res, next) => {
  try {
    res.json(await partnerAdmin.updatePartner(req.params.id, req.body));
  } catch (err) { handlePartnerError(err, res, next); }
});

router.delete('/partners/:id', ...guard, validate(admin.deletePartner), async (req, res, next) => {
  try {
    res.json(await partnerAdmin.deletePartner(req.params.id));
  } catch (err) { handlePartnerError(err, res, next); }
});

module.exports = router;
