'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Boutique product image loading continuity', () => {
  const renderer = source('js/render/render-product-card.js');
  const ux = source('js/product-image-loading-ux.js');
  const css = source('css/product-image-loading.css');
  const bundles = source('scripts/css-bundles.js');
  const railway = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'railway.toml'), 'utf8');

  test('keeps native lazy loading and installs the readiness controller', () => {
    expect(renderer).toContain("import '../product-image-loading-ux.js';");
    expect(renderer).toContain('loading="lazy"');
    expect(ux).toContain("document.addEventListener('load'");
    expect(ux).toContain("host.classList.add('is-image-ready')");
    expect(ux).toContain('MutationObserver');
  });

  test('keeps only managed product media visually occupied until its image is ready', () => {
    expect(css).toMatch(/\.k-card-img-wrap:has\(img\[data-k-product-image="1"\]\)::before[\s\S]*content:\s*'📦'/);
    expect(css).toContain('.k-card-img-wrap:has(img[data-k-product-image="1"]).is-image-ready::before');
    expect(css).toContain('.k-sug-card-img:has(img[data-k-product-image="1"]).is-image-ready::before');
    expect(css).toContain('k-product-image-sheen');
    expect(css).not.toMatch(/\.k-card-img-wrap::before/);
    expect(css).not.toMatch(/\.k-sug-card-img::before/);
  });

  test('ships the loading source in the canonical components bundle', () => {
    expect(bundles).toContain("'product-image-loading'");
  });

  test('restores Railway to migrations-only after the read-only audit', () => {
    expect(railway).toContain('preDeployCommand = ["node scripts/migrate.js"]');
    expect(railway).not.toContain('catalog-image-health-audit.js"]');
  });
});
