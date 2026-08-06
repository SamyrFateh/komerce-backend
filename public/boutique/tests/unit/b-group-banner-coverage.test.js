'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { state } = require('../../js/b-store.js');
const { showBanner, hideBanner, refreshBanner } = require('../../js/b-group-banner.js');

function createBanner() {
  const banner = document.createElement('div');
  banner.id = 'k-group-banner';
  banner.className = 'k-group-banner show is-compact';
  document.body.appendChild(banner);
  return banner;
}

async function flushPromises() {
  await new Promise(process.nextTick);
  await new Promise(process.nextTick);
  await new Promise(process.nextTick);
}

beforeEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  state.shareToken = null;
  state.shareExpiry = null;
  state.shareStatus = null;
  global.fetch = jest.fn();
});

describe('b-group-banner — contrat actif après suppression du rendu global', () => {
  it('showBanner garantit que toute bannière résiduelle reste masquée', () => {
    const banner = createBanner();
    showBanner();
    expect(banner.classList.contains('show')).toBe(false);
    expect(banner.classList.contains('is-compact')).toBe(false);
  });

  it('hideBanner tolère un DOM sans bannière', () => {
    expect(() => hideBanner()).not.toThrow();
  });

  it('sans token, refreshBanner masque sans requête réseau', () => {
    const banner = createBanner();
    refreshBanner();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(banner.classList.contains('show')).toBe(false);
  });

  it('synchronise expiry et status du panier groupe', async () => {
    state.shareToken = 'token-42';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        cart: {
          expires_at: '2026-08-01T00:00:00Z',
          status: 'active',
        },
      }),
    });

    refreshBanner();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-carts/public/token-42',
      { credentials: 'include' }
    );
    expect(state.shareExpiry).toBe('2026-08-01T00:00:00Z');
    expect(state.shareStatus).toBe('active');
  });

  it('purge la session si le panier est absent ou si la réponse HTTP échoue', async () => {
    state.shareToken = 'gone';
    sessionStorage.setItem('kmrc_share', 'gone');
    sessionStorage.setItem('kmrc_banner_dismissed', '1');
    global.fetch.mockResolvedValue({ ok: false, status: 410 });

    refreshBanner();
    await flushPromises();

    expect(sessionStorage.getItem('kmrc_share')).toBeNull();
    expect(sessionStorage.getItem('kmrc_banner_dismissed')).toBeNull();
  });

  it('avale une erreur réseau sans modifier le state', async () => {
    state.shareToken = 'offline';
    global.fetch.mockRejectedValue(new Error('offline'));

    expect(() => refreshBanner()).not.toThrow();
    await flushPromises();
    expect(state.shareStatus).toBeNull();
  });
});
