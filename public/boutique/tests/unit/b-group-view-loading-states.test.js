'use strict';

/**
 * tests/unit/b-group-view-loading-states.test.js — FIX 2026-07-10
 *
 * Non-régression "onglet Groupe bloqué sur Chargement…".
 * Cahier des charges G.5 (partie vue) :
 *   - participant public : token timeout/reject → renderError lisible + Réessayer
 *   - créateur : /mine timeout/reject → pas de loader infini
 *   - le bouton Réessayer relance renderGroupView
 *   - polling arrêté quand la vue groupe n'est plus affichée
 *
 * Harnais identique à b-group-view.test.js (group-api mocké intégralement).
 */

const mockGroupApi = {
  getOwnerSharedCarts:   jest.fn(),
  getSharedCartOwner:    jest.fn(),
  getSharedCartPublic:   jest.fn(),
  getSharedCartItems:    jest.fn(),
  getEstimationAggregate: jest.fn(),
  upsertEstimation:      jest.fn(),
  getEstimationByPhone:  jest.fn(),
  createContribution:    jest.fn(),
  closeCart:             jest.fn(),
  openSettlement:        jest.fn(),
  extendPaymentWindow:   jest.fn(),
  finalizeSharedCart:    jest.fn(),
  cancelSharedCart:      jest.fn(),
};
jest.mock('../../js/group/group-api.js', () => mockGroupApi);
jest.mock('../../js/group/group-render-creator.js', () => ({
  renderCreatorCartSwitcher: jest.fn(() => ''),
  renderCreatorArticlesPanel: jest.fn(() => ''),
  renderCreatorUnifiedCard: jest.fn(() => '<div id="k-group-unified-card"></div>'),
  renderProgress: jest.fn(() => ''),
  renderCreatorActions: jest.fn(() => ''),
  renderCreatorIdentityCard: jest.fn(() => ''),
  renderOwnerIdentityCard: jest.fn(() => ''),
  renderCreatorFinancialSummary: jest.fn(() => ''),
}));
jest.mock('../../js/b-group-banner.js', () => ({ showBanner: jest.fn(), hideBanner: jest.fn() }));
jest.mock('../../js/b-identity.js', () => ({ requireIdentity: jest.fn() }));
jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn(), saveCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({
  clearShareState: jest.fn(),
  refreshSharedBadges: jest.fn(),
  restoreSharedCartFromBackend: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { renderGroupView, stopPolling } = require('../../js/b-group-view.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function timeoutError(url) {
  const e = new Error(`Délai dépassé (timeout 10000ms) — ${url}`);
  e.name = 'TimeoutError';
  e.isTimeout = true;
  return e;
}

function groupEl() { return document.getElementById('k-group-view'); }

describe('b-group-view — états de chargement', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    localStorage.clear();
    state.shareToken = null;
    Object.values(mockGroupApi).forEach((m) => m.mockReset());
    stopPolling();
  });

  test('participant : fetch public en timeout → renderError lisible + bouton Réessayer, pas de loader infini', async () => {
    mockGroupApi.getSharedCartPublic.mockRejectedValue(timeoutError('/api/shared-carts/public/tok'));
    await renderGroupView({ participantToken: 'tok-participant' });
    await flush();

    const el = groupEl();
    expect(el.textContent).not.toContain('Chargement…');
    expect(el.textContent).toContain('Chargement impossible');
    expect(el.textContent).toContain('trop de temps');
    expect(el.querySelector('#k-group-retry-btn')).toBeTruthy();
  });

  test('participant : Réessayer relance renderGroupView (2e essai OK)', async () => {
    mockGroupApi.getSharedCartPublic
      .mockRejectedValueOnce(timeoutError('/api/shared-carts/public/tok'))
      .mockResolvedValue(null); // 2e essai : réponse non-ok → erreur métier "Panier introuvable"
    await renderGroupView({ participantToken: 'tok-participant' });
    await flush();
    expect(groupEl().querySelector('#k-group-retry-btn')).toBeTruthy();

    groupEl().querySelector('#k-group-retry-btn').click();
    await flush(); await flush();

    expect(mockGroupApi.getSharedCartPublic).toHaveBeenCalledTimes(2);
    expect(groupEl().textContent).not.toContain('Chargement…');
  });

  test('créateur : /mine en timeout → pas de loader infini, état erreur + Réessayer', async () => {
    mockGroupApi.getOwnerSharedCarts.mockRejectedValue(timeoutError('/api/shared-carts/mine'));
    await renderGroupView({});
    await flush();

    const el = groupEl();
    expect(el.textContent).not.toContain('Chargement…');
    expect(el.querySelector('#k-group-retry-btn')).toBeTruthy();
  });

  test('créateur : /mine rejette (erreur générique) → état erreur contrôlé, jamais de rejet non géré', async () => {
    mockGroupApi.getOwnerSharedCarts.mockRejectedValue(new Error('HTTP 503'));
    await expect(renderGroupView({})).resolves.toBeUndefined(); // ne throw JAMAIS
    const el = groupEl();
    expect(el.textContent).toContain('Chargement impossible');
  });

  test('polling : le tick s\'auto-arrête si la vue groupe n\'a plus la classe show', async () => {
    jest.useFakeTimers();
    try {
      // Créateur avec un panier actif → startPolling démarre
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({
        carts: [{ id: 1, status: 'open', title: 'T', total_kmf_snapshot: 1000 }],
      });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({
        cart: { id: 1, status: 'open', title: 'T', total_kmf_snapshot: 1000 },
        contributions: [], share_url: 'x',
      });
      const p = renderGroupView({});
      await jest.advanceTimersByTimeAsync(0);
      await p.catch(() => {});

      const el = groupEl();
      // On simule le changement d'onglet : la vue n'est plus "show"
      el.classList.remove('show');
      mockGroupApi.getSharedCartOwner.mockClear();

      await jest.advanceTimersByTimeAsync(31_000); // > intervalle de polling (30s)
      expect(mockGroupApi.getSharedCartOwner).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(31_000); // le timer est bien arrêté (pas juste skippé)
      expect(mockGroupApi.getSharedCartOwner).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      stopPolling();
    }
  });
});
