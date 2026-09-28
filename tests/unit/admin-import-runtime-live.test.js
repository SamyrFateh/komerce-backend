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
const client = fs.readFileSync(path.join(__dirname, '../../public/dashboards/admin/js/api-client.js'), 'utf8');

describe('Import runtime live dashboard (run-scoped)', () => {
  test('route présente dans la navigation admin sourcing', () => {
    expect(app).toContain("path: '/admin/import-runtime'");
    expect(app).toContain("view: 'ImportRuntimeView'");
    expect(index).toContain('/dashboards/admin/js/views/ImportRuntimeView.js');
  });

  test('exactement les 6 jalons canoniques', () => {
    for (const key of [
      'SOURCE_CONNECTED',
      'RAW_IMPORT',
      'REFINERY',
      'TAXONOMY',
      'CERTIFICATION',
      'CATALOGUE',
    ]) {
      expect(view).toContain(key + ':');
    }
    for (const label of [
      'Source connectée',
      'Import brut',
      'Raffinerie',
      'Taxonomie',
      'Certification',
      'Catalogue',
    ]) {
      expect(view).toContain(label);
    }
  });

  test('consomme l’endpoint run-scoped et poll toutes les 3 secondes', () => {
    expect(view).toContain('KmcApi.getImportRuntimeRun(');
    expect(view).toContain('KmcApi.getImportRuntimeRuns()');
    expect(view).toContain('POLL_MS = 3000');
    expect(view).toContain('setInterval');
    expect(client).toContain('/admin/workspaces/sourcing/import-runs');
  });

  test('ne déduit plus la certification depuis le workspace global', () => {
    expect(view).not.toContain('getSourcingWorkspace');
    expect(view).not.toContain('production_runtime_certified');
    expect(view).not.toContain('CERTIFIÉE');
  });

  test('rend completed / running / failed / pending', () => {
    expect(view).toContain("status === 'COMPLETED'");
    expect(view).toContain("status === 'RUNNING'");
    expect(view).toContain("status === 'FAILED'");
    expect(view).toContain("'À venir'");
  });

  test('affiche les invariants de réconciliation', () => {
    expect(view).toContain('UNACCOUNTED');
    expect(view).toContain('OVERFLOW');
    expect(view).not.toMatch(/\.(import_id|candidate_id|product_id)\b/);
  });
});
