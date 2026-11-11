/** @test-kind unit @test-runner jest @test-requires none */
/**
 * @unit hub-order-status
 * @feature logistics (Hub live · statut de commande du dossier)
 * @brief Le statut reflète la cause dominante : anomalie > à regrouper/acheter > reliquat > attente fournisseur > prête.
 */
'use strict';
jest.mock('../../db', () => ({ query: jest.fn() }));
const { orderStatus } = require('../../services/hub-procurement-dossier');

const order = ({ states, received, requested, partial, anomaly = 0, uncovered = 0, ready = false }) => ({
  items: [{ units: states.map((state) => ({ state })) }],
  totals: { requested, received, anomaly, uncovered, in_boxes: 0 },
  readiness: { partial, complete: received >= requested, bag_open: false, ready_to_pack: ready },
});

describe('orderStatus', () => {
  test('KOM-101 : A 2/2 reçu, B pas encore sur une PO → « Partielle · 1 à acheter », jamais « Reliquat »', () => {
    const s = orderStatus(order({ states: ['received', 'received', 'none'], received: 2, requested: 3, partial: true }));
    expect(s).toMatchObject({ label: 'Partielle · 1 à acheter', tone: 'act' });
    expect(s.label).not.toMatch(/Reliquat/);
  });
  test('rien reçu, besoin sans PO → « À regrouper »', () => {
    expect(orderStatus(order({ states: ['none'], received: 0, requested: 1, partial: false })).label).toBe('À regrouper');
  });
  test('quantité commandée sur une PO non livrée après réception partielle → « Reliquat 2/3 »', () => {
    expect(orderStatus(order({ states: ['received', 'received', 'shipped'], received: 2, requested: 3, partial: true })).label).toBe('Reliquat 2/3');
  });
  test('l’anomalie prime sur tout', () => {
    expect(orderStatus(order({ states: ['none'], received: 0, requested: 1, partial: false, uncovered: 1 })).tone).toBe('bad');
    expect(orderStatus(order({ states: ['received', 'none'], received: 1, requested: 2, partial: true, anomaly: 1 })).label).toBe('Anomalie réception');
  });
  test('attente fournisseur, puis prête', () => {
    expect(orderStatus(order({ states: ['shipped'], received: 0, requested: 1, partial: false })).label).toBe('Attente fournisseur');
    expect(orderStatus(order({ states: ['received'], received: 1, requested: 1, partial: false, ready: true })).label).toBe('Prête à ensacher');
  });
});
