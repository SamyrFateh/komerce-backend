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
 * @doctrine      docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md, docs/doctrine/DOCTRINE_DISCOVERY_ACCESSIBILITE_LOCALE.md
 * @impact-areas  recommendations, boutique, discovery-rail, category-navigation
 * @version       2026-09
 */
'use strict';

/**
 * Politique d'activation serveur du rail Discovery.
 *
 * Capability != exposure : le frontend ne possède aucun flag. Tant que
 * DISCOVERY_RAIL_ENABLED n'est pas explicitement activé, le résultat est [].
 *
 * La sélection éditoriale est explicite et server-owned :
 *
 *   DISCOVERY_RAIL_CANDIDATES=
 *     product:<uuid>,physical_offer:<uuid>@Bricolage,service:<uuid>@Maison|Bricolage
 *
 * Le suffixe `@Catégorie|Autre catégorie` est optionnel. Il ne prétend pas
 * devenir une vérité métier de l'objet : il exprime uniquement les contextes
 * de navigation dans lesquels `recommendations` est autorisé à projeter ce
 * candidat. Pour Product, la taxonomie source du catalog est également
 * projetée par le composeur.
 *
 * L'ordre de la liste EST l'ordre d'affichage. Le frontend peut prendre le
 * sous-ensemble correspondant à la page catégorie, mais ne re-ranke jamais.
 */

const db = require('../db');
const { composeDiscoveryRail } = require('./discovery-rail-composer');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_KINDS = new Set(['product', 'physical_offer', 'service']);

function isEnabled() {
  const raw = String(process.env.DISCOVERY_RAIL_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function normalizeCategoryKeys(raw) {
  if (!raw) return [];
  return [...new Set(String(raw)
    .split('|')
    .map(value => value.trim().slice(0, 80))
    .filter(Boolean))];
}

function parseEditorialCandidates(raw = process.env.DISCOVERY_RAIL_CANDIDATES) {
  if (!raw) return [];

  const candidates = [];
  const byKey = new Map();

  for (const tokenRaw of String(raw).split(',')) {
    const token = tokenRaw.trim();
    if (!token) continue;

    const scopeSeparator = token.indexOf('@');
    const identity = scopeSeparator >= 0 ? token.slice(0, scopeSeparator) : token;
    const scopeRaw = scopeSeparator >= 0 ? token.slice(scopeSeparator + 1) : '';
    const [kindRaw, idRaw, extra] = identity.split(':');
    const kind = String(kindRaw || '').trim();
    const id = String(idRaw || '').trim();
    if (extra !== undefined || !ALLOWED_KINDS.has(kind) || !UUID_RE.test(id)) continue;

    const key = `${kind}:${id}`;
    const categoryKeys = normalizeCategoryKeys(scopeRaw);
    const existing = byKey.get(key);
    if (existing) {
      existing.categoryKeys = [...new Set([...existing.categoryKeys, ...categoryKeys])];
      continue;
    }

    if (candidates.length >= 12) continue;
    const candidate = { kind, id, key, categoryKeys };
    candidates.push(candidate);
    byKey.set(key, candidate);
  }

  return candidates;
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

function mergeCategoryKeys(card, candidate) {
  const source = Array.isArray(card?.category_keys) ? card.category_keys : [];
  const editorial = Array.isArray(candidate?.categoryKeys) ? candidate.categoryKeys : [];
  return [...new Set([...source, ...editorial]
    .map(value => String(value || '').trim())
    .filter(Boolean))];
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

  // Le composeur groupe ses appels par source. recommendations réapplique
  // l'ordre éditorial et ajoute uniquement son metadata de contexte catégorie.
  // Aucune vérité d'exposabilité ou de disponibilité n'est modifiée.
  const byKey = new Map(cards.map(card => [cardKey(card), card]));
  return candidates
    .map(candidate => {
      const card = byKey.get(candidate.key);
      if (!card) return null;
      return {
        ...card,
        category_keys: mergeCategoryKeys(card, candidate),
      };
    })
    .filter(Boolean);
}

module.exports = {
  isEnabled,
  normalizeCategoryKeys,
  parseEditorialCandidates,
  resolveMarketId,
  getDiscoveryRail,
};
