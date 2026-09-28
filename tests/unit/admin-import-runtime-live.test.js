'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../public/dashboards/admin/js/app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../../public/dashboards/admin/index.html'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '../../public/dashboards/admin/js/views/ImportRuntimeView.js'), 'utf8');

describe('Import runtime live dashboard', () => {
  test('is exposed in the canonical admin sourcing navigation', () => {
    expect(app).toContain("path: '/admin/import-runtime'");
    expect(app).toContain("view: 'ImportRuntimeView'");
    expect(index).toContain('/dashboards/admin/js/views/ImportRuntimeView.js');
  });

  test('renders the intentionally small set of sourcing-to-catalogue milestones', () => {
    for (const label of ['Source connectée', 'Import brut', 'Raffinerie', 'Taxonomie', 'Certification', 'Catalogue']) {
      expect(view).toContain(label);
    }
  });

  test('observes canonical server truth and refreshes live without inventing a second telemetry store', () => {
    expect(view).toContain('KmcApi.getSourcingWorkspace()');
    expect(view).toContain('production_runtime_certified');
    expect(view).toContain('setInterval');
    expect(view).toContain('POLL_MS = 3000');
  });
});
