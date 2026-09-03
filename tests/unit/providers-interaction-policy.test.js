'use strict';

const {
  normalizeActions,
  buildPublicInteraction,
  isInquiryAction,
  publicActionForStoredAction,
} = require('../../services/providers-interaction-policy');

describe('providers interaction policy', () => {
  test('une projection legacy retombe uniquement sur request', () => {
    expect(normalizeActions(undefined)).toEqual(['request']);
    expect(normalizeActions(null)).toEqual(['request']);
  });

  test('quote converge vers request et call/whatsapp vers callback', () => {
    expect(normalizeActions(['quote', 'call', 'whatsapp', 'callback', 'request']))
      .toEqual(['request', 'callback']);
    expect(publicActionForStoredAction('quote')).toBe('request');
    expect(publicActionForStoredAction('call')).toBe('callback');
    expect(publicActionForStoredAction('whatsapp')).toBe('callback');
  });

  test('la projection publique n expose jamais une coordonnée provider', () => {
    expect(buildPublicInteraction({
      actionsEnabled: ['request', 'call', 'whatsapp'],
      publicPhone: '+269 321 00 00',
      publicWhatsapp: '+269 321 00 01',
    })).toEqual({
      actions: ['request', 'callback'],
      public_contact: null,
    });
  });

  test('un ancien jeu uniquement direct devient un rappel contextualisé', () => {
    expect(buildPublicInteraction({ actionsEnabled: ['call', 'whatsapp'] }))
      .toEqual({ actions: ['callback'], public_contact: null });
  });

  test('seules request et callback sont des intentions Inquiry publiques', () => {
    expect(isInquiryAction('request')).toBe(true);
    expect(isInquiryAction('callback')).toBe(true);
    expect(isInquiryAction('quote')).toBe(false);
    expect(isInquiryAction('call')).toBe(false);
    expect(isInquiryAction('whatsapp')).toBe(false);
  });
});
