/**
 * @komerce-arch
 * @role          economic-engine-admin-pricing-matrices
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       pricing_category_dims, pricing_category_taxes, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      lot1a_dead_editor_retired_read_only
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-08
 */

/**
 * KOMERCE — Matrices pricing legacy (LOT 1A)
 *
 * `pricing_category_taxes` et `pricing_category_dims` ont été confirmées par
 * LOT 0B comme des sources fantômes : elles étaient éditables dans Settings,
 * mais aucun moteur de pricing runtime ne les consomme.
 *
 * Migration additive / fail-closed :
 *   - GET reste disponible temporairement pour compatibilité et forensic ;
 *   - PUT reste routé mais répond 410 Gone et n'écrit plus rien ;
 *   - la purge des tables/routes legacy appartient au LOT 11, après preuve.
 *
 * Sources de vérité runtime :
 *   - taxes douanières : customs_categories.{douane_pct,tva_pct,taxe_add_pct}
 *   - dimensions défaut : customs_categories.{default_dim_l_cm,default_dim_w_cm,default_dim_h_cm}
 */

'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

function retiredEditor(res, matrix) {
  const sourceOfTruth = matrix === 'taxes'
    ? 'customs_categories.{douane_pct,tva_pct,taxe_add_pct}'
    : 'customs_categories.{default_dim_l_cm,default_dim_w_cm,default_dim_h_cm}';

  return res.status(410).json({
    error: 'pricing_matrix_editor_retired',
    matrix,
    source_of_truth: sourceOfTruth,
    message: 'Éditeur legacy retiré en LOT 1A : cette table n’est pas une source de vérité runtime.',
  });
}

// GET conservé temporairement : lecture forensic/compatibilité uniquement.
router.get('/taxes', authenticate, requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT category, label_fr,
             douane_pct, tva_pct, taxe_add_pct,
             updated_at,
             (SELECT full_name FROM users WHERE id = t.updated_by) AS updated_by_name
      FROM pricing_category_taxes t
      ORDER BY category
    `);
    res.json({ taxes: rows });
  } catch (err) { next(err); }
});

// Éditeur fantôme neutralisé : aucune validation métier, aucune transaction,
// aucune écriture. La route reste présente pour échouer explicitement plutôt
// que de produire un 404 ambigu aux anciens clients.
router.put('/taxes/:category', authenticate, requireAdmin, (_req, res) => {
  return retiredEditor(res, 'taxes');
});

// GET conservé temporairement : lecture forensic/compatibilité uniquement.
router.get('/dims', authenticate, requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT category, label_fr,
             length_cm, width_cm, height_cm,
             updated_at,
             (SELECT full_name FROM users WHERE id = d.updated_by) AS updated_by_name
      FROM pricing_category_dims d
      ORDER BY category
    `);
    res.json({ dims: rows });
  } catch (err) { next(err); }
});

router.put('/dims/:category', authenticate, requireAdmin, (_req, res) => {
  return retiredEditor(res, 'dims');
});

module.exports = router;
