/**
 * KOMERCE — Routes API Scanner Catalogue Fournisseur (LOT D)
 * ═══════════════════════════════════════════════════════════════
 *
 * Pipeline géré :
 *   POST   /catalogs/import              — créer un import (CSV ou manuel)
 *   GET    /catalogs                     — lister les imports
 *   GET    /candidates                   — lister les candidats (avec filtres)
 *   GET    /candidates/:id               — détail d'un candidat
 *   PUT    /candidates/:id               — éditer un candidat (corrections terrain)
 *   POST   /candidates/:id/scan          — re-scanner un candidat
 *   POST   /candidates/scan-batch        — re-scanner tous les candidats d'un import
 *   POST   /candidates/:id/import-product — créer le produit Komerce
 *   POST   /candidates/:id/reject        — rejeter
 *   POST   /candidates/:id/watchlist     — mettre en watchlist
 *
 * Sécurité : tous les endpoints sont admin/founder uniquement.
 * Pas d'import auto vers products : étape import-product est explicite.
 */

'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const scanner = require('../services/supplier-catalog-scanner');
const pricingEngine = require('../services/pricing-engine');
const { authenticate } = require('../middleware/auth');

// Middleware admin/founder uniquement
function requireAdminOrFounder(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'founder') {
    return res.status(403).json({ error: 'Accès admin/founder requis' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/sourcing/catalogs/import
// Body: { supplier_name, source_type, source_filename?, csv_text?, items? [], notes? }
// ═══════════════════════════════════════════════════════════════════════
router.post('/catalogs/import', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const b = req.body || {};
    const supplierName = (b.supplier_name || '').trim();
    const sourceType = b.source_type || 'manual';

    if (!supplierName) {
      return res.status(400).json({ error: 'supplier_name requis' });
    }
    if (!['csv', 'manual'].includes(sourceType)) {
      return res.status(400).json({ error: 'source_type doit être "csv" ou "manual"' });
    }

    // Extraction des items selon source
    let rawItems = [];
    if (sourceType === 'csv') {
      if (!b.csv_text) return res.status(400).json({ error: 'csv_text requis pour source_type=csv' });
      rawItems = scanner.parseCSV(b.csv_text, b.csv_mapping);
      if (!rawItems.length) return res.status(400).json({ error: 'Aucune ligne valide trouvée dans le CSV' });
    } else {
      // Manuel : items fournis directement (array d'objets)
      rawItems = Array.isArray(b.items) ? b.items : [];
      if (!rawItems.length) return res.status(400).json({ error: 'items requis pour source_type=manual' });
    }

    // Charger config Komerce une seule fois (perf : 1 requête au lieu de N)
    const config = await pricingEngine.loadGlobalConfig();

    // Créer l'import
    const importRes = await db.query(
      `INSERT INTO supplier_catalog_imports
         (supplier_name, source_type, source_filename, notes, total_items, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [supplierName, sourceType, b.source_filename || null, b.notes || null, rawItems.length, req.user?.id || null]
    );
    const importId = importRes.rows[0].id;

    // Pour chaque item brut : normaliser + scanner + insérer
    const results = { created: 0, errors: [] };
    for (const raw of rawItems) {
      try {
        const enriched = { ...raw, supplier_name: supplierName };
        const normalized = await scanner.normalizeCandidate(enriched, { config });
        const scan = await scanner.scanCandidate(normalized, { config });

        await db.query(
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
             $23, $24, NOW(), $25,
             'scanned', $26
           )`,
          [
            importId, supplierName, raw.supplier_product_id || null,
            raw.product_name, raw.supplier_category || null, raw.purchase_price || null, raw.currency || 'AED',
            raw.image_url || null, raw.product_url || null, raw.description || null,
            raw.stock_available || null, raw.min_order_qty || null, raw.supplier_delay_days || null,
            raw.weight_kg || null, raw.dim_l_cm || null, raw.dim_w_cm || null, raw.dim_h_cm || null,
            normalized.komerce_category, normalized.estimated_weight_kg, normalized.estimated_volume_m3,
            normalized.purchase_price_kmf, normalized.target_margin_pct,
            JSON.stringify(normalized.data_sources), JSON.stringify({ ...scan.scan_result, sourcing_decision: scan.sourcing_decision, reason: scan.reason, recommended_action: scan.recommended_action }),
            scan.confidence,
            req.user?.id || null,
          ]
        );
        results.created++;
      } catch (errOne) {
        results.errors.push({ product_name: raw.product_name || '?', error: errOne.message });
      }
    }

    res.json({
      import_id: importId,
      supplier_name: supplierName,
      total_items: rawItems.length,
      created: results.created,
      errors: results.errors,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/sourcing/catalogs
// Liste les imports les plus récents
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

    // Charger les events
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
// Édition rapide des champs corrigeables (cat, poids, volume, prix achat...)
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

    // On marque les champs édités comme source 'manual' dans data_sources
    const sourceUpdates = {};
    for (const key of allowed) {
      if (b[key] !== undefined) {
        sets.push(`${key} = $${pi++}`);
        params.push(b[key]);
        // Mapping champ -> clé data_sources
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

    // Si changement de prix achat ou devise, recalculer purchase_price_kmf
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

    // Mettre à jour data_sources avec les nouvelles sources 'manual'
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

    // Audit
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
// Re-scan d'un candidat (utile après édition)
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
// Re-scanne tous les candidats d'un import (ou tous si pas d'import_id)
// Body: { import_id?, ids? [] }
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
// Crée un produit Komerce à partir du candidat
// ═══════════════════════════════════════════════════════════════════════
router.post('/candidates/:id/import-product', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const r0 = await db.query('SELECT * FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Candidat introuvable' });
    const c = r0.rows[0];

    if (c.state === 'imported_to_catalog' && c.product_id) {
      return res.status(409).json({ error: 'Déjà importé', product_id: c.product_id });
    }

    // Choisir le prix de vente initial
    // Par défaut : test_price si dispo, sinon recommended_price, sinon minimum_safe
    const sr = c.scan_result || {};
    const initialPrice = req.body?.price_kmf
      || sr.test_price_kmf
      || sr.recommended_price_kmf
      || sr.minimum_safe_price_kmf
      || 0;

    if (!initialPrice) {
      return res.status(400).json({ error: 'Pas de prix calculé. Re-scannez le candidat avant import.' });
    }

    // Créer le produit (champs minimums — produit créé en is_active=FALSE pour démarrer en sourdine)
    const prodRes = await db.query(
      `INSERT INTO products (name, category, cost_kmf, price_kmf, weight_kg, is_active)
         VALUES ($1, $2, $3, $4, $5, FALSE)
         RETURNING id`,
      [
        c.product_name,
        c.komerce_category || 'autre',
        c.purchase_price_kmf || 0,
        initialPrice,
        c.estimated_weight_kg || null,
      ]
    );
    const productId = prodRes.rows[0].id;

    // Mettre à jour le candidat
    await db.query(
      `UPDATE sourcing_candidates
          SET state = 'imported_to_catalog', product_id = $1, updated_by = $2
        WHERE id = $3`,
      [productId, req.user?.id || null, req.params.id]
    );

    // Audit
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
