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

test('ajoute callback ou quote sans casser le payload historique request', () => {
  const source = document.createElement('button');
  expect(requestDiscovery('service', 'svc-2', source, 'Demain', 'callback')).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'service', ref: 'svc-2', source, requestedWindow: 'Demain', action: 'callback',
  });
});

test('émet la même commande canonique pour physical_offer', () => {
  expect(requestDiscovery('physical_offer', 'offer-1', null)).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'physical_offer', ref: 'offer-1', source: null, requestedWindow: null,
  });
});

test('refuse un kind ou une action hors frontière Inquiry', () => {
  expect(requestDiscovery('product', 'p-1', null)).toBe(false);
  expect(requestDiscovery('service', 'svc-1', null, null, 'call')).toBe(false);
  expect(mockEmit).not.toHaveBeenCalled();
});
