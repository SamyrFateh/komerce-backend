/**
 * @komerce-arch
 * @role          dashboard-partners
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-scope.js, middleware/validate.js, validators, services/partner-admin-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes
 * @db-write      none
 * @db-txn        delegated_to_partner_admin_service
 * @doctrine      legacy_http_contract_preserved, single_partner_mutation_authority, market_operator_scoping (GAP-3)
 * @impact-areas  dashboard, admin-dashboard, partners, market
 * @version       2026-09
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { attachAuthorizedMarketsForOperator, resolveMarketScopeRole, hasMarketScopeRole } = require('../../middleware/require-market-scope');
const { validate } = require('../../middleware/validate');
const { admin } = require('../../validators');
const partnerAdmin = require('../../services/partner-admin-service');

// ── GAP-3 (2026-09) ──────────────────────────────────────────────────────
// Ouvert en plus au market_operator. Lecture = viewer ou manager (guard
// suffit). Mutation = manager obligatoire, vérifié en ligne via
// ensureManagerForCountryCode — le filtrage marché passe par
// partners.country_code (résolu contre markets.code), pas par un market_id
// direct absent de cette table. attachAuthorizedMarketsForOperator ne fait
// rien pour admin — aucun changement de comportement pour ce rôle.
const guard = [authenticate, requireRole(['admin', 'market_operator']), attachAuthorizedMarketsForOperator];

function handlePartnerError(err, res, next) {
  if (err instanceof partnerAdmin.PartnerAdminError || err?.status) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  return next(err);
}

async function resolveMarketIdByCode(code) {
  if (!code) return null;
  const { rows } = await db.query('SELECT id FROM markets WHERE code = $1', [code]);
  return rows[0]?.id || null;
}

async function resolveAuthorizedCountryCodes(authorizedMarkets) {
  if (!authorizedMarkets || !authorizedMarkets.size) return [];
  const { rows } = await db.query(
    'SELECT code FROM markets WHERE id = ANY($1::uuid[])',
    [Array.from(authorizedMarkets)]
  );
  return rows.map(r => r.code);
}

/**
 * market_operator uniquement (admin retourne null immédiatement) : vérifie
 * que countryCode résout vers un marché autorisé ET que le scope sur ce
 * marché est 'manager' — jamais 'viewer', une mutation n'est jamais une
 * simple lecture. Aucun market_id fourni par le client n'est une autorité :
 * countryCode vient toujours de la ressource serveur (partner existant) ou
 * du champ validé du body, jamais interprété comme preuve d'accès en soi.
 */
async function ensureManagerForCountryCode(req, countryCode) {
  if (req.user.role !== 'market_operator') return null;
  const marketId = await resolveMarketIdByCode(countryCode);
  if (!marketId || !req.authorizedMarkets.has(marketId)) {
    return { status: 403, body: { error: 'Hors de votre périmètre marché', code: 'market_scope_denied' } };
  }
  const actualRole = await resolveMarketScopeRole(req.user.id, marketId);
  if (!hasMarketScopeRole(actualRole, 'manager')) {
    return {
      status: 403,
      body: { error: `Scope ${actualRole || 'aucun'} insuffisant — manager requis`, code: 'market_scope_role_insufficient' },
    };
  }
  return null;
}

/** Lecture (viewer ou manager suffit) — même résolution country_code → market_id. */
async function ensureReadAccessForCountryCode(req, countryCode) {
  if (req.user.role !== 'market_operator') return null;
  const marketId = await resolveMarketIdByCode(countryCode);
  if (!marketId || !req.authorizedMarkets.has(marketId)) {
    return { status: 403, body: { error: 'Hors de votre périmètre marché', code: 'market_scope_denied' } };
  }
  return null;
}

router.get('/partners', ...guard, async (req, res) => {
  try {
    const active = req.query.active === undefined
      ? undefined
      : (req.query.active === 'true' || req.query.active === '1');

    if (req.user.role === 'market_operator') {
      const codes = await resolveAuthorizedCountryCodes(req.authorizedMarkets);
      // Un country demandé hors périmètre ne doit ni élargir ni fuiter :
      // liste vide, jamais un fallback silencieux sur le scope complet.
      if (req.query.country && !codes.includes(req.query.country)) {
        return res.json([]);
      }
      const countryIn = req.query.country ? [req.query.country] : codes;
      return res.json(await partnerAdmin.listPartners({
        type: req.query.type, island: req.query.island, countryIn, active,
      }));
    }

    res.json(await partnerAdmin.listPartners({
      type: req.query.type,
      island: req.query.island,
      country: req.query.country,
      active,
    }));
  } catch (_) {
    res.json([]);
  }
});

router.get('/partners/stats', ...guard, async (req, res) => {
  try {
    if (req.user.role === 'market_operator') {
      const codes = await resolveAuthorizedCountryCodes(req.authorizedMarkets);
      return res.json(await partnerAdmin.getStats(codes));
    }
    res.json(await partnerAdmin.getStats());
  } catch (_) {
    res.json([]);
  }
});

router.get('/partners/:id', ...guard, async (req, res, next) => {
  try {
    const result = await partnerAdmin.getPartner(req.params.id);
    if (!result) return res.status(404).json({ error: 'Partenaire introuvable' });
    if (req.user.role === 'market_operator') {
      const denial = await ensureReadAccessForCountryCode(req, result.partner.country_code);
      if (denial) return res.status(denial.status).json(denial.body);
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/partners', ...guard, validate(admin.createPartner), async (req, res, next) => {
  try {
    if (req.user.role === 'market_operator') {
      const denial = await ensureManagerForCountryCode(req, req.body.country_code);
      if (denial) return res.status(denial.status).json(denial.body);
    }
    res.status(201).json(await partnerAdmin.createPartner(req.body));
  } catch (err) { handlePartnerError(err, res, next); }
});

router.put('/partners/:id', ...guard, validate(admin.updatePartner), async (req, res, next) => {
  try {
    if (req.user.role === 'market_operator') {
      const existing = await partnerAdmin.getPartner(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Partenaire introuvable' });
      const denial = await ensureManagerForCountryCode(req, existing.partner.country_code);
      if (denial) return res.status(denial.status).json(denial.body);
      // Un changement de country_code doit aussi être autorisé côté marché
      // cible — sinon on pourrait faire "sortir" un partenaire de son scope.
      if (req.body.country_code && req.body.country_code !== existing.partner.country_code) {
        const denialTarget = await ensureManagerForCountryCode(req, req.body.country_code);
        if (denialTarget) return res.status(denialTarget.status).json(denialTarget.body);
      }
    }
    res.json(await partnerAdmin.updatePartner(req.params.id, req.body));
  } catch (err) { handlePartnerError(err, res, next); }
});

router.delete('/partners/:id', ...guard, validate(admin.deletePartner), async (req, res, next) => {
  try {
    if (req.user.role === 'market_operator') {
      const existing = await partnerAdmin.getPartner(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Partenaire introuvable' });
      const denial = await ensureManagerForCountryCode(req, existing.partner.country_code);
      if (denial) return res.status(denial.status).json(denial.body);
    }
    res.json(await partnerAdmin.deletePartner(req.params.id));
  } catch (err) { handlePartnerError(err, res, next); }
});

module.exports = router;
