'use strict';
const {
  buildConversation,
  buildProof,
  assertConversation,
  assertThrough,
  summary,
} = require('../../scripts/provider-contract-proof');

function completeConversation(overrides = {}) {
  const phases = {
    EXPECTS: [{ id: 'CANONICAL_RESULT', state: 'KNOWN', evidence: 'contract' }],
    REQUIRES: [{ id: 'PROVIDER_INPUT', state: 'KNOWN', evidence: 'provider-doc' }],
    SENDS: [{ id: 'REQUEST', state: 'KNOWN', evidence: 'bounded-request' }],
    RECEIVES: [{ id: 'RESPONSE', state: 'KNOWN', evidence: 'bounded-response' }],
    CONFIRMS: [{ id: 'READ_BACK', state: 'KNOWN', evidence: 'provider-state' }],
    EXPOSES: [{ id: 'NEXT_LAYER_OUTPUT', state: 'DERIVED', evidence: 'response+read-back' }],
    ...(overrides.phases || {}),
  };
  return buildConversation({ operation: overrides.operation || 'DEMO_OPERATION', phases });
}

test('missing conversation is BLOCKED before stage proof', () => {
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox',
    stages: { P0: [{ id: 'ACCOUNT', pass: true, evidence: 'ok' }] },
  });
  expect(proof.conversation.status).toBe('BLOCKED');
  expect(() => assertThrough(proof, 'P0')).toThrow('PROVIDER_CONVERSATION_BLOCKED_DEMO_EXPECTS_NO_PROOF');
});

test('UNKNOWN conversation fact blocks at the smallest incomplete phase', () => {
  const conversation = completeConversation({
    phases: { CONFIRMS: [{ id: 'PROVIDER_STATE', state: 'UNKNOWN', evidence: 'detail endpoint not read' }] },
  });
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox', conversation,
    stages: { P0: [{ id: 'ACCOUNT', pass: true }] },
  });
  expect(() => assertConversation(proof)).toThrow('PROVIDER_CONVERSATION_BLOCKED_DEMO_CONFIRMS_PROVIDER_STATE');
});

test('DERIVED conversation facts require evidence', () => {
  expect(() => buildConversation({
    operation: 'demo',
    phases: {
      EXPECTS: [{ id: 'x', state: 'DERIVED' }],
    },
  })).toThrow('PROVIDER_CONVERSATION_DERIVED_EVIDENCE_REQUIRED_X');
});

test('known negative facts keep the conversation complete', () => {
  const conversation = completeConversation({
    phases: { EXPOSES: [{ id: 'ELIGIBLE_RATE', state: 'KNOWN', evidence: 'NONE_OBSERVED' }] },
  });
  expect(conversation.status).toBe('PASS');
});

test('missing stage proof is BLOCKED and cannot be treated as PASS', () => {
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox', conversation: completeConversation(),
    stages: { P0: [{ id: 'ACCOUNT', pass: true, evidence: 'ok' }] },
  });
  expect(proof.stages.find(stage => stage.id === 'P0').status).toBe('PASS');
  expect(proof.stages.find(stage => stage.id === 'P1').status).toBe('BLOCKED');
  expect(() => assertThrough(proof, 'P1')).toThrow('PROVIDER_CONTRACT_BLOCKED_DEMO_P1_NO_PROOF');
});

test('gate reports the smallest failing upstream contract check', () => {
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox', conversation: completeConversation(),
    stages: {
      P0: [
        { id: 'ACCOUNT', pass: true, evidence: 'seller' },
        { id: 'SHIPPING', pass: false, evidence: '0 eligible rates' },
      ],
      P1: [{ id: 'HTTP', pass: true, evidence: '200' }],
    },
  });
  expect(() => assertThrough(proof, 'P1')).toThrow('PROVIDER_CONTRACT_BLOCKED_DEMO_P0_SHIPPING');
});

test('a bounded assertion does not pretend later stages are already proved', () => {
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox', conversation: completeConversation(),
    stages: {
      P0: [{ id: 'ACCOUNT', pass: true }],
      P1: [{ id: 'HTTP', pass: true }],
    },
  });
  expect(assertThrough(proof, 'P1')).toBe(proof);
  expect(summary(proof)).toEqual(expect.objectContaining({
    provider: 'DEMO', environment: 'SANDBOX',
    conversation: expect.objectContaining({ operation: 'DEMO_OPERATION', status: 'PASS' }),
    stages: expect.arrayContaining([
      expect.objectContaining({ id: 'P0', status: 'PASS' }),
      expect.objectContaining({ id: 'P1', status: 'PASS' }),
      expect.objectContaining({ id: 'P2', status: 'BLOCKED' }),
    ]),
  }));
});
