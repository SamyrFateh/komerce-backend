'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-greeting.test.js
 *
 * js/b-greeting.js — salutation furtive au boot boutique : appelle
 * GET /api/auth/me (best-effort), affiche un chip "Karibu <prénom> 😊"
 * pendant 4s si l'utilisateur est identifié, puis disparaît.
 *
 * Périmètre couvert :
 *   - guard sessionStorage (`kmrc_greeted`) : ne refait jamais l'appel
 *     réseau une fois le chip déjà montré dans la session
 *   - silence total sur tous les cas d'échec (réseau, !res.ok, user absent
 *     ou sans id) : aucun chip, aucune exception qui remonte à l'appelant
 *   - cas succès : construction du label (avec/sans prénom, avec/sans
 *     badge fidélité), pose du chip dans le DOM, `aria-live="polite"`,
 *     nettoyage d'un chip résiduel avant d'en poser un nouveau
 *   - cycle de vie du chip : apparition après deux rAF (classe
 *     `--visible`), sortie après DURATION (4000ms) via `--out`, puis
 *     suppression du DOM 280ms plus tard
 *
 * `greetIfKnown` est async (fetch + .json()) → chaque test await la
 * promesse retournée avant d'asserter. rAF rendu synchrone (comme les
 * autres suites b-*-premium-v1) ; timers réels par défaut sauf pour les
 * tests de cycle de vie du chip, qui basculent sur des fake timers.
 */

const GREETING_KEY = 'kmrc_greeted';
const CHIP_ID = 'k-greeting-chip';

function mockFetchOnce(implementation) {
  global.fetch = jest.fn(implementation);
  return global.fetch;
}

function mockSyncRaf() {
  window.requestAnimationFrame = (cb) => { cb(); return 0; };
}

describe('b-greeting', () => {
  let greetIfKnown;

  beforeEach(() => {
    jest.resetModules();
    sessionStorage.clear();
    document.body.innerHTML = '';
    mockSyncRaf();
    // eslint-disable-next-line global-require
    ({ greetIfKnown } = require('../../js/b-greeting.js'));
  });

  afterEach(() => {
    delete global.fetch;
    jest.useRealTimers();
  });

  test('guard sessionStorage : si déjà salué cette session, aucun appel réseau', async () => {
    sessionStorage.setItem(GREETING_KEY, '1');
    const fetchSpy = mockFetchOnce();

    await greetIfKnown();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.getElementById(CHIP_ID)).toBeNull();
  });

  test('échec réseau (fetch rejette) : silencieux, aucune exception, aucun chip', async () => {
    mockFetchOnce(() => Promise.reject(new Error('offline')));

    await expect(greetIfKnown()).resolves.toBeUndefined();

    expect(document.getElementById(CHIP_ID)).toBeNull();
    expect(sessionStorage.getItem(GREETING_KEY)).toBeNull();
  });

  test('res.ok === false (ex. 401 non connecté) : aucun chip, guard non posé', async () => {
    mockFetchOnce(() => Promise.resolve({ ok: false }));

    await greetIfKnown();

    expect(document.getElementById(CHIP_ID)).toBeNull();
    expect(sessionStorage.getItem(GREETING_KEY)).toBeNull();
  });

  test('utilisateur absent (user null) : aucun chip', async () => {
    mockFetchOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }));

    await greetIfKnown();

    expect(document.getElementById(CHIP_ID)).toBeNull();
  });

  test('utilisateur sans id : aucun chip', async () => {
    mockFetchOnce(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ full_name: 'Fatima Ali' }),
    }));

    await greetIfKnown();

    expect(document.getElementById(CHIP_ID)).toBeNull();
  });

  test('succès avec prénom et badge : chip posé avec le bon label, aria-live, guard sessionStorage activé', async () => {
    mockFetchOnce(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 7, full_name: 'Fatima Ali', loyalty_badge: '🏆' }),
    }));

    await greetIfKnown();

    const chip = document.getElementById(CHIP_ID);
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('Karibu Fatima 🏆 😊');
    expect(chip.getAttribute('aria-live')).toBe('polite');
    expect(sessionStorage.getItem(GREETING_KEY)).toBe('1');
  });

  test('succès sans prénom (full_name vide) ni badge : label générique', async () => {
    mockFetchOnce(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 7, full_name: '' }),
    }));

    await greetIfKnown();

    expect(document.getElementById(CHIP_ID).textContent).toBe('Karibu 😊');
  });

  test('nettoie un chip résiduel avant d\'en poser un nouveau', async () => {
    const stale = document.createElement('div');
    stale.id = CHIP_ID;
    stale.textContent = 'ancien chip';
    document.body.appendChild(stale);
    mockFetchOnce(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 7, full_name: 'Fatima' }),
    }));

    await greetIfKnown();

    expect(document.querySelectorAll(`#${CHIP_ID}`)).toHaveLength(1);
    expect(document.getElementById(CHIP_ID).textContent).toBe('Karibu Fatima 😊');
  });

  test('deuxième appel dans la même session (guard déjà posé) : pas de second fetch', async () => {
    mockFetchOnce(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 7, full_name: 'Fatima' }),
    }));

    await greetIfKnown();
    const fetchAfterFirst = global.fetch.mock.calls.length;
    await greetIfKnown();

    expect(global.fetch.mock.calls.length).toBe(fetchAfterFirst);
  });

  describe('cycle de vie du chip (timers)', () => {
    beforeEach(() => {
      // jest.useFakeTimers() mocke aussi requestAnimationFrame par défaut
      // (config Jest moderne), ce qui écrase le mock synchrone posé par
      // mockSyncRaf() dans le beforeEach externe : sans le réappliquer ici,
      // les deux rAF imbriqués de showGreetingChip() ne s'exécutent jamais
      // (ils restent en file d'attente fake, jamais avancée par ce test).
      jest.useFakeTimers();
      mockSyncRaf();
    });

    test('le chip devient visible après les deux rAF imbriqués', async () => {
      mockFetchOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 7, full_name: 'Fatima' }),
      }));

      await greetIfKnown();

      expect(document.getElementById(CHIP_ID).classList.contains('k-greeting-chip--visible')).toBe(true);
    });

    test('après DURATION (4000ms) : classe --out posée, --visible retirée', async () => {
      mockFetchOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 7, full_name: 'Fatima' }),
      }));

      await greetIfKnown();
      jest.advanceTimersByTime(4000);

      const chip = document.getElementById(CHIP_ID);
      expect(chip.classList.contains('k-greeting-chip--out')).toBe(true);
      expect(chip.classList.contains('k-greeting-chip--visible')).toBe(false);
    });

    test('280ms après la sortie : le chip est retiré du DOM', async () => {
      mockFetchOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 7, full_name: 'Fatima' }),
      }));

      await greetIfKnown();
      jest.advanceTimersByTime(4000 + 280);

      expect(document.getElementById(CHIP_ID)).toBeNull();
    });
  });
});
