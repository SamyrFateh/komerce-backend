'use strict';

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
jest.mock('../../js/group/group-render-list.js', () => ({
  renderGroupView: jest.fn(),
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

const { state } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-cart-core.js');
const { refreshGroupBadge } = require('../../js/group/group-state.js');
const { hideBanner, showBanner } = require('../../js/b-group-banner.js');
const {
  clearShareState,
  restoreSharedCartFromBackend,
  refreshSharedBadges,
  startShareFlow,
} = require('../../js/b-share-cart.js');

function resetShareState() {
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareTotalKmf = 0;
  state.shareContributedKmf = 0;
  state.shareRemainingKmf = 0;
  state.shareUrl = null;
  state.cart = [];
}

describe('b-share-cart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
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
      document.body.innerHTML = `
        <div id="k-share-badge-row" hidden></div>
        <button id="k-cart-share"></button>
        <div id="k-sc-shared-badge"></div>
        <button id="k-sc-share" hidden></button>`;

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
      document.body.innerHTML = '<div id="k-share-badge-row"></div>';
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
});
