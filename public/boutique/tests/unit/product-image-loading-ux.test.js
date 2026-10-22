'use strict';

const fs = require('fs');
const path = require('path');

describe('product-image-loading-ux — ownership', () => {
  test('le @domain du fichier correspond à la slice catalog qui le déclare', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../js/product-image-loading-ux.js'), 'utf8');
    expect(src).toMatch(/@domain\s+catalog/);
    const feature = fs.readFileSync(path.join(__dirname, '../../features/catalog.feature.js'), 'utf8');
    expect(feature).toContain('../js/product-image-loading-ux.js');
  });
});
