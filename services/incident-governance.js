/**
 * @komerce-arch
 * @role          incident-management-governance-mapping
 * @domain        incident-management
 * @layer         service
 * @criticality   high
 * @inputs        incident_type, reconciliation subtype (details.type)
 * @outputs       origin_domain, resolver_domain, resolution_class
 * @depends       none
 * @used-by       services/incident-write-service.js, services/incident-service.js,
 *                services/parcel-transition-guard.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      F2_INCIDENT_GOVERNANCE_CONTRACT
 * @impact-areas  incident-management, logistics, orders
 * @version       2026-09 (rev.2 — reconciliation_error corrigé en mapping par sous-type)
 *
 * F2 — Incident Governance Contract.
 *
 * Source de vérité UNIQUE du mapping :
 *   incident_type (+ subtype pour reconciliation_error) ->
 *     { origin_domain, resolver_domain, resolution_class }
 *
 * Doctrine :
 *   - origin_domain  : quel domaine possède le fait qui a provoqué l'incident.
 *   - resolver_domain: quel domaine peut fournir la prochaine preuve/vérité
 *                      valide permettant de sortir de l'incident.
 *   - resolution_class:
 *       PHYSICAL_PROOF  -> Logistics peut lui-même produire une nouvelle
 *                          preuve physique (rescan) qui revalide le prédicat.
 *       UPSTREAM_TRUTH  -> Logistics ne possède pas la vérité ; seul le
 *                          domaine amont peut corriger, puis Logistics
 *                          revalide.
 *       UNCLASSIFIED    -> valeur EXPLICITE pour "on ne sait pas" — jamais
 *                          une autorité inventée. Réservée au backfill de
 *                          lignes historiques `reconciliation_error` sans
 *                          sous-type reconnu. Ne doit jamais être produite
 *                          pour un NOUVEL incident (resolveGovernanceOrThrow
 *                          échoue fail-closed dans ce cas).
 *
 * ⚠️ CORRECTIF (revue F2) : `reconciliation_error` n'a PAS un owner unique.
 * services/reconciliation-service.js produit plusieurs sous-types
 * hétérogènes sous ce même incident_type (stockés dans `details.type`), qui
 * n'ont pas tous le même origin_domain/resolver_domain. Le mapping v1 de ce
 * fichier affirmait `reconciliation_error -> ORDERS/ORDERS/UPSTREAM_TRUTH`
 * pour TOUS les sous-types : c'était une autorité inventée, pas observée.
 * Corrigé ci-dessous via RECONCILIATION_SUBTYPE_MAPPING.
 *
 * Mapping confirmé contre le producteur réel `services/reconciliation-service.js` :
 * six sous-types créent effectivement des incidents. `partial_allocation`
 * est un cas normal documenté et ne crée aucun incident ; il est donc
 * volontairement absent du mapping. `parcel_items` est lifecycle-owned par
 * Logistics, ce qui fixe l'autorité des écarts d'allocation.
 *
 * Le reste du mapping (11 types non-reconciliation) couvre exhaustivement
 * les valeurs actives du CHECK constraint `incidents.incident_type`
 * (migrations/022_parcel_first_refactor.sql).
 *
 * hub_relevant = true seulement si origin_domain === 'LOGISTICS'. Un type
 * partageant order_id/parcel_id avec un colis (ex. payment_issue,
 * reconciliation_error) ne devient PAS Hub-relevant par la seule présence de
 * ces clés (doctrine §6 — "Unknown Hub incident = block. Unknown
 * foreign-domain incident = no invented Hub authority.").
 */
'use strict';

const DOMAINS = Object.freeze(['LOGISTICS', 'PAYMENTS', 'ORDERS', 'PURCHASING', 'MARKET', 'UNCLASSIFIED']);
const RESOLUTION_CLASSES = Object.freeze(['PHYSICAL_PROOF', 'UPSTREAM_TRUTH', 'UNCLASSIFIED']);
const UNCLASSIFIED = Object.freeze({
  origin_domain: 'UNCLASSIFIED', resolver_domain: 'UNCLASSIFIED', resolution_class: 'UNCLASSIFIED',
});

const CANONICAL_MAPPING = Object.freeze({
  content_mismatch:   Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  missing_item:       Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  unexpected_item:    Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  damaged_item:       Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  weight_mismatch:    Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  quantity_mismatch:  Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  scan_anomaly:       Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  sequence_violation: Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  delay:              Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  blocked:            Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  payment_issue:      Object.freeze({ origin_domain: 'PAYMENTS', resolver_domain: 'PAYMENTS', resolution_class: 'UPSTREAM_TRUTH' }),
});

const RECONCILIATION_SUBTYPE_MAPPING = Object.freeze({
  quantity_chain_break: Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  status_scan_mismatch: Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  stale_parcel:         Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  over_allocation:      Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  unallocated_item:     Object.freeze({ origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS', resolution_class: 'PHYSICAL_PROOF' }),
  order_status_drift:   Object.freeze({ origin_domain: 'ORDERS', resolver_domain: 'ORDERS', resolution_class: 'UPSTREAM_TRUTH' }),
});

function resolveGovernance(incidentType, context = {}) {
  if (incidentType === 'reconciliation_error') {
    const subtype = context.subtype;
    if (!subtype) return null;
    const mapped = RECONCILIATION_SUBTYPE_MAPPING[subtype];
    if (!mapped) return null;
    return { ...mapped };
  }
  const canonical = CANONICAL_MAPPING[incidentType];
  if (!canonical) return null;
  return { ...canonical };
}

function validateGovernance({ incident_type, subtype, origin_domain, resolver_domain, resolution_class } = {}) {
  const canonical = resolveGovernance(incident_type, { subtype });
  if (!canonical) {
    if (incident_type === 'reconciliation_error') {
      return {
        ok: false,
        reason: subtype ? 'UNKNOWN_RECONCILIATION_SUBTYPE' : 'MISSING_RECONCILIATION_SUBTYPE',
        incident_type, subtype,
      };
    }
    return { ok: false, reason: 'UNKNOWN_INCIDENT_TYPE', incident_type };
  }
  if (origin_domain !== undefined && origin_domain !== null && origin_domain !== canonical.origin_domain) {
    return { ok: false, reason: 'ORIGIN_DOMAIN_MISMATCH', expected: canonical.origin_domain, received: origin_domain };
  }
  if (resolver_domain !== undefined && resolver_domain !== null && resolver_domain !== canonical.resolver_domain) {
    return { ok: false, reason: 'RESOLVER_DOMAIN_MISMATCH', expected: canonical.resolver_domain, received: resolver_domain };
  }
  if (resolution_class !== undefined && resolution_class !== null && resolution_class !== canonical.resolution_class) {
    return { ok: false, reason: 'RESOLUTION_CLASS_MISMATCH', expected: canonical.resolution_class, received: resolution_class };
  }
  return { ok: true, canonical };
}

function resolveGovernanceOrThrow(params = {}) {
  const check = validateGovernance(params);
  if (!check.ok) {
    const suffix = params.subtype ? ` subtype=${params.subtype}` : '';
    const err = new Error(`[incident-governance] ${check.reason} for incident_type=${params.incident_type}${suffix}`);
    err.code = check.reason;
    throw err;
  }
  return check.canonical;
}

function isHubRelevant(incidentType, subtype) {
  const governance = resolveGovernance(incidentType, { subtype });
  return !!governance && governance.origin_domain === 'LOGISTICS';
}

const IRREVERSIBLE_HUB_TRANSITIONS = Object.freeze(['shipped']);
const HUB_TRANSITION_POLICY = Object.freeze({
  content_mismatch: Object.freeze(['shipped']),
  missing_item: Object.freeze(['shipped']),
  unexpected_item: Object.freeze(['shipped']),
  damaged_item: Object.freeze(['shipped']),
  weight_mismatch: Object.freeze(['shipped']),
  quantity_mismatch: Object.freeze(['shipped']),
  scan_anomaly: Object.freeze(['shipped']),
  sequence_violation: Object.freeze(['shipped']),
  delay: Object.freeze([]),
  blocked: Object.freeze(['shipped']),
  reconciliation_error: Object.freeze({
    quantity_chain_break: Object.freeze(['shipped']),
    status_scan_mismatch: Object.freeze(['shipped']),
    stale_parcel: Object.freeze([]),
    over_allocation: Object.freeze(['shipped']),
    unallocated_item: Object.freeze(['shipped']),
  }),
});

function getBlockedTransitions(incidentType, subtype) {
  const policy = HUB_TRANSITION_POLICY[incidentType];
  if (Array.isArray(policy)) return policy;
  if (policy && subtype) return policy[subtype] || null;
  return null;
}

function isIrreversibleTransitionBlocked(openIncidents, targetStatus) {
  if (!IRREVERSIBLE_HUB_TRANSITIONS.includes(targetStatus)) return { blocked: false };

  for (const incident of openIncidents || []) {
    const governance = resolveGovernance(incident.incident_type, { subtype: incident.subtype });
    const persistedOrigin = incident.origin_domain || null;
    const canonicalOrigin = governance && governance.origin_domain;
    const origin = persistedOrigin || canonicalOrigin;

    if (origin && origin !== 'LOGISTICS') continue;
    if (!governance) {
      if (origin === 'LOGISTICS') return { blocked: true, reason: 'UNKNOWN_LOGISTICS_INCIDENT_TYPE', incident };
      continue;
    }
    if (governance.origin_domain !== 'LOGISTICS') continue;

    const blockedTransitions = getBlockedTransitions(incident.incident_type, incident.subtype);
    if (blockedTransitions && blockedTransitions.includes(targetStatus)) {
      return { blocked: true, reason: 'OPEN_HUB_RELEVANT_INCIDENT', incident };
    }
  }
  return { blocked: false };
}

function assertIrreversibleTransitionAllowed(openIncidents, targetStatus) {
  const result = isIrreversibleTransitionBlocked(openIncidents, targetStatus);
  if (result.blocked) {
    const err = new Error(`[incident-governance] transition -> ${targetStatus} bloquée (reason=${result.reason}).`);
    err.code = result.reason;
    err.incident = result.incident;
    throw err;
  }
  return true;
}

const TERMINAL_RESOLUTION_TYPES = Object.freeze(['manual_fix', 'auto_resolved', 'reship', 'refund', 'dismissed']);

function assertTerminalResolutionAllowed(incident, resolutionType) {
  if (!TERMINAL_RESOLUTION_TYPES.includes(resolutionType)) return true;

  const governance = resolveGovernance(incident.incident_type, { subtype: incident.subtype });
  const resolutionClass = incident.resolution_class || (governance && governance.resolution_class);
  const resolverDomain = incident.resolver_domain || (governance && governance.resolver_domain) || 'UNCLASSIFIED';

  if (resolutionClass === 'UNCLASSIFIED') {
    const err = new Error(
      `[incident-governance] ${resolutionType} interdit pour incident_type=${incident.incident_type}` +
      `${incident.subtype ? ' subtype=' + incident.subtype : ''} ` +
      `(resolution_class=UNCLASSIFIED) — l'autorité de résolution historique ` +
      `n'est pas prouvée; classement explicite requis avant fermeture.`
    );
    err.code = 'UNCLASSIFIED_TERMINAL_BYPASS';
    throw err;
  }

  if (resolutionClass === 'UPSTREAM_TRUTH') {
    const err = new Error(
      `[incident-governance] ${resolutionType} interdit pour incident_type=${incident.incident_type}` +
      `${incident.subtype ? ' subtype=' + incident.subtype : ''} ` +
      `(resolution_class=UPSTREAM_TRUTH, resolver_domain=${resolverDomain}) — ` +
      `seul le domaine amont peut corriger cet incident (contrat de correction authoritative F3, non encore implémenté).`
    );
    err.code = 'UPSTREAM_TRUTH_TERMINAL_BYPASS';
    throw err;
  }
  return true;
}

module.exports = {
  DOMAINS,
  RESOLUTION_CLASSES,
  UNCLASSIFIED,
  CANONICAL_MAPPING,
  RECONCILIATION_SUBTYPE_MAPPING,
  HUB_TRANSITION_POLICY,
  TERMINAL_RESOLUTION_TYPES,
  resolveGovernance,
  validateGovernance,
  resolveGovernanceOrThrow,
  isHubRelevant,
  isIrreversibleTransitionBlocked,
  assertIrreversibleTransitionAllowed,
  assertTerminalResolutionAllowed,
};