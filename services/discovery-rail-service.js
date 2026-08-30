/**
 * @komerce-arch
 * @role          recommendations-discovery-rail-service
 * @domain        recommendations
 * @layer         service
 * @criticality   medium
 * @inputs        market_code, server_editorial_policy
 * @outputs       ordered_discovery_cards
 * @depends       db, services/discovery-rail-composer.js
 * @used-by       routes/boutique-suggestions.js
 * @db-read       markets
 * @db-read-via:discovery-rail-composer products, local_stock, local_stock_allocations, services, physical_offers, providers
 * @db-write      none
 * @db-txn        read_mostly
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md §8-§13
 * @impact-areas  recommendations, boutique, discovery-rail
 * @version       2026-08
 */
'use strict';

/**
 * Politique d'activation serveur du rail Discovery.
 *
 * Capability != exposure : le frontend ne possède aucun flag. Tant que
 * DISCOVERY_RAIL_ENABLED n'est pas explicitement activé, le résultat est [].
 *
 * La sélection éditoriale est elle aussi explicite et serveur-owned :
 *
 *   DISCOVERY_RAIL_CANDIDATES=
 *     physical_offer:<uuid>,service:<uuid>,product:<uuid>,service:<uuid>
 *
 * L'ordre de cette liste EST l'ordre d'affichage. Le composeur conserve son
 * invariant : il ne sélectionne jamais lui-même ses candidats et ne fait que
 * projeter les vérités des features sources.
 */

const db = require('../db');
const { composeDiscoveryRail } = require('./discovery-rail-composer');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_KINDS = new Set(['product', 'physical_offer', 'service']);

function isEnabled() {
  const raw = String(process.env.DISCOVERY_RAIL_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function parseEditorialCandidates(raw = process.env.DISCOVERY_RAIL_CANDIDATES) {
  if (!raw) return [];

  const seen = new Set();
  const candidates = [];

  for (const token of String(raw).split(',')) {
    const [kindRaw, idRaw] = token.split(':');
    const kind = String(kindRaw || '').trim();
    const id = String(idRaw || '').trim();
    if (!ALLOWED_KINDS.has(kind) || !UUID_RE.test(id)) continue;

    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ kind, id, key });
  }

  return candidates.slice(0, 12);
}

async function resolveMarketId(marketCode) {
  if (!marketCode) return null;
  const { rows } = await db.query(
    'SELECT id FROM markets WHERE code = $1 AND is_active = true',
    [String(marketCode).toUpperCase()]
  );
  return rows[0]?.id || null;
}

function groupCandidateIds(candidates) {
  return candidates.reduce((acc, candidate) => {
    if (candidate.kind === 'product') acc.productIds.push(candidate.id);
    if (candidate.kind === 'physical_offer') acc.physicalOfferIds.push(candidate.id);
    if (candidate.kind === 'service') acc.serviceIds.push(candidate.id);
    return acc;
  }, { productIds: [], physicalOfferIds: [], serviceIds: [] });
}

function cardKey(card) {
  return `${card.kind}:${card.cta_action_ref}`;
}

/**
 * @param {{marketCode: string}} params
 * @returns {Promise<object[]>}
 */
async function getDiscoveryRail({ marketCode }) {
  if (!isEnabled()) return [];

  const candidates = parseEditorialCandidates();
  if (candidates.length === 0) return [];

  const marketId = await resolveMarketId(marketCode);
  if (!marketId) return [];

  const cards = await composeDiscoveryRail({
    marketId,
    ...groupCandidateIds(candidates),
  });

  // composeDiscoveryRail groupe ses appels par source pour rester simple.
  // Le service recommendations réapplique ici la politique éditoriale
  // explicite ; aucune vérité métier n'est modifiée.
  const byKey = new Map(cards.map(card => [cardKey(card), card]));
  return candidates.map(candidate => byKey.get(candidate.key)).filter(Boolean);
}

module.exports = {
  isEnabled,
  parseEditorialCandidates,
  resolveMarketId,
  getDiscoveryRail,
};
