'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-paypal.test.js
 *
 * Module js/b-paypal.js (222L) — intégration PayPal du checkout boutique.
 * Priorité #1 du plan de remédiation frontend : seul fichier de l'audit qui
 * touche directement à l'argent, à 0% de couverture avant cette session.
 *
 * Couverture visée :
 *   ensurePayPalSDK()   : succès, idempotence, chaque échec (config KO,
 *                         client_id absent, script onerror, window.paypal
 *                         absent après chargement)
 *   renderPayPalButton(): container introuvable, échec SDK, éligibilité,
 *                         onClick / createOrder / onApprove / onCancel / onError
 *   isPayPalEnabled()   : ok+présent, ok+absent, réponse KO, fetch qui throw
 *
 * _sdkLoaded / _sdkLoading sont des singletons module-level : chaque test qui
 * a besoin d'un état SDK propre recharge le module via jest.isolateModules.
 */

jest.mock('../../js/b-utils.js', () => ({
  apiPost: jest.fn(),
}));
jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
}));

const { apiPost } = require('../../js/b-utils.js');
const { showToast } = require('../../js/b-cart-core.js');

/** Intercepte document.createElement('script') + head.appendChild sans toucher au vrai DOM. */
function mockScriptInjection() {
  const realCreateElement = document.createElement.bind(document);
  let lastScript = null;

  jest.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'script') {
      lastScript = {};
      return lastScript;
    }
    return realCreateElement(tag);
  });
  jest.spyOn(document.head, 'appendChild').mockImplementation((el) => el);

  return () => lastScript;
}

async function waitForScriptInjection(getLastScript) {
  for (let i = 0; i < 12; i += 1) {
    const script = getLastScript();
    if (script) return script;
    await Promise.resolve();
  }
  throw new Error('Le script PayPal n’a pas été injecté');
}

function mockConfigFetch(opts) {
  const ok = opts && 'ok' in opts ? opts.ok : true;
  const paypal_client_id = opts && 'paypal_client_id' in opts ? opts.paypal_client_id : 'client-abc';
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(ok ? { paypal_client_id } : {}),
    })
  );
}

function makePaypalSdkMock({ isEligible = true } = {}) {
  const buttonsObj = {
    isEligible: jest.fn(() => isEligible),
    render: jest.fn(() => Promise.resolve()),
  };
  const captured = {};
  const paypal = {
    FUNDING: { PAYPAL: 'FUNDING_PAYPAL' },
    Buttons: jest.fn((config) => {
      captured.config = config;
      return buttonsObj;
    }),
  };
  return { paypal, buttonsObj, captured };
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  delete window.paypal;
});

describe('ensurePayPalSDK', () => {
  it('borne le chargement de la configuration pour ne jamais laisser le checkout attendre indéfiniment', async () => {
    jest.useFakeTimers();
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });
    global.fetch = jest.fn(() => new Promise(() => {}));

    const promise = mod.ensurePayPalSDK();
    jest.advanceTimersByTime(8000);

    await expect(promise).rejects.toThrow('Délai de chargement de la configuration PayPal dépassé');
    jest.useRealTimers();
  });

  it('résout avec window.paypal après un chargement réussi du SDK', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch({ ok: true, paypal_client_id: 'client-abc' });
    const getLastScript = mockScriptInjection();

    const promise = mod.ensurePayPalSDK();
    // Laisser le fetch + json() se résoudre avant de déclencher onload.
    await Promise.resolve();
    await Promise.resolve();

    window.paypal = { fake: true };
    (await waitForScriptInjection(getLastScript)).onload();

    const result = await promise;

    expect(result).toBe(window.paypal);
    expect(global.fetch).toHaveBeenCalledWith('/api/public/config', { credentials: 'include' });

    const src = getLastScript().src;
    expect(src).toContain('client-id=client-abc');
    expect(src).toContain('currency=EUR');
    expect(src).toContain('intent=capture');
    expect(src).toContain('enable-funding=paylater');
    expect(src).toContain('locale=fr_FR');
    expect(src).toContain('components=buttons');
  });

  it('est idempotent : un second appel ne relance pas le fetch de config', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch();
    const getLastScript = mockScriptInjection();

    const p1 = mod.ensurePayPalSDK();
    await Promise.resolve();
    await Promise.resolve();
    window.paypal = { fake: true };
    (await waitForScriptInjection(getLastScript)).onload();
    await p1;

    const p2 = mod.ensurePayPalSDK();
    const result2 = await p2;

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result2).toBe(window.paypal);
  });

  it('rejette si la config publique répond KO', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch({ ok: false });
    mockScriptInjection();

    await expect(mod.ensurePayPalSDK()).rejects.toThrow('Config publique indisponible');
  });

  it("rejette si paypal_client_id est absent de la config", async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch({ ok: true, paypal_client_id: undefined });
    mockScriptInjection();

    await expect(mod.ensurePayPalSDK()).rejects.toThrow('PayPal non configuré (client_id absent)');
  });

  it("rejette si le script SDK échoue à charger (adblock)", async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch();
    const getLastScript = mockScriptInjection();

    const promise = mod.ensurePayPalSDK();
    await Promise.resolve();
    await Promise.resolve();
    (await waitForScriptInjection(getLastScript)).onerror();

    await expect(promise).rejects.toThrow('Chargement SDK PayPal échoué (adblock ?)');
  });

  it('rejette si window.paypal reste indéfini après le onload du script', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch();
    const getLastScript = mockScriptInjection();

    const promise = mod.ensurePayPalSDK();
    await Promise.resolve();
    await Promise.resolve();
    // Pas de window.paypal assigné avant le onload.
    (await waitForScriptInjection(getLastScript)).onload();

    await expect(promise).rejects.toThrow('window.paypal non disponible après chargement');
  });
  it('retourne la même promesse en cas d\'appels concurrents avant résolution', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });

    mockConfigFetch();
    const getLastScript = mockScriptInjection();

    const p1 = mod.ensurePayPalSDK();
    const p2 = mod.ensurePayPalSDK(); // concurrent, avant toute résolution

    // Note : p1 et p2 sont deux Promises distinctes (une fonction async enveloppe
    // toujours sa valeur de retour dans une nouvelle Promise), mais elles adoptent
    // toutes les deux la même _sdkLoading interne — d'où fetch appelé une seule fois.

    await Promise.resolve();
    await Promise.resolve();
    window.paypal = { fake: true };
    (await waitForScriptInjection(getLastScript)).onload();

    await expect(p1).resolves.toBe(window.paypal);
    await expect(p2).resolves.toBe(window.paypal);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('renderPayPalButton', () => {
  async function loadReadyModule() {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });
    return mod;
  }

  async function primeLoadedSdk(mod, paypal) {
    mockConfigFetch();
    const getLastScript = mockScriptInjection();
    const p = mod.ensurePayPalSDK();
    await Promise.resolve();
    await Promise.resolve();
    window.paypal = paypal;
    (await waitForScriptInjection(getLastScript)).onload();
    await p;
  }

  it("lève une erreur si le container n'existe pas dans le DOM", async () => {
    const mod = await loadReadyModule();
    await expect(mod.renderPayPalButton('inexistant', {})).rejects.toThrow(
      'Container inexistant introuvable'
    );
  });

  it("affiche un message d'erreur et appelle onError si le SDK échoue à charger", async () => {
    const mod = await loadReadyModule();
    document.body.innerHTML = '<div id="pp"></div>';

    mockConfigFetch({ ok: false });
    mockScriptInjection();

    const onError = jest.fn();
    await mod.renderPayPalButton('pp', { onError });

    const container = document.getElementById('pp');
    expect(container.innerHTML).toContain('PayPal indisponible');
    expect(container.classList.contains('k-paypal-loading')).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rend les boutons PayPal avec la configuration attendue quand éligible', async () => {
    const mod = await loadReadyModule();
    document.body.innerHTML = '<div id="pp"></div>';

    const { paypal, buttonsObj, captured } = makePaypalSdkMock({ isEligible: true });
    await primeLoadedSdk(mod, paypal);

    await mod.renderPayPalButton('pp', { prepareKomerceOrder: jest.fn() });

    expect(paypal.Buttons).toHaveBeenCalledTimes(1);
    expect(captured.config.fundingSource).toBe(paypal.FUNDING.PAYPAL);
    expect(captured.config.style).toEqual({
      layout: 'vertical',
      color: 'gold',
      shape: 'rect',
      label: 'paypal',
      height: 45,
    });
    expect(buttonsObj.isEligible).toHaveBeenCalled();
    expect(buttonsObj.render).toHaveBeenCalledWith('#pp');
  });

  it("affiche un message et n'appelle pas render si les boutons ne sont pas éligibles", async () => {
    const mod = await loadReadyModule();
    document.body.innerHTML = '<div id="pp"></div>';

    const { paypal, buttonsObj } = makePaypalSdkMock({ isEligible: false });
    await primeLoadedSdk(mod, paypal);

    await mod.renderPayPalButton('pp', {});

    expect(buttonsObj.render).not.toHaveBeenCalled();
    expect(document.getElementById('pp').innerHTML).toContain('non éligible');
  });

  describe('handler onClick', () => {
    it('resolve si validateBeforeClick renvoie true', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const validateBeforeClick = jest.fn().mockResolvedValue(true);
      await mod.renderPayPalButton('pp', { validateBeforeClick });

      const actions = { resolve: jest.fn(), reject: jest.fn() };
      await captured.config.onClick({}, actions);

      expect(actions.resolve).toHaveBeenCalled();
      expect(actions.reject).not.toHaveBeenCalled();
    });

    it('reject si validateBeforeClick renvoie false', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const validateBeforeClick = jest.fn().mockResolvedValue(false);
      await mod.renderPayPalButton('pp', { validateBeforeClick });

      const actions = { resolve: jest.fn(), reject: jest.fn() };
      await captured.config.onClick({}, actions);

      expect(actions.reject).toHaveBeenCalled();
      expect(actions.resolve).not.toHaveBeenCalled();
    });

    it('reject + toast si validateBeforeClick lève une exception', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const validateBeforeClick = jest.fn().mockRejectedValue(new Error('boom'));
      await mod.renderPayPalButton('pp', { validateBeforeClick });

      const actions = { resolve: jest.fn(), reject: jest.fn() };
      await captured.config.onClick({}, actions);

      expect(showToast).toHaveBeenCalledWith('Vérifiez le formulaire avant de payer', 'error');
      expect(actions.reject).toHaveBeenCalled();
    });

    it('resolve directement en l\'absence de validateBeforeClick', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      await mod.renderPayPalButton('pp', {});

      const actions = { resolve: jest.fn(), reject: jest.fn() };
      await captured.config.onClick({}, actions);

      expect(actions.resolve).toHaveBeenCalled();
    });
  });

  describe('handler createOrder', () => {
    it("crée l'ordre Komerce puis la commande PayPal côté serveur", async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const prepareKomerceOrder = jest.fn().mockResolvedValue({ order_reference: 'REF-1', order_id: 'id-1' });
      apiPost.mockResolvedValue({ paypal_order_id: 'PP-ORDER-1' });

      await mod.renderPayPalButton('pp', { prepareKomerceOrder });

      const result = await captured.config.createOrder();

      expect(prepareKomerceOrder).toHaveBeenCalled();
      expect(apiPost).toHaveBeenCalledWith('/api/payments/paypal/create-order', {
        order_reference: 'REF-1',
      });
      expect(result).toBe('PP-ORDER-1');
    });

    it("lève + toast + onError si l'ordre Komerce n'a pas de order_reference", async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const prepareKomerceOrder = jest.fn().mockResolvedValue({});
      const onError = jest.fn();
      await mod.renderPayPalButton('pp', { prepareKomerceOrder, onError });

      await expect(captured.config.createOrder()).rejects.toThrow('Ordre Komerce non créé');
      expect(showToast).toHaveBeenCalledWith('Ordre Komerce non créé', 'error');
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('lève si paypal_order_id est absent de la réponse serveur', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const prepareKomerceOrder = jest.fn().mockResolvedValue({ order_reference: 'REF-1' });
      apiPost.mockResolvedValue({});

      await mod.renderPayPalButton('pp', { prepareKomerceOrder });

      await expect(captured.config.createOrder()).rejects.toThrow(
        'paypal_order_id manquant dans la réponse serveur'
      );
    });
  });

  describe('handler onApprove', () => {
    it('affiche un toast succès et appelle onSuccess quand la capture réussit', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const onSuccess = jest.fn();
      apiPost.mockResolvedValue({ success: true });
      await mod.renderPayPalButton('pp', { onSuccess });

      await captured.config.onApprove({ orderID: 'PP-1' });

      expect(apiPost).toHaveBeenCalledWith('/api/payments/paypal/capture/PP-1', {});
      expect(showToast).toHaveBeenCalledWith('🎉 Paiement PayPal accepté !', 'success');
      expect(onSuccess).toHaveBeenCalledWith({ success: true });
    });

    it('traite already_paid comme un succès', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const onSuccess = jest.fn();
      apiPost.mockResolvedValue({ already_paid: true });
      await mod.renderPayPalButton('pp', { onSuccess });

      await captured.config.onApprove({ orderID: 'PP-2' });

      expect(onSuccess).toHaveBeenCalledWith({ already_paid: true });
    });

    it('encode orderID dans l\'URL de capture', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      apiPost.mockResolvedValue({ success: true });
      await mod.renderPayPalButton('pp', {});

      await captured.config.onApprove({ orderID: 'id with space' });

      expect(apiPost).toHaveBeenCalledWith(
        `/api/payments/paypal/capture/${encodeURIComponent('id with space')}`,
        {}
      );
    });

    it('toast erreur + onError si la capture est incomplète', async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const onError = jest.fn();
      apiPost.mockResolvedValue({ success: false });
      await mod.renderPayPalButton('pp', { onError });

      await captured.config.onApprove({ orderID: 'PP-3' });

      expect(showToast).toHaveBeenCalledWith('Capture PayPal incomplète', 'error');
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("toast erreur si apiPost rejette (réseau)", async () => {
      const mod = await loadReadyModule();
      document.body.innerHTML = '<div id="pp"></div>';
      const { paypal, captured } = makePaypalSdkMock();
      await primeLoadedSdk(mod, paypal);

      const onError = jest.fn();
      apiPost.mockRejectedValue(new Error('network down'));
      await mod.renderPayPalButton('pp', { onError });

      await captured.config.onApprove({ orderID: 'PP-4' });

      expect(showToast).toHaveBeenCalledWith('network down', 'error');
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('onCancel ne lève pas et ne produit pas de toast (annulation utilisateur silencieuse)', async () => {
    const mod = await loadReadyModule();
    document.body.innerHTML = '<div id="pp"></div>';
    const { paypal, captured } = makePaypalSdkMock();
    await primeLoadedSdk(mod, paypal);
    await mod.renderPayPalButton('pp', {});

    expect(() => captured.config.onCancel()).not.toThrow();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('onError (callback SDK) affiche un toast et relaie à opts.onError', async () => {
    const mod = await loadReadyModule();
    document.body.innerHTML = '<div id="pp"></div>';
    const { paypal, captured } = makePaypalSdkMock();
    await primeLoadedSdk(mod, paypal);

    const onError = jest.fn();
    await mod.renderPayPalButton('pp', { onError });

    const sdkErr = new Error('sdk broken');
    captured.config.onError(sdkErr);

    expect(showToast).toHaveBeenCalledWith('Erreur PayPal — réessayez ou utilisez la carte', 'error');
    expect(onError).toHaveBeenCalledWith(sdkErr);
  });
});

describe('isPayPalEnabled', () => {
  it('retourne true si la config répond ok avec un client_id', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });
    mockConfigFetch({ ok: true, paypal_client_id: 'abc' });

    await expect(mod.isPayPalEnabled()).resolves.toBe(true);
  });

  it("retourne false si la config répond ok mais sans client_id", async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });
    mockConfigFetch({ ok: true, paypal_client_id: undefined });

    await expect(mod.isPayPalEnabled()).resolves.toBe(false);
  });

  it('retourne false si la réponse config est KO', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });
    mockConfigFetch({ ok: false });

    await expect(mod.isPayPalEnabled()).resolves.toBe(false);
  });

  it('retourne false si fetch lève une exception (réseau)', async () => {
    let mod;
    await jest.isolateModulesAsync(async () => {
      mod = require('../../js/b-paypal.js');
    });
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(mod.isPayPalEnabled()).resolves.toBe(false);
  });
});
