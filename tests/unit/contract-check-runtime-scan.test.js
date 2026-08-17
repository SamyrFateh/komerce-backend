'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

describe('contract-check runtime consumer scan', () => {
  let temp;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-contract-scan-'));
  });

  afterEach(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  test('ignore les URLs synthétiques présentes uniquement dans les tests dashboard', () => {
    const boutique = path.join(temp, 'boutique');
    const dashboards = path.join(temp, 'dashboards');
    fs.mkdirSync(boutique, { recursive: true });
    fs.mkdirSync(path.join(dashboards, 'tests', 'unit'), { recursive: true });

    fs.writeFileSync(
      path.join(dashboards, 'tests', 'unit', 'fixture.js'),
      "const endpoint = '/api/this-route-must-never-exist/order-l7-001/collect';\n",
      'utf8'
    );

    const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'contract-check.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        BOUTIQUE_DIR: boutique,
        DASHBOARDS_DIR: dashboards,
      },
    });

    expect(r.status).toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toContain('Aucune dérive');
    expect(`${r.stdout}\n${r.stderr}`).not.toContain('this-route-must-never-exist');
  });

  test('continue de bloquer une URL runtime absente du contrat', () => {
    const boutique = path.join(temp, 'boutique');
    const dashboards = path.join(temp, 'dashboards');
    fs.mkdirSync(boutique, { recursive: true });
    fs.mkdirSync(path.join(dashboards, 'js'), { recursive: true });

    fs.writeFileSync(
      path.join(dashboards, 'js', 'runtime.js'),
      "fetch('/api/this-runtime-route-must-never-exist');\n",
      'utf8'
    );

    const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'contract-check.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        BOUTIQUE_DIR: boutique,
        DASHBOARDS_DIR: dashboards,
      },
    });

    expect(r.status).toBe(1);
    expect(`${r.stdout}\n${r.stderr}`).toContain('this-runtime-route-must-never-exist');
  });
});
