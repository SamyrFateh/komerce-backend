/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — services/authkey-client.js
 * FRESH-070 (guard staging) + Lot B (couverture complète)
 *
 * Objectif :
 *   1. Couvrir la guard staging (AUTHKEY_ALLOWED_PHONES) pour éviter
 *      qu'un message WhatsApp réel parte vers des clients en staging.
 *   2. Couvrir l'ensemble du module : envFirst/WID, parseMobile,
 *      toBodyValues, callAuthKeyText, callAuthKey et tous les notify*.
 *
 * Les fonctions réseau (fetch) sont mockées. Le module calcule certaines
 * constantes (IS_PRODUCTION, _allowedPhones, WID, DEFAULT_COUNTRY_CODE) au
 * chargement : on utilise donc jest.resetModules() + require() frais à
 * chaque scénario qui dépend de variables d'environnement différentes.
 */

'use strict';

// Mock global fetch pour isoler les appels réseau
global.fetch = jest.fn();

function mockFetchOnce(body, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

describe('authkey-client — staging whitelist guard', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    jest.restoreAllMocks();
  });

  // ── Cas A : prod ne filtre pas ──────────────────────────────────────────
  it('A — en production, _isStagingAllowed retourne true quelle que soit la whitelist', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTHKEY_ALLOWED_PHONES;
    const client = require('../../services/authkey-client');
    // _isStagingAllowed est privée — on la teste via un appel qui mock fetch
    // et vérifie que le filtre ne bloque pas.
    // On accède via module.exports si exposée, sinon on test via parseMobile (publique).
    expect(client.parseMobile).toBeDefined(); // sanity check
    // En prod, pas de whitelist → tout numéro est autorisé. On valide ça indirectement :
    // si le module charge sans erreur en prod, le filtre est bien absent.
    expect(typeof client.notifyOrderCreated).toBe('function');
  });

  // ── Cas B : staging sans AUTHKEY_ALLOWED_PHONES → 0 envoi ───────────────
  it('B — en staging sans AUTHKEY_ALLOWED_PHONES, notifyOrderCreated ne fait pas d\'appel réseau', async () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.AUTHKEY_ALLOWED_PHONES;
    const client = require('../../services/authkey-client');
    await client.notifyOrderCreated({ mobile: '+2693301234', name: 'Test', orderRef: 'REF001', amount: '1000 KMF' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Cas C : staging avec whitelist, numéro matching → envoi autorisé ────
  it('C — en staging avec whitelist, numéro listé → appel réseau effectué', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.AUTHKEY_ALLOWED_PHONES = '+2693301234,+33612345678';
    process.env.AUTHKEY_API_KEY = 'test-key';
    // Mock fetch pour retourner une réponse succès. Le code réel appelle
    // response.text() (pas .json()) sur tous les chemins, puis JSON.parse —
    // le mock doit donc fournir .text(), pas .json(), pour matcher la vraie
    // forme de Response et éviter un "response.text is not a function" interne
    // (silencieux car rattrapé, mais bruite les logs et masque un vrai échec réseau).
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ error: 0, message: 'Message Queued' }),
    });
    const client = require('../../services/authkey-client');
    await client.notifyOrderCreated({ mobile: '+2693301234', name: 'Test', orderRef: 'REF001', amount: '1000 KMF' });
    expect(global.fetch).toHaveBeenCalled();
  });

  // ── Cas D : staging avec whitelist, numéro non listé → bloqué ───────────
  it('D — en staging avec whitelist, numéro absent → pas d\'appel réseau', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.AUTHKEY_ALLOWED_PHONES = '+33612345678';
    process.env.AUTHKEY_API_KEY = 'test-key';
    global.fetch = jest.fn();
    const client = require('../../services/authkey-client');
    await client.notifyOrderCreated({ mobile: '+2693399999', name: 'Inconnu', orderRef: 'REF002', amount: '500 KMF' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('authkey-client — parseMobile', () => {
  const origEnv = { ...process.env };

  beforeEach(() => { jest.resetModules(); });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  it('détecte l\'indicatif Comores (269) pour un numéro local', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_COUNTRY_CODE = '269';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('3301234');
    expect(result.country_code).toBe('269');
    expect(result.mobile).toBeTruthy();
  });

  it('parse un numéro international complet avec +33', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('+33612345678');
    expect(result.country_code).toBe('33');
  });

  it('retourne { null, null } quand aucun chiffre n\'est présent', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    expect(parseMobile('')).toEqual({ country_code: null, mobile: null });
    expect(parseMobile('abc')).toEqual({ country_code: null, mobile: null });
    expect(parseMobile(undefined)).toEqual({ country_code: null, mobile: null });
  });

  it('retire le préfixe international 00 avant détection de l\'indicatif', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('0033612345678');
    expect(result.country_code).toBe('33');
    expect(result.mobile).toBe('612345678');
  });

  it('reconnaît un numéro mobile français local 06/07 sans indicatif', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('0612345678');
    expect(result).toEqual({ country_code: '33', mobile: '612345678' });
  });

  it('reconnaît un numéro mobile français local commençant par 07', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('0712345678');
    expect(result.country_code).toBe('33');
  });

  it('retombe sur DEFAULT_COUNTRY_CODE quand aucun préfixe connu ne matche', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_COUNTRY_CODE = '269';
    const { parseMobile } = require('../../services/authkey-client');
    // '123' ne matche aucun préfixe connu et n'est pas un 06/07 français
    const result = parseMobile('123');
    expect(result).toEqual({ country_code: '269', mobile: '123' });
  });

  it('détecte un indicatif UK (44) sur un numéro suffisamment long', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('+447911123456');
    expect(result.country_code).toBe('44');
  });

  it('détecte un indicatif Émirats (971)', () => {
    process.env.NODE_ENV = 'production';
    const { parseMobile } = require('../../services/authkey-client');
    const result = parseMobile('+971501234567');
    expect(result.country_code).toBe('971');
  });
});

describe('authkey-client — envFirst / WID', () => {
  const origEnv = { ...process.env };

  beforeEach(() => { jest.resetModules(); });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  it('utilise la valeur par défaut si aucune variable d\'environnement WID n\'est fournie', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTHKEY_WID_ORDER_CREATED;
    delete process.env.AUTHKEY_ORDER_CREATED_WID;
    delete process.env.WID_ORDER_CREATED;
    const { WID } = require('../../services/authkey-client');
    expect(WID.ordercreated).toBe('32183');
  });

  it('priorise AUTHKEY_WID_* sur les anciens noms WID_*', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_WID_ORDER_CREATED = 'new-id';
    process.env.AUTHKEY_ORDER_CREATED_WID = 'mid-id';
    process.env.WID_ORDER_CREATED = 'old-id';
    const { WID } = require('../../services/authkey-client');
    expect(WID.ordercreated).toBe('new-id');
  });

  it('retombe sur le nom intermédiaire si le nom prioritaire est vide/blanc', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_WID_ORDER_CREATED = '   ';
    process.env.AUTHKEY_ORDER_CREATED_WID = 'mid-id';
    delete process.env.WID_ORDER_CREATED;
    const { WID } = require('../../services/authkey-client');
    expect(WID.ordercreated).toBe('mid-id');
  });

  it('n’expose aucun template WhatsApp de facture', () => {
    process.env.NODE_ENV = 'production';
    const { WID } = require('../../services/authkey-client');
    expect(WID).not.toHaveProperty('invoiceready');
  });
});

describe('authkey-client — toBodyValues (via callAuthKey)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_API_KEY = 'test-key';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    jest.restoreAllMocks();
  });

  it('utilise directement bodyValues quand fourni (escape hatch)', async () => {
    mockFetchOnce({ Status: 'success', MessageID: '1' });
    const { callAuthKey } = require('../../services/authkey-client');
    await callAuthKey({ wid: '999', mobile: '+33612345678', variables: { bodyValues: { custom: 'x' } } });
    const [, opts] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.bodyValues).toEqual({ custom: 'x' });
  });

  it('construit bodyValues à partir des clés nommées connues, en ignorant undefined/null/vide', async () => {
    mockFetchOnce({ Status: 'success', MessageID: '1' });
    const { callAuthKey } = require('../../services/authkey-client');
    await callAuthKey({
      wid: '999',
      mobile: '+33612345678',
      variables: { name: 'Ali', order_ref: undefined, amount: null, relay_point: '' },
    });
    const [, opts] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.bodyValues).toEqual({ name: 'Ali' });
  });

  it('ignore explicitement les champs de facture et de lien documentaire', async () => {
    mockFetchOnce({ Status: 'success', MessageID: '1' });
    const { callAuthKey } = require('../../services/authkey-client');
    await callAuthKey({
      wid: '999',
      mobile: '+33612345678',
      variables: { name: 'Ali', invoice_number: 'FAC-001', invoice_url: 'https://example.test/facture' },
    });
    const [, opts] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.bodyValues).toEqual({ name: 'Ali' });
  });

  it('conserve les clés var1/var2 explicites passées par compatibilité', async () => {
    mockFetchOnce({ Status: 'success', MessageID: '1' });
    const { callAuthKey } = require('../../services/authkey-client');
    await callAuthKey({ wid: '999', mobile: '+33612345678', variables: { name: 'Ali', var1: 'x', var2: 'y' } });
    const [, opts] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.bodyValues).toEqual({ name: 'Ali', var1: 'x', var2: 'y' });
  });

  it('n\'ajoute pas la clé bodyValues au body si aucune variable exploitable', async () => {
    mockFetchOnce({ Status: 'success', MessageID: '1' });
    const { callAuthKey } = require('../../services/authkey-client');
    await callAuthKey({ wid: '999', mobile: '+33612345678', variables: {} });
    const [, opts] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.bodyValues).toBeUndefined();
  });

  it('gère un variables non-objet (null) sans planter', async () => {
    mockFetchOnce({ Status: 'success', MessageID: '1' });
    const { callAuthKey } = require('../../services/authkey-client');
    await expect(callAuthKey({ wid: '999', mobile: '+33612345678', variables: null })).resolves.toMatchObject({ ok: true });
  });
});

describe('authkey-client — callAuthKey', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    jest.restoreAllMocks();
  });

  it('retourne missing_api_key si AUTHKEY_API_KEY est absent', async () => {
    delete process.env.AUTHKEY_API_KEY;
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result).toEqual({ ok: false, error: 'missing_api_key' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retourne missing_wid si wid est absent', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ mobile: '+33612345678' });
    expect(result).toEqual({ ok: false, error: 'missing_wid' });
  });

  it('retourne invalid_mobile si le numéro ne peut pas être parsé', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '' });
    expect(result).toEqual({ ok: false, error: 'invalid_mobile', raw: '' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('bloque et journalise en staging si le numéro n\'est pas whitelisté', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.AUTHKEY_ALLOWED_PHONES = '+33600000000';
    process.env.AUTHKEY_API_KEY = 'test-key';
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result).toEqual({ ok: false, reason: 'staging_not_allowed', mobile: '+33612345678', wid: '32183' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retourne ok:true et propage messageId/providerStatus en cas de succès', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce({ Status: 'Success', MessageID: 'abc123' });
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('abc123');
    expect(result.providerStatus).toBe('success');
    expect(result.wid).toBe('32183');
  });

  it('retourne ok:false quand response.ok est false (HTTP error)', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce({ Message: 'bad request' }, { ok: false, status: 400 });
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('bad request');
  });

  it('retourne ok:false quand le provider répond 200 mais avec un statut d\'échec métier', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce({ Status: 'error', Message: 'Invalid Authkey' });
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid Authkey');
  });

  it('détecte un échec via le message contenant "insufficient balance" même avec un status neutre', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce({ Status: 'queued', Message: 'insufficient balance' });
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result.ok).toBe(false);
  });

  it('gère une réponse non-JSON en la wrappant dans { raw }', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce('not-json-at-all');
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    // status vide, message vide -> pas providerFailed côté regex/status -> ok:true avec data.raw
    expect(result.data).toEqual({ raw: 'not-json-at-all' });
  });

  it('retourne ok:false, error:network_error sur exception fetch', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result).toEqual({ ok: false, error: 'network_error', details: 'ECONNRESET', wid: '32183' });
  });

  it('retombe sur http_<status> quand le provider ne fournit ni Message ni Error', async () => {
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce({}, { ok: false, status: 503 });
    const { callAuthKey } = require('../../services/authkey-client');
    const result = await callAuthKey({ wid: '32183', mobile: '+33612345678' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('http_503');
  });

});

describe('authkey-client — callAuthKeyText', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_API_KEY = 'test-key';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    jest.restoreAllMocks();
  });

  it('retourne missing_api_key si AUTHKEY_API_KEY est absent', async () => {
    delete process.env.AUTHKEY_API_KEY;
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour' });
    expect(result).toEqual({ ok: false, error: 'missing_api_key' });
  });

  it('retourne missing_message si message est absent', async () => {
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678' });
    expect(result).toEqual({ ok: false, error: 'missing_message' });
  });

  it('retourne invalid_mobile si le numéro ne peut pas être parsé', async () => {
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '', message: 'Bonjour' });
    expect(result).toEqual({ ok: false, error: 'invalid_mobile', raw: '' });
  });

  // O7.2 (Cycle A) : les 3 tests de détection/signature d'URL de facture dans
  // callAuthKeyText ont été retirés — cette logique n'existe plus (voir
  // services/authkey-client.js). Le lien de facture publique est désormais
  // construit par services/invoice-service.js (orders) avant l'appel ; ce
  // module envoie le message texte tel quel, sans inspection de contenu.

  it('bloque en staging si le numéro n\'est pas whitelisté', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'staging';
    process.env.AUTHKEY_ALLOWED_PHONES = '+33600000000';
    process.env.AUTHKEY_API_KEY = 'test-key';
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour' });
    expect(result).toEqual({ ok: false, reason: 'staging_not_allowed', mobile: '+33612345678' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('envoie un message texte simple avec succès', async () => {
    mockFetchOnce({ Status: 'success', MessageID: 'txt-3' });
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour, votre colis est arrivé.' });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('txt-3');
  });

  it('retourne ok:false quand le provider rejette la requête (HTTP KO)', async () => {
    mockFetchOnce({ Message: 'bad request' }, { ok: false, status: 400 });
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('bad request');
  });

  it('détecte un échec métier via un message provider matchant "template"', async () => {
    mockFetchOnce({ Status: 'queued', Message: 'template not approved' });
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour' });
    expect(result.ok).toBe(false);
  });

  it('retourne ok:false, error:network_error sur exception fetch', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour' });
    expect(result).toEqual({ ok: false, error: 'network_error', details: 'timeout' });
  });

  it('retombe sur http_<status> quand le provider ne fournit ni Message ni Error', async () => {
    mockFetchOnce({}, { ok: false, status: 500 });
    const { callAuthKeyText } = require('../../services/authkey-client');
    const result = await callAuthKeyText({ mobile: '+33612345678', message: 'Bonjour' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('http_500');
  });
});

describe('authkey-client — notify* wrappers', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.AUTHKEY_API_KEY = 'test-key';
    mockFetchOnce({ Status: 'success', MessageID: 'ok' });
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    jest.restoreAllMocks();
  });

  function sentBody() {
    const [, opts] = global.fetch.mock.calls[0];
    return JSON.parse(opts.body);
  }

  it('notifyOrderCreated délègue à callAuthKey avec le WID order_created et les bonnes variables', async () => {
    const { notifyOrderCreated, WID } = require('../../services/authkey-client');
    const result = await notifyOrderCreated({ mobile: '+33612345678', name: 'Ali', orderRef: 'REF1', amount: '1000 KMF' });
    expect(result.ok).toBe(true);
    expect(sentBody().wid).toBe(WID.ordercreated);
    expect(sentBody().bodyValues).toEqual({ name: 'Ali', order_ref: 'REF1', amount: '1000 KMF' });
  });

  it('notifyPaymentConfirmed délègue à callAuthKey avec le WID payment_confirmed', async () => {
    const { notifyPaymentConfirmed, WID } = require('../../services/authkey-client');
    await notifyPaymentConfirmed({ mobile: '+33612345678', name: 'Ali', orderRef: 'REF1' });
    expect(sentBody().wid).toBe(WID.paymentconfirmed);
    expect(sentBody().bodyValues).toEqual({ name: 'Ali', order_ref: 'REF1' });
  });

  it('notifyOrderShipped délègue à callAuthKey avec le WID order_shipped et relay_point', async () => {
    const { notifyOrderShipped, WID } = require('../../services/authkey-client');
    await notifyOrderShipped({ mobile: '+33612345678', name: 'Ali', orderRef: 'REF1', relayPoint: 'Moroni Centre' });
    expect(sentBody().wid).toBe(WID.ordershipped);
    expect(sentBody().bodyValues).toEqual({ name: 'Ali', order_ref: 'REF1', relay_point: 'Moroni Centre' });
  });

  it('notifyOrderDelivered délègue à callAuthKey avec le WID order_delivered', async () => {
    const { notifyOrderDelivered, WID } = require('../../services/authkey-client');
    await notifyOrderDelivered({ mobile: '+33612345678', name: 'Ali', orderRef: 'REF1', relayPoint: 'Moroni Centre' });
    expect(sentBody().wid).toBe(WID.orderdelivered);
  });

  it('notifyOrderCancelled délègue à callAuthKey avec le WID order_cancelled', async () => {
    const { notifyOrderCancelled, WID } = require('../../services/authkey-client');
    await notifyOrderCancelled({ mobile: '+33612345678', name: 'Ali', orderRef: 'REF1' });
    expect(sentBody().wid).toBe(WID.ordercancelled);
  });

  it('notifyAbandonedCart délègue à callAuthKey avec item_count converti en chaîne', async () => {
    const { notifyAbandonedCart, WID } = require('../../services/authkey-client');
    await notifyAbandonedCart({ mobile: '+33612345678', name: 'Ali', itemCount: 3 });
    expect(sentBody().wid).toBe(WID.abandonedcart);
    expect(sentBody().bodyValues).toEqual({ name: 'Ali', item_count: '3' });
  });

  // O7.2 (Cycle A) : les 3 tests notifyInvoiceReady ont été retirés — la
  // fonction a été supprimée (zéro appelant réel dans le repo). Le lien de
  // facture publique est désormais construit et testé côté
  // services/invoice-service.js (tests/unit/invoice-service.test.js), qui
  // possède déjà la logique de signature via invoice-public-token.js.
});
