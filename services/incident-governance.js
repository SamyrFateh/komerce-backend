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
 *                services/parcel-transition-guard.js, services/hub-physical-identity.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      F2_INCIDENT_GOVERNANCE_CONTRACT
 * @impact-areas  incident-management, logistics, orders, purchasing
 * @version       2026-09 (rev.3 — HUB-001 upstream quarantine subtypes)
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
 * `reconciliation_error` n'a PAS un owner unique. Le mapping est donc par
 * sous-type. HUB-001 ajoute trois sous-types upstream uniquement : identité
 * d'achat/SOI et quantité d'achat appartiennent à Purchasing ; destination
 * commerciale appartient à Orders. Le Hub les détecte mais ne les corrige pas.
 *
 * Le reste du mapping couvre les valeurs actives du CHECK constraint
 * `incidents.incident_type` (migrations/022_parcel_first_refactor.sql).
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
  hub_purchase_identity_conflict: Object.freeze({ origin_domain: 'PURCHASING', resolver_domain: 'PURCHASING', resolution_class: 'UPSTREAM_TRUTH' }),
  hub_purchase_quantity_conflict: Object.freeze({ origin_domain: 'PURCHASING', resolver_domain: 'PURCHASING', resolution_class: 'UPSTREAM_TRUTH' }),
  hub_destination_conflict:       Object.freeze({ origin_domain: 'ORDERS', resolver_domain: 'ORDERS', resolution_class: 'UPSTREAM_TRUTH' }),
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
      `seul le domaine amont peut corriger cet incident; Hub ne peut le fermer qu'après vérité authoritative corrigée et revalidation.`
    );
    err.code = 'UPSTREAM_TRUTH_TERMINAL_BYPASS';
    throw err;
  }

  if (resolutionClass === 'PHYSICAL_PROOF') {
    const err = new Error(
      `[incident-governance] ${resolutionType} interdit pour incident_type=${incident.incident_type} ` +
      `(resolution_class=PHYSICAL_PROOF) — une fermeture physique exige une nouvelle preuve scan_events ` +
      `et la revalidation synchrone du prédicat original.`
    );
    err.code = 'PHYSICAL_PROOF_TERMINAL_BYPASS';
    throw err;
  }
  return true;
}

/*
 * F3 — SLA policy.
 *
 * Smallest explicit policy, not a generic SLA engine: duration is a pure
 * function of resolution_class only (§2 of the F3 mandate — no repo
 * convention existed to build on, so this is the smallest explicit policy,
 * documented here rather than invented silently).
 *
 *   PHYSICAL_PROOF -> short operational SLA: Logistics owns the next scan,
 *                     can act same-day.
 *   UPSTREAM_TRUTH -> domain correction SLA: a different domain must act
 *                     first, then Logistics revalidates — longer window.
 *
 * UNCLASSIFIED is intentionally absent: resolveGovernanceOrThrow() never
 * produces UNCLASSIFIED for a NEW incident (fail-closed), so no new incident
 * can reach computeDueAt() with an unknown authority. Historical UNCLASSIFIED
 * rows keep due_at = NULL (never backfilled — same reasoning as F2).
 */
const SLA_DURATION_MS = Object.freeze({
  PHYSICAL_PROOF: 24 * 60 * 60 * 1000,
  UPSTREAM_TRUTH: 72 * 60 * 60 * 1000,
});

function computeDueAt(resolutionClass, fromDate = new Date()) {
  const durationMs = SLA_DURATION_MS[resolutionClass];
  if (!durationMs) return null;
  return new Date(fromDate.getTime() + durationMs);
}

/*
 * F3 — resolver_domain -> Action Center owner_role.
 *
 * The durable operational sink for escalation delivery is the existing
 * `signals` table (services/signal-service.js#upsertSignal), already
 * idempotent on (signal_type, market_id, entity_type, entity_id) and already
 * rendered by the Action Center. owner_role there is role-based
 * (hub/relais/sourcing/admin); this maps F2's domain authority onto it so
 * escalation reaches the resolver's actual operational surface instead of a
 * generic admin queue. No new sink is created (§20 of the F3 mandate).
 */
const RESOLVER_DOMAIN_TO_OWNER_ROLE = Object.freeze({
  LOGISTICS: 'hub',
  PAYMENTS: 'admin',
  ORDERS: 'admin',
  PURCHASING: 'sourcing',
  MARKET: 'admin',
  UNCLASSIFIED: 'admin',
});

function resolverDomainToOwnerRole(resolverDomain) {
  return RESOLVER_DOMAIN_TO_OWNER_ROLE[resolverDomain] || 'admin';
}

module.exports = {
  DOMAINS,
  RESOLUTION_CLASSES,
  UNCLASSIFIED,
  CANONICAL_MAPPING,
  RECONCILIATION_SUBTYPE_MAPPING,
  HUB_TRANSITION_POLICY,
  TERMINAL_RESOLUTION_TYPES,
  SLA_DURATION_MS,
  RESOLVER_DOMAIN_TO_OWNER_ROLE,
  resolveGovernance,
  validateGovernance,
  resolveGovernanceOrThrow,
  isHubRelevant,
  isIrreversibleTransitionBlocked,
  assertIrreversibleTransitionAllowed,
  assertTerminalResolutionAllowed,
  computeDueAt,
  resolverDomainToOwnerRole,
};