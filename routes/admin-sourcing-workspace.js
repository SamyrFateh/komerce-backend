/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-api
 * @domain        sourcing
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_session, sourcing_global_grant, business_references, action_payloads
 * @outputs       global_sourcing_projection, sourcing_action_results, source_autopilot_switch_results, source_registry_results
 * @depends       middleware/auth.js, middleware/require-sourcing-global-authority.js, services/import-runtime-runs.js, services/import-lot-registry.js, services/sourcing-workspace.js, services/sourcing-integrity-service.js, services/sourcing-catalog-change-observation.js
 * @used-by       bootstrap/api-routes.js, canonical sourcing workspace
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated_to_sourcing_workspace_service
 * @doctrine      global_sourcing_authority, no_client_market_dimension, no_browser_internal_ids, source_autopilot_is_explicit_operator_authority, dashboard_observes_server_truth
 * @impact-areas  sourcing, catalog, partners, admin-dashboard
 * @version       2026-09
 */

'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireSourcingGlobalAuthority } = require('../middleware/require-sourcing-global-authority');
const workspace = require('../services/sourcing-workspace');
const sourcingHealth = require('../services/sourcing-integrity-service');
const catalogChangeObservation = require('../services/sourcing-catalog-change-observation');
const providerPolicy = require('../services/sourcing-provider-control-policy');
const importRuns = require('../services/import-runtime-runs');
const importLotRegistry = require('../services/import-lot-registry');

const router = express.Router();
const guard = [authenticate, requireRole(['admin', 'sourcing']), requireSourcingGlobalAuthority];
const MARKET_FIELDS = ['market_id', 'marketId', 'market_code', 'marketCode'];
const INTERNAL_ID_FIELDS = ['id', 'candidate_id', 'product_id', 'partner_id', 'import_id'];

function hasOwnAny(obj, names) {
  return Boolean(obj) && names.some(name => Object.prototype.hasOwnProperty.call(obj, name));
}

function rejectForbiddenDimensions(req, res, next) {
  if (hasOwnAny(req.query, MARKET_FIELDS) || hasOwnAny(req.body, MARKET_FIELDS)) {
    return res.status(400).json({
      error: 'Le Sourcing Canonical est global et ne reçoit aucune dimension marché client.',
      code: 'sourcing_market_dimension_forbidden',
    });
  }
  if (hasOwnAny(req.query, INTERNAL_ID_FIELDS) || hasOwnAny(req.body, INTERNAL_ID_FIELDS)) {
    return res.status(400).json({
      error: 'Les identifiants internes ne sont pas acceptés par le Sourcing Canonical.',
      code: 'sourcing_internal_id_forbidden',
    });
  }
  return next();
}

router.use(...guard, rejectForbiddenDimensions);

function sendAction(res, action, result, status = 200) {
  res.status(status).json({ ok: true, action, result });
}

function handleError(err, res, next) {
  if (err?.status) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  return next(err);
}

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const [payload, health] = await Promise.all([
      workspace.buildWorkspace(),
      sourcingHealth.buildHealthDashboard(),
    ]);
    res.json({ ...payload, health });
  } catch (err) { handleError(err, res, next); }
});

const RUN_REF_RE = /^KIR-\d{6,}$/;

function runNotFound(res) {
  return res.status(404).json({
    error: 'Run d’import introuvable',
    code: 'import_run_not_found',
  });
}

router.get('/import-runs', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ runs: await importRuns.listRuns({ limit: req.query.limit }) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/import-passages', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await importRuns.listPassages({ limit: req.query.limit, offset: req.query.offset }));
  } catch (err) { handleError(err, res, next); }
});

router.get('/import-cockpit', async (req, res, next) => {
  try {
    const requestedRun = req.query.run ? String(req.query.run) : null;
    if (requestedRun && !RUN_REF_RE.test(requestedRun)) return runNotFound(res);

    const [lots, sourceControls, sourceRequests] = await Promise.all([
      importLotRegistry.listLots({ limit: req.query.limit || 12 }),
      workspace.listSourceControls(),
      workspace.listSourceRequests(),
    ]);
    const selectedRef = requestedRun || lots[0]?.run_ref || null;
    let selectedLot = selectedRef ? lots.find(lot => lot.run_ref === selectedRef) : null;
    if (selectedRef && !selectedLot) selectedLot = await importLotRegistry.getLot(selectedRef);
    if (selectedRef && !selectedLot) return runNotFound(res);

    const [selected, runNav] = selectedRef
      ? await Promise.all([
          importRuns.getRun(selectedRef),
          importRuns.getRunNeighbors(selectedRef),
        ])
      : [null, { older_ref: null, newer_ref: null }];
    if (selectedRef && !selected) return runNotFound(res);

    const visibleLots = selectedLot && !lots.some(lot => lot.run_ref === selectedLot.run_ref)
      ? [selectedLot, ...lots]
      : lots;

    res.set('Cache-Control', 'no-store');
    res.json({
      source_controls: sourceControls,
      source_requests: sourceRequests,
      lots: visibleLots,
      run_nav: runNav,
      selected: selected ? { ...selected, business: selectedLot } : null,
    });
  } catch (err) { handleError(err, res, next); }
});

router.get('/import-runs/:runRef', async (req, res, next) => {
  try {
    if (!RUN_REF_RE.test(req.params.runRef)) return runNotFound(res);
    const run = await importRuns.getRun(req.params.runRef);
    if (!run) return runNotFound(res);
    res.set('Cache-Control', 'no-store');
    res.json(run);
  } catch (err) { handleError(err, res, next); }
});

router.get('/import-runs/:runRef/population', async (req, res, next) => {
  try {
    if (!RUN_REF_RE.test(req.params.runRef)) return runNotFound(res);
    const kind = String(req.query.kind || '');
    if (!importRuns.POPULATION_KINDS.includes(kind)) {
      return res.status(400).json({ error: 'Population inconnue', code: 'import_population_kind_invalid' });
    }
    const population = await importRuns.getPopulation(req.params.runRef, kind);
    if (!population) return runNotFound(res);
    res.set('Cache-Control', 'no-store');
    res.json(population);
  } catch (err) { handleError(err, res, next); }
});

router.get('/import-runs/:runRef/items/:supplierProductId', async (req, res, next) => {
  try {
    if (!RUN_REF_RE.test(req.params.runRef)) return runNotFound(res);
    const trace = await importRuns.getProductTrace(
      req.params.runRef,
      req.params.supplierProductId
    );
    if (!trace) {
      return res.status(404).json({
        error: 'Produit introuvable dans ce run',
        code: 'import_run_item_not_found',
      });
    }
    res.set('Cache-Control', 'no-store');
    res.json(trace);
  } catch (err) { handleError(err, res, next); }
});

router.post('/import-runs/replay', async (req, res, next) => {
  try {
    sendAction(res, 'replay_import', await workspace.replayImport(req.body, req.user));
  } catch (err) { handleError(err, res, next); }
});

router.post('/imports', async (req, res, next) => {
  try { sendAction(res, 'import_catalog', await workspace.importCatalog(req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

// Operator-only first intake seam: persists one exact stock observation for an
// already registered API source, never applies it to Catalog or Purchasing.
router.post('/sources/:sourceRef/catalog-changes/observe', async (req, res, next) => {
  try {
    const result = await catalogChangeObservation.recordUnitStockChange({
      sourceRef: req.params.sourceRef, envelope: req.body,
    });
    res.set('Cache-Control', 'no-store');
    sendAction(res, 'observe_unit_stock_change', result,
      result.status === 'recorded' ? 201 : 200);
  } catch (err) { handleError(err, res, next); }
});

// Registre opérateur des sources : catalogue canonique, création fail-closed, demande de
// connecteur, test de connexion. Aucune de ces routes n'active, ne certifie ni n'importe.
router.get('/sources/catalog', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await workspace.getSourceCatalog());
  } catch (err) { handleError(err, res, next); }
});

router.post('/sources', async (req, res, next) => {
  try { sendAction(res, 'create_source', await workspace.createSource(req.body, req.user), 201); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/requests', async (req, res, next) => {
  try { sendAction(res, 'request_source_connector', await workspace.createSourceRequest(req.body, req.user), 201); }
  catch (err) { handleError(err, res, next); }
});

router.patch('/sources/requests/:requestRef', async (req, res, next) => {
  try { sendAction(res, 'update_source_request', await workspace.updateSourceRequest(req.params.requestRef, req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/sources/requests/:requestRef', async (req, res, next) => {
  try { sendAction(res, 'delete_source_request', await workspace.deleteSourceRequest(req.params.requestRef)); }
  catch (err) { handleError(err, res, next); }
});

router.patch('/sources/:sourceRef', async (req, res, next) => {
  try { sendAction(res, 'update_source', await workspace.updateSource(req.params.sourceRef, req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/archive', async (req, res, next) => {
  try { sendAction(res, 'archive_source', await workspace.archiveSource(req.params.sourceRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/restore', async (req, res, next) => {
  try { sendAction(res, 'restore_source', await workspace.restoreSource(req.params.sourceRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/test-connection', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    sendAction(res, 'test_source_connection', await workspace.testSourceConnection(req.params.sourceRef));
  } catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/prepare', async (req, res, next) => {
  try { sendAction(res, 'prepare_source', await workspace.prepareSourceForCertification(req.params.sourceRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/capabilities/:capability', async (req,res,next)=>{
  try {
    sendAction(res,'set_provider_capability',await providerPolicy.setCapability(req.params.sourceRef,req.params.capability,req.body?.enabled,req.user,req.body?.reason));
  } catch(err){handleError(err,res,next);}
});

router.post('/sources/:sourceRef/import-now', async (req, res, next) => {
  try { sendAction(res, 'import_source_now', await workspace.runSourceImportNow(req.params.sourceRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/activate', async (req, res, next) => {
  try { sendAction(res, 'activate_source_autopilot', await workspace.activateSourceAutopilot(req.params.sourceRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/sources/:sourceRef/deactivate', async (req, res, next) => {
  try { sendAction(res, 'deactivate_source_autopilot', await workspace.setSourceAutopilot(req.params.sourceRef, false)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/products/:productRef/update', async (req, res, next) => {
  try { sendAction(res, 'update_sourcing_product', await workspace.updatePortfolioProduct(req.params.productRef, req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/update', async (req, res, next) => {
  try { sendAction(res, 'update_candidate', await workspace.updateCandidate(req.params.candidateRef, req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/scan', async (req, res, next) => {
  try { sendAction(res, 'scan_candidate', await workspace.scanCandidate(req.params.candidateRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/promote', async (req, res, next) => {
  try { sendAction(res, 'promote_candidate', await workspace.promoteCandidate(req.params.candidateRef, req.body, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/watchlist', async (req, res, next) => {
  try { sendAction(res, 'watchlist_candidate', await workspace.watchlistCandidate(req.params.candidateRef, req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/candidates/:candidateRef/reject', async (req, res, next) => {
  try { sendAction(res, 'reject_candidate', await workspace.rejectCandidate(req.params.candidateRef, req.body?.reason || '', req.user)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers', async (req, res, next) => {
  try { sendAction(res, 'create_sourcing_supplier', await workspace.createSupplier(req.body), 201); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers/:partnerRef/update', async (req, res, next) => {
  try { sendAction(res, 'update_sourcing_supplier', await workspace.updateSupplier(req.params.partnerRef, req.body)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers/:partnerRef/deactivate', async (req, res, next) => {
  try { sendAction(res, 'deactivate_sourcing_supplier', await workspace.setSupplierActive(req.params.partnerRef, false)); }
  catch (err) { handleError(err, res, next); }
});

router.post('/suppliers/:partnerRef/activate', async (req, res, next) => {
  try { sendAction(res, 'activate_sourcing_supplier', await workspace.setSupplierActive(req.params.partnerRef, true)); }
  catch (err) { handleError(err, res, next); }
});

module.exports = router;
