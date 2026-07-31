/**
 * @komerce-arch-lite
 * @role          account-view-tests
 * @domain        account
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-komerce.test.js
 * @purpose       Tests unitaires de openMonKomerce (Lot 4B) : authentification
 *                à l'entrée, page unique sans sous-onglet, bloc wallet, profil
 *                (champs persistés uniquement), retrait & sécurité (informatif).
 * @impact-areas  account, wallet, boutique-navigation
 * @version       2026-07-lot4b
 */
'use strict';

/**
 * tests/unit/b-komerce.test.js
 *
 * Module js/b-komerce.js — page unique Mon Komerce (Lot 4B).
 *
 * Couverture :
 *   openMonKomerce() : authentification à l'entrée, annulation OTP,
 *     session valide, montage du shell unique, chargement des blocs.
 *   Bloc wallet : délègue à b-wallet.js.
 *   Bloc profil : champs réels (full_name, currency_pref), WhatsApp en
 *     lecture seule sans label "vérifié", email en lecture seule,
 *     bouton désactivé sans modification, sauvegarde via PUT unique.
 *   Bloc retrait & sécurité : informatif, aucun bouton de mutation,
 *     texte "lorsque votre commande est prête au relais".
 *   Session expirée : gate de ré-authentification dans le wallet-block.
 *   Séquence : pas de double-montage du shell, rendu stable.
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => String(s ?? '')),
  fmt:      jest.fn((v) => v + ' KMF'),
  apiGet:   jest.fn(),
  apiPut:   jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity:   jest.fn(),
  getCurrentIdentity: jest.fn(),
}));
jest.mock('../../js/b-wallet.js', () => ({ renderWalletView: jest.fn() }));
jest.mock('../../js/b-bus.js', () => {
  const listeners = {};
  return {
    bus: {
      on:   (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      emit: (ev, ...args) => { (listeners[ev] || []).forEach(fn => fn(...args)); },
      off:  () => {},
    },
  };
});

const { apiGet, apiPut }                 = require('../../js/b-utils.js');
const { requireIdentity, getCurrentIdentity } = require('../../js/b-identity.js');
const { renderWalletView }               = require('../../js/b-wallet.js');
const { openMonKomerce }                 = require('../../js/b-komerce.js');
const { flush }                          = require('./helpers/boutiqueTestKit');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  getCurrentIdentity.mockReturnValue(null);
  requireIdentity.mockResolvedValue(null);
  apiGet.mockResolvedValue({ full_name: 'Fatima', phone: '+2691234567', currency_pref: 'KMF' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authentification à l'entrée
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — authentification', () => {
  it('session valide : ouvre directement la page sans OTP', async () => {
    getCurrentIdentity.mockReturnValue({ id: 1, phone: '+2691234567' });
    await openMonKomerce();
    await flush();
    expect(requireIdentity).not.toHaveBeenCalled();
    expect(document.getElementById('k-komerce-view')).not.toBeNull();
  });

  it('session absente : déclenche requireIdentity avant tout affichage', async () => {
    requireIdentity.mockResolvedValue({ id: 1, phone: '+2691234567' });
    await openMonKomerce();
    await flush();
    expect(requireIdentity).toHaveBeenCalled();
    expect(document.getElementById('k-komerce-view')).not.toBeNull();
  });

  it('OTP annulé : aucune coquille vide montée', async () => {
    requireIdentity.mockResolvedValue(null); // annulation
    await openMonKomerce();
    await flush();
    expect(document.getElementById('k-komerce-view')).toBeNull();
  });

  it('après succès OTP : aucune donnée perso rendue avant la réponse API', async () => {
    // requireIdentity résout mais apiGet n'a pas encore répondu
    let resolveGet;
    apiGet.mockReturnValue(new Promise(r => { resolveGet = r; }));
    requireIdentity.mockResolvedValue({ id: 1 });
    openMonKomerce();
    await flush();
    // Le shell est monté mais le formulaire profil n'est pas encore rendu :
    // le champ #k-kmc-fullname n'existe pas encore (état "Chargement…").
    const profileBlock = document.getElementById('k-kmc-profile-block');
    expect(profileBlock?.querySelector('#k-kmc-fullname')).toBeNull();
    // La résolution de l'API déclenche le rendu du formulaire avec les données
    resolveGet({ full_name: 'Fatima', phone: '+2691234567', currency_pref: 'KMF' });
    await flush();
    // Après résolution : le champ exist et porte la valeur personnelle
    expect(profileBlock?.querySelector('#k-kmc-fullname')?.value).toBe('Fatima');
  });

  it('session expirée (401 en cours de session) : gate de ré-auth dans wallet-block', async () => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    apiGet.mockRejectedValue({ status: 401 });
    await openMonKomerce();
    await flush();
    const walletBlock = document.getElementById('k-kmc-wallet-block');
    expect(walletBlock?.querySelector('#k-kmc-reauth')).not.toBeNull();
  });

  it('l\'authentification n\'est pas redemandée bloc par bloc', async () => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    await openMonKomerce();
    await flush();
    // Un seul appel API /api/auth/me — pas un par bloc
    expect(requireIdentity).not.toHaveBeenCalled();
    expect(apiGet).toHaveBeenCalledWith('/api/auth/me');
    expect(apiGet.mock.calls.filter(c => c[0] === '/api/auth/me').length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structure de la page — aucun sous-onglet
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — structure page unique', () => {
  beforeEach(() => { getCurrentIdentity.mockReturnValue({ id: 1 }); });

  it('monte #k-komerce-view avec la class show', async () => {
    await openMonKomerce();
    await flush();
    const el = document.getElementById('k-komerce-view');
    expect(el).not.toBeNull();
    expect(el.classList.contains('show')).toBe(true);
  });

  it('aucune sous-navigation (.k-kmc-subnav ou k-kmc-subnav-item)', async () => {
    await openMonKomerce();
    await flush();
    expect(document.querySelector('.k-kmc-subnav')).toBeNull();
    expect(document.querySelector('.k-kmc-subnav-item')).toBeNull();
  });

  it('pas de currentSubtab exposé ni de bouton de sous-onglet', async () => {
    await openMonKomerce();
    await flush();
    expect(document.querySelector('[data-subtab]')).toBeNull();
  });

  it('contient k-kmc-wallet-block, k-kmc-profile-block, k-kmc-security-block', async () => {
    await openMonKomerce();
    await flush();
    expect(document.getElementById('k-kmc-wallet-block')).not.toBeNull();
    expect(document.getElementById('k-kmc-profile-block')).not.toBeNull();
    expect(document.getElementById('k-kmc-security-block')).not.toBeNull();
  });

  it('second appel ne duplique pas le shell', async () => {
    await openMonKomerce();
    await flush();
    await openMonKomerce();
    await flush();
    expect(document.querySelectorAll('#k-komerce-view').length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloc wallet
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — bloc wallet', () => {
  it('délègue à renderWalletView()', async () => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    await openMonKomerce();
    await flush();
    expect(renderWalletView).toHaveBeenCalled();
    expect(document.getElementById('k-wallet-view')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloc profil
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — bloc profil', () => {
  beforeEach(() => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    apiGet.mockResolvedValue({
      full_name: 'Fatima Ali',
      phone: '+2691234567',
      email: 'fatima@example.km',
      currency_pref: 'KMF',
    });
  });

  it('affiche full_name dans un champ éditable', async () => {
    await openMonKomerce();
    await flush();
    const input = document.getElementById('k-kmc-fullname');
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('Fatima Ali');
  });

  it('WhatsApp affiché en lecture seule, jamais éditable', async () => {
    await openMonKomerce();
    await flush();
    const readonlyInputs = [...document.querySelectorAll('.k-kmc-field--readonly input')];
    const phoneInput = readonlyInputs.find(i => i.value.startsWith('+269'));
    expect(phoneInput).not.toBeUndefined();
    expect(phoneInput.disabled).toBe(true);
  });

  it('WhatsApp SANS label "vérifié" — aucun badge vérifié inventé', async () => {
    await openMonKomerce();
    await flush();
    const profileBlock = document.getElementById('k-kmc-profile-block');
    // La chaîne "vérifié" ne doit PAS apparaître comme label de champ
    // (elle peut apparaître dans le texte de Retrait & sécurité, pas ici)
    const labels = [...profileBlock.querySelectorAll('.k-kmc-field span')];
    const hasVerifiedLabel = labels.some(l => l.textContent.toLowerCase().includes('v\u00e9rifi\u00e9'));
    expect(hasVerifiedLabel).toBe(false);
  });

  it('email en lecture seule (PUT /api/auth/me n\'accepte pas email)', async () => {
    await openMonKomerce();
    await flush();
    const readonlyInputs = [...document.querySelectorAll('.k-kmc-field--readonly input')];
    const emailInput = readonlyInputs.find(i => i.value.includes('@'));
    expect(emailInput).not.toBeUndefined();
    expect(emailInput.disabled).toBe(true);
  });

  it('bouton "Enregistrer mes modifications" désactivé sans modification', async () => {
    await openMonKomerce();
    await flush();
    const btn = document.getElementById('k-kmc-profile-save');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it('bouton activé après modification du nom', async () => {
    await openMonKomerce();
    await flush();
    const input = document.getElementById('k-kmc-fullname');
    input.value = 'Fatima Ben Ali';
    input.dispatchEvent(new Event('input'));
    const btn = document.getElementById('k-kmc-profile-save');
    expect(btn.disabled).toBe(false);
  });

  it('PUT /api/auth/me avec full_name ET currency_pref au submit', async () => {
    apiPut.mockResolvedValue({});
    await openMonKomerce();
    await flush();
    const input  = document.getElementById('k-kmc-fullname');
    const select = document.getElementById('k-kmc-currency');
    input.value  = 'Fatima Ben Ali';
    select.value = 'EUR';
    input.dispatchEvent(new Event('input'));
    document.getElementById('k-kmc-profile-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(apiPut).toHaveBeenCalledWith('/api/auth/me', { full_name: 'Fatima Ben Ali', currency_pref: 'EUR' });
  });

  it('double envoi impossible (bouton désactivé pendant la sauvegarde)', async () => {
    let resolveApi;
    apiPut.mockReturnValue(new Promise(r => { resolveApi = r; }));
    await openMonKomerce();
    await flush();
    const input = document.getElementById('k-kmc-fullname');
    input.value = 'Fatima B.';
    input.dispatchEvent(new Event('input'));
    document.getElementById('k-kmc-profile-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    document.getElementById('k-kmc-profile-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    resolveApi({});
    await flush();
    expect(apiPut).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloc retrait & sécurité
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — bloc retrait & sécurité', () => {
  beforeEach(() => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    apiGet.mockResolvedValue({ full_name: 'Fatima', phone: '+2691234567', currency_pref: 'KMF' });
  });

  it('aucun bouton de mutation (informatif uniquement)', async () => {
    await openMonKomerce();
    await flush();
    const secBlock = document.getElementById('k-kmc-security-block');
    expect(secBlock.querySelectorAll('button').length).toBe(0);
  });

  it('contient "lorsque votre commande est prête au relais"', async () => {
    await openMonKomerce();
    await flush();
    const secBlock = document.getElementById('k-kmc-security-block');
    expect(secBlock.textContent).toContain('lorsque votre commande est pr\u00eate au relais');
  });

  it('ne contient PAS "après confirmation de commande"', async () => {
    await openMonKomerce();
    await flush();
    const secBlock = document.getElementById('k-kmc-security-block');
    expect(secBlock.textContent).not.toContain('apr\u00e8s confirmation de commande');
  });

  it('ne contient PAS "après création de commande"', async () => {
    await openMonKomerce();
    await flush();
    const secBlock = document.getElementById('k-kmc-security-block');
    expect(secBlock.textContent).not.toContain('apr\u00e8s cr\u00e9ation de commande');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recherches de clôture — absence des symboles interdits
// ─────────────────────────────────────────────────────────────────────────────

describe('clôture — aucun résidu d\'architecture sous-onglet', () => {
  beforeEach(() => { getCurrentIdentity.mockReturnValue({ id: 1 }); });

  it('aucun élément avec data-subtab dans le DOM', async () => {
    await openMonKomerce();
    await flush();
    expect(document.querySelector('[data-subtab]')).toBeNull();
  });

  it('aucune classe k-kmc-subnav dans le DOM', async () => {
    await openMonKomerce();
    await flush();
    expect(document.querySelector('.k-kmc-subnav')).toBeNull();
  });

  it('aucun élément "Vue d\'ensemble" dans le DOM', async () => {
    await openMonKomerce();
    await flush();
    expect(document.body.textContent).not.toContain('Vue d\u2019ensemble');
    expect(document.body.textContent).not.toContain('Vue d\'ensemble');
  });
});
