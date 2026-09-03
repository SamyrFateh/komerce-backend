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

test('émet la commande canonique request sans précision', () => {
  const source = document.createElement('button');
  expect(requestDiscovery('service', 'svc-1', source)).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'service', ref: 'svc-1', source, requestedWindow: null, requesterNote: null,
  });
});

test('transporte fenêtre et précision sans perdre la cible', () => {
  const source = document.createElement('button');
  expect(requestDiscovery(
    'service', 'svc-1', source, '  Cette semaine  ', 'request', '  Hilux 2012, phare droit  '
  )).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'service', ref: 'svc-1', source,
    requestedWindow: 'Cette semaine', requesterNote: 'Hilux 2012, phare droit',
  });
});

test('callback ajoute uniquement l intention au contrat', () => {
  const source = document.createElement('button');
  expect(requestDiscovery('service', 'svc-2', source, null, 'callback', 'Rappeler après 17h')).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'service', ref: 'svc-2', source, requestedWindow: null,
    requesterNote: 'Rappeler après 17h', action: 'callback',
  });
});

test('émet la même commande canonique pour physical_offer', () => {
  expect(requestDiscovery('physical_offer', 'offer-1', null, null, 'request', '30 sacs')).toBe(true);
  expect(mockEmit).toHaveBeenCalledWith('discovery:request', {
    kind: 'physical_offer', ref: 'offer-1', source: null,
    requestedWindow: null, requesterNote: '30 sacs',
  });
});

test('refuse un kind ou une action hors frontière Inquiry publique', () => {
  expect(requestDiscovery('product', 'p-1', null)).toBe(false);
  expect(requestDiscovery('service', 'svc-1', null, null, 'call')).toBe(false);
  expect(requestDiscovery('service', 'svc-1', null, null, 'quote')).toBe(false);
  expect(mockEmit).not.toHaveBeenCalled();
});
