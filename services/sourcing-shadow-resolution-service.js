/**
 * @komerce-arch
 * @role          sourcing-shadow-resolution-owner
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        immutable_observations, rebuildable_evidence, canonical_identity_shadow
 * @outputs       evidence, match_proposals, resolution_decisions, bindings, canonical_entities
 * @depends       db.js, node:crypto, services/sourcing-resolution-evidence.js
 * @used-by       services/sourcing-observation-shadow-service.js
 * @db-read       sourcing_captures, sourcing_observations, sourcing_observation_evidence, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_resolution_bindings, sourcing_resolution_decisions
 * @db-write      sourcing_observation_evidence, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_match_proposals, sourcing_resolution_decisions, sourcing_resolution_bindings
 * @db-txn        owned
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md, docs/doctrine/DOCTRINE_SOURCE_SHADOW_RESOLUTION.md
 * @impact-areas  sourcing, supplier-import
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const { extractObservationEvidence, scoreCandidate, chooseResolutionRoute } = require('./sourcing-resolution-evidence');

const EXTRACTOR_VERSION = 'shadow-evidence-v1';
const MATCHER_VERSION = 'shadow-matcher-v1';
const RESOLVER_VERSION = 'shadow-resolution-v1';
const MAX_CANDIDATES = 24;

function refKind(grain) {
  return `${grain}.source_ref`;
}

async function loadCaptureObservations(client, captureId) {
  const result = await client.query(
    `SELECT o.observation_id, o.capture_id, o.grain::text AS grain,
            o.source_ref, o.principal_ref, o.parent_observation_id,
            o.observed_at, o.normalized, c.source_id
       FROM sourcing_observations o
       JOIN sourcing_captures c ON c.capture_id = o.capture_id
      WHERE o.capture_id = $1
      ORDER BY CASE o.grain::text WHEN 'product' THEN 1 WHEN 'offer' THEN 2 WHEN 'unit' THEN 3 ELSE 4 END,
               o.created_at, o.observation_id`,
    [captureId]
  );
  return result.rows || [];
}

async function persistEvidence(client, observation, evidence) {
  for (const item of evidence) {
    await client.query(
      `INSERT INTO sourcing_observation_evidence
         (observation_id, evidence_type, evidence_key, value, extractor_version)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (observation_id, evidence_type, evidence_key, value, extractor_version)
       DO NOTHING`,
      [observation.observation_id, item.evidence_type, item.evidence_key, item.value, EXTRACTOR_VERSION]
    );
  }
  return evidence.length;
}

async function activeBinding(client, observationId) {
  const result = await client.query(
    `SELECT canonical_entity_id FROM sourcing_resolution_bindings
      WHERE observation_id = $1 AND ended_at IS NULL LIMIT 1`,
    [observationId]
  );
  return result.rows?.[0]?.canonical_entity_id || null;
}

async function existingResolverDecision(client, observationId) {
  const result = await client.query(
    `SELECT decision_id, decision_type, canonical_entity_id
       FROM sourcing_resolution_decisions
      WHERE observation_id = $1 AND actor_type = 'rule' AND actor_ref = $2
      ORDER BY created_at DESC LIMIT 1`,
    [observationId, RESOLVER_VERSION]
  );
  return result.rows?.[0] || null;
}

async function parentCanonical(client, observation) {
  if (observation.grain === 'product') return null;
  if (!observation.parent_observation_id) return null;
  return activeBinding(client, observation.parent_observation_id);
}

async function exactRefCandidates(client, observation, parentEntityId) {
  if (!observation.source_ref) return [];
  const result = await client.query(
    `SELECT ce.canonical_entity_id
       FROM sourcing_canonical_entity_refs cer
       JOIN sourcing_canonical_entities ce ON ce.canonical_entity_id = cer.canonical_entity_id
      WHERE cer.source_id = $1 AND cer.ref_kind = $2 AND cer.ref_value = $3
        AND ce.grain::text = $4 AND ce.status = 'active'
        AND ($5::uuid IS NULL OR ce.parent_entity_id = $5::uuid)
      LIMIT 2`,
    [observation.source_id, refKind(observation.grain), observation.source_ref, observation.grain, parentEntityId]
  );
  return result.rows || [];
}

async function evidenceCandidates(client, observation) {
  if (observation.grain !== 'product') return [];
  const result = await client.query(
    `SELECT DISTINCT rb.canonical_entity_id
       FROM sourcing_observation_evidence current_e
       JOIN sourcing_observation_evidence previous_e
         ON previous_e.evidence_type = current_e.evidence_type
        AND previous_e.evidence_key = current_e.evidence_key
        AND previous_e.value = current_e.value
        AND previous_e.observation_id <> current_e.observation_id
       JOIN sourcing_resolution_bindings rb
         ON rb.observation_id = previous_e.observation_id AND rb.ended_at IS NULL
       JOIN sourcing_canonical_entities ce
         ON ce.canonical_entity_id = rb.canonical_entity_id AND ce.status = 'active'
      WHERE current_e.observation_id = $1
        AND ce.grain::text = 'product'
        AND (current_e.evidence_type = 'deterministic_id'
          OR (current_e.evidence_type = 'lexical' AND current_e.evidence_key IN ('brand_model','product_name')))
      LIMIT $2`,
    [observation.observation_id, MAX_CANDIDATES]
  );
  return result.rows || [];
}

async function offerContextCandidates(client, observation, parentEntityId) {
  if (observation.grain !== 'offer' || !parentEntityId) return [];
  const result = await client.query(
    `SELECT DISTINCT ce.canonical_entity_id
       FROM sourcing_canonical_entities ce
       JOIN sourcing_resolution_bindings rb
         ON rb.canonical_entity_id = ce.canonical_entity_id AND rb.ended_at IS NULL
       JOIN sourcing_observations prior_o ON prior_o.observation_id = rb.observation_id
       JOIN sourcing_captures prior_c ON prior_c.capture_id = prior_o.capture_id
      WHERE ce.grain::text = 'offer' AND ce.status = 'active'
        AND ce.parent_entity_id = $1 AND prior_c.source_id = $2
      LIMIT $3`,
    [parentEntityId, observation.source_id, MAX_CANDIDATES]
  );
  return result.rows || [];
}

async function unitContextCandidates(client, observation, parentEntityId, currentEvidence) {
  if (observation.grain !== 'unit' || observation.source_ref || !parentEntityId) return [];
  const signature = currentEvidence.find((e) => e.evidence_type === 'lexical' && e.evidence_key === 'option_signature');
  if (!signature) return [];
  const result = await client.query(
    `SELECT DISTINCT ce.canonical_entity_id
       FROM sourcing_canonical_entities ce
       JOIN sourcing_resolution_bindings rb
         ON rb.canonical_entity_id = ce.canonical_entity_id AND rb.ended_at IS NULL
       JOIN sourcing_observation_evidence e ON e.observation_id = rb.observation_id
      WHERE ce.grain::text = 'unit' AND ce.status = 'active'
        AND ce.parent_entity_id = $1
        AND e.evidence_type = 'lexical' AND e.evidence_key = 'option_signature' AND e.value = $2
      LIMIT $3`,
    [parentEntityId, signature.value, MAX_CANDIDATES]
  );
  return result.rows || [];
}

async function candidateEvidence(client, canonicalEntityId) {
  const result = await client.query(
    `SELECT DISTINCT e.evidence_type, e.evidence_key, e.value
       FROM sourcing_resolution_bindings rb
       JOIN sourcing_observation_evidence e ON e.observation_id = rb.observation_id
      WHERE rb.canonical_entity_id = $1 AND rb.ended_at IS NULL`,
    [canonicalEntityId]
  );
  return result.rows || [];
}

async function retrieveAndScoreCandidates(client, observation, parentEntityId, currentEvidence) {
  const byId = new Map();
  const remember = (rows, hint) => {
    for (const row of rows) {
      const id = row.canonical_entity_id;
      if (!id) continue;
      const current = byId.get(id) || { canonical_entity_id: id, sourceRefExact: false, contextExact: false };
      if (hint === 'source_ref') current.sourceRefExact = true;
      if (hint === 'context') current.contextExact = true;
      byId.set(id, current);
    }
  };

  remember(await exactRefCandidates(client, observation, parentEntityId), 'source_ref');
  remember(await evidenceCandidates(client, observation), 'evidence');
  remember(await offerContextCandidates(client, observation, parentEntityId), 'context');
  remember(await unitContextCandidates(client, observation, parentEntityId, currentEvidence), 'context');

  const scored = [];
  for (const candidate of [...byId.values()].slice(0, MAX_CANDIDATES)) {
    const previousEvidence = await candidateEvidence(client, candidate.canonical_entity_id);
    scored.push({
      canonical_entity_id: candidate.canonical_entity_id,
      ...scoreCandidate(currentEvidence, previousEvidence, {
        sourceRefExact: candidate.sourceRefExact,
        contextExact: candidate.contextExact,
      }),
    });
  }
  return scored;
}

async function insertProposal(client, runId, observation, candidate, currentEvidence) {
  const snapshot = {
    matcher_version: MATCHER_VERSION,
    source_ref_exact: candidate.source_ref_exact,
    context_exact: candidate.context_exact,
    gtin_exact: candidate.gtin_exact,
    mpn_exact: candidate.mpn_exact,
    brand_exact: candidate.brand_exact,
    current_evidence: currentEvidence,
    matched_evidence: candidate.matched_evidence,
    contradictions: candidate.contradictions,
  };
  const result = await client.query(
    `INSERT INTO sourcing_match_proposals
       (proposal_run_id, observation_id, grain, candidate_entity_id, matcher_version,
        support_score, contradiction_score, coverage_score, evidence_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     RETURNING proposal_id`,
    [runId, observation.observation_id, observation.grain, candidate.canonical_entity_id,
      MATCHER_VERSION, candidate.support_score, candidate.contradiction_score,
      candidate.coverage_score, JSON.stringify(snapshot)]
  );
  return result.rows[0].proposal_id;
}

async function createCanonical(client, observation, parentEntityId) {
  const result = await client.query(
    `INSERT INTO sourcing_canonical_entities (grain, parent_entity_id)
     VALUES ($1,$2) RETURNING canonical_entity_id`,
    [observation.grain, parentEntityId]
  );
  return result.rows[0].canonical_entity_id;
}

async function attachSourceRef(client, observation, canonicalEntityId) {
  if (!observation.source_ref) return;
  const kind = refKind(observation.grain);
  const existing = await client.query(
    `SELECT canonical_entity_id FROM sourcing_canonical_entity_refs
      WHERE source_id = $1 AND ref_kind = $2 AND ref_value = $3`,
    [observation.source_id, kind, observation.source_ref]
  );
  const existingId = existing.rows?.[0]?.canonical_entity_id;
  if (existingId && existingId !== canonicalEntityId) {
    const err = new Error('source ref deja liee a une autre identite canonique shadow');
    err.code = 'SHADOW_RESOLUTION_REF_CONFLICT';
    throw err;
  }
  if (!existingId) {
    await client.query(
      `INSERT INTO sourcing_canonical_entity_refs
         (canonical_entity_id, source_id, ref_kind, ref_value)
       VALUES ($1,$2,$3,$4)`,
      [canonicalEntityId, observation.source_id, kind, observation.source_ref]
    );
  }
}

async function insertDecision(client, observation, decisionType, canonicalEntityId, proposalId, rationale, snapshot) {
  const result = await client.query(
    `INSERT INTO sourcing_resolution_decisions
       (decision_type, grain, proposal_id, observation_id, canonical_entity_id,
        actor_type, actor_ref, rationale, evidence_snapshot)
     VALUES ($1,$2,$3,$4,$5,'rule',$6,$7,$8::jsonb)
     RETURNING decision_id`,
    [decisionType, observation.grain, proposalId || null, observation.observation_id,
      canonicalEntityId || null, RESOLVER_VERSION, rationale, JSON.stringify(snapshot || {})]
  );
  return result.rows[0].decision_id;
}

async function bindObservation(client, observation, canonicalEntityId, decisionId) {
  await client.query(
    `INSERT INTO sourcing_resolution_bindings
       (observation_id, grain, canonical_entity_id, asserted_by_decision_id)
     VALUES ($1,$2,$3,$4)`,
    [observation.observation_id, observation.grain, canonicalEntityId, decisionId]
  );
}

async function resolveObservation(client, observation, runId) {
  const currentEvidence = extractObservationEvidence(observation);
  const evidenceCount = await persistEvidence(client, observation, currentEvidence);

  if (await activeBinding(client, observation.observation_id)) {
    return { outcome: 'already_resolved', evidence: evidenceCount, proposals: 0 };
  }
  if (await existingResolverDecision(client, observation.observation_id)) {
    return { outcome: 'already_decided', evidence: evidenceCount, proposals: 0 };
  }

  const parentEntityId = await parentCanonical(client, observation);
  if (observation.grain !== 'product' && !parentEntityId) {
    return { outcome: 'deferred_parent', evidence: evidenceCount, proposals: 0 };
  }

  const candidates = await retrieveAndScoreCandidates(client, observation, parentEntityId, currentEvidence);
  let proposalCount = 0;
  for (const candidate of candidates) {
    candidate.proposal_id = await insertProposal(client, runId, observation, candidate, currentEvidence);
    proposalCount++;
  }

  const route = chooseResolutionRoute(candidates);
  const auditSnapshot = {
    resolver_version: RESOLVER_VERSION,
    matcher_version: MATCHER_VERSION,
    route: route.reason,
    candidates: candidates.map((candidate) => ({
      canonical_entity_id: candidate.canonical_entity_id,
      proposal_id: candidate.proposal_id,
      support_score: candidate.support_score,
      contradiction_score: candidate.contradiction_score,
      coverage_score: candidate.coverage_score,
      source_ref_exact: candidate.source_ref_exact,
      context_exact: candidate.context_exact,
      gtin_exact: candidate.gtin_exact,
    })),
    evidence: currentEvidence,
  };

  if (route.action === 'NEW_CANONICAL') {
    const canonicalEntityId = await createCanonical(client, observation, parentEntityId);
    await attachSourceRef(client, observation, canonicalEntityId);
    const decisionId = await insertDecision(
      client, observation, 'LINK', canonicalEntityId, null,
      `${RESOLVER_VERSION}: nouvelle identite canonique, aucun candidat retrouve`, auditSnapshot
    );
    await bindObservation(client, observation, canonicalEntityId, decisionId);
    return { outcome: 'new_canonical', canonical_entity_id: canonicalEntityId, evidence: evidenceCount, proposals: proposalCount };
  }

  if (route.action === 'LINK') {
    const candidate = route.candidate;
    await attachSourceRef(client, observation, candidate.canonical_entity_id);
    const decisionId = await insertDecision(
      client, observation, 'LINK', candidate.canonical_entity_id, candidate.proposal_id,
      `${RESOLVER_VERSION}: ${route.reason}`, auditSnapshot
    );
    await bindObservation(client, observation, candidate.canonical_entity_id, decisionId);
    return { outcome: 'linked', canonical_entity_id: candidate.canonical_entity_id, evidence: evidenceCount, proposals: proposalCount, route: route.reason };
  }

  const candidate = route.candidate;
  await insertDecision(
    client, observation, 'REVIEW_REQUIRED', candidate?.canonical_entity_id || null,
    candidate?.proposal_id || null, `${RESOLVER_VERSION}: ${route.reason}`, auditSnapshot
  );
  return { outcome: 'review_required', evidence: evidenceCount, proposals: proposalCount, route: route.reason };
}

async function resolveCaptureShadow(captureId) {
  if (!captureId) throw new Error('captureId requis pour la resolution shadow');
  const client = await db.getClient();
  const runId = crypto.randomUUID();
  try {
    await client.query('BEGIN');
    const observations = await loadCaptureObservations(client, captureId);
    if (!observations.length) {
      await client.query('COMMIT');
      return { status: 'skipped', reason: 'empty_capture', capture_id: captureId, observations: 0 };
    }

    const summary = {
      status: 'resolved', capture_id: captureId, resolver_version: RESOLVER_VERSION,
      observations: observations.length, evidence: 0, proposals: 0,
      new_canonical: 0, linked: 0, review_required: 0,
      deferred_parent: 0, already_resolved: 0,
    };

    for (const observation of observations) {
      const result = await resolveObservation(client, observation, runId);
      summary.evidence += result.evidence || 0;
      summary.proposals += result.proposals || 0;
      if (result.outcome === 'new_canonical') summary.new_canonical++;
      else if (result.outcome === 'linked') summary.linked++;
      else if (result.outcome === 'review_required') summary.review_required++;
      else if (result.outcome === 'deferred_parent') summary.deferred_parent++;
      else if (result.outcome === 'already_resolved' || result.outcome === 'already_decided') summary.already_resolved++;
    }

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  EXTRACTOR_VERSION,
  MATCHER_VERSION,
  RESOLVER_VERSION,
  resolveCaptureShadow,
  _resolveObservation: resolveObservation,
  _loadCaptureObservations: loadCaptureObservations,
};
