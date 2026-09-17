/**
 * @komerce-arch
 * @role          provider-contract-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        normalized provider conversation plus contract checks grouped by proof stage
 * @outputs       fail-closed conversation/proof report and stage assertion
 * @depends       none
 * @used-by       provider sandbox probes and Golden E2E runners
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  sourcing, purchasing, supplier-integration, tests
 */
'use strict';

const STAGES = Object.freeze([
  Object.freeze({ id: 'P0', name: 'BUSINESS_READINESS' }),
  Object.freeze({ id: 'P1', name: 'RAW_API' }),
  Object.freeze({ id: 'P2', name: 'ADAPTER' }),
  Object.freeze({ id: 'P3', name: 'PIPELINE' }),
  Object.freeze({ id: 'P4', name: 'GOLDEN_E2E' }),
]);

const CONVERSATION_PHASES = Object.freeze([
  'EXPECTS',
  'REQUIRES',
  'SENDS',
  'RECEIVES',
  'CONFIRMS',
  'EXPOSES',
]);
const FACT_STATES = Object.freeze(['KNOWN', 'DERIVED', 'UNKNOWN']);
const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage.id, index]));
const SAFE_ID = /^[A-Z0-9_][A-Z0-9_.-]{0,119}$/;

function safeId(value, label) {
  const id = String(value || '').trim().toUpperCase();
  if (!SAFE_ID.test(id)) throw new Error(`PROVIDER_CONTRACT_${label}_INVALID`);
  return id;
}

function safeEvidence(value) {
  if (value == null) return null;
  const evidence = String(value).trim().slice(0, 240);
  return evidence || null;
}

function normalizeFact(fact) {
  if (!fact || typeof fact !== 'object') throw new Error('PROVIDER_CONVERSATION_FACT_INVALID');
  const id = safeId(fact.id, 'FACT_ID');
  const state = safeId(fact.state, 'FACT_STATE');
  if (!FACT_STATES.includes(state)) throw new Error(`PROVIDER_CONVERSATION_FACT_STATE_INVALID_${id}`);
  const evidence = safeEvidence(fact.evidence);
  if (state === 'DERIVED' && !evidence) throw new Error(`PROVIDER_CONVERSATION_DERIVED_EVIDENCE_REQUIRED_${id}`);
  return Object.freeze({ id, state, evidence });
}

function buildConversation({ operation, phases }) {
  const operationId = safeId(operation, 'OPERATION');
  const source = phases && typeof phases === 'object' ? phases : {};
  const normalizedPhases = CONVERSATION_PHASES.map(id => {
    const facts = (Array.isArray(source[id]) ? source[id] : []).map(normalizeFact);
    const status = facts.length > 0 && facts.every(fact => fact.state !== 'UNKNOWN') ? 'PASS' : 'BLOCKED';
    return Object.freeze({ id, status, facts });
  });
  const status = normalizedPhases.every(phase => phase.status === 'PASS') ? 'PASS' : 'BLOCKED';
  return Object.freeze({ operation: operationId, status, phases: normalizedPhases });
}

function normalizeCheck(check) {
  if (!check || typeof check !== 'object') throw new Error('PROVIDER_CONTRACT_CHECK_INVALID');
  const id = safeId(check.id, 'CHECK_ID');
  if (typeof check.pass !== 'boolean') throw new Error(`PROVIDER_CONTRACT_CHECK_RESULT_INVALID_${id}`);
  return Object.freeze({ id, pass: check.pass, evidence: safeEvidence(check.evidence) });
}

function buildProof({ provider, environment, conversation, stages }) {
  const providerId = safeId(provider, 'PROVIDER');
  const environmentId = safeId(environment, 'ENVIRONMENT');
  const normalizedConversation = conversation && conversation.operation && Array.isArray(conversation.phases)
    ? conversation
    : buildConversation(conversation || { operation: 'UNSPECIFIED', phases: {} });
  const source = stages && typeof stages === 'object' ? stages : {};
  const normalizedStages = STAGES.map(stage => {
    const checks = (Array.isArray(source[stage.id]) ? source[stage.id] : []).map(normalizeCheck);
    const status = checks.length > 0 && checks.every(check => check.pass) ? 'PASS' : 'BLOCKED';
    return Object.freeze({ id: stage.id, name: stage.name, status, checks });
  });
  return Object.freeze({
    provider: providerId,
    environment: environmentId,
    conversation: normalizedConversation,
    stages: normalizedStages,
  });
}

function assertConversation(proof) {
  if (!proof || !proof.conversation || !Array.isArray(proof.conversation.phases)) {
    throw new Error('PROVIDER_CONTRACT_PROOF_INVALID');
  }
  if (proof.conversation.status === 'PASS') return proof;
  const blockedPhase = proof.conversation.phases.find(phase => phase.status !== 'PASS');
  const unknown = blockedPhase?.facts.find(fact => fact.state === 'UNKNOWN');
  const factId = unknown?.id || 'NO_PROOF';
  const phaseId = blockedPhase?.id || 'CONVERSATION';
  throw new Error(`PROVIDER_CONVERSATION_BLOCKED_${proof.provider}_${phaseId}_${factId}`);
}

function assertThrough(proof, through = 'P1') {
  if (!proof || !Array.isArray(proof.stages)) throw new Error('PROVIDER_CONTRACT_PROOF_INVALID');
  assertConversation(proof);
  const target = safeId(through, 'STAGE');
  const targetIndex = STAGE_INDEX.get(target);
  if (targetIndex == null) throw new Error(`PROVIDER_CONTRACT_STAGE_UNKNOWN_${target}`);

  for (const stage of proof.stages.slice(0, targetIndex + 1)) {
    if (stage.status === 'PASS') continue;
    const failed = stage.checks.find(check => !check.pass);
    const checkId = failed?.id || 'NO_PROOF';
    throw new Error(`PROVIDER_CONTRACT_BLOCKED_${proof.provider}_${stage.id}_${checkId}`);
  }
  return proof;
}

function conversationSummary(conversation) {
  return {
    operation: conversation.operation,
    status: conversation.status,
    phases: conversation.phases.map(phase => ({
      id: phase.id,
      status: phase.status,
      unknown_facts: phase.facts.filter(fact => fact.state === 'UNKNOWN').map(fact => fact.id),
    })),
  };
}

function summary(proof) {
  if (!proof || !Array.isArray(proof.stages) || !proof.conversation) throw new Error('PROVIDER_CONTRACT_PROOF_INVALID');
  return {
    provider: proof.provider,
    environment: proof.environment,
    conversation: conversationSummary(proof.conversation),
    stages: proof.stages.map(stage => ({
      id: stage.id,
      name: stage.name,
      status: stage.status,
      failed_checks: stage.checks.filter(check => !check.pass).map(check => check.id),
    })),
  };
}

module.exports = {
  STAGES,
  CONVERSATION_PHASES,
  FACT_STATES,
  buildConversation,
  buildProof,
  assertConversation,
  assertThrough,
  summary,
};
