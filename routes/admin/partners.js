/**
 * @komerce-arch
 * @role          dashboard-partners
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-delegated-role.js, middleware/require-market-delegated-capability.js, middleware/validate.js, validators, services/partner-admin-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      none
 * @db-txn        delegated_to_partner_admin_service
 * @doctrine      legacy_http_contract_preserved, capability_is_the_authority_not_role, single_partner_mutation_authority
 * @impact-areas  dashboard, admin-dashboard, partners, market
 * @version       2026-10-d8
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { attachMarketDelegatedRoleFor } = require('../../middleware/require-market-delegated-role');
const { attachAuthorizedMarketsForCapability } = require('../../middleware/require-market-delegated-capability');
const { validate } = require('../../middleware/validate');
const { admin } = require('../../validators');
const partnerAdmin = require('../../services/partner-admin-service');

// D8 Market Control Plane — le registre historique partners est multi-types :
// provider.manage ne constitue donc jamais son autorité. Les lectures exigent
// partners.read ; les mutations exigent partners.manage. L'admin central
// conserve son comportement historique, tandis que l'autorité market_operator
// provient exclusivement des assignments/memberships/capabilities canoniques.
const baseGuard = [
  authenticate,
  attachMarketDelegatedRoleFor(['admin', 'market_operator']),
  requireRole(['admin', 'market_operator']),
];
const attachPartnerReadMarkets = attachAuthorizedMarketsForCapability('partners.read', { audit: false });
const attachPartnerManageMarkets = attachAuthorizedMarketsForCapability('partners.manage', { audit: true });

function allowCentralAdminOr(delegatedGuard) {
  return (req, res, next) => req.user.role === 'admin' ? next() : delegatedGuard(req, res, next);
}

const readGuard = [...baseGuard, allowCentralAdminOr(attachPartnerReadMarkets)];
const manageGuard = [...baseGuard, allowCentralAdminOr(attachPartnerManageMarkets)];

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
 * Pour market_operator uniquement, countryCode est résolu côté serveur vers
 * le Market ID puis comparé aux marchés autorisés pour la capability exacte.
 * Le code pays n'est jamais une preuve d'autorité en soi.
 */
async function ensureCapabilityAccessForCountryCode(req, countryCode, capability) {
  if (req.user.role !== 'market_operator') return null;
  const marketId = await resolveMarketIdByCode(countryCode);
  if (!marketId || !req.authorizedMarkets || !req.authorizedMarkets.has(marketId)) {
    return {
      status: 403,
      body: {
        error: `Capability ${capability} requise sur ce marché`,
        code: 'MARKET_CAPABILITY_REQUIRED',
      },
    };
  }
  return null;
}

router.get('/partners', ...readGuard, async (req, res) => {
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

router.get('/partners/stats', ...readGuard, async (req, res) => {
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

router.get('/partners/:id', ...readGuard, async (req, res, next) => {
  try {
    const result = await partnerAdmin.getPartner(req.params.id);
    if (!result) return res.status(404).json({ error: 'Partenaire introuvable' });
    if (req.user.role === 'market_operator') {
      const denial = await ensureCapabilityAccessForCountryCode(req, result.partner.country_code, 'partners.read');
      if (denial) return res.status(denial.status).json(denial.body);
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/partners', ...manageGuard, validate(admin.createPartner), async (req, res, next) => {
  try {
    if (req.user.role === 'market_operator') {
      const denial = await ensureCapabilityAccessForCountryCode(req, req.body.country_code, 'partners.manage');
      if (denial) return res.status(denial.status).json(denial.body);
    }
    res.status(201).json(await partnerAdmin.createPartner(req.body));
  } catch (err) { handlePartnerError(err, res, next); }
});

router.put('/partners/:id', ...manageGuard, validate(admin.updatePartner), async (req, res, next) => {
  try {
    if (req.user.role === 'market_operator') {
      const existing = await partnerAdmin.getPartner(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Partenaire introuvable' });
      const denial = await ensureCapabilityAccessForCountryCode(req, existing.partner.country_code, 'partners.manage');
      if (denial) return res.status(denial.status).json(denial.body);
      // Un changement de country_code doit aussi être autorisé côté marché
      // cible — sinon on pourrait faire "sortir" un partenaire de son scope.
      if (req.body.country_code && req.body.country_code !== existing.partner.country_code) {
        const denialTarget = await ensureCapabilityAccessForCountryCode(req, req.body.country_code, 'partners.manage');
        if (denialTarget) return res.status(denialTarget.status).json(denialTarget.body);
      }
    }
    res.json(await partnerAdmin.updatePartner(req.params.id, req.body));
  } catch (err) { handlePartnerError(err, res, next); }
});

router.delete('/partners/:id', ...manageGuard, validate(admin.deletePartner), async (req, res, next) => {
  try {
    if (req.user.role === 'market_operator') {
      const existing = await partnerAdmin.getPartner(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Partenaire introuvable' });
      const denial = await ensureCapabilityAccessForCountryCode(req, existing.partner.country_code, 'partners.manage');
      if (denial) return res.status(denial.status).json(denial.body);
    }
    res.json(await partnerAdmin.deletePartner(req.params.id));
  } catch (err) { handlePartnerError(err, res, next); }
});

module.exports = router;
