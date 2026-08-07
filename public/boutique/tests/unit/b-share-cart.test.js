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
    test('affiche le contexte partagé et normalise le CTA', () => {
      appendElement('div', 'k-share-badge-row', { hidden: true });
      appendElement('button', 'k-cart-share');
      appendElement('div', 'k-sc-shared-badge');
      appendElement('button', 'k-sc-share', { hidden: true });

      refreshSharedBadges(true);

      expect(document.getElementById('k-share-badge-row').hidden).toBe(false);
      expect(document.getElementById('k-cart-share').textContent)
        .toBe('📤 Partager cette liste');
      expect(document.getElementById('k-sc-shared-badge').hidden).toBe(true);
      expect(document.getElementById('k-sc-share').hidden).toBe(false);
      expect(document.getElementById('k-sc-share').textContent)
        .toBe('📤 Partager cette liste');
      expect(refreshGroupBadge).toHaveBeenCalled();
    });

    test('masque le badge mobile si aucune liste n’est active', () => {
      appendElement('div', 'k-share-badge-row');
      refreshSharedBadges(false);
      expect(document.getElementById('k-share-badge-row').hidden).toBe(true);
    });

    test('ne dépend pas de la présence des éléments DOM', () => {
      expect(() => refreshSharedBadges(true)).not.toThrow();
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
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(mockGetSharedCartPublic).toHaveBeenCalledWith('tok-open');
      expect(mockActivateSharedListContext).toHaveBeenCalledWith(
        publicPayload,
        'tok-open',
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

    test('un repartage ne dépend pas du panier local', async () => {
      state.cart = [];
      state.shareToken = 'tok-1';
      state.shareUrl = 'https://x.test/boutique/?p=tok-1';
      state.cartName = 'Repas de famille';

      await startShareFlow({ reshare: true });

      expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('Repas de famille'),
        url: 'https://x.test/boutique/?p=tok-1',
      }));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('un repartage annulé par l’utilisateur ne produit pas d’erreur', async () => {
      state.shareToken = 'tok-2';
      state.shareUrl = 'https://x.test/boutique/?p=tok-2';
      navigator.share.mockRejectedValue(
        Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      );

      await expect(startShareFlow({ reshare: true })).resolves.toBeUndefined();
      expect(showToast).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe('install', () => {
    // PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART — régression :
    // #k-sc-group-view appelait l'ancien switchToGroup(), supprimé par une
    // session antérieure sans que ce listener soit mis à jour (ReferenceError
    // au clic). Couvre le câblage réel du bouton plutôt que la seule
    // fonction interne, pour qu'un futur renommage similaire échoue ici.
    // install() est un singleton au niveau module (_installed) : un seul
    // appel par fichier de test, les deux branches sont vérifiées via deux
    // clics successifs avec un état différent plutôt que deux install().
    test('#k-sc-group-view active la liste courante dans le side cart canonique (jamais switchToGroup)', async () => {
      appendElement('button', 'k-sc-group-view');

      install();

      state.shareToken = null;
      document.getElementById('k-sc-group-view').click();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockActivateFromParticipantUrl).not.toHaveBeenCalled();

      state.shareToken = 'tok-owner-1';
      document.getElementById('k-sc-group-view').click();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockActivateFromParticipantUrl).toHaveBeenCalledWith('tok-owner-1');
    });
  });
});
