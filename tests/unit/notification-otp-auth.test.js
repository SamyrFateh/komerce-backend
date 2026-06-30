'use strict';

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

  it('sendMagicLink retourne failed si provider rejette ou throw', async () => {
    mockInternals.callAuthKey.mockResolvedValueOnce({ ok: false, error: 'bad_template' });
    await expect(sendMagicLink({ phone: '+269000', magicLink: 'https://x' })).resolves.toEqual({ success: false, channel: 'whatsapp', error: 'bad_template', reason: 'authkey_rejected' });

    mockInternals.callAuthKey.mockRejectedValueOnce(new Error('provider_down'));
    await expect(sendMagicLink({ phone: '+269000', magicLink: 'https://x' })).resolves.toEqual({ success: false, channel: 'whatsapp', error: 'provider_down', reason: 'exception' });
    expect(mockInternals.logNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'magic_link_sent', status: 'failed' }));
  });
});
