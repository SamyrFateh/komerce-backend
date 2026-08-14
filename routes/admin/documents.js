/**
 * @komerce-arch
 * @role          admin-documents
 * @domain        documents
 * @layer         route
 * @criticality   low
 * @inputs        query filters (document_type, order_id, from, to, limit, offset)
 * @outputs       transaction_documents rows + résumé par type
 * @depends       db.js, middleware/auth.js
 * @used-by       routes/admin/index.js
 * @db-read       transaction_documents, users
 * @db-write      (none)
 * @db-txn        (none)
 * @doctrine      DOCTRINE_DOCUMENTS_TRANSACTIONNELS_KOMERCE.md
 * @impact-areas  documents
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/documents ──────────────────────────────────────────────
// Liste les documents transactionnels avec filtres.
// Sert à diagnostiquer : "est-ce que des documents sont bien émis ?"
//
// Query params :
//   document_type  refund_receipt | wallet_receipt | pickup_proof |
//                  customs_invoice
//   order_id       UUID commande
//   subject_id     UUID sujet (refund_id, wallet_tx_id, etc.)
//   status         pending | available | error
//   from           ISO date (issued_at >=)
//   to             ISO date (issued_at <=)
//   limit          défaut 50, max 200
//   offset         défaut 0
router.get('/documents', ...guard, async (req, res, next) => {
  try {
    const {
      document_type,
      order_id,
      subject_id,
      status,
      from,
      to,
      limit  = 50,
      offset = 0,
    } = req.query;

    const conds  = [];
    const params = [];
    let   pi     = 1;

    if (document_type) { conds.push(`td.document_type = $${pi++}`); params.push(document_type); }
    if (order_id)      { conds.push(`td.order_id = $${pi++}`);      params.push(order_id); }
    if (subject_id)    { conds.push(`td.subject_id = $${pi++}`);    params.push(subject_id); }
    if (status)        { conds.push(`td.status = $${pi++}`);        params.push(status); }
    if (from)          { conds.push(`td.issued_at >= $${pi++}`);    params.push(from); }
    if (to)            { conds.push(`td.issued_at <= $${pi++}`);    params.push(to); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const cap = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;

    const { rows } = await db.query(
      `SELECT
         td.id,
         td.document_type,
         td.subject_type,
         td.subject_id,
         td.order_id,
         td.refund_id,
         td.reference,
         td.status,
         td.issued_at,
         td.issued_by,
         td.file_url,
         -- metadata allégée : on expose les clés de surface, pas le snapshot complet
         td.metadata - 'lines' AS metadata_summary
       FROM transaction_documents td
       ${where}
       ORDER BY td.issued_at DESC
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, cap, off]
    );

    // Comptage total pour pagination
    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*) AS total FROM transaction_documents td ${where}`,
      params
    );

    res.json({ documents: rows, total: Number(total), limit: cap, offset: off });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/documents/summary ─────────────────────────────────────
// Résumé par type : combien de documents émis, le plus récent, séquences OK ?
// C'est la route de diagnostic principal ("pourquoi aucun document ?").
router.get('/documents/summary', ...guard, async (req, res, next) => {
  try {
    // Comptage par type + date du plus récent
    const { rows: byType } = await db.query(`
      SELECT
        document_type,
        COUNT(*)                              AS total,
        COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
        COUNT(*) FILTER (WHERE status = 'available') AS available,
        COUNT(*) FILTER (WHERE status = 'error')     AS error,
        MAX(issued_at)                        AS last_issued_at,
        MIN(issued_at)                        AS first_issued_at
      FROM transaction_documents
      GROUP BY document_type
      ORDER BY document_type
    `);

    // Vérifier que les séquences existent (diagnostic migration)
    const SEQUENCES = [
      'refund_receipt_seq',
      'wallet_receipt_seq',
      'pickup_proof_seq',
      'customs_invoice_seq',
    ];
    const { rows: seqRows } = await db.query(
      `SELECT sequence_name
         FROM information_schema.sequences
        WHERE sequence_schema = 'public'
          AND sequence_name = ANY($1)`,
      [SEQUENCES]
    );
    const existingSeqs = new Set(seqRows.map(r => r.sequence_name));
    const sequences = SEQUENCES.map(name => ({
      name,
      exists: existingSeqs.has(name),
    }));

    // Vérifier que la table elle-même existe
    const { rows: [tableCheck] } = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name   = 'transaction_documents'
      ) AS table_exists
    `);

    // Valeurs autorisées dans la contrainte CHECK
    const { rows: [constraintRow] } = await db.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'transaction_documents'
         AND c.conname = 'transaction_documents_type_check'
    `);

    res.json({
      table_exists:    tableCheck.table_exists,
      by_type:         byType,
      sequences,
      type_constraint: constraintRow?.def ?? null,
      // Si by_type est vide et table_exists est true → documents jamais émis ou migrations non jouées
      diagnosis: byType.length === 0
        ? 'Aucun document émis. Vérifier : (1) migrations 083/093 jouées en prod, (2) logs Railway pour erreurs silencieuses.'
        : `${byType.reduce((s, r) => s + Number(r.total), 0)} document(s) au total.`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/documents/:id ─────────────────────────────────────────
// Détail complet d'un document — metadata complète incluse.
router.get('/documents/:id', ...guard, async (req, res, next) => {
  try {
    const { rows: [doc] } = await db.query(
      `SELECT td.*,
              u.full_name AS issued_by_name
         FROM transaction_documents td
         LEFT JOIN users u ON u.id = td.issued_by
        WHERE td.id = $1`,
      [req.params.id]
    );

    if (!doc) return res.status(404).json({ error: 'Document introuvable' });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
