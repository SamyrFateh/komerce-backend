'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const RETIRED_MODULE = path.join(ROOT, 'utils/store-credits.js');

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('store-credits retirement', () => {
  it('garde le shim legacy supprimé', () => {
    expect(fs.existsSync(RETIRED_MODULE)).toBe(false);
  });

  it('interdit tout nouvel import runtime de utils/store-credits', () => {
    const runtimeRoots = ['bootstrap', 'middleware', 'routes', 'services', 'utils']
      .map(dir => path.join(ROOT, dir));
    const offenders = [];

    for (const root of runtimeRoots) {
      for (const file of walk(root)) {
        const src = fs.readFileSync(file, 'utf8');
        if (/require\(['"][^'"]*store-credits['"]\)|from\s+['"][^'"]*store-credits['"]/.test(src)) {
          offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
