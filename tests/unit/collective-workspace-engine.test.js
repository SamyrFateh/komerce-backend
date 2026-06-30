/**
 * KOMERCE — Tests Unitaires : collective-workspace-engine (P0 shared-cart)
 *
 * Ce module est un barrel (Lot C4) qui ré-exporte les fonctions des 6 modules
 * collective-workspace-* découpés. Les comportements métier sont déjà testés
 * dans chacun de ces modules ; ce test garantit uniquement que le barrel
 * n'a pas de régression de surface (toutes les clés présentes, même référence
 * de fonction que le module source — pas de wrapper accidentel qui romprait
 * mocks/spies des appelants).
 *
 * Run : npx jest tests/unit/collective-workspace-engine.test.js
 */

'use strict';

const internals = require('../../services/collective-workspace-internals');
const creation = require('../../services/collective-workspace-creation');
const reads = require('../../services/collective-workspace-reads');
const items = require('../../services/collective-workspace-items');
const contributions = require('../../services/collective-workspace-contributions');
const lifecycle = require('../../services/collective-workspace-lifecycle');

const engine = require('../../services/collective-workspace-engine');

describe('collective-workspace-engine (barrel)', () => {
  test('expose toutes les clés attendues', () => {
    const expectedKeys = [
      '_generateToken', '_hashToken', 'logEvent', 'CONFIG',
      'createWorkspace',
      'getWorkspaceByPublicToken', 'getWorkspaceByCreatorToken', 'getTokenInfo', 'deriveWorkspacePhase',
      'addItem', 'updateItem', 'removeItem',
      'addContribution', 'cancelContribution', 'cancelContributionByCreator',
      'finalizationReview', 'finalizeWorkspace', 'resumeWorkspace',
    ];
    expect(Object.keys(engine).sort()).toEqual(expectedKeys.sort());
  });

  test('re-exporte les helpers internals par référence identique', () => {
    expect(engine._generateToken).toBe(internals._generateToken);
    expect(engine._hashToken).toBe(internals._hashToken);
    expect(engine.logEvent).toBe(internals.logEvent);
    expect(engine.CONFIG).toBe(internals.CONFIG);
  });

  test('re-exporte createWorkspace par référence identique', () => {
    expect(engine.createWorkspace).toBe(creation.createWorkspace);
  });

  test('re-exporte les fonctions de lecture par référence identique', () => {
    expect(engine.getWorkspaceByPublicToken).toBe(reads.getWorkspaceByPublicToken);
    expect(engine.getWorkspaceByCreatorToken).toBe(reads.getWorkspaceByCreatorToken);
    expect(engine.getTokenInfo).toBe(reads.getTokenInfo);
    expect(engine.deriveWorkspacePhase).toBe(reads.deriveWorkspacePhase);
  });

  test('re-exporte les fonctions items par référence identique', () => {
    expect(engine.addItem).toBe(items.addItem);
    expect(engine.updateItem).toBe(items.updateItem);
    expect(engine.removeItem).toBe(items.removeItem);
  });

  test('re-exporte les fonctions contributions par référence identique', () => {
    expect(engine.addContribution).toBe(contributions.addContribution);
    expect(engine.cancelContribution).toBe(contributions.cancelContribution);
    expect(engine.cancelContributionByCreator).toBe(contributions.cancelContributionByCreator);
  });

  test('re-exporte les fonctions de cycle de vie par référence identique', () => {
    expect(engine.finalizationReview).toBe(lifecycle.finalizationReview);
    expect(engine.finalizeWorkspace).toBe(lifecycle.finalizeWorkspace);
    expect(engine.resumeWorkspace).toBe(lifecycle.resumeWorkspace);
  });

  test('toutes les fonctions exportées sont bien des fonctions', () => {
    const fnKeys = Object.keys(engine).filter((k) => k !== 'CONFIG');
    for (const key of fnKeys) {
      expect(typeof engine[key]).toBe('function');
    }
  });
});
