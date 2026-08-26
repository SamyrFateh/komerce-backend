/**
 * @komerce-arch
 * @role          sourcing-candidate-scanner
 * @domain        sourcing
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/supplier-catalog-scanner.js, services/pricing-engine.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-import-dispatch.js, services/sourcing-candidate-actions.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       sourcing_candidate_events, sourcing_candidates, supplier_catalog_imports
 * @db-write      sourcing_candidates
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports
 * @db-txn        candidate_mutations_delegated_to_shared_authority
 * @doctrine      legacy_http_contract_preserved, single_sourcing_candidate_mutation_authority, DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  sourcing, catalog
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const scanner = require('../services/supplier-catalog-scanner');
const pricingEngine = require('../services/pricing-engine');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const importDispatch = require('../services/sourcing-import-dispatch');
const candidateActions = require('../services/sourcing-candidate-actions');
const { authenticate } = require('../middleware/auth');

function requireAdminOrFounder(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

function legacyCandidateError(err, res, next) {
  if (!err?.status) return next(err);
  const body = { error: err.message };
  if (err.code === 'candidate_quarantined') {
    body.error = "Candidat en quarantaine — non promouvable en l'état (cf. supplier_catalog_import_rejections / batch_findings).";
  }
  if (err.details && typeof err.details === 'object') Object.assign(body, err.details);
  return res.status(err.status).json(body);
}

router.get('/connectors', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try { res.json(importDispatch.connectorCatalog()); }
  catch (err) { next(err); }
});

router.post('/catalogs/import', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const result = await catalogImportOrchestrator.importCatalog(
      req.body,
      req.user?.id,
      importDispatch.dispatchToConnector
    );
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.get('/catalogs', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const r = await db.query(
      `SELECT i.*,
              (SELECT COUNT(*) FROM sourcing_candidates sc WHERE sc.import_id = i.id) AS items_count,
              (SELECT COUNT(*) FROM sourcing_candidates sc WHERE sc.import_id = i.id AND sc.state = 'imported_to_catalog') AS imported_count
         FROM supplier_catalog_imports i
        ORDER BY i.imported_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ imports: r.rows });
  } catch (err) { next(err); }
});

router.get('/candidates', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const conditions = [];
    const params = [];
    let pi = 1;

    if (req.query.state === 'all') {
      // no state filter
    } else if (req.query.state) {
      conditions.push(`state = $${pi++}`);
      params.push(req.query.state);
    } else {
      conditions.push(`state NOT IN ('rejected', 'archived')`);
    }
    if (req.query.supplier) {
      conditions.push(`supplier_name ILIKE $${pi++}`);
      params.push('%' + req.query.supplier + '%');
    }
    if (req.query.decision) {
      conditions.push(`scan_result->>'sourcing_decision' = $${pi++}`);
      params.push(req.query.decision);
    }
    if (req.query.import_id) {
      conditions.push(`import_id = $${pi++}`);
      params.push(req.query.import_id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit);
    const r = await db.query(
      `SELECT id, import_id, supplier_name, supplier_product_id,
              product_name, supplier_category, purchase_price, currency,
              image_url, product_url,
              komerce_category, estimated_weight_kg, estimated_volume_m3,
              purchase_price_kmf, target_margin_pct,
              data_sources, scan_result, scan_at, confidence,
              state, product_id, notes, rejected_reason,
              created_at, updated_at
         FROM sourcing_candidates
         ${where}
         ORDER BY
           CASE state
             WHEN 'scanned' THEN 1
             WHEN 'test_ready' THEN 2
             WHEN 'watchlist' THEN 3
             WHEN 'normalized' THEN 4
             WHEN 'raw_imported' THEN 5
             WHEN 'imported_to_catalog' THEN 6
             WHEN 'rejected' THEN 7
             WHEN 'archived' THEN 8
           END,
           updated_at DESC
         LIMIT $${pi}`,
      params
    );
    res.json({ candidates: r.rows, count: r.rows.length });
  } catch (err) { next(err); }
});

router.get('/candidates/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const r = await db.query('SELECT * FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });
    const eventsRes = await db.query(
      `SELECT id, event_type, old_state, new_state, changes, notes, created_at
         FROM sourcing_candidate_events
        WHERE candidate_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ candidate: r.rows[0], events: eventsRes.rows });
  } catch (err) { next(err); }
});

router.put('/candidates/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const candidate = await candidateActions.updateCandidate(req.params.id, req.body || {}, req.user?.id || null);
    res.json({ candidate });
  } catch (err) { legacyCandidateError(err, res, next); }
});

router.post('/candidates/:id/scan', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const candidate = await candidateActions.scanCandidate(req.params.id, req.user?.id || null);
    res.json({ candidate });
  } catch (err) { legacyCandidateError(err, res, next); }
});

// Legacy batch scan remains available during proof. Canonical V1 deliberately
// exposes only mono-candidate actions using candidate_ref business references.
router.post('/candidates/scan-batch', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const b = req.body || {};
    const conditions = [];
    const params = [];
    let pi = 1;
    if (b.import_id) {
      conditions.push(`import_id = $${pi++}`);
      params.push(b.import_id);
    } else if (Array.isArray(b.ids) && b.ids.length) {
      conditions.push(`id = ANY($${pi++}::uuid[])`);
      params.push(b.ids);
    } else {
      return res.status(400).json({ error: 'import_id ou ids requis' });
    }

    const rows = await db.query(
      `SELECT * FROM sourcing_candidates WHERE ${conditions.join(' AND ')} LIMIT 500`,
      params
    );
    const config = await pricingEngine.loadGlobalConfig();
    const results = { scanned: 0, errors: [] };
    for (const cand of rows.rows) {
      try {
        const scan = await scanner.scanCandidate(cand, { config });
        const merged = {
          ...scan.scan_result,
          sourcing_decision: scan.sourcing_decision,
          reason: scan.reason,
          recommended_action: scan.recommended_action,
        };
        await db.query(
          `UPDATE sourcing_candidates
              SET scan_result = $1, scan_at = NOW(), confidence = $2,
                  state = CASE WHEN state IN ('raw_imported','normalized') THEN 'scanned' ELSE state END
            WHERE id = $3`,
          [JSON.stringify(merged), scan.confidence, cand.id]
        );
        results.scanned++;
      } catch (errOne) {
        results.errors.push({ id: cand.id, error: errOne.message });
      }
    }
    res.json(results);
  } catch (err) { next(err); }
});

router.post('/candidates/:id/import-product', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    res.json(await candidateActions.promoteCandidate(
      req.params.id,
      req.body || {},
      req.user?.id || null
    ));
  } catch (err) { legacyCandidateError(err, res, next); }
});

router.post('/candidates/:id/reject', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    await candidateActions.rejectCandidate(
      req.params.id,
      (req.body?.reason || '').trim(),
      req.user?.id || null
    );
    res.json({ ok: true });
  } catch (err) { legacyCandidateError(err, res, next); }
});

router.post('/candidates/:id/watchlist', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    await candidateActions.watchlistCandidate(req.params.id, req.user?.id || null);
    res.json({ ok: true });
  } catch (err) { legacyCandidateError(err, res, next); }
});

module.exports = router;
