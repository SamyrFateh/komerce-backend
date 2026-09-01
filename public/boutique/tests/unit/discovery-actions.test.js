'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockEmit = jest.fn();

jest.mock('../../js/b-bus.js', () => ({
  bus: { emit: mockEmit },
}));

const { requestDiscovery } = require('../../js/discovery-actions.js');

beforeEach(() => mockEmit.mockClear());

test('émet la commande canonique pour service sans précision', () => {
  const source = document.createElement('button');
  expect(requestDiscovery('service', 'svc-1', source)).toBe(true);
  expect(mockEmit).toHaveBeenCalledTimes(1);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'service', ref: 'svc-1', source, requestedWindow: null,
  });
});

test('transporte la fenêtre demandée dans le même contrat canonique', () => {
  const source = document.createElement('button');
  expect(requestDiscovery('service', 'svc-1', source, '  Samedi matin  ')).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'service', ref: 'svc-1', source, requestedWindow: 'Samedi matin',
  });
});

test('émet la même commande canonique pour physical_offer', () => {
  expect(requestDiscovery('physical_offer', 'offer-1', null)).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'physical_offer', ref: 'offer-1', source: null, requestedWindow: null,
  });
});

test('refuse un kind hors frontière Discovery actionnable', () => {
  expect(requestDiscovery('product', 'p-1', null)).toBe(false);
  expect(mockEmit).not.toHaveBeenCalled();
});
