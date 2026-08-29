'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('css-specificity-guard --save at zero findings', () => {
  test('persists an empty ratchet instead of returning before save', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k-css-spec-zero-'));
    try {
      const scripts = path.join(tmp, 'scripts');
      fs.mkdirSync(scripts, { recursive: true });
      fs.mkdirSync(path.join(tmp, 'css', 'dist'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'js'), { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, '../../scripts/css-specificity-guard.js'),
        path.join(scripts, 'css-specificity-guard.js')
      );

      const run = spawnSync(process.execPath, [path.join(scripts, 'css-specificity-guard.js'), '--save'], {
        cwd: tmp,
        encoding: 'utf8'
      });

      expect(run.status).toBe(0);
      expect(run.stdout).toContain('Baseline figée à 0 override(s)');
      const baseline = JSON.parse(fs.readFileSync(path.join(scripts, '.css-specificity-guard-baseline.json'), 'utf8'));
      expect(baseline.total).toBe(0);
      expect(baseline.keys).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
