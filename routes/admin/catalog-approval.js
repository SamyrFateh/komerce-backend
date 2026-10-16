/**
 * @komerce-arch
 * @role          catalog-approval-routes
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        http_request
 * @outputs       http_response
 * @depends       middleware/auth.js, services/catalog-approval.js
 * @used-by       routes/admin/index.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §6
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-07
 */

'use strict';

/**
 * routes/admin/catalog-approval.js — K-4
 *
 * File d'approbation étage ⑥ (DOCTRINE_CATALOGUE.md §6) : un écran,
 * trois issues. Auth + rôle admin sur tout le groupe (mêmes gardes que le
 * reste de routes/admin/*.js).
 *
 *   GET    /api/admin/catalog/approval-queue          → liste (paginée)
 *   POST   /api/admin/catalog/approval-queue/:id/approve
 *   POST   /api/admin/catalog/approval-queue/:id/reject   { reason }
 *   POST   /api/admin/catalog/approval-queue/:id/override { fields, reason }
 */

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const catalogApproval = require('../../services/catalog-approval');
const db = require('../../db');
const { certifyCatalogProductWithVisualEvidence } = require('../../services/catalog-refinery-combined-proof');
const { recordVisualFrReview } = require('../../services/catalog-visual-fr-human-review-write');

const guard = [authenticate, requireRole(['admin'])];

router.get('/catalog/approval-queue', ...guard, async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const result = await catalogApproval.getApprovalQueue(undefined, { limit, offset });
    res.json(result);
  } catch (err) { next(err); }
});

// Read-only evidence for the refinery review UI; never publishes a candidate.
router.get('/catalog/approval-queue/:id/visual-fr-proof', ...guard, async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ code: 'INVALID_PRODUCT_ID' });
    }
    const verdict = await certifyCatalogProductWithVisualEvidence(db, req.params.id);
    if (!verdict) return res.status(404).json({ code: 'PRODUCT_NOT_FOUND' });
    return res.json(verdict);
  } catch (err) { next(err); }
});

// Separate explicit human review action; never changes product publication state.
router.post('/catalog/approval-queue/:id/media/:mediaId/visual-fr-review', ...guard, async (req, res, next) => {
  try {
    const result = await recordVisualFrReview(db, {
      productId: req.params.id,
      mediaId: req.params.mediaId,
      review: req.body,
      reviewerId: String(req.user?.id || ''),
    });
    return res.status(result.status).json(result);
  } catch (err) { next(err); }
});

router.post('/catalog/approval-queue/:id/approve', ...guard, async (req, res, next) => {
  try {
    const { status, body } = await catalogApproval.approveProduct(undefined, req.params.id, req.user);
    res.status(status).json(body);
  } catch (err) { next(err); }
});

router.post('/catalog/approval-queue/:id/reject', ...guard, async (req, res, next) => {
  try {
    const { status, body } = await catalogApproval.rejectProduct(
      undefined, req.params.id, { reason: req.body?.reason }, req.user
    );
    res.status(status).json(body);
  } catch (err) { next(err); }
});

router.post('/catalog/approval-queue/:id/override', ...guard, async (req, res, next) => {
  try {
    const { status, body } = await catalogApproval.overrideAndApprove(
      undefined, req.params.id, { fields: req.body?.fields, reason: req.body?.reason }, req.user
    );
    res.status(status).json(body);
  } catch (err) { next(err); }
});

module.exports = router;
