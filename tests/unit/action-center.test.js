'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const actionCenter = require('../../public/dashboards/canonical/js/action-center');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Canonical Action Center — presentation contract', () => {
  test('conserve la classification métier reçue du serveur sans recalcul', () => {
    expect(actionCenter.severityLabel('urgent')).toBe('Urgent');
    expect(actionCenter.severityLabel('critical')).toBe('Critique');
    expect(actionCenter.severityLabel('warning')).toBe('Attention');
    expect(actionCenter.severityLabel('info')).toBe('Info');
  });

  test('les métriques restent une projection directe du summary serveur', () => {
    expect(actionCenter.metricItems({ urgent: 2, warning: 1, info: 3, total_active: 6 }))
      .toEqual([
        { key: 'urgent', label: 'Urgent / critique', value: 2, tone: 'critical' },
        { key: 'warning', label: 'Avertissements', value: 1, tone: 'warning' },
        { key: 'info', label: 'Informations', value: 3, tone: 'neutral' },
        { key: 'total', label: 'Signaux actifs', value: 6, tone: 'neutral' },
      ]);
  });

  test('la carte signal expose des hooks visuels fondés uniquement sur row.severity', () => {
    const source = read('public/dashboards/canonical/js/action-center.js');
    expect(source).toContain('kmc-action-signal');
    expect(source).toContain('card.dataset.severity = severity');
    expect(source).toMatch(/\['urgent', 'critical', 'warning', 'info'\]\.includes/);
    expect(source).not.toMatch(/severity\s*[<>]=?\s*\d/);
  });
});
