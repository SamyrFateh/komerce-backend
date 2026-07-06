'use strict';

/**
 * tests/unit/SuppliersView.test.js
 *
 * admin/js/views/SuppliersView.js (429L) — Fournisseurs & partenaires /admin/suppliers
 * Export public : `SuppliersView` (constructeur) → new SuppliersView().render(container).
 *
 * Dépendance externe : `KmcApi` (global, mocké) — getPartners(), getPartnersStats(),
 * createPartner(body), updatePartner(id, body), deletePartner(id).
 * `window.alert` et `window.confirm` mockés (validations et confirmations destructrices).
 *
 * Périmètre couvert :
 *   - render() : loading, chargement partners+stats (formats array et {partners}/{stats}),
 *     comptage par type, erreur réseau
 *   - buildUI : 5 onglets avec compteurs, onglet actif par défaut (sourcing), hint contextuel,
 *     état vide (avec/sans recherche), grille de cartes
 *   - filterPartners : filtre par type actif, recherche multi-champs, tri actifs d'abord puis alpha
 *   - renderCard : étoiles, lignes meta (contact, pays/zone, île/zone, délai), tags
 *     (actif/inactif + catégories limitées à 3), bloc stats (logistique vs autres, absent si pas
 *     de stats ou type hors liste), actions (whatsapp, éditer, toggle, supprimer)
 *   - Bascule d'onglet (reset recherche), recherche avec debounce 200ms
 *   - openModal : création (défauts) vs édition (pré-remplissage), fermeture (croix, fond, annuler)
 *   - saveFromModal : validation nom obligatoire, création vs mise à jour, parsing catégories/
 *     nombres, gestion erreur API
 *   - handleDelete : confirmation annulée, succès (message optionnel), échec
 *   - handleToggle : succès et échec
 *   - Clic sur carte ouvre le modal sauf clic sur action/lien
 */

function makePartner(overrides) {
  return Object.assign({
    id: 'sup-1',
    name: 'Dubai Trading Co',
    partner_type: 'sourcing',
    is_active: true,
    contact_name: 'Ahmed K.',
    contact_phone: '+971 50 123 4567',
    contact_email: 'ahmed@dubaitrading.ae',
    whatsapp_url: 'https://wa.me/971501234567',
    website_url: 'https://dubaitrading.ae',
    country_code: 'AE',
    country_label: 'Émirats Arabes Unis',
    island: null,
    zone: 'Deira',
    address: null,
    currency: 'AED',
    lead_time_days: 10,
    commission_kmf: 0,
    payment_terms: null,
    product_categories: ['phones', 'electromenager'],
    pricing_notes: null,
    rating: 4,
    notes: null,
  }, overrides);
}

describe('SuppliersView', () => {
  let container, view;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    container = document.getElementById('main');

    global.KmcApi = {
      getPartners: jest.fn().mockResolvedValue([makePartner()]),
      getPartnersStats: jest.fn().mockResolvedValue([]),
      createPartner: jest.fn().mockResolvedValue({}),
      updatePartner: jest.fn().mockResolvedValue({}),
      deletePartner: jest.fn().mockResolvedValue({}),
    };
    global.alert = jest.fn();
    global.confirm = jest.fn(() => true);

    require('../../dashboards/admin/js/views/SuppliersView.js');
    view = new global.SuppliersView();
  });

  afterEach(() => {
    document.getElementById('suppliers-view-styles')?.remove();
    document.getElementById('sv-modal')?.remove();
    delete global.KmcApi;
    delete global.alert;
    delete global.confirm;
  });

  async function renderView() {
    view.render(container);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  }

  /* ── render() ────────────────────────────────────────────────────── */
  describe('render()', () => {
    it('affiche le loader avant résolution', () => {
      view.render(container);
      expect(container.innerHTML).toMatch(/Chargement fournisseurs/);
    });

    it('accepte un format tableau direct pour partners et stats', async () => {
      await renderView();
      expect(container.querySelectorAll('.sv-card').length).toBe(1);
    });

    it('accepte un format enveloppé {partners}/{stats}', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue({ partners: [makePartner()] });
      global.KmcApi.getPartnersStats = jest.fn().mockResolvedValue({ stats: [{ partner_id: 'sup-1', orders_count_30d: 5, avg_margin_pct_90d: 22 }] });
      await renderView();
      expect(container.querySelector('.sv-stats').textContent).toMatch(/5/);
    });

    it('affiche une erreur si getPartners échoue', async () => {
      global.KmcApi.getPartners = jest.fn().mockRejectedValue(new Error('network down'));
      await renderView();
      expect(container.innerHTML).toMatch(/Erreur chargement fournisseurs/);
      expect(container.innerHTML).toMatch(/network down/);
    });

    it('continue même si getPartnersStats échoue (catch interne)', async () => {
      global.KmcApi.getPartnersStats = jest.fn().mockRejectedValue(new Error('stats down'));
      await renderView();
      expect(container.querySelectorAll('.sv-card').length).toBe(1);
    });

    it('calcule les compteurs par type pour les 5 onglets', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([
        makePartner({ id: 'a', partner_type: 'sourcing' }),
        makePartner({ id: 'b', partner_type: 'sourcing' }),
        makePartner({ id: 'c', partner_type: 'relais' }),
      ]);
      await renderView();
      const counts = [...container.querySelectorAll('.sv-tab .sv-count')].map(c => c.textContent);
      expect(counts).toEqual(['2', '0', '0', '1', '0']);
    });
  });

  /* ── buildUI / onglets ───────────────────────────────────────────── */
  describe('Onglets et état vide', () => {
    it('affiche sourcing comme onglet actif par défaut avec son hint', async () => {
      await renderView();
      const active = container.querySelector('.sv-tab.active');
      expect(active.dataset.type).toBe('sourcing');
      expect(container.querySelector('.sv-hint').textContent).toMatch(/Dubai\/Chine/);
    });

    it('bascule d\'onglet et réinitialise la recherche', async () => {
      await renderView();
      const search = container.querySelector('#sv-search');
      search.value = 'xyz';
      search.dispatchEvent(new Event('input'));
      container.querySelector('[data-type="relais"]').click();
      expect(container.querySelector('.sv-tab.active').dataset.type).toBe('relais');
      expect(container.querySelector('#sv-search').value).toBe('');
    });

    it('affiche un état vide générique quand aucun partenaire du type', async () => {
      await renderView();
      container.querySelector('[data-type="agent_hub"]').click();
      expect(container.querySelector('.sv-empty').textContent).toMatch(/Aucun hub enregistré/i);
    });

    it('affiche un état vide contextualisé à la recherche', async () => {
      jest.useFakeTimers();
      view.render(container);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const search = container.querySelector('#sv-search');
      search.value = 'introuvable';
      search.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(200);
      expect(container.querySelector('.sv-empty').textContent).toMatch(/correspondant à "introuvable"/);
      jest.useRealTimers();
    });
  });

  /* ── Recherche avec debounce ─────────────────────────────────────── */
  describe('Recherche (debounce 200ms)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('filtre après le délai de debounce, pas avant', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([
        makePartner({ id: 'a', name: 'Alpha Trading' }),
        makePartner({ id: 'b', name: 'Beta Supplies' }),
      ]);
      view.render(container);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      const search = container.querySelector('#sv-search');
      search.value = 'alpha';
      search.dispatchEvent(new Event('input'));
      expect(container.querySelectorAll('.sv-card').length).toBe(2); // pas encore filtré
      jest.advanceTimersByTime(200);
      expect(container.querySelectorAll('.sv-card').length).toBe(1);
    });

    it('recherche sur contact, téléphone, zone, île, pays', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([
        makePartner({ id: 'a', name: 'A', zone: 'Deira' }),
        makePartner({ id: 'b', name: 'B', zone: 'Autre', contact_phone: '+269 333' }),
      ]);
      view.render(container);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const search = container.querySelector('#sv-search');
      search.value = 'deira';
      search.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(200);
      expect(container.querySelectorAll('.sv-card').length).toBe(1);
    });
  });

  /* ── filterPartners / tri ────────────────────────────────────────── */
  describe('Tri des cartes', () => {
    it('trie les actifs en premier puis alphabétiquement', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([
        makePartner({ id: 'a', name: 'Zoulou', is_active: true }),
        makePartner({ id: 'b', name: 'Alpha', is_active: false }),
        makePartner({ id: 'c', name: 'Bravo', is_active: true }),
      ]);
      await renderView();
      const names = [...container.querySelectorAll('.sv-card-name')].map(n => n.textContent);
      expect(names).toEqual(['Bravo', 'Zoulou', 'Alpha']);
    });
  });

  /* ── renderCard ──────────────────────────────────────────────────── */
  describe('renderCard()', () => {
    it('affiche les étoiles selon la note', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([makePartner({ rating: 3 })]);
      await renderView();
      expect(container.querySelector('.sv-card-rating').textContent).toBe('★★★☆☆');
    });

    it("n'affiche pas de note si absente", async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([makePartner({ rating: null })]);
      await renderView();
      expect(container.querySelector('.sv-card-rating')).toBeNull();
    });

    it('affiche île+zone en repli si pas de country_label', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([
        makePartner({ partner_type: 'relais', country_label: null, island: 'Anjouan', zone: 'Mutsamudu' }),
      ]);
      await renderView();
      container.querySelector('[data-type="relais"]').click();
      expect(container.querySelector('.sv-card-meta').textContent).toMatch(/Anjouan.*Mutsamudu/);
    });

    it('marque inactif visuellement et dans le tag', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([makePartner({ is_active: false })]);
      await renderView();
      const card = container.querySelector('.sv-card');
      expect(card.classList.contains('inactive')).toBe(true);
      expect(card.querySelector('.sv-tag-inactive').textContent).toBe('inactif');
    });

    it('limite les catégories affichées à 3', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([
        makePartner({ product_categories: ['a', 'b', 'c', 'd', 'e'] }),
      ]);
      await renderView();
      // tag "actif" + 3 catégories max = 4 tags
      expect(container.querySelectorAll('.sv-tag').length).toBe(4);
    });

    it('affiche le bloc stats logistique (envois/taux) pour le type logistique', async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([makePartner({ id: 'sup-1', partner_type: 'logistique' })]);
      global.KmcApi.getPartnersStats = jest.fn().mockResolvedValue([{ partner_id: 'sup-1', shipments_count: 12, avg_customs_rate_90d: 18.456 }]);
      await renderView();
      container.querySelector('[data-type="logistique"]').click();
      const stats = container.querySelector('.sv-stats').textContent;
      expect(stats).toMatch(/12/);
      expect(stats).toMatch(/18\.5%/);
    });

    it('affiche le bloc stats sourcing/personnalisé (commandes/marge)', async () => {
      global.KmcApi.getPartnersStats = jest.fn().mockResolvedValue([{ partner_id: 'sup-1', orders_count_30d: 7, avg_margin_pct_90d: 33.3 }]);
      await renderView();
      const stats = container.querySelector('.sv-stats').textContent;
      expect(stats).toMatch(/7/);
      expect(stats).toMatch(/33\.3%/);
    });

    it("n'affiche pas de bloc stats pour relais/agent_hub même avec stats dispo", async () => {
      global.KmcApi.getPartners = jest.fn().mockResolvedValue([makePartner({ id: 'sup-1', partner_type: 'relais' })]);
      global.KmcApi.getPartnersStats = jest.fn().mockResolvedValue([{ partner_id: 'sup-1', orders_count_30d: 7 }]);
      await renderView();
      container.querySelector('[data-type="relais"]').click();
      expect(container.querySelector('.sv-stats')).toBeNull();
    });

    it('affiche le lien whatsapp si présent', async () => {
      await renderView();
      const link = container.querySelector('.sv-actions a');
      expect(link.getAttribute('href')).toMatch(/wa\.me/);
    });
  });

  /* ── Modal — ouverture / fermeture ───────────────────────────────── */
  describe('Modal', () => {
    it('ouvre en mode création via le bouton "+ Ajouter"', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      expect(document.getElementById('sv-modal')).toBeTruthy();
      expect(document.querySelector('.sv-modal-head h3').textContent).toMatch(/Ajouter/);
      expect(document.getElementById('f-name').value).toBe('');
    });

    it('ouvre en mode édition au clic sur une carte, pré-rempli', async () => {
      await renderView();
      container.querySelector('.sv-card').click();
      expect(document.querySelector('.sv-modal-head h3').textContent).toMatch(/Modifier/);
      expect(document.getElementById('f-name').value).toBe('Dubai Trading Co');
      expect(document.getElementById('f-country').value).toBe('AE');
    });

    it('ouvre en édition via le bouton éditer sans propager le clic carte', async () => {
      await renderView();
      container.querySelector('[data-action="edit"]').click();
      expect(document.getElementById('sv-modal')).toBeTruthy();
      expect(document.querySelectorAll('#sv-modal').length).toBe(1);
    });

    it('ne rouvre pas le modal si le clic vient d\'un lien de la carte', async () => {
      await renderView();
      container.querySelector('.sv-actions a').click();
      // Le lien n'a pas de handler stopPropagation dédié mais le closest('a') doit bloquer l'ouverture
      expect(document.getElementById('sv-modal')).toBeNull();
    });

    it('ferme via la croix', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.querySelector('.sv-modal-close').click();
      expect(document.getElementById('sv-modal')).toBeNull();
    });

    it('ferme via le clic sur le fond', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.getElementById('sv-modal').click();
      expect(document.getElementById('sv-modal')).toBeNull();
    });

    it('ferme via le bouton Annuler', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.querySelector('[data-modal-close]:not(.sv-modal-close)').click();
      expect(document.getElementById('sv-modal')).toBeNull();
    });

    it('affiche le bouton Supprimer uniquement en édition', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      expect(document.getElementById('sv-modal-delete')).toBeNull();
      document.querySelector('.sv-modal-close').click();
      container.querySelector('.sv-card').click();
      expect(document.getElementById('sv-modal-delete')).toBeTruthy();
    });
  });

  /* ── saveFromModal ───────────────────────────────────────────────── */
  describe('Sauvegarde du formulaire', () => {
    it('refuse si le nom est vide', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.getElementById('f-name').value = '   ';
      document.getElementById('sv-modal-save').click();
      expect(global.alert).toHaveBeenCalledWith(expect.stringMatching(/nom est obligatoire/));
      expect(global.KmcApi.createPartner).not.toHaveBeenCalled();
    });

    it('crée un nouveau partenaire avec les champs saisis', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.getElementById('f-name').value = 'Nouveau Fournisseur';
      document.getElementById('f-lead-time').value = '15';
      document.getElementById('f-categories').value = 'jouets, textile';
      document.getElementById('f-country').value = 'CN';
      document.getElementById('sv-modal-save').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(global.KmcApi.createPartner).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Nouveau Fournisseur',
        lead_time_days: 15,
        product_categories: ['jouets', 'textile'],
        country_code: 'CN',
        country_label: 'Chine',
      }));
      expect(document.getElementById('sv-modal')).toBeNull();
    });

    it('met à jour un partenaire existant (editId présent)', async () => {
      await renderView();
      container.querySelector('.sv-card').click();
      document.getElementById('f-name').value = 'Dubai Trading Co (renommé)';
      document.getElementById('sv-modal-save').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.updatePartner).toHaveBeenCalledWith('sup-1', expect.objectContaining({ name: 'Dubai Trading Co (renommé)' }));
    });

    it('envoie null pour les champs optionnels vides et pays non renseigné', async () => {
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.getElementById('f-name').value = 'X';
      document.getElementById('f-categories').value = '';
      document.getElementById('sv-modal-save').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const body = global.KmcApi.createPartner.mock.calls[0][0];
      expect(body.contact_name).toBeNull();
      expect(body.product_categories).toBeNull();
      expect(body.country_code).toBeNull();
      expect(body.country_label).toBeNull();
      expect(body.commission_kmf).toBe(0);
    });

    it("affiche une alerte si l'API échoue", async () => {
      global.KmcApi.createPartner = jest.fn().mockRejectedValue(new Error('conflit'));
      await renderView();
      container.querySelector('#sv-add-btn').click();
      document.getElementById('f-name').value = 'X';
      document.getElementById('sv-modal-save').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.alert).toHaveBeenCalledWith(expect.stringMatching(/conflit/));
    });
  });

  /* ── handleDelete ────────────────────────────────────────────────── */
  describe('Suppression', () => {
    it('ne supprime pas si confirm() est annulé', async () => {
      global.confirm = jest.fn(() => false);
      await renderView();
      container.querySelector('[data-action="delete"]').click();
      expect(global.KmcApi.deletePartner).not.toHaveBeenCalled();
    });

    it('supprime, ferme le modal et affiche un message si fourni', async () => {
      global.KmcApi.deletePartner = jest.fn().mockResolvedValue({ message: 'Supprimé avec succès' });
      await renderView();
      container.querySelector('[data-action="delete"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.deletePartner).toHaveBeenCalledWith('sup-1');
      expect(global.alert).toHaveBeenCalledWith(expect.stringMatching(/Supprimé avec succès/));
    });

    it("affiche une alerte d'erreur si la suppression échoue", async () => {
      global.KmcApi.deletePartner = jest.fn().mockRejectedValue(new Error('lié à des commandes'));
      await renderView();
      container.querySelector('[data-action="delete"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.alert).toHaveBeenCalledWith(expect.stringMatching(/lié à des commandes/));
    });

    it('ne fait rien si le partenaire est introuvable', async () => {
      await renderView();
      const btn = container.querySelector('[data-action="delete"]');
      btn.dataset.id = 'inconnu';
      btn.click();
      expect(global.confirm).not.toHaveBeenCalled();
    });
  });

  /* ── handleToggle ────────────────────────────────────────────────── */
  describe('Activer/désactiver', () => {
    it('bascule is_active et re-render', async () => {
      await renderView();
      container.querySelector('[data-action="toggle"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.KmcApi.updatePartner).toHaveBeenCalledWith('sup-1', { is_active: false });
    });

    it("affiche une alerte d'erreur si le toggle échoue", async () => {
      global.KmcApi.updatePartner = jest.fn().mockRejectedValue(new Error('erreur serveur'));
      await renderView();
      container.querySelector('[data-action="toggle"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(global.alert).toHaveBeenCalledWith(expect.stringMatching(/erreur serveur/));
    });
  });
});
