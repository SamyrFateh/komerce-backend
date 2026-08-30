'use strict';

const {
  CONTRACTS,
  DASHBOARD_METRICS,
  CI_REQUIRED,
  backendDebtCode,
  remediationForBackendDebt,
  remediationForGateFinding,
} = require('../../scripts/agent-remediation-contract.js');

describe('B5 agent remediation contract', () => {
  test('every contract is agent-actionable and forbids baseline inflation', () => {
    for (const [code, rule] of Object.entries(CONTRACTS)) {
      expect(code).toMatch(/^[A-Z0-9-]+$/);
      expect(['backend', 'dashboard', 'boutique', 'governance']).toContain(rule.scope);
      expect(rule.owner).toBeTruthy();
      expect(rule.cause).toBeTruthy();
      expect(rule.action).toBeTruthy();
      expect(rule.forbidden).toBeTruthy();
      expect(rule.baselinePolicy).toBe('never-increase-to-pass');
    }
  });

  test('all dashboard measured metrics have remediation codes', () => {
    expect(DASHBOARD_METRICS).toEqual(expect.objectContaining({
      orphanRoutes: 'DASH-ORPHAN-ROUTE',
      deadApiMethods: 'DASH-DEAD-API-METHOD',
      missingApiMethods: 'DASH-MISSING-API-METHOD',
      doctrineViolations: 'DASH-DOCTRINE-FETCH',
      unprovenContracts: 'DASH-UNPROVEN-CONTRACT',
    }));
    Object.values(DASHBOARD_METRICS).forEach(code => expect(CONTRACTS[code]).toBeTruthy());
  });

  test('reviewed backend exceptions are information, not open debt', () => {
    const debt = { rule: 'I-BACK-2 (reviewed)', count: 1, entries: ['services/scan-engine.js'] };
    expect(backendDebtCode(debt)).toBe('BACKEND-REVIEWED-EXCEPTION');
    const rem = remediationForBackendDebt(debt);
    expect(rem.severity).toBe('info');
    expect(rem.autoRemediation).toBe(false);
  });

  test('open backend debt remains actionable', () => {
    const debt = { rule: 'I-BACK-7', count: 2, entries: ['routes/a.js'], note: 'remove console.log' };
    const rem = remediationForBackendDebt(debt);
    expect(rem.code).toBe('BACKEND-ARCH');
    expect(rem.action).toBeTruthy();
    expect(rem.evidence.entries).toEqual(['routes/a.js']);
  });

  test('gate findings resolve by scope and gate family', () => {
    expect(remediationForGateFinding({ gate: 'check:css-guard', scope: 'boutique' }).code)
      .toBe('BOUTIQUE-CASCADE');
    expect(remediationForGateFinding({ gate: 'gate:feature-registry-check', scope: 'root' }).code)
      .toBe('BACKEND-FEATURE-OWNERSHIP');
    expect(remediationForGateFinding({ type: 'missingApiMethods', scope: 'dashboard' }).code)
      .toBe('DASH-MISSING-API-METHOD');
  });

  test('critical CI families are declared once with a known contract', () => {
    const needles = new Set();
    for (const item of CI_REQUIRED) {
      expect(CONTRACTS[item.code]).toBeTruthy();
      expect(needles.has(item.needle)).toBe(false);
      needles.add(item.needle);
    }
  });
});
