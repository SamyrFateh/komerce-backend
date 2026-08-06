'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-wallet-loading-states.test.js — FIX 2026-07-10
 *
 * Non-régression "porte-monnaie bloqué sur Chargement…".
 * Cahier des charges G.3 :
 *   - /api/wallet pending/reject → pas de loader infini (état erreur rendu)
 *   - /api/wallet 401 sans identité → gate auth
 *   - bouton Réessayer relance le chargement
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
  fmt: jest.fn((n) => String(n) + ' KMF'),
  apiGet: jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn(),
  getCurrentIdentity: jest.fn(() => null),
}));

const { apiGet } = require('../../js/b-utils.js');
const { getCurrentIdentity } = require('../../js/b-identity.js');
const { renderWalletView } = require('../../js/b-wallet.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function timeoutError(path) {
  const e = new Error(`Délai dépassé (timeout 10000ms) — ${path}`);
  e.name = 'TimeoutError';
  e.isTimeout = true;
  return e;
}
function httpError(status, msg) {
  const e = new Error(msg || `HTTP ${status}`);
  e.status = status;
  return e;
}

describe('b-wallet — états de chargement', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="k-wallet-view"></div>';
    apiGet.mockReset();
    getCurrentIdentity.mockReturnValue(null);
  });

  test('timeout /api/wallet → état erreur + Réessayer, JAMAIS de loader résiduel', async () => {
    apiGet.mockImplementation(() => Promise.reject(timeoutError('/api/wallet')));
    renderWalletView();
    await flush(); await flush();

    const el = document.getElementById('k-wallet-view');
    expect(el.textContent).not.toContain('Chargement…');
    expect(el.textContent).toContain('trop de temps');
    expect(el.querySelector('#k-wlt-retry-btn')).toBeTruthy();
  });

  test('erreur réseau/5xx → état erreur + Réessayer (pas de gate auth trompeuse)', async () => {
    apiGet.mockImplementation(() => Promise.reject(httpError(503, 'DB indisponible')));
    renderWalletView();
    await flush(); await flush();

    const el = document.getElementById('k-wallet-view');
    expect(el.textContent).toContain('Impossible de charger le porte-monnaie');
    expect(el.querySelector('#k-wlt-retry-btn')).toBeTruthy();
    expect(el.querySelector('#k-wlt-auth-btn')).toBeFalsy();
  });

  test('401 sans identité → gate d\'identification (comportement normal, pas une panne)', async () => {
    apiGet.mockImplementation(() => Promise.reject(httpError(401, 'Non authentifié')));
    renderWalletView();
    await flush(); await flush();

    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).toBeTruthy();
    expect(el.textContent).toContain('Identifiez-vous');
  });

  test('bouton Réessayer relance le chargement et affiche les données au 2e essai', async () => {
    let attempt = 0;
    apiGet.mockImplementation((path) => {
      if (attempt === 0) return Promise.reject(timeoutError(path));
      if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 12000, expires_at: null });
      return Promise.resolve({ transactions: [] });
    });
    renderWalletView();
    await flush(); await flush();

    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-retry-btn')).toBeTruthy();

    attempt = 1;
    el.querySelector('#k-wlt-retry-btn').click();
    await flush(); await flush();

    expect(el.textContent).not.toContain('Chargement…');
    expect(el.querySelector('#k-wlt-retry-btn')).toBeFalsy();
    expect(el.textContent).toContain('12000 KMF'); // balance affichée
  });
});
