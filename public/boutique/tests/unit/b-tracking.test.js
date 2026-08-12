'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-tracking.test.js
 *
 * Module js/b-tracking.js (395L) — suivi de commande (référence directe ou
 * OTP + historique). 0% de couverture réelle avant cette session (jamais
 * testé, jamais mocké non plus dans les autres suites).
 *
 * Couverture visée :
 *   buildTimeline()       : position done/current/à venir pour chaque statut,
 *                           statut inconnu (idx = -1, rien "done"/"current").
 *   getStatusDisplay()    : tous les statuts connus + fallback inconnu.
 *   formatOrderDate()     : aujourd'hui / hier / "il y a N jours" / date
 *                           complète / vide / date invalide (catch).
 *   renderOrdersHistory() : liste vide vs cartes rendues.
 *   renderOrderDetail()   : rendu d'une seule commande.
 *   renderMyOrdersList()  : cartes construites, clic carte -> apiGet détail,
 *                           erreur réseau -> toast, clic "chercher autre".
 *   renderTrackView()     : montage/ancrage, cas 0 commande -> mode recherche,
 *                           cas commandes présentes -> renderMyOrdersList.
 *   renderTrackViewSearchMode() :
 *     - recherche rapide par référence (6 caractères, succès, erreur "introuvable")
 *     - bascule vers le mode OTP historique
 *     - demande de code (succès/erreur), vérification (succès/erreur),
 *       chargement du tracking après OTP (avec et sans commandes), renvoi de code.
 *
 * b-phone.js est mocké (comme dans b-checkout.test.js) pour isoler la logique
 * propre à b-tracking.js ; sa propre couverture est assurée par
 * tests/unit/b-phone.test.js.
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => String(s ?? '')),
  optimizeImgUrl: jest.fn((url) => url),
  fmt: jest.fn((n) => n + ' KMF'),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));
jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
}));
jest.mock('../../js/b-phone.js', () => ({
  PHONE_COUNTRIES: [{ code: '+33', name: 'France', digits: 9 }],
  phoneBlockHTML: jest.fn(
    (selId, inpId, code) =>
      `<select id="${selId}"></select><input id="${inpId}" type="tel" data-default="${code}">`
  ),
  buildPhoneSelect: jest.fn(),
  buildE164: jest.fn((code, raw) => code + raw.replace(/\D/g, '')),
  digitsOnly: jest.fn((v) => (v || '').replace(/\D/g, '')),
  normalizeLocal: jest.fn((code, digits) => digits),
}));
jest.mock('../../js/group/group-api.js', () => ({
  getSharedCartLibrary: jest.fn(),
  closeCart: jest.fn(),
}));
jest.mock('../../js/group/group-side-cart.js', () => ({
  activateFromParticipantUrl: jest.fn(),
}));
jest.mock('../../js/b-nav.js', () => ({
  switchView: jest.fn(),
  activateNavTab: jest.fn(),
}));

const { apiGet, apiPost } = require('../../js/b-utils.js');
const { showToast } = require('../../js/b-cart-core.js');
const { flush } = require('./helpers/boutiqueTestKit');
const { getSharedCartLibrary } = require('../../js/group/group-api.js');
const { activateFromParticipantUrl } = require('../../js/group/group-side-cart.js');
const { switchView, activateNavTab } = require('../../js/b-nav.js');
const {
  buildTimeline,
  getStatusDisplay,
  formatOrderDate,
  renderOrdersHistory,
  renderOrderDetail,
  renderMyOrdersList,
  renderTrackView,
  renderTrackViewSearchMode,
  renderListsTab,
} = require('../../js/b-tracking.js');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('buildTimeline', () => {
  it('marque les étapes précédentes comme "done" et l\'étape courante comme "current"', () => {
    const html = buildTimeline('shipped');
    // shipped est l'index 2 (0:pending,1:preparation,2:shipped,...)
    const doneCount = (html.match(/k-track-step-dot done/g) || []).length;
    const currentCount = (html.match(/k-track-step-dot current/g) || []).length;
    expect(doneCount).toBe(2);
    expect(currentCount).toBe(1);
  });

  it('ne marque rien comme done/current pour un statut inconnu', () => {
    const html = buildTimeline('statut-bidon');
    expect(html).not.toContain('done');
    expect(html).not.toContain('current');
  });

  it('affiche l\'icône du step au lieu du check si non terminé', () => {
    const html = buildTimeline('pending');
    expect(html).toContain('⚙️'); // icône de "preparation", pas encore done
  });
});

describe('getStatusDisplay', () => {
  it.each([
    ['pending', 'En attente'],
    ['confirmed', 'Confirmée'],
    ['paid', 'Payée'],
    ['shipped', 'Expédiée'],
    ['available', 'Au relais'],
    ['collected', 'Retirée'],
    ['cancelled', 'Annulée'],
  ])('mappe le statut %s vers le libellé attendu', (status, label) => {
    expect(getStatusDisplay(status).label).toBe(label);
  });

  it('retombe sur un affichage générique pour un statut inconnu', () => {
    const d = getStatusDisplay('truc-inconnu');
    expect(d.label).toBe('truc-inconnu');
    expect(d.cls).toBe('pending');
    expect(d.emoji).toBe('📦');
  });

  it('gère un statut vide/undefined', () => {
    const d = getStatusDisplay(undefined);
    expect(d.label).toBe('Inconnu');
  });
});

describe('formatOrderDate', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('retourne une chaîne vide si pas de date', () => {
    expect(formatOrderDate(null)).toBe('');
    expect(formatOrderDate('')).toBe('');
  });

  it("retourne \"Aujourd'hui\" pour une date du jour", () => {
    expect(formatOrderDate('2026-07-06T08:00:00Z')).toBe("Aujourd'hui");
  });

  it('retourne "Hier" pour la veille', () => {
    expect(formatOrderDate('2026-07-05T08:00:00Z')).toBe('Hier');
  });

  it('retourne "Il y a N jours" pour moins d\'une semaine', () => {
    expect(formatOrderDate('2026-07-02T08:00:00Z')).toBe('Il y a 4 jours');
  });

  it('retourne une date formatée au-delà d\'une semaine', () => {
    const result = formatOrderDate('2026-06-01T08:00:00Z');
    expect(result).not.toBe('');
    expect(result).not.toContain('Il y a');
  });

  it('ne plante pas sur une date non parseable (Date invalide gérée par le moteur, pas par le catch)', () => {
    // new Date(str-invalide) ne lève pas en JS — elle produit un objet Date
    // invalide, et toLocaleDateString renvoie "Invalid Date" plutôt que de
    // lever une exception. Le catch de formatOrderDate n'est donc atteint
    // que dans des cas plus exotiques (non reproductibles simplement ici) ;
    // on vérifie seulement l'absence de crash.
    expect(() => formatOrderDate('n\'importe-quoi-de-non-parseable-!!')).not.toThrow();
  });
});

describe('renderOrdersHistory', () => {
  it('affiche un message si aucune commande', () => {
    const container = document.createElement('div');
    renderOrdersHistory([], container);
    expect(container.textContent).toContain('Aucune commande trouvée');
  });

  it('rend une carte par commande', () => {
    const container = document.createElement('div');
    renderOrdersHistory(
      [
        { reference: 'K1AAAA', total_amount: 1000, status: 'pending', created_at: '2026-07-01T00:00:00Z' },
        { reference: 'K2BBBB', total_amount: 2000, status: 'shipped', created_at: '2026-07-02T00:00:00Z' },
      ],
      container
    );
    expect(container.querySelectorAll('.k-order-card').length).toBe(2);
    expect(container.textContent).toContain('K1AAAA');
    expect(container.textContent).toContain('K2BBBB');
  });
});

describe('renderOrderDetail', () => {
  it('rend la carte de la commande avec sa timeline', () => {
    const container = document.createElement('div');
    renderOrderDetail({ reference: 'K9ZZZZ', total_amount: 5000, status: 'available' }, container);
    expect(container.querySelector('.k-order-ref').textContent).toBe('K9ZZZZ');
    expect(container.querySelector('.k-track-steps')).not.toBeNull();
  });

  it('utilise l\'id comme repli si reference absente', () => {
    const container = document.createElement('div');
    renderOrderDetail({ id: 'internal-id-1', total_amount: 0, status: 'pending' }, container);
    expect(container.querySelector('.k-order-ref').textContent).toBe('internal-id-1');
  });
});

describe('renderMyOrdersList', () => {
  function makeOrders() {
    return [
      {
        reference: 'K1AAAA',
        status: 'pending',
        total_kmf: 1500,
        created_at: '2026-07-06T00:00:00Z',
        product_name: 'Riz 25kg',
        items_count: 1,
      },
      {
        reference: 'K2BBBB',
        status: 'shipped',
        total_kmf: 3000,
        created_at: '2026-07-01T00:00:00Z',
        product_name: 'Huile',
        product_image_url: 'https://img/x.jpg',
        items_count: 3,
      },
    ];
  }

  it('rend une carte par commande avec le résumé attendu', () => {
    const el = document.createElement('div');
    renderMyOrdersList(el, makeOrders());
    const cards = el.querySelectorAll('.k-myorder-card');
    expect(cards.length).toBe(2);
    expect(cards[1].textContent).toContain('Huile + 2 autres');
  });

  it('affiche le nombre de commandes trouvées dans l\'en-tête', () => {
    const el = document.createElement('div');
    renderMyOrdersList(el, makeOrders());
    expect(el.textContent).toContain('2 commandes trouvées');
  });

  it('clic sur une carte charge le détail via apiGet et l\'affiche', async () => {
    const el = document.createElement('div');
    renderMyOrdersList(el, makeOrders());
    apiGet.mockResolvedValue({ order: { reference: 'K1AAAA', status: 'pending', total_amount: 1500 } });

    el.querySelector('[data-ref="K1AAAA"]').click();
    await flush();

    expect(apiGet).toHaveBeenCalledWith('/api/orders/K1AAAA');
    expect(el.querySelector('.k-order-ref')).not.toBeNull();
  });

  it('affiche un toast d\'erreur si le chargement du détail échoue', async () => {
    const el = document.createElement('div');
    renderMyOrdersList(el, makeOrders());
    apiGet.mockRejectedValue(new Error('network'));

    const card = el.querySelector('[data-ref="K1AAAA"]');
    card.click();
    await flush();

    expect(showToast).toHaveBeenCalledWith('Impossible de charger cette commande.', 'error');
    expect(card.classList.contains('k-myorder-loading')).toBe(false);
  });

  it('le bouton "chercher une autre commande" bascule vers le mode recherche', () => {
    const el = document.createElement('div');
    renderMyOrdersList(el, makeOrders());
    el.querySelector('#k-myorders-search-other').click();
    expect(el.querySelector('#k-track-quick')).not.toBeNull();
  });
});

describe('renderTrackView', () => {
  it('crée #k-track-view ancré après #k-fav-view', async () => {
    document.body.innerHTML = '<div id="k-fav-view"></div>';
    apiGet.mockResolvedValue({ orders: [] });
    renderTrackView();
    const el = document.getElementById('k-track-view');
    expect(el).not.toBeNull();
    expect(document.getElementById('k-fav-view').nextElementSibling).toBe(el);
    await flush();
  });

  it('affiche le mode recherche si aucune commande', async () => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockResolvedValue({ orders: [] });
    renderTrackView();
    await flush();
    expect(document.getElementById('k-track-quick')).not.toBeNull();
  });

  it('affiche la liste des commandes si des commandes existent', async () => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockResolvedValue({
      orders: [{ reference: 'K1AAAA', status: 'pending', total_kmf: 1000, created_at: '2026-07-01T00:00:00Z' }],
    });
    renderTrackView();
    await flush();
    expect(document.querySelector('.k-myorder-card')).not.toBeNull();
  });

  it('gère une réponse API qui est directement un tableau (pas {orders: [...]})', async () => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockResolvedValue([{ reference: 'K3CCCC', status: 'pending', total_kmf: 1000, created_at: '2026-07-01T00:00:00Z' }]);
    renderTrackView();
    await flush();
    expect(document.querySelector('.k-myorder-card')).not.toBeNull();
  });

  // FIX 2026-07-10 : une panne technique n'est PLUS déguisée en mode recherche —
  // elle affiche un état erreur + Réessayer (avec fallback recherche proposé).
  // La bascule directe en mode recherche reste le comportement du 401 (pas de session).
  it('panne technique de l\'appel API → état erreur + Réessayer (fallback recherche proposé)', async () => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockRejectedValue(new Error('down'));
    renderTrackView();
    await flush();
    expect(document.getElementById('k-track-retry-btn')).not.toBeNull();
    expect(document.getElementById('k-track-search-fallback-btn')).not.toBeNull();
  });

  it('401 (pas de session) → bascule en mode recherche', async () => {
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    apiGet.mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }));
    renderTrackView();
    await flush();
    expect(document.getElementById('k-track-quick')).not.toBeNull();
  });
});

describe('renderTrackViewSearchMode', () => {
  function mountSearchMode() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderTrackViewSearchMode(el);
    return el;
  }

  it('recherche rapide par référence : succès -> affiche le détail', async () => {
    const el = mountSearchMode();
    apiGet.mockResolvedValue({ order: { reference: 'K3XR7FZ', status: 'pending', total_amount: 500 } });

    el.querySelector('#k-track-digits').value = '3XR7FZ';
    el.querySelector('#k-track-quick-btn').click();
    await flush();

    expect(apiGet).toHaveBeenCalledWith('/api/orders/K3XR7FZ');
    expect(el.querySelector('#k-otp-step3').classList.contains('u-hidden')).toBe(false);
  });

  it('recherche rapide : moins de 6 caractères -> toast erreur, pas d\'appel API', async () => {
    const el = mountSearchMode();
    el.querySelector('#k-track-digits').value = 'X';
    el.querySelector('#k-track-quick-btn').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith('Entrez les 6 caractères de votre référence.', 'error');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('recherche rapide : référence introuvable -> toast erreur et réactive le bouton', async () => {
    const el = mountSearchMode();
    apiGet.mockRejectedValue(new Error('not found'));
    el.querySelector('#k-track-digits').value = '3XR7FZ';
    const btn = el.querySelector('#k-track-quick-btn');
    btn.click();
    await flush();
    expect(showToast).toHaveBeenCalledWith('Commande introuvable. Vérifiez la référence (ex : K3XR7F).', 'error');
    expect(btn.disabled).toBe(false);
  });

  it('la saisie de 6 caractères déclenche automatiquement la recherche', async () => {
    const el = mountSearchMode();
    apiGet.mockResolvedValue({ order: { reference: 'K3XR7FZ', status: 'pending' } });
    const input = el.querySelector('#k-track-digits');
    input.value = '3xr7fz';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(input.value).toBe('3XR7FZ');
    expect(apiGet).toHaveBeenCalledWith('/api/orders/K3XR7FZ');
  });

  it('bascule vers le mode OTP historique puis retour au mode rapide', () => {
    const el = mountSearchMode();
    el.querySelector('#k-track-history-toggle').click();
    expect(el.querySelector('#k-track-otp').classList.contains('u-hidden')).toBe(false);
    expect(el.querySelector('#k-track-quick').classList.contains('u-hidden')).toBe(true);

    el.querySelector('#k-track-back-quick').click();
    expect(el.querySelector('#k-track-quick').classList.contains('u-hidden')).toBe(false);
  });

  describe('flux OTP historique', () => {
    function fillValidPhone(el) {
      // Le mock de b-phone.js déclare digits:9 pour '+33' et applique
      // normalizeLocal en identité (pas de retrait du 0 initial) : on
      // saisit donc directement 9 chiffres sans 0 pour que
      // isValidLocalLength (via le mock) valide le numéro.
      const country = el.querySelector('#k-otp-country');
      const input = el.querySelector('#k-otp-phone');
      country.value = '+33';
      input.value = '612345678';
    }

    it("demande de code : numéro invalide -> toast, pas d'appel réseau", async () => {
      const el = mountSearchMode();
      el.querySelector('#k-track-history-toggle').click();
      el.querySelector('#k-otp-phone').value = '';
      el.querySelector('#k-otp-request-btn').click();
      await flush();
      expect(showToast).toHaveBeenCalledWith('Entrez un numéro valide pour ce pays.', 'error');
      expect(apiPost).not.toHaveBeenCalled();
    });

    it('demande de code : succès -> passe au step2 (saisie code)', async () => {
      const el = mountSearchMode();
      el.querySelector('#k-track-history-toggle').click();
      fillValidPhone(el);
      apiPost.mockResolvedValue({ success: true });

      el.querySelector('#k-otp-request-btn').click();
      await flush();

      expect(apiPost).toHaveBeenCalledWith('/api/auth/otp/request', { phone: '+33612345678' });
      expect(el.querySelector('#k-otp-step2').classList.contains('u-hidden')).toBe(false);
    });

    it('demande de code : échec réseau -> toast erreur, réactive le bouton', async () => {
      const el = mountSearchMode();
      el.querySelector('#k-track-history-toggle').click();
      fillValidPhone(el);
      apiPost.mockRejectedValue(new Error('Envoi impossible'));

      const btn = el.querySelector('#k-otp-request-btn');
      btn.click();
      await flush();

      expect(showToast).toHaveBeenCalledWith('Envoi impossible', 'error');
      expect(btn.disabled).toBe(false);
    });

    async function reachStep2(el) {
      el.querySelector('#k-track-history-toggle').click();
      fillValidPhone(el);
      apiPost.mockResolvedValue({ success: true });
      el.querySelector('#k-otp-request-btn').click();
      await flush();
    }

    it('vérification code : code trop court -> toast erreur', async () => {
      const el = mountSearchMode();
      await reachStep2(el);
      el.querySelector('#k-otp-code').value = '12';
      el.querySelector('#k-otp-verify-btn').click();
      await flush();
      expect(showToast).toHaveBeenCalledWith('Entrez le code complet.', 'error');
    });

    it('vérification code : succès avec commandes -> affiche l\'historique', async () => {
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockResolvedValue({ success: true, user: { name: 'Fatima' } });
      apiGet.mockResolvedValue({
        orders: [{ reference: 'K1AAAA', status: 'pending', totalKmf: 1000, createdAt: '2026-07-01T00:00:00Z' }],
      });

      el.querySelector('#k-otp-code').value = '123456';
      el.querySelector('#k-otp-verify-btn').click();
      await flush();

      expect(apiGet).toHaveBeenCalledWith('/api/client/tracking');
      expect(el.querySelector('#k-otp-step3').classList.contains('u-hidden')).toBe(false);
      expect(el.querySelector('#k-orders-list').textContent).toContain('K1AAAA');
    });

    it('vérification code : succès mais aucune commande -> message de bienvenue sans commande', async () => {
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockResolvedValue({ success: true, user: { name: 'Fatima' } });
      apiGet.mockRejectedValue(new Error('tracking down'));

      el.querySelector('#k-otp-code').value = '123456';
      el.querySelector('#k-otp-verify-btn').click();
      await flush();

      expect(el.querySelector('#k-orders-list').textContent).toContain('Fatima');
      expect(el.querySelector('#k-orders-list').textContent).toContain('Aucune commande trouvée');
    });

    it('vérification code : code incorrect -> toast erreur, réactive le bouton', async () => {
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockRejectedValue(new Error('Code incorrect ou expiré.'));

      const verifyBtn = el.querySelector('#k-otp-verify-btn');
      el.querySelector('#k-otp-code').value = '000000';
      verifyBtn.click();
      await flush();

      expect(showToast).toHaveBeenCalledWith('Code incorrect ou expiré.', 'error');
      expect(verifyBtn.disabled).toBe(false);
    });

    it('renvoi de code : succès -> nouveau toast et compte à rebours', async () => {
      jest.useFakeTimers();
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockResolvedValue({ success: true });

      const resendBtn = el.querySelector('#k-otp-resend-btn');
      resendBtn.click();
      await flush();

      expect(showToast).toHaveBeenCalledWith('📲 Nouveau code envoyé !', 'success');
      expect(resendBtn.disabled).toBe(true);
      jest.useRealTimers();
    });

    it('renvoi de code : échec réseau -> toast d\'erreur et bouton réactivé', async () => {
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockRejectedValue(new Error('network down'));

      const resendBtn = el.querySelector('#k-otp-resend-btn');
      resendBtn.click();
      await flush();

      expect(showToast).toHaveBeenCalledWith('Erreur lors du renvoi.', 'error');
      expect(resendBtn.disabled).toBe(false);
      expect(resendBtn.textContent).toBe('Renvoyer le code');
    });

    it('renvoi de code : le compte à rebours de 30s décrémente puis réactive le bouton à 0', async () => {
      jest.useFakeTimers();
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockResolvedValue({ success: true });

      const resendBtn = el.querySelector('#k-otp-resend-btn');
      resendBtn.click();
      await flush();

      jest.advanceTimersByTime(1000);
      expect(resendBtn.textContent).toBe('Renvoyer (29s)');

      // Fait s'écouler le reste du compte à rebours jusqu'à 0.
      jest.advanceTimersByTime(29000);
      expect(resendBtn.disabled).toBe(false);
      expect(resendBtn.textContent).toBe('Renvoyer le code');

      // Un second clic doit redevenir possible (resendTimer a bien été remis à null).
      apiPost.mockClear();
      apiPost.mockResolvedValue({ success: true });
      resendBtn.click();
      await flush();
      expect(apiPost).toHaveBeenCalledWith('/api/auth/otp/request', { phone: '+33612345678' });
      jest.useRealTimers();
    });

    it('bouton retour du step3 relance renderTrackView (rebascule vers l\'historique)', async () => {
      // renderTrackView() (appelée par #k-otp-back-btn) a besoin d'un point
      // d'ancrage réel dans le document pour se monter.
      document.body.innerHTML = '<div id="k-catalog-section"></div>';
      const el = mountSearchMode();
      await reachStep2(el);
      apiPost.mockResolvedValue({ success: true, user: { name: 'Fatima' } });
      apiGet.mockResolvedValue({ orders: [] });
      el.querySelector('#k-otp-code').value = '123456';
      el.querySelector('#k-otp-verify-btn').click();
      await flush();

      apiGet.mockResolvedValue({ orders: [] });
      expect(() => el.querySelector('#k-otp-back-btn').click()).not.toThrow();
    });
  });
});

describe('renderListsTab — bibliothèque de listes (GAP-01/02)', () => {
  function mountListsPanel() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('rend les cartes de listes fermées avec l\'attribut disabled', async () => {
    getSharedCartLibrary.mockResolvedValue({
      created: [{ id: 1, token: 'tok-closed', status: 'closed', title: 'Liste fermée', total_kmf: 1000, items_count: 2, claimed_count: 1 }],
      saved: [],
    });
    const el = mountListsPanel();
    await renderListsTab(el);
    await flush();

    const btn = el.querySelector('.k-library-item[data-token="tok-closed"]');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.status).toBe('closed');
  });

  it('clic sur une liste fermée ne bascule pas la vue et n\'active pas le contexte de liste', async () => {
    getSharedCartLibrary.mockResolvedValue({
      created: [{ id: 1, token: 'tok-closed', status: 'closed', title: 'Liste fermée', total_kmf: 1000, items_count: 2, claimed_count: 1 }],
      saved: [],
    });
    const el = mountListsPanel();
    await renderListsTab(el);
    await flush();

    switchView.mockClear();
    activateFromParticipantUrl.mockClear();

    const btn = el.querySelector('.k-library-item[data-token="tok-closed"]');
    // Le guard dataset.status doit tenir même si `disabled` était retiré après coup.
    btn.disabled = false;
    btn.click();
    await flush();

    expect(switchView).not.toHaveBeenCalled();
    expect(activateFromParticipantUrl).not.toHaveBeenCalled();
  });

  it('clic sur une liste ouverte bascule vers la Boutique puis active le contexte de liste', async () => {
    getSharedCartLibrary.mockResolvedValue({
      created: [{ id: 2, token: 'tok-open', status: 'open', title: 'Liste ouverte', total_kmf: 5000, items_count: 3, claimed_count: 1 }],
      saved: [],
    });
    const el = mountListsPanel();
    await renderListsTab(el);
    await flush();

    switchView.mockClear();
    activateFromParticipantUrl.mockClear();

    const btn = el.querySelector('.k-library-item[data-token="tok-open"]');
    expect(btn.disabled).toBe(false);
    btn.click();
    await flush();

    expect(activateNavTab).toHaveBeenCalledWith('shop');
    expect(switchView).toHaveBeenCalledWith('shop');
    expect(activateFromParticipantUrl).toHaveBeenCalledWith('tok-open');
    // GAP-01 : la Boutique doit être activée avant le contexte de liste.
    const switchOrder = switchView.mock.invocationCallOrder[0];
    const activateOrder = activateFromParticipantUrl.mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(activateOrder);
  });
});
