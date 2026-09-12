'use strict';

const { COMPLETION_QUERIES } = require('../../scripts/aliexpress-wave2-completion');

test('Wave 2 completion plan has enough fresh search surface', () => {
  expect(COMPLETION_QUERIES.length).toBeGreaterThanOrEqual(50);
});
