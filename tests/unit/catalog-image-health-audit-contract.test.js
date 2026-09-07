'use strict';

const fs = require('fs');
const path = require('path');

const audit = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'catalog-image-health-audit.js'), 'utf8');
const golden = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'catalog', 'golden-elite-pro.js'), 'utf8');

describe('catalog image health audit semantics', () => {
  test('remote audit intentionally probes HTTPS URLs only', () => {
    expect(audit).toContain("/^https:\\/\\//i.test(value)");
  });

  test('Golden Product uses local Boutique assets and is not a broken supplier hero', () => {
    expect(golden).toContain("const MEDIA_BASE = '/images/products/golden-elite-pro';");
    expect(golden).toContain('neutral-main.svg');
  });
});
