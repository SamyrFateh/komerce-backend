'use strict';

const { buildPlan } = require('../../scripts/pr-preflight');

function labels(scope) {
  return buildPlan({
    backend: false,
    dashboard: false,
    boutique: false,
    governance: false,
    migrations: false,
    changedFiles: [],
    ...scope,
  }, 'base-sha', 'head-sha').map(step => step.label);
}

test('preflight garde un socle unique de gates carte-first et debt-zero', () => {
  expect(labels({})).toEqual(expect.arrayContaining([
    'Feature registry',
    'Feature card schema',
    'Touched files ownership',
    'Docs history',
    'Feature audit',
    'Debt Zero',
  ]));
});

test('preflight backend ajoute les preuves rapides sans lancer le from-scratch DB', () => {
  const plan = labels({ backend: true });
  expect(plan).toEqual(expect.arrayContaining([
    'Touched tests / completion-at-contact',
    'Backend code quality',
    'Backend feature guard',
    'Contract consumer check',
  ]));
  expect(plan.join(' ')).not.toMatch(/From-scratch|integration|E2E API/i);
});

test('preflight gouvernance réutilise les gates architecture existants', () => {
  expect(labels({ governance: true })).toEqual(expect.arrayContaining([
    'Architecture graph refresh',
    'Architecture header hygiene',
    'Headers ↔ SQL',
    'Business graph ratchet',
  ]));
});

test('preflight boutique réutilise le check rapide du workspace', () => {
  expect(labels({ boutique: true })).toContain('Boutique fast gates');
});
