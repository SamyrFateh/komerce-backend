'use strict';

const fs = require('fs');
const path = require('path');

const utils = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'b-utils.js'), 'utf8');

describe('catalog image loading invariant', () => {
  test('product carousel remains lazy and async-decoded', () => {
    expect(utils).toContain('loading="lazy" decoding="async"');
    expect(utils).toContain('data-k-product-image="1"');
  });
});
