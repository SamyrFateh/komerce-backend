'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '../../js');

describe('shared-cart surface public API boundary', () => {
  test('la façade reste une réexportation étroite du contrôleur shared-cart', () => {
    const src = fs.readFileSync(path.join(JS, 'group/shared-cart-surface-api.js'), 'utf8');
    expect(src).toContain("from './group-side-cart.js'");
    for (const name of ['isSharedListSurfaceActive','hasOpenSharedListInSlot','renderSharedListInCart','exitSharedListRenderMode','setCartSurface','reopenSharedListCart','activateFromParticipantUrl']) {
      expect(src).toContain(name);
    }
    expect(src).not.toContain('showKomerceConfirm');
    expect(src).not.toContain('refreshSharedListContext');
  });

  test('orders-client consomme la façade sans importer group-side-cart directement', () => {
    const cart = fs.readFileSync(path.join(JS, 'b-cart.js'), 'utf8');
    const tracking = fs.readFileSync(path.join(JS, 'b-tracking.js'), 'utf8');
    expect(cart).toContain("from './group/shared-cart-surface-api.js'");
    expect(cart).not.toContain("from './group/group-side-cart.js'");
    expect(tracking).toContain("import('./group/shared-cart-surface-api.js')");
    expect(tracking).not.toContain("import('./group/group-side-cart.js')");
  });
});
