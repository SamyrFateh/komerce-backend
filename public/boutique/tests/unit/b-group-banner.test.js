'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-group-banner.test.js
 *
 * Module js/b-group-banner.js (220L) — jamais testé en direct avant cette
 * session (mocké dans b-share-cart.test.js / b-group-view.test.js).
 *
 * ⚠️ Constat de lecture du code : `showBanner(data)` (ligne 177) a été vidé
 * par la doctrine "cockpit Groupe — mai 2026" (commentaire du fichier) et se
 * résume désormais à `hideBanner(); return;` — il ignore totalement `data`.
 * Conséquence : buildHTML, getOrCreateBanner, bindBanner, expandBanner,
 * shouldAutoCollapse, scheduleCollapse, startTick, timeRemaining, pct,
 * isClosedStatus (≈140 lignes, plus de la moitié du fichier) sont du code
 * mort — plus aucun chemin d'exécution ne les atteint. Confirmé par grep :
 * aucun appelant externe n'invoque autre chose que showBanner/hideBanner/
 * refreshBanner (les 3 seuls exports).
 *
 * Ce fichier de test couvre donc la surface réellement exécutable — les 3
 * exports — et ne teste pas les fonctions internes mortes (aucune valeur
 * ajoutée à tester du code inatteignable). Cf. rapport livré séparément
 * pour la proposition de suppression du code mort.
 *
 * Import réel (aucun mock du sujet testé). fetch mocké (réseau hors
 * périmètre unitaire, pattern global.fetch déjà en place via setup.js).
 */

const { state } = require('../../js/b-store.js');
const { showBanner, hideBanner, refreshBanner } = require('../../js/b-group-banner.js');

function resetState() {
  state.shareToken = null;
  state.shareExpiry = null;
  state.shareStatus = null;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  resetState();
  global.fetch = jest.fn();
});

describe('showBanner (vidée par la doctrine cockpit Groupe — délègue entièrement à hideBanner)', () => {
  it('ne throw pas, quel que soit le contenu de data', () => {
    expect(() => showBanner({ title: 'Panier X', status: 'fully_funded' })).not.toThrow();
    expect(() => showBanner()).not.toThrow();
    expect(() => showBanner(null)).not.toThrow();
  });

  it('masque une bannière existante au lieu de l\'afficher (comportement actuel du code)', () => {
    const el = document.createElement('div');
    el.id = 'k-group-banner';
    el.classList.add('show', 'is-compact');
    document.body.appendChild(el);

    showBanner({ title: 'Panier X', status: 'fully_funded' });

    expect(el.classList.contains('show')).toBe(false);
    expect(el.classList.contains('is-compact')).toBe(false);
  });
});

describe('hideBanner', () => {
  it('ne throw pas si aucune bannière dans le DOM', () => {
    expect(() => hideBanner()).not.toThrow();
  });

  it('retire les classes show et is-compact de la bannière existante', () => {
    const el = document.createElement('div');
    el.id = 'k-group-banner';
    el.className = 'k-group-banner show is-compact';
    document.body.appendChild(el);

    hideBanner();

    expect(el.classList.contains('show')).toBe(false);
    expect(el.classList.contains('is-compact')).toBe(false);
  });

  it('conserve les autres classes de la bannière', () => {
    const el = document.createElement('div');
    el.id = 'k-group-banner';
    el.className = 'k-group-banner show';
    document.body.appendChild(el);

    hideBanner();

    expect(el.classList.contains('k-group-banner')).toBe(true);
  });
});

describe('refreshBanner', () => {
  it('sans state.shareToken : masque la bannière sans appeler fetch', () => {
    state.shareToken = null;
    refreshBanner();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('avec state.shareToken : appelle le bon endpoint avec credentials include', () => {
    state.shareToken = 'tok-123';
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cart: null }) });
    refreshBanner();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/tok-123',
      { credentials: 'include' }
    );
  });

  it('réponse ok mais sans data.cart : masque la bannière et purge le sessionStorage', async () => {
    state.shareToken = 'tok-123';
    window.sessionStorage.setItem('kmrc_share', '{"token":"tok-123"}');
    window.sessionStorage.setItem('kmrc_banner_dismissed', '1');
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    refreshBanner();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(window.sessionStorage.getItem('kmrc_share')).toBeNull();
    expect(window.sessionStorage.getItem('kmrc_banner_dismissed')).toBeNull();
  });

  it('réponse non-ok (ex 404/410, panier supprimé) : traité comme absence de cart, masque + purge', async () => {
    state.shareToken = 'tok-123';
    window.sessionStorage.setItem('kmrc_share', '{"token":"tok-123"}');
    global.fetch.mockResolvedValue({ ok: false, status: 404 });

    refreshBanner();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(window.sessionStorage.getItem('kmrc_share')).toBeNull();
  });

  it('réponse ok avec data.cart : synchronise expiry et status', async () => {
    state.shareToken = 'tok-123';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        cart: {
          title: 'Panier familial',
          expires_at: '2026-08-01T00:00:00Z',
          status: 'active',
        },
      }),
    });

    refreshBanner();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(state.shareExpiry).toBe('2026-08-01T00:00:00Z');
    expect(state.shareStatus).toBe('active');
  });

  it('erreur réseau (fetch rejette) : ne throw pas, silencieusement avalée', async () => {
    state.shareToken = 'tok-123';
    global.fetch.mockRejectedValue(new Error('offline'));

    expect(() => refreshBanner()).not.toThrow();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    // rien à assert de plus : le .catch(() => {}) doit juste avaler l'erreur
  });
});
