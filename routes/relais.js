/**
 * @komerce-arch
 * @role          relais
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       relais
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-08
 */


'use strict';
/**
 * KOMERCE — Points relais
 *
 * GET /api/relais        → liste tous les relais actifs (public)
 * GET /api/relais/:id    → détail d'un relais
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

const PUBLIC_RELAY_COLUMNS = `
  id, name, agent_name, phone, address, zone, hours, island,
  latitude, longitude, photo_url
`;

// GET /api/relais — liste publique des points relais actifs
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT ${PUBLIC_RELAY_COLUMNS}
      FROM relais
      WHERE is_active = TRUE
      ORDER BY island, name
    `);
    res.json(rows);
  } catch(err) { next(err); }
});

// Route publique — liste des relais actifs (pas d'auth requise)
router.get('/public', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, zone, island, address, phone, latitude, longitude, photo_url
      FROM relais
      WHERE is_active = TRUE
      ORDER BY island, zone, name
    `);
    res.json({ relais: rows });
  } catch(err) { next(err); }
});

// GET /api/relais/:id — détail d'un relais
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_RELAY_COLUMNS}
       FROM relais WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Relais introuvable' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

module.exports = router;
