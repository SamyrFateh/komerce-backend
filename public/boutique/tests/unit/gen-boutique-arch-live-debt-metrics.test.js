'use strict';

const { buildSnapshot, render } = require('../../scripts/gen-boutique-arch-live.js');

describe('Architecture LIVE structural debt metrics', () => {
  test('reports executable zero ratchets and separates reviewed physical important guards from open debt', () => {
    const snapshot = buildSnapshot();
    expect(snapshot.debts.cascade.total).toBe(0);
    expect(snapshot.debts.specificity.total).toBe(0);
    expect(snapshot.debts.important.total).toBe(0);
    expect(snapshot.debts.important.reviewedGuardIds).toContain('desktop-mobile-drawer-neutralization');

    const md = render(snapshot);
    expect(md).toContain('Conflits de cascade suivis** : 0');
    expect(md).toContain('Overrides de spécificité suivis** : 0');
    expect(md).toContain('Dette `!important` ouverte** : 0');
    expect(md).toContain('`!important` physiques** : 3');
  });
});
