'use strict';
const { buildProof, assertThrough, summary } = require('../../scripts/provider-contract-proof');

test('missing proof is BLOCKED and cannot be treated as PASS', () => {
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox',
    stages: { P0: [{ id: 'ACCOUNT', pass: true, evidence: 'ok' }] },
  });
  expect(proof.stages.find(stage => stage.id === 'P0').status).toBe('PASS');
  expect(proof.stages.find(stage => stage.id === 'P1').status).toBe('BLOCKED');
  expect(() => assertThrough(proof, 'P1')).toThrow('PROVIDER_CONTRACT_BLOCKED_DEMO_P1_NO_PROOF');
});

test('gate reports the smallest failing upstream contract check', () => {
  const proof = buildProof({
    provider: 'demo', environment: 'sandbox',
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
    provider: 'demo', environment: 'sandbox',
    stages: {
      P0: [{ id: 'ACCOUNT', pass: true }],
      P1: [{ id: 'HTTP', pass: true }],
    },
  });
  expect(assertThrough(proof, 'P1')).toBe(proof);
  expect(summary(proof)).toEqual(expect.objectContaining({
    provider: 'DEMO', environment: 'SANDBOX',
    stages: expect.arrayContaining([
      expect.objectContaining({ id: 'P0', status: 'PASS' }),
      expect.objectContaining({ id: 'P1', status: 'PASS' }),
      expect.objectContaining({ id: 'P2', status: 'BLOCKED' }),
    ]),
  }));
});
