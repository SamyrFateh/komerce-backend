'use strict';

const {
  normalizeActions,
  buildPublicInteraction,
  isInquiryAction,
} = require('../../services/providers-interaction-policy');

describe('providers interaction policy', () => {
  test('une projection legacy retombe uniquement sur request', () => {
    expect(normalizeActions(undefined)).toEqual(['request']);
    expect(normalizeActions(null)).toEqual(['request']);
  });

  test('les actions sont cumulatives, ordonnées et dédupliquées', () => {
    expect(normalizeActions(['callback', 'call', 'callback', 'whatsapp', 'unknown']))
      .toEqual(['callback', 'call', 'whatsapp']);
  });

  test('un contact direct n est exposé que si une coordonnée publique explicite existe', () => {
    expect(buildPublicInteraction({
      actionsEnabled: ['callback', 'call', 'whatsapp'],
      publicPhone: '+269 321 00 00',
      publicWhatsapp: null,
    })).toEqual({
      actions: ['callback', 'call'],
      public_contact: { phone: '+269 321 00 00' },
    });
  });

  test('providers.phone privé ne peut pas être reconstruit par fallback', () => {
    expect(buildPublicInteraction({
      actionsEnabled: ['call', 'whatsapp'],
    })).toEqual({ actions: [], public_contact: null });
  });

  test('seules request quote callback partent vers Inquiry', () => {
    expect(isInquiryAction('request')).toBe(true);
    expect(isInquiryAction('quote')).toBe(true);
    expect(isInquiryAction('callback')).toBe(true);
    expect(isInquiryAction('call')).toBe(false);
    expect(isInquiryAction('whatsapp')).toBe(false);
  });
});
