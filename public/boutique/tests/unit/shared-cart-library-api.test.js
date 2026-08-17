'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '../../js');

describe('shared-cart library public API boundary', () => {
  test('la façade expose uniquement bibliothèque et libellé canonique', () => {
    const src = fs.readFileSync(path.join(JS, 'group/shared-cart-library-api.js'), 'utf8');
    expect(src).toContain("getSharedCartLibrary } from './group-api.js'");
    expect(src).toContain("sharedListDisplayLabel } from './group-list-labels.js'");
    expect(src).not.toContain('saveSharedCart');
    expect(src).not.toContain('removeSavedSharedCart');
  });

  test('tracking consomme la façade sans importer les internes library/labels', () => {
    const tracking = fs.readFileSync(path.join(JS, 'b-tracking.js'), 'utf8');
    expect(tracking).toContain("from './group/shared-cart-library-api.js'");
    expect(tracking).not.toContain("from './group/group-api.js'");
    expect(tracking).not.toContain("from './group/group-list-labels.js'");
  });
});
