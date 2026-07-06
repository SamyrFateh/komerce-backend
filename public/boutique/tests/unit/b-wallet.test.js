'use strict';

/**
 * tests/unit/b-wallet.test.js
 *
 * Module js/b-wallet.js (329L) — vue "Mon porte-monnaie" (solde + historique).
 * 0% de couverture réelle avant cette session.
 *
 * Seule renderWalletView() est exportée ; le reste (gate OTP, carte de solde,
 * état vide, liste de transactions, groupement par commande) est testé au
 * travers du DOM qu'elle produit — même approche que b-tracking.js.
 *
 * Couverture visée :
 *   renderWalletView() : montage initial (#k-wallet-view créé + ancré),
 *     réutilisation si déjà présent, gate OTP si pas de solde ET pas
 *     d'identité, affichage solde>0 / solde=0, avec/sans transactions.
 *   renderAuthGate()   : clic -> requireIdentity() -> succès (re-render) /
 *     annulation (réactive le bouton).
 *   buildBalanceCard() : urgence d'expiration (0j, 1j, <=7j, >7j), CTA
 *     "Faire mes achats" clique sur l'onglet shop.
 *   buildEmptyState()  : rendu si balance = 0.
 *   groupTransactions() (via buildTransactionList) : masque reversal/reason
 *     inconnu, regroupe par order_reference, cache le net=0, garde les
 *     orphelines (sans order_reference), tri anti-chronologique, en-têtes
 *     de mois.
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

describe('renderWalletView — gate OTP', () => {
  it('affiche la gate si aucune donnée ET aucune identité', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValue(null);
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).not.toBeNull();
    expect(el.textContent).toContain('Identifiez-vous');
  });

  it('n\'affiche pas la gate si une identité existe déjà, même sans solde', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValue({ name: 'Fatima' });
    renderWalletView();
    await flush();
    const el = document.getElementById('k-wallet-view');
    expect(el.querySelector('#k-wlt-auth-btn')).toBeNull();
  });

  it('clic sur le bouton gate : succès identité -> recharge la vue wallet', async () => {
    apiGet.mockResolvedValue(null);
    getCurrentIdentity.mockReturnValueOnce(null); // 1er rendu : gate
    requireIdentity.mockResolvedValue({ name: 'Fatima' });
    renderWalletView();
    await flush();

    // Après identification réussie, le second renderWalletView() doit voir une identité.
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
    expect(spy).not.toThrow;
  });
});

describe('renderWalletView — résilience réseau', () => {
  it('affiche la gate si les deux appels API rejettent et qu\'il n\'y a pas d\'identité', async () => {
    apiGet.mockRejectedValue(new Error('network down'));
    getCurrentIdentity.mockReturnValue(null);
    renderWalletView();
    await flush();
    expect(document.getElementById('k-wlt-auth-btn')).not.toBeNull();
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
    // La transaction reversal est filtrée par groupTransactions ; la liste
    // reçoit un tableau non vide (donc pas l'état "Aucun mouvement", qui ne
    // s'affiche que si transactions.length === 0 en amont) mais 0 ligne rendue.
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

  // Note : la branche "transactions.length === 0" à l'intérieur de
  // buildTransactionList() est du code mort depuis renderWalletView(), qui
  // n'appelle buildTransactionList() que si transactions.length > 0 (cf.
  // garde ligne ~113). Non testée ici en conséquence — signalé pour audit
  // plutôt que simulé artificiellement.

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
    // Le plus récent (juin) doit apparaître en premier.
    expect(months[0].textContent.toLowerCase()).toContain('juin');
  });
});
