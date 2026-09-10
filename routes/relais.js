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
 * @db-read       relais, markets
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, market_scoped_public_projection
 * @impact-areas  logistics, boutique, checkout
 * @version       2026-09
 */


'use strict';
/**
 * KOMERCE — Points relais
 *
 * GET /api/relais        → liste des relais actifs, filtrable par marché
 * GET /api/relais/public → projection publique légère, filtrable par marché
 * GET /api/relais/:id    → détail d'un relais
 *
 * `?market=CM|CG|KM|...` ne constitue JAMAIS une autorisation : c'est un
 * filtre de projection publique pour la vitrine. L'autorité métier d'une
 * commande reste le relais_id persisté, dont le market_id est résolu serveur.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

const PUBLIC_RELAY_COLUMNS = `
  r.id, r.market_id, m.code AS market_code, m.name AS market_name,
  r.name, r.agent_name, r.phone, r.address, r.zone, r.hours, r.island,
  r.latitude, r.longitude, r.photo_url
`;

function normalizeMarketCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  return /^[A-Z]{2}$/.test(raw) ? raw : '';
}

function marketCodeFromPreviewReferrer(req) {
  // Pont PREVIEW staging : les appels historiques /api/relais ne transportent
  // pas encore explicitement le MarketContext. Sur une navigation même-origin
  // /boutique/?market=CM, le Referer permet de garder la projection cohérente.
  // Un appelant peut (et doit à terme) fournir ?market= explicitement.
  const referrer = String(req.get('referer') || '').trim();
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    const host = String(req.get('host') || '').toLowerCase();
    if (host && url.host.toLowerCase() !== host) return null;
    return normalizeMarketCode(url.searchParams.get('market'));
  } catch (_) {
    return null;
  }
}

function requestedMarketCode(req) {
  const explicit = normalizeMarketCode(req.query?.market || req.query?.market_code);
  if (explicit !== null) return explicit;
  return marketCodeFromPreviewReferrer(req);
}

async function listActiveRelays({ marketCode = null, compact = false } = {}) {
  const select = compact
    ? `r.id, r.market_id, m.code AS market_code, m.name AS market_name,
       r.name, r.zone, r.island, r.address, r.phone, r.latitude, r.longitude, r.photo_url`
    : PUBLIC_RELAY_COLUMNS;

  const params = [];
  let marketFilter = '';
  if (marketCode) {
    params.push(marketCode);
    marketFilter = 'AND m.code = $1';
  }

  const { rows } = await db.query(`
    SELECT ${select}
    FROM relais r
    JOIN markets m ON m.id = r.market_id
    WHERE r.is_active = TRUE
      ${marketFilter}
    ORDER BY
      CASE
        WHEN m.code = 'CM' AND LOWER(COALESCE(r.zone, r.address, r.name, '')) LIKE '%yaound%' THEN 0
        WHEN m.code = 'CM' AND LOWER(COALESCE(r.zone, r.address, r.name, '')) LIKE '%douala%' THEN 1
        WHEN m.code = 'CG' AND LOWER(COALESCE(r.zone, r.address, r.name, '')) LIKE '%brazzaville%' THEN 0
        ELSE 10
      END,
      r.zone NULLS LAST,
      r.island NULLS LAST,
      r.name
  `, params);
  return rows;
}

function rejectMalformedMarket(res, code) {
  if (code !== '') return false;
  res.status(400).json({ error: 'Code marché invalide', code: 'invalid_market_code' });
  return true;
}

// GET /api/relais — liste publique des points relais actifs
router.get('/', async (req, res, next) => {
  try {
    const marketCode = requestedMarketCode(req);
    if (rejectMalformedMarket(res, marketCode)) return;
    const rows = await listActiveRelays({ marketCode });
    res.json(rows);
  } catch(err) { next(err); }
});

// Route publique — liste des relais actifs (pas d'auth requise)
router.get('/public', async (req, res, next) => {
  try {
    const marketCode = requestedMarketCode(req);
    if (rejectMalformedMarket(res, marketCode)) return;
    const rows = await listActiveRelays({ marketCode, compact: true });
    res.json({ relais: rows });
  } catch(err) { next(err); }
});

// GET /api/relais/:id — détail d'un relais
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_RELAY_COLUMNS}
       FROM relais r
       JOIN markets m ON m.id = r.market_id
       WHERE r.id = $1 AND r.is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Relais introuvable' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

module.exports = router;
