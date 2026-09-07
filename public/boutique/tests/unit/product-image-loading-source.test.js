'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'product-image-loading-ux.js'), 'utf8');

describe('product image loading source guards', () => {
  test('guards non-browser execution and binds only once', () => {
    expect(source).toContain("if (typeof document === 'undefined') return false;");
    expect(source).toContain("root.dataset.kProductImageLoadingBound === '1'");
    expect(source).toContain("root.dataset.kProductImageLoadingBound = '1'");
  });
});
