'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const accounting = require('../../public/dashboards/canonical/js/finance-accounting-workspace');
const decision = require('../../public/dashboards/canonical/js/finance-accounting-workspace-decision');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('finance / comptabilité decision-first', () => {
  test('les décisions visibles viennent uniquement des métriques serveur déjà canoniques', () => {
    const summary = {
      expected_kmf: 500000,
      collected_kmf: 420000,
      verified_kmf: 300000,
      pending_deposits: 3,
      uncollected_kmf: 80000,
    };

    const metrics = accounting.metricItems(summary);
    const decisions = decision.decisionItems(metrics);
    expect(decisions).toEqual([
      expect.objectContaining({
        key: 'missing',
        label: 'Cash non encaissé',
        tone: 'critical',
        value: metrics.find(item => item.key === 'missing').value,
      }),
      expect.objectContaining({
        key: 'pending',
        label: 'Dépôts à vérifier',
        tone: 'warning',
        value: metrics.find(item => item.key === 'pending').value,
      }),
    ]);
  });

  test('zéro anomalie ne fabrique aucune alerte', () => {
    const summary = {
      expected_kmf: 500000,
      collected_kmf: 500000,
      verified_kmf: 500000,
      pending_deposits: 0,
      uncollected_kmf: 0,
    };
    expect(decision.decisionItems(accounting.metricItems(summary))).toEqual([]);
  });

  test('la carte rapprochement reprend les écarts backend et ne crée aucun seuil arbitraire', () => {
    expect(decision.reconciliationCard({ gap_collection_kmf: 0, gap_deposit_kmf: 0 })).toEqual(
      expect.objectContaining({ tone: 'positive' })
    );
    const card = decision.reconciliationCard({ gap_collection_kmf: 25000, gap_deposit_kmf: 0 });
    expect(card.tone).toBe('warning');
    expect(card.metrics[0].label).toBe('Écart collecte');
    expect(card.metrics[0].value).toContain('25');
    expect(card.metrics[0].value).toContain('KMF');
    expect(card.metrics[1]).toEqual(expect.objectContaining({ label: 'Écart dépôt' }));
    expect(card.metrics[1].value).toContain('0');
  });

  test('la couche decision-first est chargée après le workspace et reste lecture seule', () => {
    const index = read('public/dashboards/canonical/index.html');
    const source = read('public/dashboards/canonical/js/finance-accounting-workspace-decision.js');
    const baseIndex = index.indexOf('/dashboards/canonical/js/finance-accounting-workspace.js');
    const decisionIndex = index.indexOf('/dashboards/canonical/js/finance-accounting-workspace-decision.js?v=1611');

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(decisionIndex).toBeGreaterThan(baseIndex);
    expect(source).not.toMatch(/\b(?:POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toContain('/api/');
    expect(source).toContain('dashboard_no_business_recompute');
  });
});
