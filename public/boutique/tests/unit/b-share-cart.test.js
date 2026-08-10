'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests du flux « Partager cette liste ».
 *
 * Le module ne possède plus de formulaire de création : un clic vérifie
 * l'identité, crée la liste à partir du panier puis ouvre le canal de partage.
 */

jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ clearCart: jest.fn() }));
jest.mock('../../js/group/group-state.js', () => ({
  refreshGroupBadge: jest.fn(),
}));
jest.mock('../../js/b-nav.js', () => ({ switchView: jest.fn() }));
jest.mock('../../js/b-group-banner.js', () => ({
  showBanner: jest.fn(),
  hideBanner: jest.fn(),
  refreshBanner: jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn().mockResolvedValue({ id: 'user-1' }),
}));
const mockActivateFromParticipantUrl = jest.fn().mockResolvedValue(true);
const mockActivateSharedListContext = jest.fn();
jest.mock('../../js/group/group-side-cart.js', () => ({
  activateFromParticipantUrl: mockActivateFromParticipantUrl,
  activateSharedListContext: mockActivateSharedListContext,
  // Correctif archéologie (mandat §2) — activateCartInCanonicalSurface()
  // consulte désormais ce garde avant toute réactivation silencieuse ;
  // false par défaut ici (aucun test de ce fichier ne couvre le × lui-même,
  // couvert par group-side-cart.test.js) pour ne changer le comportement
  // d'aucun test existant.
  isDismissedSharedListToken: jest.fn().mockReturnValue(false),
}));
// P0-A — restoreSharedCartFromBackend() active désormais réellement la
// liste dans le side cart canonique (activateCartInCanonicalSurface), pas
// seulement le cache de session : ce chemin appelle getSharedCartPublic()
// (group-api.js) en plus du GET /mine ci-dessous. fetchWithTimeout reste
// réel (utilisé par le GET /mine lui-même, sur le même global.fetch mocké
// par test).
const mockGetSharedCartPublic = jest.fn().mockResolvedValue(null);
jest.mock('../../js/group/group-api.js', () => ({
  fetchWithTimeout: jest.requireActual('../../js/group/group-api.js').fetchWithTimeout,
  getSharedCartPublic: mockGetSharedCartPublic,
}));

const { state } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-cart-core.js');
const { refreshGroupBadge } = require('../../js/group/group-state.js');
const { hideBanner, showBanner } = require('../../js/b-group-banner.js');
const {
  clearShareState,
  restoreSharedCartFromBackend,
  refreshSharedBadges,
  startShareFlow,
  install,
} = require('../../js/b-share-cart.js');

function resetShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareUrl = null;
  state.cart = [];
}

function appendElement(tagName, id, { hidden = false, className = '', tab = null } = {}) {
  const element = document.createElement(tagName);
  element.id = id;
  element.hidden = hidden;
  element.className = className;
  if (tab) element.dataset.tab = tab;
  document.body.appendChild(element);
  return element;
}

describe('b-share-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.replaceChildren();
    window.sessionStorage.clear();
    resetShareState();
    global.fetch = jest.fn();
    window.open = jest.fn();

    Object.defineProperty(navigator, 'share', {
      value: jest.fn().mockResolvedValue(),
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue() },
      configurable: true,
    });
  });

  describe('clearShareState', () => {
    test('réinitialise tous les champs share_* et purge sessionStorage', () => {
      state.shareToken = 'tok-1';
      state.shareId = 'cart-1';
      state.cartName = 'Liste X';
      window.sessionStorage.setItem('kmrc_share', '{"token":"tok-1"}');
      window.sessionStorage.setItem('kmrc_banner_dismissed', '1');

      clearShareState();

      expect(state.shareToken).toBeNull();
      expect(state.shareId).toBeNull();
      expect(state.cartName).toBe('');
      expect(window.sessionStorage.getItem('kmrc_share')).toBeNull();
      expect(window.sessionStorage.getItem('kmrc_banner_dismissed')).toBeNull();
      expect(refreshGroupBadge).toHaveBeenCalled();
      expect(hideBanner).toHaveBeenCalled();
    });
  });

  describe('refreshSharedBadges', () => {
    test('normalise l’unique CTA Partager sans badge concurrent', () => {
      appendElement('button', 'k-cart-share');
      appendElement('button', 'k-sc-share', { hidden: true });

      refreshSharedBadges(true);

      expect(document.getElementById('k-cart-share').textContent)
        .toBe('Partager');
      expect(document.getElementById('k-sc-share').hidden).toBe(false);
      expect(document.getElementById('k-sc-share').textContent)
        .toBe('Partager');
      expect(document.getElementById('k-share-badge-row')).toBeNull();
      expect(document.getElementById('k-cart-reshare')).toBeNull();
      expect(document.getElementById('k-sc-reshare')).toBeNull();
      expect(refreshGroupBadge).toHaveBeenCalled();
    });

    test('ne dépend pas de la présence des éléments DOM', () => {
      expect(() => refreshSharedBadges(false)).not.toThrow();
    });
  });

  describe('restoreSharedCartFromBackend', () => {
    test('401/403 retourne null sans toucher au cache local', async () => {
      state.shareToken = 'tok-preserved';
      global.fetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await restoreSharedCartFromBackend({ silent: true });

      expect(result).toBeNull();
      expect(state.shareToken).toBe('tok-preserved');
    });

    test('une erreur serveur silencieuse ne produit pas de toast', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await restoreSharedCartFromBackend({ silent: true });

      expect(result).toBeNull();
      expect(showToast).not.toHaveBeenCalled();
    });

    test('une erreur réseau non silencieuse est signalée', async () => {
      global.fetch.mockRejectedValue(new Error('offline'));

      const result = await restoreSharedCartFromBackend({ silent: false });

      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('offline'),
        'error',
      );
    });

    test('une liste vide confirmée par le backend purge le cache', async () => {
      state.shareToken = 'tok-old';
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ carts: [] }),
      });

      const result = await restoreSharedCartFromBackend();

      expect(result).toBeNull();
      expect(state.shareToken).toBeNull();
    });

    test('ignore les listes annulées et archivées', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          carts: [
            { id: '1', status: 'archived' },
            { id: '2', status: 'cancelled' },
          ],
        }),
      });

      await restoreSharedCartFromBackend();

      expect(state.shareToken).toBeNull();
    });

    test('restaure la liste active la plus récente', async () => {
      const older = {
        id: 'old',
        token: 'tok-old',
        status: 'open',
        title: 'Ancienne liste',
        created_at: '2026-01-01T00:00:00Z',
      };
      const newer = {
        id: 'new',
        token: 'tok-new',
        status: 'open',
        title: 'Liste récente',
        created_at: '2026-06-01T00:00:00Z',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ carts: [older, newer] }),
      });

      const result = await restoreSharedCartFromBackend();

      expect(result).toEqual(newer);
      expect(state.shareToken).toBe('tok-new');
      expect(state.cartName).toBe('Liste récente');
      expect(JSON.parse(sessionStorage.getItem('kmrc_share')).token).toBe('tok-new');
      expect(showBanner).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Liste récente',
        status: 'open',
      }));
    });

    test('P0-A — active réellement la liste OPEN restaurée dans le side cart canonique, pas seulement le cache de session', async () => {
      const openCart = {
        id: 'sc-open',
        token: 'tok-open',
        status: 'open',
        title: 'Liste du jour',
        created_at: '2026-06-01T00:00:00Z',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ carts: [openCart] }),
      });
      const publicPayload = { cart: { id: 'sc-open', token: 'tok-open', status: 'open' }, items: [], is_creator: true };
      mockGetSharedCartPublic.mockResolvedValueOnce(publicPayload);

      await restoreSharedCartFromBackend();

      expect(mockGetSharedCartPublic).toHaveBeenCalledWith('tok-open');
      expect(mockActivateSharedListContext).toHaveBeenCalledWith(
        publicPayload,
        'tok-open',
        { silent: true },
      );
    });

    test('P0 — restoreSharedCartFromBackend() attend l\'activation de la surface canonique avant de resoudre (pas de course)', async () => {
      // Régression du bug audité : activateCartInCanonicalSurface() n'était
      // pas awaited -> la promesse de restoreSharedCartFromBackend()
      // resolvait AVANT que activateSharedListContext() ait été appelée.
      // Ce test échoue si le await est retiré de b-share-cart.js, car il
      // n'y a ici AUCUN tick de microtask supplémentaire après le await
      // de la fonction testée elle-même.
      const openCart = {
        id: 'sc-open-2', token: 'tok-open-2', status: 'open',
        title: 'Liste immediate', created_at: '2026-06-01T00:00:00Z',
      };
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ carts: [openCart] }) });
      let resolveGetPublic;
      mockGetSharedCartPublic.mockReturnValueOnce(new Promise((resolve) => { resolveGetPublic = resolve; }));

      const restorePromise = restoreSharedCartFromBackend();
      // Laisse le fetch /mine se résoudre, mais getSharedCartPublic reste
      // en attente tant qu'on n'a pas appelé resolveGetPublic().
      await Promise.resolve();
      await Promise.resolve();
      expect(mockActivateSharedListContext).not.toHaveBeenCalled();

      resolveGetPublic({ cart: { id: 'sc-open-2', token: 'tok-open-2', status: 'open' }, items: [], is_creator: true });
      await restorePromise;

      expect(mockActivateSharedListContext).toHaveBeenCalledWith(
        expect.objectContaining({ cart: expect.objectContaining({ token: 'tok-open-2' }) }),
        'tok-open-2',
        { silent: true },
      );
    });

    test('P1-A/§9 — une liste CLOSED n\'est plus restaurée comme active au boot (ni cache, ni side cart)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          carts: [{ id: 'sc-closed', token: 'tok-closed', status: 'closed', created_at: '2026-06-01T00:00:00Z' }],
        }),
      });

      const result = await restoreSharedCartFromBackend();
      await Promise.resolve(); await Promise.resolve();

      expect(result).toBeNull();
      expect(state.shareToken).toBeNull();
      expect(mockActivateSharedListContext).not.toHaveBeenCalled();
    });

    // Correctif archéologie (mandat §2) — le × ne doit jamais être
    // court-circuité par la restauration silencieuse au boot : un token
    // marqué "quitté" par isDismissedSharedListToken() ne doit provoquer
    // aucune activation du side cart, même si /mine le renvoie toujours
    // OPEN (l'organisateur ne l'a pas clôturé, juste quitté l'affichage).
    test('mandat §2 — une liste OPEN dont le token est marqué "quitté" (×) n\'est pas réactivée au boot silencieux', async () => {
      const { isDismissedSharedListToken } = require('../../js/group/group-side-cart.js');
      isDismissedSharedListToken.mockReturnValueOnce(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          carts: [{ id: 'sc-dismissed', token: 'tok-dismissed', status: 'open', created_at: '2026-06-01T00:00:00Z' }],
        }),
      });

      const result = await restoreSharedCartFromBackend();
      await Promise.resolve(); await Promise.resolve();

      // Le cache de session (badge/bandeau) reste synchronisé normalement —
      // seule l'activation dans le side cart canonique est bloquée.
      expect(result).toEqual(expect.objectContaining({ token: 'tok-dismissed' }));
      expect(mockActivateSharedListContext).not.toHaveBeenCalled();
      expect(mockGetSharedCartPublic).not.toHaveBeenCalled();
    });

    // Une activation EXPLICITE (silent=false, ex. juste après publication
    // via openSharedListInCanonicalCart) ne doit jamais être bloquée par ce
    // garde — seul le boot silencieux (restoreSharedCartFromBackend) le
    // consulte. Non couvert directement ici (openSharedListInCanonicalCart
    // n'est pas exportée), mais le contrat silent=true est vérifié
    // ci-dessus et documenté dans activateCartInCanonicalSurface().
  });

  describe('startShareFlow', () => {
    test('un panier vide bloque seulement une nouvelle création', async () => {
      await startShareFlow();

      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('panier'),
        'error',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('Partager depuis la liste affichée ne dépend pas du panier local', async () => {
      state.cart = [];
      state.cartSurface = 'shared-list';
      state.sharedListContext = {
        token: 'tok-1',
        status: 'open',
        isCreator: true,
        creatorFirstName: 'Sam',
      };

      await startShareFlow();

      expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Sélection Komerce',
        text: expect.stringContaining('sélection Komerce'),
        url: 'http://localhost/boutique/?p=tok-1',
      }));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('un partage de liste annulé par l’utilisateur ne produit pas d’erreur', async () => {
      state.cartSurface = 'shared-list';
      state.sharedListContext = {
        token: 'tok-2',
        status: 'open',
        isCreator: false,
        creatorFirstName: 'Awa',
      };
      navigator.share.mockRejectedValue(
        Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      );

      await expect(startShareFlow()).resolves.toBeUndefined();
      expect(showToast).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    });
  });


  describe('install — action Partager canonique', () => {
    test('câble uniquement les deux CTA canoniques et respecte le token participant au boot', async () => {
      const cartShare = appendElement('button', 'k-cart-share');
      const sideShare = appendElement('button', 'k-sc-share');
      state._pendingParticipantToken = 'tok-participant';

      install();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockActivateFromParticipantUrl).toHaveBeenCalledWith('tok-participant');
      expect(document.getElementById('k-cart-reshare')).toBeNull();
      expect(document.getElementById('k-sc-reshare')).toBeNull();

      expect(cartShare.disabled).toBe(false);
      expect(sideShare.disabled).toBe(false);

      state.shareToken = 'tok-clear-by-event';
      document.dispatchEvent(new Event('cart:cleared'));
      expect(state.shareToken).toBeNull();
    });
  });


});
