'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-wallet.test.js
 *
 * Module js/b-wallet.js — vue "Mon porte-monnaie".
 *
 * Couverture visée :
 *   renderWalletView() : montage initial, réutilisation DOM, gate OTP,
 *     auth expirée, état erreur/retry, solde disponible, échéance et historique.
 *   buildBalanceCard() : urgence d'expiration, CTA boutique.
 *   groupTransactions() : filtre les écritures techniques et affiche l'impact net.
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => String(s ?? '')),
  fmt: jest.fn((kmf) => kmf + ' KMF'),
  apiGet: jest.fn(),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn(),
  getCurrentIdentity: jest.fn(),
}));

const { apiGet } = require('../../js/b-utils.js');
const { requireIdentity, getCurrentIdentity } = require('../../js/b-identity.js');
const { renderWalletView } = require('../../js/b-wallet.js');
const { flush } = require('./helpers/boutiqueTestKit');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  getCurrentIdentity.mockReturnValue(null);
});

describe('renderWalletView — montage', () => {
  it('crée #k-wallet-view et l\'ancre après #k-fav-view si présent', async () => {
    document.body.innerHTML = '<div id="k-fav-view"></div>';
    apiGet.mockResolvedValue(null);
    renderWalletView();
    await flush();
    const fav = document.getElementById('k-fav-view');
    const wallet = document.getElementById('k-wallet-view');
    expect(wallet).not.toBeNull();
    expect(fav.nextElementSibling).toBe(wallet);
  });

  it('retombe sur #k-track-view puis #k-catalog-section si k-fav-view absent', async () => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockResolvedValue(null);
    renderWalletView();
    await flush();
    expect(document.getElementById('k-catalog-section').nextElementSibling.id).toBe('k-wallet-view');
  });

  it('l\'ajoute au body si aucun ancrage trouvé', async () => {
    document.body.innerHTML = '';
    apiGet.mockResolvedValue(null);
    renderWalletView();
    await flush();
    expect(document.body.querySelector('#k-wallet-view')).not.toBeNull();
  });

  it('réutilise l\'élément existant plutôt que d\'en recréer un', async () => {
    document.body.innerHTML = '<div id="k-wallet-view" data-marker="1"></div>';
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValue({ name: 'x' });
    renderWalletView();
    await flush();
    expect(document.querySelectorAll('#k-wallet-view').length).toBe(1);
  });
});

describe('renderWalletView — gate OTP / session', () => {
  it('affiche la gate si aucune donnée ET aucune identité', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValue(null);
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).not.toBeNull();
    expect(el.textContent).toContain('Identifiez-vous');
  });

  it('n\'affiche pas la gate si une identité existe déjà et qu\'il n\'y a pas d\'erreur API', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValue({ name: 'Fatima' });
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).toBeNull();
    expect(el.querySelector('.k-wlt-zero')).not.toBeNull();
  });

  it('401 sans identité → gate d\'identification', async () => {
    const err401 = Object.assign(new Error('HTTP 401'), { status: 401 });
    apiGet.mockRejectedValue(err401);
    getCurrentIdentity.mockReturnValue(null);
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).not.toBeNull();
    expect(el.textContent).toContain('Identifiez-vous');
  });

  it('401 avec identité locale → gate session expirée, pas état vide trompeur', async () => {
    const err401 = Object.assign(new Error('HTTP 401'), { status: 401 });
    apiGet.mockRejectedValue(err401);
    getCurrentIdentity.mockReturnValue({ name: 'Fatima' });
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).not.toBeNull();
    expect(el.textContent).toContain('Session expirée');
    expect(el.querySelector('.k-wlt-zero')).toBeNull();
  });

  it('clic sur le bouton gate : succès identité -> recharge la vue wallet', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValueOnce(null); // 1er rendu : gate
    requireIdentity.mockResolvedValue({ name: 'Fatima' });
    renderWalletView();
    await flush();

    getCurrentIdentity.mockReturnValue({ name: 'Fatima' });
    apiGet.mockResolvedValue({ balance_kmf: 0 });

    document.getElementById('k-wlt-auth-btn').click();
    await flush();

    expect(requireIdentity).toHaveBeenCalledWith({
      reason: 'porte-monnaie',
      title: 'Accéder à mon porte-monnaie',
    });
    expect(document.getElementById('k-wlt-auth-btn')).toBeNull();
  });

  it('clic sur le bouton gate : annulation -> réactive le bouton', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValue(null);
    requireIdentity.mockResolvedValue(null);
    renderWalletView();
    await flush();

    const btn = document.getElementById('k-wlt-auth-btn');
    btn.click();
    await flush();

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('M\'identifier');
  });
});

describe('renderWalletView — solde', () => {
  it('affiche l\'état vide si balance = 0', async () => {
    apiGet.mockResolvedValue({ balance_kmf: 0 });
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('.k-wlt-zero')).not.toBeNull();
    expect(el.querySelector('.k-wlt-card')).toBeNull();
    expect(el.textContent).toContain('Aucun crédit disponible');
  });

  it('affiche la carte de solde si balance > 0', async () => {
    apiGet.mockImplementation((path) =>
      path === '/api/wallet'
        ? Promise.resolve({ balance_kmf: 5000, expires_at: null })
        : Promise.resolve({ transactions: [] })
    );
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    const card = el.querySelector('.k-wlt-card');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('5000 KMF');
    expect(card.textContent).toContain('Disponible');
  });

  it('n\'affiche pas la liste de transactions si vide même avec solde > 0', async () => {
    apiGet.mockImplementation((path) =>
      path === '/api/wallet'
        ? Promise.resolve({ balance_kmf: 5000 })
        : Promise.resolve({ transactions: [] })
    );
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('.k-wlt-tx-wrap')).toBeNull();
  });

  it('affiche la liste de transactions si solde > 0 et transactions non vides', async () => {
    apiGet.mockImplementation((path) =>
      path === '/api/wallet'
        ? Promise.resolve({ balance_kmf: 5000 })
        : Promise.resolve({
            transactions: [
              { type: 'credit', reason: 'admin_gift', amount_kmf: 5000, created_at: '2026-06-01T00:00:00Z' },
            ],
          })
    );
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('.k-wlt-tx-wrap')).not.toBeNull();
    expect(el.querySelector('.k-wlt-tx-row')).not.toBeNull();
  });

  it('affiche aussi les mouvements si le solde est revenu à 0', async () => {
    apiGet.mockImplementation((path) =>
      path === '/api/wallet'
        ? Promise.resolve({ balance_kmf: 0 })
        : Promise.resolve({
            transactions: [
              { type: 'debit', reason: 'checkout', amount_kmf: 2000, created_at: '2026-06-01T00:00:00Z' },
            ],
          })
    );
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('.k-wlt-zero')).not.toBeNull();
    expect(el.querySelector('.k-wlt-tx-row')).not.toBeNull();
  });

  describe('urgence d\'expiration', () => {
    async function renderWithExpiry(daysFromNow) {
      const d = new Date();
      d.setDate(d.getDate() + daysFromNow);
      apiGet.mockImplementation((path) =>
        path === '/api/wallet'
          ? Promise.resolve({ balance_kmf: 1000, expires_at: d.toISOString() })
          : Promise.resolve({ transactions: [] })
      );
      renderWalletView();
      await flush();
      return document.getElementById('k-wallet-view');
    }

    it('affiche "Expire aujourd\'hui" pour une expiration à J+0', async () => {
      const el = await renderWithExpiry(0);
      expect(el.textContent).toContain("Expire aujourd'hui");
      expect(el.querySelector('.k-wlt-expiry--urgent')).not.toBeNull();
    });

    it('affiche "Expire demain" pour une expiration à J+1', async () => {
      const el = await renderWithExpiry(1);
      expect(el.textContent).toContain('Expire demain');
    });

    it('affiche un compte à rebours pour une expiration <= 7 jours', async () => {
      const el = await renderWithExpiry(5);
      expect(el.textContent).toContain('Expire dans 5 jours');
    });

    it('affiche la date complète (non urgente) au-delà de 7 jours', async () => {
      const el = await renderWithExpiry(30);
      expect(el.querySelector('.k-wlt-expiry--urgent')).toBeNull();
      expect(el.textContent).toContain('Valable jusqu\'au');
    });

    it('n\'affiche aucun bloc expiration si expires_at absent', async () => {
      apiGet.mockImplementation((path) =>
        path === '/api/wallet'
          ? Promise.resolve({ balance_kmf: 1000, expires_at: null })
          : Promise.resolve({ transactions: [] })
      );
      renderWalletView();
      await flush();
      const el = document.getElementById('k-wallet-view');
      expect(el.querySelector('.k-wlt-expiry')).toBeNull();
    });
  });

  it('le CTA "Faire mes achats" clique sur l\'onglet shop', async () => {
    document.body.innerHTML = '<button data-tab="shop"></button>';
    apiGet.mockImplementation((path) =>
      path === '/api/wallet' ? Promise.resolve({ balance_kmf: 1000 }) : Promise.resolve({ transactions: [] })
    );
    renderWalletView();
    await flush();
    const shopBtn = document.querySelector('[data-tab="shop"]');
    const spy = jest.spyOn(shopBtn, 'click');
    document.getElementById('k-wlt-cta-btn').click();
    expect(spy).toHaveBeenCalled();
  });
});

describe('renderWalletView — résilience réseau', () => {
  it('panne réseau sans identité → état erreur + Réessayer (pas la gate)', async () => {
    apiGet.mockRejectedValue(new Error('network down'));
    getCurrentIdentity.mockReturnValue(null);
    renderWalletView();
    await flush();
    expect(document.getElementById('k-wlt-retry-btn')).not.toBeNull();
    expect(document.getElementById('k-wlt-auth-btn')).toBeNull();
  });

  it('timeout → état erreur + Réessayer, jamais loader résiduel', async () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError', isTimeout: true });
    apiGet.mockRejectedValue(err);
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.textContent).toContain('porte-monnaie met trop de temps');
    expect(el.querySelector('.k-wlt-loading')).toBeNull();
    expect(el.querySelector('#k-wlt-retry-btn')).not.toBeNull();
  });

  it('échec transactions seul → solde affiché + avertissement historique', async () => {
    apiGet.mockImplementation((path) =>
      path === '/api/wallet'
        ? Promise.resolve({ balance_kmf: 4000 })
        : Promise.reject(new Error('tx down'))
    );
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('.k-wlt-card')).not.toBeNull();
    expect(el.textContent).toContain('Historique momentanément indisponible');
  });
});

describe('groupTransactions (via buildTransactionList)', () => {
  async function renderWithTx(transactions) {
    apiGet.mockImplementation((path) =>
      path === '/api/wallet' ? Promise.resolve({ balance_kmf: 1000 }) : Promise.resolve({ transactions })
    );
    renderWalletView();
    await flush();
    return document.getElementById('k-wallet-view');
  }

  it('masque les transactions de type reversal', async () => {
    const el = await renderWithTx([
      { type: 'reversal', reason: 'reversal', amount_kmf: 100, created_at: '2026-06-01T00:00:00Z' },
    ]);
    expect(el.querySelectorAll('.k-wlt-tx-row').length).toBe(0);
  });

  it('masque les transactions avec un reason inconnu', async () => {
    const el = await renderWithTx([
      { type: 'credit', reason: 'mystere', amount_kmf: 100, created_at: '2026-06-01T00:00:00Z' },
    ]);
    expect(el.querySelectorAll('.k-wlt-tx-row').length).toBe(0);
  });

  it('regroupe les transactions partageant un order_reference et affiche l\'impact net', async () => {
    const el = await renderWithTx([
      { type: 'debit', reason: 'checkout', amount_kmf: 3000, order_reference: 'K1ABCD', created_at: '2026-06-01T00:00:00Z' },
      { type: 'credit', reason: 'order_cancel', amount_kmf: 1000, order_reference: 'K1ABCD', created_at: '2026-06-02T00:00:00Z' },
    ]);
    const rows = el.querySelectorAll('.k-wlt-tx-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('K1ABCD');
    expect(rows[0].querySelector('.k-wlt-tx-amt--debit')).not.toBeNull();
  });

  it('masque un groupe dont le net est zéro (commande payée puis intégralement remboursée)', async () => {
    const el = await renderWithTx([
      { type: 'debit', reason: 'checkout', amount_kmf: 2000, order_reference: 'K2ZERO', created_at: '2026-06-01T00:00:00Z' },
      { type: 'credit', reason: 'order_cancel', amount_kmf: 2000, order_reference: 'K2ZERO', created_at: '2026-06-02T00:00:00Z' },
    ]);
    expect(el.querySelectorAll('.k-wlt-tx-row').length).toBe(0);
  });

  it('garde les transactions orphelines (sans order_reference)', async () => {
    const el = await renderWithTx([
      { type: 'credit', reason: 'admin_gift', amount_kmf: 500, created_at: '2026-06-01T00:00:00Z' },
    ]);
    expect(el.querySelectorAll('.k-wlt-tx-row').length).toBe(1);
  });

  it('affiche l\'icône ⏳ et le libellé "Crédit expiré" pour une transaction de type expiration', async () => {
    const el = await renderWithTx([
      { type: 'expiration', reason: 'expiration', amount_kmf: 300, created_at: '2026-06-01T00:00:00Z' },
    ]);
    const row = el.querySelector('.k-wlt-tx-row');
    expect(row).not.toBeNull();
    expect(row.querySelector('.k-wlt-tx-icon').textContent).toBe('⏳');
    expect(row.textContent).toContain('Crédit expiré');
  });

  it('retombe sur l\'icône par défaut "•" pour un type non reconnu (reason connu)', async () => {
    const el = await renderWithTx([
      { type: 'mystere', reason: 'admin_gift', amount_kmf: 300, created_at: '2026-06-01T00:00:00Z' },
    ]);
    const row = el.querySelector('.k-wlt-tx-row');
    expect(row.querySelector('.k-wlt-tx-icon').textContent).toBe('•');
  });

  it('trie les transactions par date décroissante et regroupe par mois', async () => {
    const el = await renderWithTx([
      { type: 'credit', reason: 'admin_gift', amount_kmf: 100, created_at: '2026-05-01T00:00:00Z' },
      { type: 'credit', reason: 'admin_gift', amount_kmf: 200, created_at: '2026-06-01T00:00:00Z' },
    ]);
    const months = el.querySelectorAll('.k-wlt-month');
    expect(months.length).toBe(2);
    expect(months[0].textContent.toLowerCase()).toContain('juin');
  });
});
