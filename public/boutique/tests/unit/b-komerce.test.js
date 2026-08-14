/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          account-view-tests
 * @domain        account
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-komerce.test.js
 * @purpose       Tests unitaires de openMonKomerce (Lot 4B, étendu Lot 5) :
 *                authentification à l'entrée, page unique sans sous-onglet,
 *                bloc wallet, profil (champs persistés uniquement), retrait
 *                & sécurité (code informatif + autorisation nominative de
 *                retrait exceptionnel — états NONE/ACTIVE).
 * @impact-areas  account, wallet, documents, boutique-navigation
 * @version       2026-08-documents
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
 *   Bloc wallet : solde compact sans historique de mouvements.
 *   Bloc profil : champs réels (full_name, currency_pref), WhatsApp en
 *     lecture seule sans label "vérifié", email en lecture seule,
 *     bouton désactivé sans modification, sauvegarde via PUT unique.
 *   Bloc retrait & sécurité : informatif, aucun bouton de mutation,
 *     texte "lorsque votre commande est prête au relais".
 *   Session expirée : gate de ré-authentification dans le wallet-block.
 *   Séquence : pas de double-montage du shell, rendu stable.
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize:  jest.fn((s) => String(s ?? '')),
  fmt:       jest.fn((v) => v + ' KMF'),
  apiGet:    jest.fn(),
  apiPut:    jest.fn(),
  apiDelete: jest.fn(),
  apiDownload: jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity:   jest.fn(),
  getCurrentIdentity: jest.fn(),
}));
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

const { apiGet, apiPut, apiDelete, apiDownload } = require('../../js/b-utils.js');
const { requireIdentity, getCurrentIdentity } = require('../../js/b-identity.js');
const { openMonKomerce }                 = require('../../js/b-komerce.js');
const { flush, submitForm }               = require('./helpers/boutiqueTestKit');

function mockApiGetDefaults({ me, auth } = {}) {
  apiGet.mockImplementation((path) => {
    if (path === '/api/auth/me') return Promise.resolve(me || { full_name: 'Fatima', phone: '+2691234567', currency_pref: 'KMF' });
    if (path === '/api/auth/me/pickup-authorization') return Promise.resolve(auth || { status: 'NONE' });
    if (path === '/api/auth/me/documents') return Promise.resolve({ documents: [] });
    if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 0, expires_at: null });
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  getCurrentIdentity.mockReturnValue(null);
  requireIdentity.mockResolvedValue(null);
  mockApiGetDefaults();
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

  it('contient wallet, documents, profil et sécurité dans une page unique', async () => {
    await openMonKomerce();
    await flush();
    expect(document.getElementById('k-kmc-wallet-block')).not.toBeNull();
    expect(document.getElementById('k-kmc-documents-block')).not.toBeNull();
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

describe('openMonKomerce — documents privés', () => {
  beforeEach(() => { getCurrentIdentity.mockReturnValue({ id: 1 }); });

  it('donne la priorité à Mes documents puis affiche le wallet compact', async () => {
    await openMonKomerce();
    await flush();
    const primary = document.querySelector('.k-kmc-col-primary');
    expect(primary.children[0].id).toBe('k-kmc-documents-block');
    expect(primary.children[1].id).toBe('k-kmc-wallet-block');
    expect(document.querySelector('[data-subtab]')).toBeNull();
  });

  it('liste une facture et déclenche le téléchargement authentifié', async () => {
    mockApiGetDefaults();
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ full_name: 'Ali', phone: '+269', currency_pref: 'KMF' });
      if (path === '/api/auth/me/pickup-authorization') return Promise.resolve({ status: 'NONE' });
      if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 0 });
      if (path === '/api/auth/me/documents') return Promise.resolve({ documents: [{
        id: 'doc-1', document_type: 'invoice', reference: 'INV-1', amount_kmf: 12000,
        issued_at: '2026-08-14', download_url: '/api/auth/me/documents/doc-1/download',
      }] });
      return Promise.resolve(null);
    });
    apiDownload.mockRejectedValueOnce(Object.assign(new Error('test stop'), { status: 500 }));
    await openMonKomerce();
    await flush();
    const button = document.querySelector('.k-kmc-document-download');
    expect(button.textContent).toBe('Télécharger');
    button.click();
    await flush();
    expect(apiDownload).toHaveBeenCalledWith('/api/auth/me/documents/doc-1/download', { timeoutMs: 20000 });
  });

  it('ignore les mouvements non essentiels et ne propose aucun bouton sans PDF disponible', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ full_name: 'Ali', phone: '+269', currency_pref: 'KMF' });
      if (path === '/api/auth/me/pickup-authorization') return Promise.resolve({ status: 'NONE' });
      if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 0 });
      if (path === '/api/auth/me/documents') return Promise.resolve({ documents: [
        { document_type: 'wallet_receipt', reference: 'WLT-1', download_url: '/hidden' },
        { document_type: 'invoice', reference: 'INV-PENDING', download_url: null },
      ] });
      return Promise.resolve(null);
    });
    await openMonKomerce();
    await flush();
    const block = document.getElementById('k-kmc-documents-block');
    expect(block.textContent).not.toContain('WLT-1');
    expect(block.textContent).toContain('INV-PENDING');
    expect(block.textContent).toContain('En préparation');
    expect(block.querySelector('.k-kmc-document-download')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloc wallet
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — bloc wallet', () => {
  it('affiche uniquement le solde et son échéance, sans charger les mouvements', async () => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    mockApiGetDefaults();
    apiGet.mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.resolve({ full_name: 'Ali', phone: '+269', currency_pref: 'KMF' });
      if (path === '/api/auth/me/pickup-authorization') return Promise.resolve({ status: 'NONE' });
      if (path === '/api/auth/me/documents') return Promise.resolve({ documents: [] });
      if (path === '/api/wallet') return Promise.resolve({ balance_kmf: 4500, expires_at: '2026-12-01' });
      return Promise.resolve(null);
    });
    await openMonKomerce();
    await flush();
    const block = document.getElementById('k-kmc-wallet-block');
    expect(block.textContent).toContain('4\u202f500 KMF');
    expect(block.textContent).toContain('1 décembre 2026');
    expect(apiGet).not.toHaveBeenCalledWith('/api/wallet/transactions?limit=50');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bloc profil
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — bloc profil', () => {
  beforeEach(() => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
    mockApiGetDefaults({
      me: {
        full_name: 'Fatima Ali',
        phone: '+2691234567',
        email: 'fatima@example.km',
        currency_pref: 'KMF',
      },
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
    mockApiGetDefaults();
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
// Bloc autorisation de retrait exceptionnel (Lot 5)
// ─────────────────────────────────────────────────────────────────────────────

describe('openMonKomerce — autorisation de retrait exceptionnel (Lot 5)', () => {
  beforeEach(() => {
    getCurrentIdentity.mockReturnValue({ id: 1 });
  });

  it('état NONE : affiche un formulaire, bouton désactivé tant que les 2 champs ne sont pas remplis', async () => {
    mockApiGetDefaults({ auth: { status: 'NONE' } });
    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    const saveBtn = authBlock.querySelector('#k-kmc-auth-save');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(true);
    // Aucun résumé de personne autorisée en état NONE
    expect(authBlock.querySelector('#k-kmc-auth-name')).toBeNull();
  });

  it('état NONE : le bouton s\'active une fois les 2 champs remplis', async () => {
    mockApiGetDefaults({ auth: { status: 'NONE' } });
    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    const givenInput  = authBlock.querySelector('#k-kmc-auth-given');
    const familyInput = authBlock.querySelector('#k-kmc-auth-family');
    givenInput.value = 'Fatima';
    givenInput.dispatchEvent(new Event('input'));
    familyInput.value = 'Said';
    familyInput.dispatchEvent(new Event('input'));
    expect(authBlock.querySelector('#k-kmc-auth-save').disabled).toBe(false);
  });

  it('soumission du formulaire : PUT avec given_names/family_name, puis affiche l\'état ACTIVE', async () => {
    mockApiGetDefaults({ auth: { status: 'NONE' } });
    apiPut.mockResolvedValue({
      status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said',
      version: 1, updated_at: '2026-07-01T00:00:00Z',
    });
    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    authBlock.querySelector('#k-kmc-auth-given').value = 'Fatima';
    authBlock.querySelector('#k-kmc-auth-given').dispatchEvent(new Event('input'));
    authBlock.querySelector('#k-kmc-auth-family').value = 'Said';
    authBlock.querySelector('#k-kmc-auth-family').dispatchEvent(new Event('input'));

    await submitForm(authBlock.querySelector('#k-kmc-auth-form'));
    await flush();

    expect(apiPut).toHaveBeenCalledWith('/api/auth/me/pickup-authorization', {
      given_names: 'Fatima', family_name: 'Said',
    });
    expect(authBlock.querySelector('#k-kmc-auth-name').textContent).toBe('Fatima Said');
    expect(authBlock.querySelector('#k-kmc-auth-save')).toBeNull();
  });

  it('état ACTIVE : affiche le nom autorisé, "Modifier" et "Supprimer", jamais le nom en HTML brut', async () => {
    mockApiGetDefaults({
      auth: { status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said', version: 2, updated_at: '2026-07-01T00:00:00Z' },
    });
    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    expect(authBlock.querySelector('#k-kmc-auth-name').textContent).toBe('Fatima Said');
    expect(authBlock.querySelector('#k-kmc-auth-edit')).not.toBeNull();
    expect(authBlock.querySelector('#k-kmc-auth-delete')).not.toBeNull();
    // Le nom n'apparaît jamais interpolé littéralement dans le HTML source
    expect(authBlock.innerHTML).not.toContain('>Fatima Said<');
  });

  it('"Modifier" : ouvre le formulaire pré-rempli avec le nom actuel', async () => {
    mockApiGetDefaults({
      auth: { status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said', version: 2, updated_at: '2026-07-01T00:00:00Z' },
    });
    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    authBlock.querySelector('#k-kmc-auth-edit').click();
    await flush();
    expect(authBlock.querySelector('#k-kmc-auth-given').value).toBe('Fatima');
    expect(authBlock.querySelector('#k-kmc-auth-family').value).toBe('Said');
    expect(authBlock.querySelector('#k-kmc-auth-cancel')).not.toBeNull();
  });

  it('"Supprimer" : demande confirmation, appelle DELETE, revient à l\'état NONE', async () => {
    mockApiGetDefaults({
      auth: { status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said', version: 2, updated_at: '2026-07-01T00:00:00Z' },
    });
    apiDelete.mockResolvedValue({ status: 'NONE' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    authBlock.querySelector('#k-kmc-auth-delete').click();
    await flush();

    expect(confirmSpy).toHaveBeenCalled();
    expect(apiDelete).toHaveBeenCalledWith('/api/auth/me/pickup-authorization');
    expect(authBlock.querySelector('#k-kmc-auth-name')).toBeNull();
    expect(authBlock.querySelector('#k-kmc-auth-save')).not.toBeNull();
    confirmSpy.mockRestore();
  });

  it('"Supprimer" : n\'appelle pas DELETE si la confirmation est refusée', async () => {
    mockApiGetDefaults({
      auth: { status: 'ACTIVE', given_names: 'Fatima', family_name: 'Said', version: 2, updated_at: '2026-07-01T00:00:00Z' },
    });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    await openMonKomerce();
    await flush(6);
    const authBlock = document.getElementById('k-kmc-auth-content');
    authBlock.querySelector('#k-kmc-auth-delete').click();
    await flush();

    expect(apiDelete).not.toHaveBeenCalled();
    expect(authBlock.querySelector('#k-kmc-auth-name')).not.toBeNull();
    confirmSpy.mockRestore();
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
