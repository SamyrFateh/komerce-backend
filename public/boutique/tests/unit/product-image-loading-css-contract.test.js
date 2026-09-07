'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'product-image-loading.css'), 'utf8');

describe('product image loading CSS contract', () => {
  test('loading mask never captures gestures', () => {
    expect(css).toContain('pointer-events: none;');
  });
});
