'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(),
}));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn() }) }));

const router = require('../../routes/admin-loyalty');

describe('admin-loyalty route surface', () => {
  test('expose uniquement les cinq opérations admin de récompense attendues', () => {
    const routes = router.stack
      .filter(layer => layer.route)
      .map(layer => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).filter(m => layer.route.methods[m]).sort(),
      }));

    expect(routes).toEqual(expect.arrayContaining([
      { path: '/pending', methods: ['get'] },
      { path: '/reward/:id', methods: ['post'] },
      { path: '/skip/:id', methods: ['post'] },
      { path: '/history', methods: ['get'] },
      { path: '/stats', methods: ['get'] },
    ]));
    expect(routes).toHaveLength(5);
  });

  test('chaque route porte authenticate + requireAdmin avant le handler métier', () => {
    const routeLayers = router.stack.filter(layer => layer.route);
    for (const layer of routeLayers) {
      expect(layer.route.stack).toHaveLength(3);
    }
  });
});
