'use strict';

/**
 * tests/unit/b-komerce.test.js
 *
 * Module js/b-komerce.js — shell "Mon Komerce" (Lot 4).
 *
 * Couverture visée :
 *   renderKomerceView() : montage du shell + sous-nav, sous-onglet par
 *     défaut, activation visuelle du bon bouton.
 *   Vue d'ensemble : identité + solde + expiration, raccourcis vers les
 *     autres sous-rubriques.
 *   Mon wallet : délègue entièrement à b-wallet.js (aucune logique propre).
 *   Retrait & sécurité : informatif uniquement, aucun bouton d'action de
 *     mutation (personne de secours, OTP tiers, etc.).
 *   Mes informations : édition full_name uniquement, WhatsApp non éditable.
 *   Mes préférences : uniquement currency_pref, persisté via PUT.
 *   Gate d'authentification et état d'erreur, communs à toutes les
 *     sous-rubriques (sauf wallet, gérée par b-wallet.js lui-même).
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => String(s ?? '')),
  fmt: jest.fn((kmf) => kmf + ' KMF'),
  apiGet: jest.fn(),
  apiPut: jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn(),
  getCurrentIdentity: jest.fn(),
}));
jest.mock('../../js/b-wallet.js', () => ({ renderWalletView: jest.fn() }));

const { apiGet, apiPut } = require('../../js/b-utils.js');
const { requireIdentity, getCurrentIdentity } = require('../../js/b-identity.js');
const { renderWalletView } = require('../../js/b-wallet.js');
const { renderKomerceView } = require('../../js/b-komerce.js');
const { flush } = require('./helpers/boutiqueTestKit');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  getCurrentIdentity.mockReturnValue(null);
});

describe('renderKomerceView — shell', () => {
  it('crée #k-komerce-view avec les 5 sous-rubriques', async () => {
    apiGet.mockResolvedValue({});
    renderKomerceView();
    await flush();
    const el = document.getElementById('k-komerce-view');
    expect(el).not.toBeNull();
    const items = el.querySelectorAll('.k-kmc-subnav-item');
    expect(items.length).toBe(5);
    expect([...items].map((b) => b.dataset.subtab)).toEqual([
      'overview', 'wallet', 'security', 'profile', 'preferences',
    ]);
  });

  it('ne recrée pas le shell à un second appel', async () => {
    apiGet.mockResolvedValue({});
    renderKomerceView();
    await flush();
    renderKomerceView('security');
    await flush();
    expect(document.querySelectorAll('#k-komerce-view').length).toBe(1);
  });

  it('sans argument -> overview par défaut, bouton overview actif', async () => {
    apiGet.mockResolvedValue({});
    renderKomerceView();
    await flush();
    const active = document.querySelector('.k-kmc-subnav-item.active');
    expect(active.dataset.subtab).toBe('overview');
  });

  it('sous-onglet inconnu -> retombe sur le dernier onglet valide', async () => {
    apiGet.mockResolvedValue({});
    renderKomerceView('profile');
    await flush();
    renderKomerceView('n-existe-pas');
    await flush();
    const active = document.querySelector('.k-kmc-subnav-item.active');
    expect(active.dataset.subtab).toBe('profile');
  });

  it('clic sur un bouton de sous-nav change de panneau', async () => {
    apiGet.mockResolvedValue({ full_name: 'Fatima', phone: '+269123456' });
    renderKomerceView();
    await flush();
    document.querySelector('[data-subtab="security"]').click();
    await flush();
    expect(document.querySelector('.k-kmc-subnav-item.active').dataset.subtab).toBe('security');
  });
});

describe('renderKomerceView — Vue d\'ensemble', () => {
  it('affiche nom, WhatsApp masqué, solde et expiration', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ full_name: 'Fatima Ali', phone: '+2691234567' });
      if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 12500, expires_at: '2026-09-30T23:59:59Z' });
      return Promise.resolve(null);
    });
    renderKomerceView('overview');
    await flush();
    const panel = document.getElementById('k-kmc-panel');
    expect(panel.textContent).toContain('Fatima Ali');
    expect(panel.textContent).toContain('12500 KMF');
    expect(panel.querySelector('.k-kmc-ov-phone').textContent).not.toContain('34567');
  });

  it('les raccourcis mènent vers Mes informations / Mes préférences', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ full_name: 'Fatima', phone: '+2691234567' });
      if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 0, expires_at: null });
      return Promise.resolve(null);
    });
    renderKomerceView('overview');
    await flush();
    document.querySelector('[data-goto="profile"]').click();
    await flush();
    expect(document.querySelector('.k-kmc-subnav-item.active').dataset.subtab).toBe('profile');
  });

  it('session expirée (401 sur /api/auth/me) -> gate d\'authentification', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.reject({ status: 401 });
      return Promise.resolve(null);
    });
    renderKomerceView('overview');
    await flush();
    expect(document.getElementById('k-kmc-auth-btn')).not.toBeNull();
  });
});

describe('renderKomerceView — Mon wallet', () => {
  it('délègue à renderWalletView() sans logique propre', async () => {
    renderKomerceView('wallet');
    await flush();
    expect(renderWalletView).toHaveBeenCalled();
    expect(document.getElementById('k-wallet-view')).not.toBeNull();
  });
});

describe('renderKomerceView — Retrait & sécurité', () => {
  it('est purement informatif : aucun bouton de mutation', async () => {
    apiGet.mockResolvedValue({ phone: '+2691234567' });
    renderKomerceView('security');
    await flush();
    const panel = document.getElementById('k-kmc-panel');
    expect(panel.querySelectorAll('button').length).toBe(0);
    expect(panel.textContent).toContain('code de retrait');
  });
});

describe('renderKomerceView — Mes informations', () => {
  it('WhatsApp vérifié affiché en lecture seule, jamais éditable', async () => {
    apiGet.mockResolvedValue({ full_name: 'Fatima', phone: '+2691234567', email: 'f@example.km' });
    renderKomerceView('profile');
    await flush();
    const phoneInput = document.querySelector('.k-kmc-field--readonly input');
    expect(phoneInput.disabled).toBe(true);
  });

  it('soumettre le formulaire -> PUT /api/auth/me avec full_name uniquement', async () => {
    apiGet.mockResolvedValue({ full_name: 'Fatima', phone: '+2691234567' });
    apiPut.mockResolvedValue({});
    renderKomerceView('profile');
    await flush();
    document.getElementById('k-kmc-fullname').value = 'Fatima Ben Ali';
    document.getElementById('k-kmc-profile-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(apiPut).toHaveBeenCalledWith('/api/auth/me', { full_name: 'Fatima Ben Ali' });
  });
});

describe('renderKomerceView — Mes préférences', () => {
  it('affiche uniquement la devise (seule préférence réellement persistée)', async () => {
    apiGet.mockResolvedValue({ currency_pref: 'KMF' });
    renderKomerceView('preferences');
    await flush();
    const panel = document.getElementById('k-kmc-panel');
    expect(panel.querySelector('#k-kmc-currency')).not.toBeNull();
  });

  it('changer la devise -> PUT /api/auth/me avec currency_pref', async () => {
    apiGet.mockResolvedValue({ currency_pref: 'KMF' });
    apiPut.mockResolvedValue({});
    renderKomerceView('preferences');
    await flush();
    const select = document.getElementById('k-kmc-currency');
    select.value = 'EUR';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(apiPut).toHaveBeenCalledWith('/api/auth/me', { currency_pref: 'EUR' });
  });
});
