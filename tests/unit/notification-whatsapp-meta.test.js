/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/notification-whatsapp-meta.test.js
 *
 * Tests du module services/whatsapp-meta.js (adaptateur Meta Graph API,
 * distinct de services/whatsapp.js/authkey-client.js utilisés par order.js/parcel.js).
 *
 * TOKEN et PHONE_NUMBER_ID sont lus depuis process.env au require() du module
 * (const au top-level) -> chaque scénario "configuré" doit faire
 * jest.resetModules() + fixer process.env AVANT le require.
 *
 * Couverture :
 *   sendTemplateWhatsApp :
 *     ✓ skip si TOKEN ou PHONE_NUMBER_ID absent (déjà couvert par
 *       whatsapp-meta-alert-engine.test.js, revérifié ici pour la suite isolée)
 *     ✓ succès (res.ok) : renvoie message_id depuis data.messages[0].id
 *     ✓ succès mais data.messages absent/vide : message_id -> null
 *     ✓ échec HTTP (res.ok=false) avec data.error présent
 *     ✓ échec HTTP (res.ok=false) sans data.error : error replie sur data brute
 *     ✓ res.json() rejette (réponse non-JSON) : fallback {} sans throw
 *     ✓ payload envoyé : normalise le téléphone, applique lang/components par défaut et custom
 *   normalizeWhatsAppPhone (via payload envoyé à fetch) :
 *     ✓ retire les caractères non numériques
 *     ✓ null/undefined -> chaîne vide
 *
 * Gap documenté (branch coverage 94.11%, non 100%) :
 *   metaUrl(path = '') ligne 27 — le paramètre par défaut path='' n'est
 *   jamais exercé : metaUrl n'est pas exportée et n'a qu'un seul point
 *   d'appel interne (sendTemplateWhatsApp -> metaUrl('/messages')), toujours
 *   avec un argument explicite. Branche structurellement inatteignable
 *   depuis la surface publique du module, même classe de gap que
 *   order.js:210 (condition composée toujours vraie).
 */

'use strict';

describe('services/whatsapp-meta', () => {
  const OLD_ENV = process.env;
  let mockFetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterAll(() => {
    process.env = OLD_ENV;
    global.fetch = undefined;
  });

  function loadConfigured() {
    process.env.META_WA_TOKEN = 'test-token';
    process.env.META_WA_PHONE_NUMBER_ID = '123456';
    return require('../../services/whatsapp-meta');
  }

  it('skip si META_WA_TOKEN absent', async () => {
    delete process.env.META_WA_TOKEN;
    process.env.META_WA_PHONE_NUMBER_ID = '123456';
    const { sendTemplateWhatsApp } = require('../../services/whatsapp-meta');

    const result = await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    expect(result).toEqual({ success: false, skipped: true, reason: 'meta_not_configured' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skip si META_WA_PHONE_NUMBER_ID absent', async () => {
    process.env.META_WA_TOKEN = 'test-token';
    delete process.env.META_WA_PHONE_NUMBER_ID;
    const { sendTemplateWhatsApp } = require('../../services/whatsapp-meta');

    const result = await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    expect(result).toEqual({ success: false, skipped: true, reason: 'meta_not_configured' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('succès : renvoie message_id depuis data.messages[0].id et appelle la bonne URL/payload', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    const responseData = { messages: [{ id: 'wamid.ABC123' }] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(responseData),
    });

    const result = await sendTemplateWhatsApp({
      to: '+269 32 12 345',
      templateName: 'order_created',
      lang: 'en',
      components: [{ type: 'body', parameters: [] }],
    });

    expect(result).toEqual({ success: true, message_id: 'wamid.ABC123', raw: responseData });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/123456/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      })
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Normalisation attendue : '+269 32 12 345' -> suppression de tout non-digit ('+' et espaces)
    expect(sentBody).toEqual({
      messaging_product: 'whatsapp',
      to: '2693212345',
      type: 'template',
      template: {
        name: 'order_created',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [] }],
      },
    });
  });

  it('succès mais data.messages absent : message_id -> null', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({}),
    });

    const result = await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    expect(result).toEqual({ success: true, message_id: null, raw: {} });
  });

  it('applique lang=fr et components=[] par défaut si non fournis', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.DEF' }] }),
    });

    await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.template.language).toEqual({ code: 'fr' });
    expect(sentBody.template.components).toEqual([]);
  });

  it('échec HTTP (res.ok=false) avec data.error présent', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({ error: { message: 'Invalid OAuth access token' } }),
    });

    const result = await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    expect(result).toEqual({
      success: false,
      status: 401,
      error: { message: 'Invalid OAuth access token' },
    });
  });

  it('échec HTTP (res.ok=false) sans data.error : error replie sur les données brutes', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    const raw = { unexpected: 'shape' };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue(raw),
    });

    const result = await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    expect(result).toEqual({ success: false, status: 500, error: raw });
  });

  it('res.json() rejette (réponse non-JSON) : fallback {} sans throw, puis suit la branche ok/non-ok', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: jest.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
    });

    const result = await sendTemplateWhatsApp({ to: '+269321', templateName: 'order_created' });

    expect(result).toEqual({ success: false, status: 502, error: {} });
  });

  it('normalise un téléphone null/undefined en chaîne vide dans le payload', async () => {
    const { sendTemplateWhatsApp } = loadConfigured();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.X' }] }),
    });

    await sendTemplateWhatsApp({ to: null, templateName: 'order_created' });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.to).toBe('');
  });
});
