/**
 * @komerce-arch
 * @role          sourcing-candidate-scanner
 * @domain        sourcing
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*, services/suppliers/catalog-import-orchestrator.js, services/catalog-promotion.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       product_skus, sourcing_candidate_events, sourcing_candidates, supplier_catalog_imports
 * @db-write      catalog_media, product_sku_media, product_skus, product_variants, products, sourcing_candidate_events, sourcing_candidates
 * @db-write-via:catalog-import-orchestrator supplier_catalog_imports
 * @db-txn        import-product : transaction dédiée (db.getClient/BEGIN..COMMIT), promotion catalogue incluse ; reste des routes : query_direct
 * @doctrine      PDC-8 Lot 6, DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  sourcing, catalog
 * @version       2026-07 (PDC-8 Lot 6 — import-product transactionnel + promotion catalogue câblée)
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
 * Lot B1 (2026-06-28) : l'orchestration métier de POST /catalogs/import
 * (upsert idempotent, verrou champs manuels, archivage full-snapshot) a été
 * extraite iso-comportement vers services/suppliers/catalog-import-orchestrator.js.
 * Cette route ne fait plus que dispatcher et appeler le service.
 *
 * Pipeline complet :
 *   1. POST /catalogs/import     reçoit { source_type, supplier_name, ... }
 *   2. Dispatch vers le bon connector
 *   3. Connector → NormalizedSupplierProduct[]
 *   4. catalogImportOrchestrator.importCatalog() → normalize + scan + persist
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
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const catalogEnrichment = require('../services/catalog-enrichment');
const { promoteCatalog } = require('../services/catalog-promotion');
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
    const result = await catalogImportOrchestrator.importCatalog(req.body, req.user?.id, dispatchToConnector);
    res.status(result.status).json(result.body);
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

    if (req.query.state === 'all') {
      // Pas de filtre state — vue brute complète, y compris rejected/archived.
    } else if (req.query.state) {
      conditions.push(`state = $${pi++}`);
      params.push(req.query.state);
    } else {
      // Défaut : la file admin ne mélange pas les candidats déjà tranchés
      // (rejected/archived) avec ceux qui attendent une décision — la doctrine
      // catalogue §2 exige que leur raison reste consultable (visible via
      // ?state=rejected ou ?state=all), mais pas qu'ils polluent la vue par
      // défaut comme s'ils restaient « à décider ».
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

    // ING-5 (verrou 2) — une devise saisie hors whitelist ne doit plus jamais
    // pouvoir produire un purchase_price_kmf faux (ex: GBP traité comme KMF).
    const CURRENCY_WHITELIST = ['AED', 'EUR', 'USD', 'KMF'];
    if (b.currency !== undefined && !CURRENCY_WHITELIST.includes(b.currency)) {
      return res.status(400).json({
        error: `currency doit être l'une de : ${CURRENCY_WHITELIST.join(', ')}`,
      });
    }

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
      // ING-5 (durcissement) — doctrine ING-I2 : jamais de défaut fabriqué sur
      // la devise. Avant : repli silencieux sur 'AED' si ni le body ni la ligne
      // DB n'avaient de currency. Inerte en pratique (currency toujours posée à
      // l'INSERT depuis la donnée validée par le contrat v1), mais une mine
      // dormante si un futur chemin d'écriture contourne ce contrat — on la
      // désamorce en refusant explicitement plutôt qu'en devinant.
      const dbCurrency = b.currency === undefined
        ? (await db.query('SELECT currency FROM sourcing_candidates WHERE id = $1', [req.params.id])).rows[0]?.currency
        : undefined;
      const cur = b.currency !== undefined ? b.currency : dbCurrency;
      if (!cur) {
        return res.status(400).json({
          error: 'Devise introuvable : ni fournie dans la requête, ni présente en base pour ce candidat. Fournir explicitement currency.',
        });
      }
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
// PDC-8 Lot 6 : la route ouvre désormais une transaction dédiée. Le produit,
// la promotion catalogue (media/axes/SKU/couture SKU↔media) et la mise à
// jour du candidat forment une seule unité atomique — soit tout est commité,
// soit rien ne l'est. L'enrichissement FR (étage ⑤) reste hors transaction
// et best-effort : il s'exécute APRÈS le commit et ne fait jamais échouer
// une promotion déjà actée.
router.post('/candidates/:id/import-product', authenticate, requireAdminOrFounder, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const r0 = await client.query('SELECT * FROM sourcing_candidates WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Candidat introuvable' });
    }
    const c = r0.rows[0];

    if (c.state === 'imported_to_catalog' && c.product_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Déjà importé', product_id: c.product_id });
    }

    // ING-5 (verrou 1) — une exclusion absolue est terminale partout (ING-I5).
    // Un candidat rejeté (rejet manuel OU auto-exclusion douane/légale) n'est
    // JAMAIS ré-importable, quel que soit le chemin emprunté par la route.
    if (c.state === 'rejected' || c.scan_result?.sourcing_decision === 'EXCLUDED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Candidat exclu (douane/légal) — import interdit, non ré-évaluable.',
      });
    }

    // ING-6 (barrière de promotion) — un candidat en quarantaine n'est pas
    // promouvable : il n'est ni prêt ni rejeté, seulement non représentable
    // aujourd'hui (cf. migration 110). Et un candidat issu d'un batch
    // BLOCKED_* ou encore PROCESSING/FAILED ne l'est pas davantage : le
    // seuil de blocage (ING-I4/ING-I9) ne protège rien si un candidat
    // 'normalized' isolé peut être promu sans regarder l'état de son batch.
    if (c.state === 'quarantined') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Candidat en quarantaine — non promouvable en l\'état (cf. supplier_catalog_import_rejections / batch_findings).',
      });
    }
    if (c.import_id) {
      const batchRes = await client.query(
        'SELECT status FROM supplier_catalog_imports WHERE id = $1',
        [c.import_id]
      );
      const batchStatus = batchRes.rows[0]?.status;
      if (batchStatus && batchStatus !== 'COMPLETED' && batchStatus !== 'COMPLETED_WITH_QUARANTINE') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Import parent non promouvable (statut batch: ${batchStatus}).`,
          import_id: c.import_id,
          batch_status: batchStatus,
        });
      }
    }

    const sr = c.scan_result || {};
    const initialPrice = req.body?.price_kmf
      || sr.test_price_kmf
      || sr.recommended_price_kmf
      || sr.minimum_safe_price_kmf
      || 0;

    if (!initialPrice) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Pas de prix calculé. Re-scannez le candidat avant import.' });
    }

    const weightKg = c.estimated_weight_kg || null;

    // DOCTRINE_CATALOGUE §7 — la donnée source ne se perd JAMAIS : elle est
    // écrite ici, à l'entrée du catalogue (retraduction + litiges fournisseur).
    // La locale des connecteurs actuels est l'anglais (Dubaï) ; les futurs
    // connecteurs porteront leur locale dans NormalizedSupplierProduct.
    const prodRes = await client.query(
      `INSERT INTO products (
         name, category,
         cost_kmf,
         price_kmf,
         weight_kg,
         is_active, lifecycle_status,
         name_source, description_source, source_locale, content_source
       ) VALUES ($1, $2, $3, $4, $5, FALSE, 'candidate', $6, $7, $8, 'connector_raw')
       RETURNING id`,
      [
        c.product_name,
        c.komerce_category || 'autre',
        c.purchase_price_kmf || 0,
        initialPrice,
        weightKg,
        c.product_name,
        c.description || null,
        'en',
      ]
    );
    const productId = prodRes.rows[0].id;

    // PDC-8 Lot 6 — promotion du normalized_source_contract V2 (media, axes,
    // SKU, couture SKU↔media) dans la même transaction. Un contrat V1
    // (absent/null) est un no-op explicite (promoted:false), pas une erreur.
    // Une promotion invalide (422) fait échouer tout l'import (rollback).
    const promotion = await promoteCatalog(client, {
      productId,
      normalizedSourceContract: c.normalized_source_contract || null,
    });

    await client.query(
      `UPDATE sourcing_candidates
          SET state = 'imported_to_catalog', product_id = $1, updated_by = $2
        WHERE id = $3`,
      [productId, req.user?.id || null, req.params.id]
    );

    await client.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, changes, triggered_by)
         VALUES ($1, 'imported', $2, 'imported_to_catalog', $3, $4)`,
      [req.params.id, c.state, JSON.stringify({ product_id: productId, price_kmf: initialPrice }), req.user?.id || null]
    );

    await client.query('COMMIT');

    // Étage ⑤ — enrichissement FR (K-3), best-effort, HORS transaction et
    // APRÈS le commit : un hoquet du modèle ne fait pas échouer un import déjà
    // acté. En échec, la fiche reste en donnée connecteur, marquée
    // needs_review, run tracé (catalog_enrichment_runs).
    const enrichment = await catalogEnrichment.enrichAndApply(productId);

    res.json({
      product_id: productId,
      candidate_id: req.params.id,
      promotion, // { promoted: bool, reason?, media?, variants?, skus?, skuMediaLinks? }
      enrichment, // { status: ok|low_confidence|invalid_output|failed, confidence?, error? }
      message: enrichment.status === 'ok'
        ? 'Produit créé en mode inactif, fiche FR générée. Approuvez-la quand prête.'
        : 'Produit créé en mode inactif — fiche à relire (needs_review). Activez-le manuellement quand prêt.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
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
