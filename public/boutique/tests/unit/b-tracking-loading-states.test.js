'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-tracking-loading-states.test.js — FIX 2026-07-10
 *
 * Non-régression "suivi commandes bloqué sur Chargement…".
 * Cahier des charges G.4 :
 *   - /api/orders pending/reject → pas de loader infini
 *   - affichage fallback recherche ou erreur contrôlée
 *   - bouton Réessayer relance
 *   - 401/403 après identité restaurée → état Session expirée distinct
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
  optimizeImgUrl: jest.fn((u) => u),
  fmt: jest.fn((n) => String(n) + ' KMF'),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn(),
  getCurrentIdentity: jest.fn(() => null),
  restoreIdentity: jest.fn(() => Promise.resolve(null)),
}));

const { apiGet } = require('../../js/b-utils.js');
const { restoreIdentity } = require('../../js/b-identity.js');
const { renderTrackView } = require('../../js/b-tracking.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function timeoutError(path) {
  const e = new Error(`Délai dépassé (timeout 10000ms) — ${path}`);
  e.name = 'TimeoutError';
  e.isTimeout = true;
  return e;
}
function httpError(status) {
  const e = new Error(`HTTP ${status}`);
  e.status = status;
  return e;
}

function trackEl() { return document.getElementById('k-track-view'); }

describe('b-tracking — états de chargement', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockReset();
    restoreIdentity.mockResolvedValue({ phone: '+2691234567' });
  });

  test('timeout /api/orders → état erreur contrôlé + Réessayer, pas de loader infini', async () => {
    apiGet.mockImplementation(() => Promise.reject(timeoutError('/api/orders?limit=20')));
    renderTrackView();
    await flush(); await flush();

    const el = trackEl();
    expect(el.textContent).not.toContain('Chargement de vos commandes');
    expect(el.textContent).toContain('trop de temps');
    expect(el.querySelector('#k-track-retry-btn')).toBeTruthy();
    // Fallback recherche par référence proposé
    expect(el.querySelector('#k-track-search-fallback-btn')).toBeTruthy();
  });

  test('erreur 503 → état erreur (pas de bascule trompeuse en mode recherche)', async () => {
    apiGet.mockImplementation(() => Promise.reject(httpError(503)));
    renderTrackView();
    await flush(); await flush();

    const el = trackEl();
    expect(el.textContent).toContain('Impossible de charger vos commandes');
    expect(el.querySelector('#k-track-retry-btn')).toBeTruthy();
  });

  test('401 après identité restaurée → état Session expirée, pas une panne réseau', async () => {
    apiGet.mockImplementation(() => Promise.reject(httpError(401)));
    renderTrackView();
    await flush(); await flush();

    const el = trackEl();
    expect(el.querySelector('#k-track-retry-btn')).toBeFalsy();
    expect(el.textContent).not.toContain('Chargement de vos commandes');
    expect(el.textContent).toContain('Session expirée');
    expect(el.querySelector('#k-track-reauth-btn')).toBeTruthy();
  });

  test('bouton Réessayer relance et affiche les commandes au 2e essai', async () => {
    let attempt = 0;
    apiGet.mockImplementation(() => {
      if (attempt === 0) return Promise.reject(timeoutError('/api/orders?limit=20'));
      return Promise.resolve({ orders: [{ id: 1, reference: 'KM-TEST-001', status: 'confirmed', items: [] }] });
    });
    renderTrackView();
    await flush(); await flush();
    expect(trackEl().querySelector('#k-track-retry-btn')).toBeTruthy();

    attempt = 1;
    trackEl().querySelector('#k-track-retry-btn').click();
    await flush(); await flush();

    const el = trackEl();
    expect(el.querySelector('#k-track-retry-btn')).toBeFalsy();
    expect(el.textContent).not.toContain('Chargement de vos commandes');
  });
});
