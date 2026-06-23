/**
 * @komerce-arch
 * @role          logistics-sourcing-scanner
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       sourcing_candidate_events, sourcing_candidates, supplier_catalog_imports
 * @db-write      products, sourcing_candidate_events, sourcing_candidates, supplier_catalog_imports
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Routes API Scanner Catalogue Fournisseur (LOT D)
 * ═══════════════════════════════════════════════════════════════
 *
 * Le routeur utilise un DISPATCHER de connecteurs.
 * Selon source_type, il appelle le bon connector pour produire
 * des NormalizedSupplierProduct[], puis passe la liste au scanner.
 *
 * Aucune logique fournisseur dans ce fichier.
 *
 * Pipeline complet :
 *   1. POST /catalogs/import     reçoit { source_type, supplier_name, ... }
 *   2. Dispatch vers le bon connector
 *   3. Connector → NormalizedSupplierProduct[]
 *   4. Scanner   → normalize + scan via pricing-engine
 *   5. Persist   → INSERT INTO sourcing_candidates
 *
 * Routes :
 *   POST   /catalogs/import
 *   GET    /catalogs
 *   GET    /candidates
 *   GET    /candidates/:id
 *   PUT    /candidates/:id
 *   POST   /candidates/:id/scan
 *   POST   /candidates/scan-batch
 *   POST   /candidates/:id/import-product
 *   POST   /candidates/:id/reject
 *   POST   /candidates/:id/watchlist
 *   GET    /connectors                    ← NOUVEAU : liste connecteurs disponibles
 */

'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const scanner = require('../services/supplier-catalog-scanner');
const pricingEngine = require('../services/pricing-engine');
const { authenticate } = require('../middleware/auth');

// ── Connecteurs ──
const csvConnector    = require('../services/suppliers/connectors/csv-connector');
const manualConnector = require('../services/suppliers/connectors/manual-connector');
const noonModule      = require('../services/suppliers/connectors/noon-connector');

// ── Registre des connecteurs ──
// Chaque entrée déclare comment dispatcher selon source_type (et supplier le cas échéant).
const CONNECTORS = {
  csv:    { module: csvConnector,    active: true,  label: 'CSV import' },
  manual: { module: manualConnector, active: true,  label: 'Saisie manuelle' },
  api: {
    // Connecteurs API par fournisseur. Tous inactifs par défaut.
    // Pour activer : implémenter le connecteur dans services/suppliers/connectors/
    // et passer active=true ici.
    noon: { active: noonModule.IS_ACTIVE, label: 'Noon API', reason: noonModule.INACTIVE_REASON },
  },
};

function requireAdminOrFounder(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Accès admin requis' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/sourcing/connectors
// Liste les connecteurs disponibles (pour l'UI : afficher quoi est actif)
// ═══════════════════════════════════════════════════════════════════════
router.get('/connectors', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    res.json({
      sources: [
        { type: 'csv', active: true, label: 'CSV import' },
        { type: 'manual', active: true, label: 'Saisie manuelle' },
      ],
      api_suppliers: Object.keys(CONNECTORS.api).map(s => ({
        supplier: s,
        active: CONNECTORS.api[s].active,
        label: CONNECTORS.api[s].label,
        reason: CONNECTORS.api[s].active ? null : CONNECTORS.api[s].reason,
      })),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// DISPATCHER : appelle le bon connector pour produire NormalizedSupplierProduct[]
// ═══════════════════════════════════════════════════════════════════════
async function dispatchToConnector(body) {
  const sourceType = body.source_type || 'manual';

  if (sourceType === 'csv') {
    return csvConnector.fetchProducts({
      supplier_name: body.supplier_name,
      csv_text: body.csv_text,
      csv_mapping: body.csv_mapping,
    });
  }

  if (sourceType === 'manual') {
    return manualConnector.fetchProducts({
      supplier_name: body.supplier_name,
      items: body.items,
    });
  }

  if (sourceType === 'api') {
    const supplier = (body.supplier_id || '').toLowerCase();
    const entry = CONNECTORS.api[supplier];
    if (!entry) {
      throw new Error(`API non configurée : supplier "${supplier}" inconnu. Sources connues : ${Object.keys(CONNECTORS.api).join(', ')}`);
    }
    if (!entry.active) {
      throw new Error(`API non configurée : ${entry.reason || 'connecteur inactif'}`);
    }
    // Si actif un jour : instancier le connecteur et appeler fetchProducts
    // const Connector = require('../services/suppliers/connectors/' + supplier + '-connector');
    // const inst = new Connector.NoonConnector(body.config || {});
    // return inst.fetchProducts(body.options || {});
    throw new Error(`API "${supplier}" déclarée mais non câblée. Voir api-connector.base.js.`);
  }

  throw new Error(`source_type inconnu : "${sourceType}". Valeurs supportées : csv, manual, api.`);
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/catalogs/import
// Body: { supplier_name, source_type: 'csv'|'manual'|'api', ... }
// ═══════════════════════════════════════════════════════════════════════
router.post('/catalogs/import', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const b = req.body || {};
    const supplierName = (b.supplier_name || '').trim();
    const sourceType = b.source_type || 'manual';

    if (!supplierName) return res.status(400).json({ error: 'supplier_name requis' });
    if (!['csv', 'manual', 'api'].includes(sourceType)) {
      return res.status(400).json({ error: 'source_type doit être csv, manual ou api' });
    }

    // 1. Dispatcher vers le connecteur → NormalizedSupplierProduct[]
    let connectorResult;
    try {
      connectorResult = await dispatchToConnector(b);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const products = connectorResult.products || [];
    const invalidFromConnector = connectorResult.invalid || [];

    if (!products.length) {
      return res.status(400).json({
        error: 'Aucun produit valide trouvé',
        invalid: invalidFromConnector,
      });
    }

    // 2. Charger config Komerce une seule fois
    const config = await pricingEngine.loadGlobalConfig();

    // 3. Créer l'import
    const importRes = await db.query(
      `INSERT INTO supplier_catalog_imports
         (supplier_name, source_type, source_filename, notes, total_items, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [supplierName, sourceType, b.source_filename || null, b.notes || null, products.length, req.user?.id || null]
    );
    const importId = importRes.rows[0].id;

    // 4. Pour chaque NormalizedSupplierProduct : normaliser Komerce + scanner + persister
    const results = { created: 0, errors: [...invalidFromConnector] };
    for (const product of products) {
      try {
        const normalized = await scanner.normalizeCandidate(product, { config });
        const scan = await scanner.scanCandidate(normalized, { config });

        // DSC-E1 — UPSERT idempotent sur (supplier_name, supplier_product_id)
        // Les états terminaux (imported_to_catalog, rejected) ne sont jamais régressés.
        const scanJson = JSON.stringify({ ...scan.scan_result, sourcing_decision: scan.sourcing_decision, reason: scan.reason, recommended_action: scan.recommended_action });
        const incomingDataSources = JSON.stringify(normalized.data_sources);

        const upsertRes = await db.query(
          `INSERT INTO sourcing_candidates (
             import_id, supplier_name, supplier_product_id,
             product_name, supplier_category, purchase_price, currency,
             image_url, product_url, description,
             stock_available, min_order_qty, supplier_delay_days,
             weight_kg, dim_l_cm, dim_w_cm, dim_h_cm,
             komerce_category, estimated_weight_kg, estimated_volume_m3,
             purchase_price_kmf, target_margin_pct,
             data_sources, scan_result, scan_at, confidence,
             state, updated_by
           ) VALUES (
             $1, $2, $3,
             $4, $5, $6, $7,
             $8, $9, $10,
             $11, $12, $13,
             $14, $15, $16, $17,
             $18, $19, $20,
             $21, $22,
             $23::jsonb, $24, NOW(), $25,
             'scanned', $26
           )
           ON CONFLICT (supplier_name, supplier_product_id)
             WHERE supplier_product_id IS NOT NULL
           DO UPDATE SET
             import_id           = EXCLUDED.import_id,
             product_name        = EXCLUDED.product_name,
             supplier_category   = EXCLUDED.supplier_category,
             -- DSC-E2 : préserver les champs édités manuellement (data_sources[champ] = 'manual')
             purchase_price      = CASE WHEN (sourcing_candidates.data_sources->>'purchase_price') = 'manual'
                                        THEN sourcing_candidates.purchase_price
                                        ELSE EXCLUDED.purchase_price END,
             currency            = CASE WHEN (sourcing_candidates.data_sources->>'purchase_price') = 'manual'
                                        THEN sourcing_candidates.currency
                                        ELSE EXCLUDED.currency END,
             purchase_price_kmf  = CASE WHEN (sourcing_candidates.data_sources->>'purchase_price') = 'manual'
                                        THEN sourcing_candidates.purchase_price_kmf
                                        ELSE EXCLUDED.purchase_price_kmf END,
             komerce_category    = CASE WHEN (sourcing_candidates.data_sources->>'category') = 'manual'
                                        THEN sourcing_candidates.komerce_category
                                        ELSE EXCLUDED.komerce_category END,
             estimated_weight_kg = CASE WHEN (sourcing_candidates.data_sources->>'weight') = 'manual'
                                        THEN sourcing_candidates.estimated_weight_kg
                                        ELSE EXCLUDED.estimated_weight_kg END,
             estimated_volume_m3 = CASE WHEN (sourcing_candidates.data_sources->>'volume') = 'manual'
                                        THEN sourcing_candidates.estimated_volume_m3
                                        ELSE EXCLUDED.estimated_volume_m3 END,
             target_margin_pct   = CASE WHEN (sourcing_candidates.data_sources->>'target_margin') = 'manual'
                                        THEN sourcing_candidates.target_margin_pct
                                        ELSE EXCLUDED.target_margin_pct END,
             image_url           = EXCLUDED.image_url,
             product_url         = EXCLUDED.product_url,
             description         = EXCLUDED.description,
             stock_available     = EXCLUDED.stock_available,
             min_order_qty       = EXCLUDED.min_order_qty,
             supplier_delay_days = EXCLUDED.supplier_delay_days,
             weight_kg           = EXCLUDED.weight_kg,
             dim_l_cm            = EXCLUDED.dim_l_cm,
             dim_w_cm            = EXCLUDED.dim_w_cm,
             dim_h_cm            = EXCLUDED.dim_h_cm,
             -- Fusionner data_sources : les marques 'manual' existantes priment
             data_sources        = sourcing_candidates.data_sources || EXCLUDED.data_sources,
             scan_result         = EXCLUDED.scan_result,
             scan_at             = NOW(),
             confidence          = EXCLUDED.confidence,
             -- Ne pas régresser un état terminal
             state               = CASE WHEN sourcing_candidates.state IN ('imported_to_catalog', 'rejected')
                                        THEN sourcing_candidates.state
                                        ELSE 'scanned' END,
             updated_by          = EXCLUDED.updated_by
           RETURNING *, (xmax <> 0) AS was_updated`,
          [
            importId, supplierName, product.supplier_product_id || null,
            product.product_name, product.supplier_category || null, product.purchase_price || null, product.currency || 'AED',
            product.image_url || null, product.product_url || null, product.description || null,
            product.stock_available || null, product.min_order_qty || null, product.supplier_delay_days || null,
            product.weight_kg || null, product.dimensions?.l_cm || null, product.dimensions?.w_cm || null, product.dimensions?.h_cm || null,
            normalized.komerce_category, normalized.estimated_weight_kg, normalized.estimated_volume_m3,
            normalized.purchase_price_kmf, normalized.target_margin_pct,
            incomingDataSources, scanJson, scan.confidence,
            req.user?.id || null,
          ]
        );

        const row = upsertRes.rows[0];
        const wasUpdated = row.was_updated;

        if (wasUpdated) {
          // DSC-E2 : journaliser les champs ignorés pour cause de verrou 'manual'
          const manualSources = row.data_sources || {};
          const lockedFields = Object.entries(manualSources)
            .filter(([, v]) => v === 'manual')
            .map(([k]) => k);

          await db.query(
            `INSERT INTO sourcing_candidate_events
               (candidate_id, event_type, changes, notes, triggered_by)
             VALUES ($1, 'data_correction', $2, $3, $4)`,
            [
              row.id,
              JSON.stringify({ re_import: true, locked_manual_fields: lockedFields }),
              lockedFields.length
                ? `Re-import : ${lockedFields.join(', ')} conservé(s) (édition manuelle).`
                : 'Re-import sans champ manuel verrouillé.',
              req.user?.id || null,
            ]
          );
          results.updated = (results.updated || 0) + 1;
        } else {
          results.created++;
        }
      } catch (errOne) {
        results.errors.push({ product_name: product.product_name || '?', error: errOne.message });
      }
    }

    // DSC-E3 — Archivage des candidats disparus (full snapshot uniquement)
    // Activé si is_full_snapshot=true dans le body.
    // Passe à 'archived' les candidats du même supplier_name absents du lot
    // et pas dans un état terminal (imported_to_catalog, rejected).
    if (b.is_full_snapshot) {
      const importedIds = products
        .map(p => p.supplier_product_id)
        .filter(Boolean);

      const archiveRes = await db.query(
        `UPDATE sourcing_candidates
            SET state = 'archived', updated_by = $1
          WHERE supplier_name = $2
            AND supplier_product_id IS NOT NULL
            AND supplier_product_id <> ALL($3::text[])
            AND state NOT IN ('imported_to_catalog', 'rejected', 'archived')
          RETURNING id, supplier_product_id, state`,
        [req.user?.id || null, supplierName, importedIds]
      );

      for (const archived of archiveRes.rows) {
        await db.query(
          `INSERT INTO sourcing_candidate_events
             (candidate_id, event_type, old_state, new_state, notes, triggered_by)
           VALUES ($1, 'state_change', $2, 'archived', $3, $4)`,
          [
            archived.id,
            archived.state,
            `Absent du full-snapshot import ${importId}`,
            req.user?.id || null,
          ]
        );
      }

      results.archived = archiveRes.rows.length;
    }

    res.json({
      import_id: importId,
      supplier_name: supplierName,
      source_type: sourceType,
      total_items: products.length,
      created: results.created,
      updated: results.updated || 0,
      archived: results.archived || 0,
      errors: results.errors,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/sourcing/catalogs
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/sourcing/candidates
// Filtres : ?state=...&supplier=...&decision=...&limit=...
// ═══════════════════════════════════════════════════════════════════════
router.get('/candidates', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const conditions = [];
    const params = [];
    let pi = 1;

    if (req.query.state) {
      conditions.push(`state = $${pi++}`);
      params.push(req.query.state);
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

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/sourcing/candidates/:id
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// PUT /api/admin/sourcing/candidates/:id
// ═══════════════════════════════════════════════════════════════════════
router.put('/candidates/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const b = req.body || {};
    const allowed = ['komerce_category', 'estimated_weight_kg', 'estimated_volume_m3',
                     'purchase_price', 'currency', 'target_margin_pct', 'notes',
                     'product_name', 'supplier_category'];
    const sets = [];
    const params = [];
    let pi = 1;

    const sourceUpdates = {};
    for (const key of allowed) {
      if (b[key] !== undefined) {
        sets.push(`${key} = $${pi++}`);
        params.push(b[key]);
        const srcKey = ({
          komerce_category: 'category',
          estimated_weight_kg: 'weight',
          estimated_volume_m3: 'volume',
          purchase_price: 'purchase_price',
          target_margin_pct: 'target_margin',
        })[key];
        if (srcKey) sourceUpdates[srcKey] = 'manual';
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'Aucun champ à modifier' });

    if (b.purchase_price !== undefined || b.currency !== undefined) {
      const config = await pricingEngine.loadGlobalConfig();
      const cur = b.currency || (await db.query('SELECT currency FROM sourcing_candidates WHERE id = $1', [req.params.id])).rows[0]?.currency || 'AED';
      const price = b.purchase_price !== undefined
        ? b.purchase_price
        : (await db.query('SELECT purchase_price FROM sourcing_candidates WHERE id = $1', [req.params.id])).rows[0]?.purchase_price;
      const priceKmf = scanner.convertToKMF(price, cur, config.finance);
      sets.push(`purchase_price_kmf = $${pi++}`);
      params.push(priceKmf);
    }

    if (Object.keys(sourceUpdates).length) {
      sets.push(`data_sources = data_sources || $${pi++}::jsonb`);
      params.push(JSON.stringify(sourceUpdates));
    }

    sets.push(`updated_by = $${pi++}`);
    params.push(req.user?.id || null);

    params.push(req.params.id);
    const r = await db.query(
      `UPDATE sourcing_candidates SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });

    await db.query(
      `INSERT INTO sourcing_candidate_events (candidate_id, event_type, changes, notes, triggered_by)
         VALUES ($1, 'data_correction', $2, $3, $4)`,
      [req.params.id, JSON.stringify(b), b.notes || null, req.user?.id || null]
    );

    res.json({ candidate: r.rows[0] });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/candidates/:id/scan
// ═══════════════════════════════════════════════════════════════════════
router.post('/candidates/:id/scan', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const r0 = await db.query('SELECT * FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });
    const candidate = r0.rows[0];

    const config = await pricingEngine.loadGlobalConfig();
    const scan = await scanner.scanCandidate(candidate, { config });

    const merged = { ...scan.scan_result, sourcing_decision: scan.sourcing_decision, reason: scan.reason, recommended_action: scan.recommended_action };
    const updRes = await db.query(
      `UPDATE sourcing_candidates
          SET scan_result = $1, scan_at = NOW(), confidence = $2, state = 'scanned', updated_by = $3
        WHERE id = $4 RETURNING *`,
      [JSON.stringify(merged), scan.confidence, req.user?.id || null, req.params.id]
    );

    await db.query(
      `INSERT INTO sourcing_candidate_events (candidate_id, event_type, result, triggered_by)
         VALUES ($1, 'scan', $2, $3)`,
      [req.params.id, JSON.stringify(merged), req.user?.id || null]
    );

    res.json({ candidate: updRes.rows[0] });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/candidates/scan-batch
// ═══════════════════════════════════════════════════════════════════════
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
        const merged = { ...scan.scan_result, sourcing_decision: scan.sourcing_decision, reason: scan.reason, recommended_action: scan.recommended_action };
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

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/candidates/:id/import-product
// ═══════════════════════════════════════════════════════════════════════
router.post('/candidates/:id/import-product', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const r0 = await db.query('SELECT * FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });
    const c = r0.rows[0];

    if (c.state === 'imported_to_catalog' && c.product_id) {
      return res.status(409).json({ error: 'Déjà importé', product_id: c.product_id });
    }

    const sr = c.scan_result || {};
    const initialPrice = req.body?.price_kmf
      || sr.test_price_kmf
      || sr.recommended_price_kmf
      || sr.minimum_safe_price_kmf
      || 0;

    if (!initialPrice) {
      return res.status(400).json({ error: 'Pas de prix calculé. Re-scannez le candidat avant import.' });
    }

    const weightKg = c.estimated_weight_kg || null;

    const prodRes = await db.query(
      `INSERT INTO products (
         name, category,
         cost_kmf,
         price_kmf,
         weight_kg,
         is_active, lifecycle_status
       ) VALUES ($1, $2, $3, $4, $5, FALSE, 'candidate')
       RETURNING id`,
      [
        c.product_name,
        c.komerce_category || 'autre',
        c.purchase_price_kmf || 0,
        initialPrice,
        weightKg,
      ]
    );
    const productId = prodRes.rows[0].id;

    await db.query(
      `UPDATE sourcing_candidates
          SET state = 'imported_to_catalog', product_id = $1, updated_by = $2
        WHERE id = $3`,
      [productId, req.user?.id || null, req.params.id]
    );

    await db.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, changes, triggered_by)
         VALUES ($1, 'imported', $2, 'imported_to_catalog', $3, $4)`,
      [req.params.id, c.state, JSON.stringify({ product_id: productId, price_kmf: initialPrice }), req.user?.id || null]
    );

    res.json({
      product_id: productId,
      candidate_id: req.params.id,
      message: 'Produit créé en mode inactif (is_active=false). Activez-le manuellement quand prêt.',
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/candidates/:id/reject
// ═══════════════════════════════════════════════════════════════════════
router.post('/candidates/:id/reject', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const reason = (req.body?.reason || '').trim();
    const r0 = await db.query('SELECT state FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });

    await db.query(
      `UPDATE sourcing_candidates SET state='rejected', rejected_reason=$1, updated_by=$2 WHERE id=$3`,
      [reason || null, req.user?.id || null, req.params.id]
    );
    await db.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, notes, triggered_by)
         VALUES ($1, 'rejected', $2, 'rejected', $3, $4)`,
      [req.params.id, r0.rows[0].state, reason, req.user?.id || null]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/candidates/:id/watchlist
// ═══════════════════════════════════════════════════════════════════════
router.post('/candidates/:id/watchlist', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const r0 = await db.query('SELECT state FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });

    await db.query(
      `UPDATE sourcing_candidates SET state='watchlist', updated_by=$1 WHERE id=$2`,
      [req.user?.id || null, req.params.id]
    );
    await db.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, triggered_by)
         VALUES ($1, 'state_change', $2, 'watchlist', $3)`,
      [req.params.id, r0.rows[0].state, req.user?.id || null]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
