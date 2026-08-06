'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockInternals = {
  log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  callAuthKey: jest.fn(),
  callAuthKeyText: jest.fn(),
  WID_OTP: 'WID_OTP',
  WID_MAGIC_LINK: 'WID_MAGIC',
  logNotification: jest.fn(() => Promise.resolve()),
  firstName: jest.fn((name) => (name ? String(name).trim().split(/\s+/)[0] : 'Client')),
};

jest.mock('../../services/notifications/internals', () => mockInternals);

const { sendOtpMessage, sendMagicLink } = require('../../services/notifications/otp-auth');

describe('notifications/otp-auth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sendOtpMessage refuse les parametres manquants', async () => {
    await expect(sendOtpMessage({ phone: '', code: '1234' })).resolves.toEqual({ success: false, channel: 'none', reason: 'missing_params' });
    await expect(sendOtpMessage({ phone: '+269', code: '' })).resolves.toEqual({ success: false, channel: 'none', reason: 'missing_params' });
    expect(mockInternals.callAuthKeyText).not.toHaveBeenCalled();
  });

  it('sendOtpMessage privilegie le texte libre AuthKey et log en sent', async () => {
    mockInternals.callAuthKeyText.mockResolvedValueOnce({ ok: true, messageId: 'msg-otp' });

    await expect(sendOtpMessage({ phone: '+269000', code: '123456', name: 'Ali', expiryMin: 7 }))
      .resolves.toEqual({ success: true, channel: 'whatsapp', messageId: 'msg-otp' });
    expect(mockInternals.callAuthKeyText).toHaveBeenCalledWith({
      mobile: '+269000',
      message: 'Code Komerce : 123456\n\nValable 7 min.\nNe donnez ce code à personne.',
    });
    expect(mockInternals.logNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'otp_sent', status: 'sent', detail: { messageId: 'msg-otp', via: 'komerce_free_text' } }));
    expect(mockInternals.callAuthKey).not.toHaveBeenCalled();
  });

  it('sendOtpMessage fallback template si texte libre refuse', async () => {
    mockInternals.callAuthKeyText.mockResolvedValueOnce({ ok: false, error: 'free_text_refused' });
    mockInternals.callAuthKey.mockResolvedValueOnce({ ok: true, messageId: 'msg-template' });

    await expect(sendOtpMessage({ phone: '+269000', code: '123456', name: 'Ali Ben', expiryMin: 10 }))
      .resolves.toEqual({ success: true, channel: 'whatsapp', messageId: 'msg-template' });
    expect(mockInternals.callAuthKey).toHaveBeenCalledWith({
      wid: 'WID_OTP',
      mobile: '+269000',
      variables: { name: 'Ali', code: '123456', otp: '123456', expiry: '10' },
    });
  });

  it('sendOtpMessage tente le fallback template si callAuthKeyText leve une exception', async () => {
    mockInternals.callAuthKeyText.mockRejectedValueOnce(new Error('network_down'));
    mockInternals.callAuthKey.mockResolvedValueOnce({ ok: true, messageId: 'msg-after-exception' });

    await expect(sendOtpMessage({ phone: '+269000', code: '123456' }))
      .resolves.toEqual({ success: true, channel: 'whatsapp', messageId: 'msg-after-exception' });
    expect(mockInternals.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+269000' }),
      'AuthKey free-text OTP exception',
    );
  });

  it('sendOtpMessage retourne otp_delivery_failed si texte libre echoue et aucun WID_OTP configure', async () => {
    mockInternals.callAuthKeyText.mockResolvedValueOnce({ ok: false, error: 'free_text_refused' });
    const originalWidOtp = mockInternals.WID_OTP;
    mockInternals.WID_OTP = null;
    jest.resetModules();
    jest.doMock('../../services/notifications/internals', () => mockInternals);
    const { sendOtpMessage: sendOtpMessageNoWid } = require('../../services/notifications/otp-auth');

    await expect(sendOtpMessageNoWid({ phone: '+269000', code: '123456' }))
      .resolves.toEqual({
        success: false,
        channel: 'none',
        reason: 'otp_delivery_failed',
        error: 'Impossible d’envoyer l’OTP : texte libre refusé et aucun WID_OTP configuré',
      });

    mockInternals.WID_OTP = originalWidOtp;
    jest.dontMock('../../services/notifications/internals');
    jest.resetModules();
  });

  it('sendOtpMessage retourne authkey_rejected ou exception en fallback template', async () => {
    mockInternals.callAuthKeyText.mockResolvedValueOnce({ ok: false, error: 'free_text_refused' });
    mockInternals.callAuthKey.mockResolvedValueOnce({ ok: false, error: 'template_refused' });
    await expect(sendOtpMessage({ phone: '+269000', code: '123456' })).resolves.toEqual({ success: false, channel: 'whatsapp', error: 'template_refused', reason: 'authkey_rejected' });

    mockInternals.callAuthKeyText.mockResolvedValueOnce({ ok: false, error: 'free_text_refused' });
    mockInternals.callAuthKey.mockRejectedValueOnce(new Error('provider_down'));
    await expect(sendOtpMessage({ phone: '+269000', code: '123456' })).resolves.toEqual({ success: false, channel: 'whatsapp', error: 'provider_down', reason: 'exception' });
  });

  it('sendMagicLink refuse les parametres manquants', async () => {
    await expect(sendMagicLink({ phone: '', magicLink: 'https://x' })).resolves.toEqual({ success: false, channel: 'none', reason: 'missing_params' });
    await expect(sendMagicLink({ phone: '+269', magicLink: '' })).resolves.toEqual({ success: false, channel: 'none', reason: 'missing_params' });
  });

  it('sendMagicLink utilise le template dedie et log sent', async () => {
    mockInternals.callAuthKey.mockResolvedValueOnce({ ok: true, messageId: 'msg-link' });

    await expect(sendMagicLink({ phone: '+269000', name: 'Ali Ben', magicLink: 'https://komerce.co/me?token=abc', expiryMin: 20 }))
      .resolves.toEqual({ success: true, channel: 'whatsapp', messageId: 'msg-link' });
    expect(mockInternals.callAuthKey).toHaveBeenCalledWith({
      wid: 'WID_MAGIC',
      mobile: '+269000',
      variables: { name: 'Ali', link: 'https://komerce.co/me?token=abc', magic_link: 'https://komerce.co/me?token=abc', url: 'https://komerce.co/me?token=abc', expiry: '20' },
    });
    expect(mockInternals.logNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'magic_link_sent', status: 'sent' }));
  });

  it('sendMagicLink reussit via fallback WID_OTP si WID_MAGIC_LINK non configure', async () => {
    jest.resetModules();

    const fallbackInternals = {
      log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
      callAuthKey: jest.fn().mockResolvedValueOnce({ ok: true, messageId: 'msg-fallback-otp' }),
      callAuthKeyText: jest.fn(),
      WID_OTP: 'WID_OTP',
      WID_MAGIC_LINK: null,
      logNotification: jest.fn(() => Promise.resolve()),
      firstName: jest.fn((name) => (name ? String(name).trim().split(/\s+/)[0] : 'Client')),
    };

    jest.doMock('../../services/notifications/internals', () => fallbackInternals);
    const { sendMagicLink: sendMagicLinkFallback } = require('../../services/notifications/otp-auth');

    await expect(sendMagicLinkFallback({ phone: '+269000', magicLink: 'https://komerce.co/me?token=abc' }))
      .resolves.toEqual({ success: true, channel: 'whatsapp', messageId: 'msg-fallback-otp' });

    expect(fallbackInternals.callAuthKey).toHaveBeenCalledWith(expect.objectContaining({ wid: 'WID_OTP' }));
    expect(fallbackInternals.logNotification).toHaveBeenCalledWith(expect.objectContaining({
      detail: { messageId: 'msg-fallback-otp', wid: 'WID_OTP', via: 'fallback_otp' },
    }));

    jest.dontMock('../../services/notifications/internals');
    jest.resetModules();
  });

  it('sendMagicLink retourne failed si provider rejette ou throw', async () => {
    mockInternals.callAuthKey.mockResolvedValueOnce({ ok: false, error: 'bad_template' });
    await expect(sendMagicLink({ phone: '+269000', magicLink: 'https://x' })).resolves.toEqual({ success: false, channel: 'whatsapp', error: 'bad_template', reason: 'authkey_rejected' });

    mockInternals.callAuthKey.mockRejectedValueOnce(new Error('provider_down'));
    await expect(sendMagicLink({ phone: '+269000', magicLink: 'https://x' })).resolves.toEqual({ success: false, channel: 'whatsapp', error: 'provider_down', reason: 'exception' });
    expect(mockInternals.logNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'magic_link_sent', status: 'failed' }));
  });
});

describe('notifications/otp-auth - sendMagicLink sans aucun template configure', () => {
  it('retourne no_template_configured si WID_MAGIC_LINK et WID_OTP sont tous deux falsy', async () => {
    jest.resetModules();

    const noTemplateInternals = {
      log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
      callAuthKey: jest.fn(),
      callAuthKeyText: jest.fn(),
      WID_OTP: null,
      WID_MAGIC_LINK: null,
      logNotification: jest.fn(() => Promise.resolve()),
      firstName: jest.fn((name) => (name ? String(name).trim().split(/\s+/)[0] : 'Client')),
    };

    jest.doMock('../../services/notifications/internals', () => noTemplateInternals);
    const { sendMagicLink: sendMagicLinkNoTemplate } = require('../../services/notifications/otp-auth');

    await expect(sendMagicLinkNoTemplate({ phone: '+269000', magicLink: 'https://komerce.co/me?token=abc' }))
      .resolves.toEqual({
        success: false,
        channel: 'none',
        reason: 'no_template_configured',
        error: 'Aucun template WhatsApp configuré pour le magic link',
      });

    expect(noTemplateInternals.callAuthKey).not.toHaveBeenCalled();
    expect(noTemplateInternals.logNotification).toHaveBeenCalledWith(expect.objectContaining({
      event: 'magic_link_sent',
      status: 'skipped',
      detail: { reason: 'no_template_configured' },
    }));

    jest.dontMock('../../services/notifications/internals');
    jest.resetModules();
  });
});
