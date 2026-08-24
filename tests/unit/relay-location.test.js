'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  buildRelayMapUrl,
  formatRelayPoint,
  appendRelayLocation,
} = require('../../services/notifications/relay-location');

describe('localisation utilitaire du relais', () => {
  it('génère une recherche Google Maps encodée depuis le nom et l adresse', () => {
    expect(buildRelayMapUrl({
      name: 'Relais Moroni Centre',
      address: 'Volo-Volo, Grande Comore',
    })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Relais%20Moroni%20Centre%2C%20Volo-Volo%2C%20Grande%20Comore',
    );
  });

  it('nettoie les espaces avant de construire le lien', () => {
    expect(buildRelayMapUrl({ name: '  Relais   A  ', address: '  Moroni  ' }))
      .toContain('query=Relais%20A%2C%20Moroni');
  });

  it('ne fabrique aucun lien quand la localisation est absente', () => {
    expect(buildRelayMapUrl()).toBeNull();
    expect(formatRelayPoint()).toBe('votre point relais');
    expect(appendRelayLocation('Colis disponible.')).toBe('Colis disponible.');
  });

  it('enrichit le même message avec un seul lien de localisation', () => {
    const message = appendRelayLocation('Colis disponible.', {
      name: 'Relais A',
      address: 'Moroni',
    });

    expect(message).toContain('Colis disponible.\n📍 Localiser le relais : https://www.google.com/maps/search/');
    expect(message.match(/https:\/\//g)).toHaveLength(1);
  });

  it('formate la variable du template WhatsApp disponible avec le lien', () => {
    expect(formatRelayPoint({ name: 'Relais A', address: 'Moroni' }))
      .toBe('Relais A — Localiser : https://www.google.com/maps/search/?api=1&query=Relais%20A%2C%20Moroni');
  });
});
