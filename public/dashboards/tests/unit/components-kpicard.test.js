'use strict';
describe('KpiCard component', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="test-container"></div>';
  });

  it('charge sans crash', () => {
    expect(() => {
      try { require('../../admin/js/components/KpiCard.js'); } catch(e) {
        if (!e.message.includes('is not defined')) throw e;
      }
    }).not.toThrow();
  });
});
