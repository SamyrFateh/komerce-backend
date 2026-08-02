'use strict';

/**
 * tests/unit/b-share-cart.test.js
 *
 * js/b-share-cart.js (675L) — flow "📤 Partager" côté créateur.
 * Exports réels : clearShareState, restoreSharedCartFromBackend,
 * refreshSharedBadges, startShareFlow, install.
 *
 * Dépendances mockées : b-cart-core.js (showToast), b-cart.js (clearCart),
 * group/group-state.js (refreshGroupBadge), b-group-banner.js (showBanner/
 * hideBanner/refreshBanner), b-identity.js (requireIdentity — non exercé
 * dans ce périmètre mais mocké par prudence).
 * global.fetch mocké par tests/unit/setup.js, surchargé par test.
 *
 * Périmètre choisi : restoreSharedCartFromBackend (source de vérité P0 —
 * argent/état), clearShareState, refreshSharedBadges (DOM), et les gardes
 * + branches directement atteignables de startShareFlow (panier vide,
 * reshare avec panier actif → WhatsApp par shareMode, panier actif détecté
 * → choix "voir mon groupe"/"annuler"). Laissé de côté : `promptInit`
 * (~190L de câblage de formulaire DOM + validation téléphone) et le chemin
 * de création complet qui l'appelle en interne (binding privé non
 * interceptable sans le faire tourner réellement) — dette assumée pour un
 * sous-lot dédié avec une fixture DOM plus lourde, comme pour
 * `renderCheckout()` (b-checkout.js) et `setupModal()` (b-modal-core.js).
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
jest.mock('../../js/b-identity.js', () => ({ requireIdentity: jest.fn() }));

const { state } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-cart-core.js');
const { refreshGroupBadge } = require('../../js/group/group-state.js');
const { hideBanner } = require('../../js/b-group-banner.js');
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
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue() },
      configurable: true,
    });
  });

  describe('clearShareState', () => {
    test('réinitialise tous les champs share_* et purge sessionStorage', () => {
      state.shareToken = 'tok-1';
      state.shareId = 'cart-1';
      state.cartName = 'Panier X';
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
    test('isShared=true → badge mobile visible, badge desktop masqué (remplacé par bouton Partager)', () => {
      document.body.innerHTML = `
        <div id="k-share-badge-row" hidden></div>
        <button id="k-cart-share"></button>
        <div id="k-sc-shared-badge"></div>
        <button id="k-sc-share" hidden></button>`;
      refreshSharedBadges(true);
      expect(document.getElementById('k-share-badge-row').hidden).toBe(false);
      expect(document.getElementById('k-cart-share').textContent).toBe('📤 Partager');
      expect(document.getElementById('k-sc-shared-badge').hidden).toBe(true);
      expect(document.getElementById('k-sc-share').hidden).toBe(false);
      expect(refreshGroupBadge).toHaveBeenCalled();
    });

    test('isShared=false → badge mobile masqué', () => {
      document.body.innerHTML = `<div id="k-share-badge-row"></div>`;
      refreshSharedBadges(false);
      expect(document.getElementById('k-share-badge-row').hidden).toBe(true);
    });

    test('sans aucun élément DOM présent → ne throw pas', () => {
      expect(() => refreshSharedBadges(true)).not.toThrow();
    });
  });

  describe('restoreSharedCartFromBackend', () => {
    test('401/403 (non connecté) → retourne null sans toucher au state local', async () => {
      state.shareToken = 'tok-preserved';
      global.fetch.mockResolvedValue({ ok: false, status: 401 });
      const result = await restoreSharedCartFromBackend({ silent: true });
      expect(result).toBeNull();
      expect(state.shareToken).toBe('tok-preserved');
    });

    test('erreur serveur (500) en silencieux → pas de toast, retourne null', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500 });
      const result = await restoreSharedCartFromBackend({ silent: true });
      expect(result).toBeNull();
      expect(showToast).not.toHaveBeenCalled();
    });

    test('erreur réseau non silencieuse → toast erreur affiché', async () => {
      global.fetch.mockRejectedValue(new Error('offline'));
      const result = await restoreSharedCartFromBackend({ silent: false });
      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('offline'), 'error');
    });

    test('200 + liste vide → purge le state local (le backend confirme : aucun panier actif)', async () => {
      state.shareToken = 'tok-old';
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ carts: [] }) });
      const result = await restoreSharedCartFromBackend();
      expect(result).toBeNull();
      expect(state.shareToken).toBeNull();
    });

    test('200 + carts contenant uniquement des paniers non actifs (finalized/cancelled) → purge', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ carts: [{ id: '1', status: 'finalized' }, { id: '2', status: 'cancelled' }] }),
      });
      const result = await restoreSharedCartFromBackend();
      expect(result).toBeNull();
      expect(state.shareToken).toBeNull();
    });

    test('200 + panier actif → applique au state, sauvegarde sessionStorage, montre la bannière', async () => {
      const cart = {
        id: 'cart-9', token: 'tok-9', status: 'open', title: 'Anniversaire',
        total_kmf_snapshot: 8000, contributed_kmf: 2000, remaining_kmf: 6000,
        created_at: new Date().toISOString(),
      };
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ carts: [cart] }) });
      const result = await restoreSharedCartFromBackend();

      expect(result).toEqual(cart);
      expect(state.shareToken).toBe('tok-9');
      expect(state.shareId).toBe('cart-9');
      expect(state.shareTotalKmf).toBe(8000);
      expect(state.shareRemainingKmf).toBe(6000);
      expect(JSON.parse(window.sessionStorage.getItem('kmrc_share')).token).toBe('tok-9');
      expect(refreshGroupBadge).toHaveBeenCalled();
    });

    test("plusieurs paniers actifs → sélectionne le plus récent (created_at)", async () => {
      const older = { id: 'old', token: 'tok-old', status: 'open', created_at: '2026-01-01T00:00:00Z' };
      const newer = { id: 'new', token: 'tok-new', status: 'open', created_at: '2026-06-01T00:00:00Z' };
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ carts: [older, newer] }) });
      await restoreSharedCartFromBackend();
      expect(state.shareToken).toBe('tok-new');
    });
  });

  describe('startShareFlow — gardes et branches directes', () => {
    test('panier vide → toast erreur, aucun appel réseau', async () => {
      state.cart = [];
      await startShareFlow({});
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('panier'), 'error');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    describe('reshare=true avec panier déjà partagé → WhatsApp direct (pas de re-création)', () => {
      beforeEach(() => {
        state.cart = [{ id: 'p1', qty: 1, product: { id: 'p1' } }];
        state.shareToken = 'tok-1';
        state.shareUrl = 'https://x.test/boutique/?p=tok-1';
        state.cartName = 'Panier de groupe';
      });

      test('shareStatus="closed" → message "ready_to_pay" (règlement ouvert)', async () => {
        state.shareStatus = 'closed';
        await startShareFlow({ reshare: true });
        expect(window.open).toHaveBeenCalledWith(
          expect.stringContaining('r%C3%A9gler%20ta%20part'),
          '_blank', 'noopener',
        );
        expect(global.fetch).not.toHaveBeenCalled();
      });

      test('shareStatus="open" → message "needs_validation" (pas encore confirmé)', async () => {
        state.shareStatus = 'open';
        await startShareFlow({ reshare: true });
        expect(window.open).toHaveBeenCalledWith(
          expect.stringContaining('sera%20ouvert%20quand'),
          '_blank', 'noopener',
        );
      });

      test('copie le lien de partage dans le presse-papier', async () => {
        await startShareFlow({ reshare: true });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://x.test/boutique/?p=tok-1');
      });
    });

    describe('!reshare avec panier actif déjà présent → modale de choix', () => {
      beforeEach(() => {
        state.cart = [{ id: 'p1', qty: 1, product: { id: 'p1' } }];
        state.shareToken = 'tok-1';
        state.cartName = 'Panier existant';
      });

      test('clic "Annuler" (croix) → aucune action, pas d\'appel réseau', async () => {
        const flowPromise = startShareFlow({});
        // La modale de choix est injectée de façon synchrone dans le DOM.
        document.querySelector('.k-sm-close').click();
        await flowPromise;
        expect(global.fetch).not.toHaveBeenCalled();
      });

      test('clic "Voir mon groupe actif" → bascule vers l\'onglet groupe (pas de nouvelle création)', async () => {
        const flowPromise = startShareFlow({});
        document.querySelector('#k-sm-view-group').click();
        await flowPromise;
        expect(global.fetch).not.toHaveBeenCalled();
      });
    });
  });
});
