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

  test('garde hors plafond et délai : priorités visibles et ancrées, sans qualifier la garde normale d’anomalie', () => {
    const summary = {
      expected_kmf: 100000, collected_kmf: 100000,
      closed_kmf: 60000, held_kmf: 40000,
      holders_over_ceiling: 1, holders_overdue: 1,
      transfers_to_act: 2, pending_deposits: 3, uncollected_kmf: 1000,
    };
    const items = accounting.metricItems(summary);
    const actions = decision.decisionItems(items);
    expect(actions.map(item => item.key)).toEqual(['over-ceiling', 'overdue', 'missing', 'toact']);
    expect(actions[0]).toMatchObject({ tone: 'critical', href: '#accounting-custody', value: '1' });
    const cards = decision.summaryCards(items);
    expect(cards[0].metrics).toEqual([
      { label: 'Attendu', value: '100 000 KMF' },
      { label: 'Collecté', value: '100 000 KMF' },
      { label: 'Détenu', value: '40 000 KMF' },
      { label: 'Clôturé', value: '60 000 KMF' },
    ]);

    const ordinary = accounting.metricItems({
      expected_kmf: 100000, collected_kmf: 100000, closed_kmf: 60000,
      held_kmf: 40000, holders_over_ceiling: 0, holders_overdue: 0,
      transfers_to_act: 0, pending_deposits: 0, uncollected_kmf: 0, legacy_to_regularize_kmf: 0,
    });
    expect(decision.decisionItems(ordinary)).toEqual([]);
    expect(decision.summaryCards(ordinary)[0].metrics[2]).toEqual({ label: 'Détenu', value: '40 000 KMF' });
  });

  test('rapprochement = cash réellement collecté moins clôture contrôlée et pertes, jamais dépôts vérifiés', () => {
    const zero = decision.reconciliationCard({ gap_collection_kmf: 0, gap_closure_kmf: 0, held_kmf: 0 });
    expect(zero.tone).toBe('neutral');
    expect(zero.tone).not.toBe('positive');
    const card = decision.reconciliationCard({ gap_collection_kmf: 25000, gap_closure_kmf: 40000, held_kmf: 40000 });
    expect(card.tone).toBe('warning');
    expect(card.metrics).toEqual([
      { label: 'Écart collecte', value: '25 000 KMF' },
      { label: 'Collecté − clôturé − pertes', value: '40 000 KMF' },
      { label: 'Détenu maintenant', value: '40 000 KMF' },
    ]);
    // Un solde détenu n'est pas en lui-même une alerte de clôture.
    expect(decision.reconciliationCard({ gap_collection_kmf: 0, gap_closure_kmf: 40000, held_kmf: 40000 }).tone).toBe('neutral');
  });

  test('la couche decision-first est chargée après le workspace et reste lecture seule', () => {
    const index = read('public/dashboards/canonical/index.html');
    const source = read('public/dashboards/canonical/js/finance-accounting-workspace-decision.js');
    const baseIndex = index.indexOf('/dashboards/canonical/js/finance-accounting-workspace.js');
    const decisionIndex = index.indexOf('/dashboards/canonical/js/finance-accounting-workspace-decision.js?v=261011-1');

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(decisionIndex).toBeGreaterThan(baseIndex);
    expect(source).not.toMatch(/\b(?:POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toContain('/api/');
    expect(source).toContain('dashboard_no_business_recompute');
  });
});
