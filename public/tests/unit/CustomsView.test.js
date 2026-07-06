'use strict';

/**
 * tests/unit/CustomsView.test.js
 *
 * admin/js/views/CustomsView.js (434L) — Vue Douane /admin/customs
 * Export : constructeur `function CustomsView(){ this.render = ... }`
 * (même famille que SourcingScannerView/PricingStrategyView/SuppliersView) —
 * instanciation en test : `new global.CustomsView().render(container)`.
 *
 * Dépendances externes (globals mockés) :
 *   - KmcApi.getCustomsShipments() / getCustomsRatesEffective() /
 *     getPartnersLogistique() / getCustomsShipment(id) / createCustomsShipment(body)
 *   - global.fetch (routes non couvertes par KmcApi : /deactivate, /activate)
 *   - window.prompt (handleDeactivate), window.confirm (handleActivate)
 *
 * Périmètre couvert :
 *   - render() : shell, chargement parallèle (shipments+rates+transitaires),
 *     getPartnersLogistique() en échec toléré (.catch(() => [])), erreur
 *     globale (Promise.all rejeté) avec message échappé
 *   - buildUI/KPIs : taux 30j/90j, envois actifs/total, douane payée 30j
 *   - renderForm : référence auto-générée, select transitaires peuplé vs
 *     fallback input libre, bascule "+ Autre (saisie libre)", méthode de
 *     ventilation par défaut + bloc explicatif, changement de méthode
 *   - renderTable : état vide, ligne peuplée (date/ref/transitaire/CIF/
 *     douane/taux/méthode/colis/état), classes de taux (low/mid/high),
 *     échappement XSS (reference, transitaire_name)
 *   - renderAllocPanel : détail envoi sélectionné, avertissement envoi
 *     désactivé, tableau colis peuplé, état vide, échappement XSS des
 *     champs colis
 *   - wireEvents : changement méthode, bascule transitaire libre, reset,
 *     submit, data-action (deactivate/activate/view/close-detail), clic ligne
 *   - submitNewShipment : validation champs requis, transitaire du select
 *     vs saisie libre, succès (re-render), erreur API (alert)
 *   - handleDeactivate : prompt annulé (null), raison vide vs renseignée,
 *     succès (alert + render), erreur réseau
 *   - handleActivate : confirm annulé, succès, erreur
 *   - handleView : succès (état + panel affiché), erreur réseau
 */

function makeShipment(overrides) {
  return Object.assign({
    id: 'ship-1',
    reference: 'CUST-20260701-001',
    shipment_date: '2026-07-01',
    transitaire_name: 'Ahmed Dubai',
    cif_value_kmf: 2500000,
    customs_paid_kmf: 400000,
    effective_rate_pct: 16,
    allocation_method: 'by_cif_value',
    nb_parcels_linked: 8,
    nb_parcels: 10,
    is_active: true,
  }, overrides);
}

function makeParcel(overrides) {
  return Object.assign({
    parcel_id: 'parcel-abcdef12',
    parcel_ref: 'COL-500',
    order_ref: 'CMD-900',
    client_name: 'Fatima B.',
    parcel_cif_kmf: 150000,
    parcel_weight_kg: 3.2,
    customs_share_kmf: 24000,
    allocation_basis: 'cif',
  }, overrides);
}

function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }

describe('CustomsView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    global.KmcApi = {
      getCustomsShipments: jest.fn().mockResolvedValue({ shipments: [makeShipment()] }),
      getCustomsRatesEffective: jest.fn().mockResolvedValue({
        rates: { last_30d: { rate_pct: 15.5, total_customs_kmf: 400000 }, last_90d: { rate_pct: 14.2 } },
      }),
      getPartnersLogistique: jest.fn().mockResolvedValue([{ id: 't1', name: 'Ahmed Dubai', country_label: 'UAE' }]),
      getCustomsShipment: jest.fn().mockResolvedValue({ shipment: makeShipment(), parcels: [makeParcel()] }),
      createCustomsShipment: jest.fn().mockResolvedValue({ ok: true }),
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ message: 'OK' }) });

    require('../../dashboards/admin/js/views/CustomsView.js');
  });

  afterEach(() => {
    document.getElementById('cv-styles')?.remove();
    delete global.KmcApi;
    delete global.fetch;
    delete window.prompt;
    delete window.confirm;
    delete window.alert;
    jest.useRealTimers();
  });

  async function flush(times = 5) {
    for (let i = 0; i < times; i++) await Promise.resolve();
  }

  function view() { return new global.CustomsView(); }

  it('expose render() (contrat app.js#invokeView, via instanciation)', () => {
    const v = view();
    expect(typeof v.render).toBe('function');
  });

  /* ── render() / chargement ──────────────────────────────────────────── */
  describe('render() — chargement initial', () => {
    it('affiche un loader puis charge shipments+rates+transitaires en parallèle', async () => {
      view().render(root);
      expect(root.innerHTML).toContain('Chargement historique douane');
      await flush();
      expect(global.KmcApi.getCustomsShipments).toHaveBeenCalledTimes(1);
      expect(global.KmcApi.getCustomsRatesEffective).toHaveBeenCalledTimes(1);
      expect(global.KmcApi.getPartnersLogistique).toHaveBeenCalledTimes(1);
      expect(root.querySelector('.cv-form')).toBeTruthy();
      expect(root.querySelector('.cv-table-wrap, .kmc-empty')).toBeTruthy();
    });

    it('tolère un échec de getPartnersLogistique() (liste transitaire vide, pas de crash)', async () => {
      global.KmcApi.getPartnersLogistique.mockRejectedValue(new Error('network'));
      view().render(root);
      await flush();
      expect(root.querySelector('#cv-transit')).toBeTruthy();
      expect(root.querySelector('#cv-transit-sel')).toBeFalsy();
    });

    it('accepte transitairesResp sous forme {partners: [...]} (pas juste un tableau brut)', async () => {
      global.KmcApi.getPartnersLogistique.mockResolvedValue({ partners: [{ id: 't2', name: 'Yusuf' }] });
      view().render(root);
      await flush();
      expect(root.querySelector('#cv-transit-sel')).toBeTruthy();
      expect(root.innerHTML).toContain('Yusuf');
    });

    it('erreur de chargement (Promise.all rejeté) affiche un message échappé', async () => {
      global.KmcApi.getCustomsShipments.mockRejectedValue(new Error('<img src=x onerror=alert(1)>'));
      view().render(root);
      await flush();
      expect(root.querySelector('.kmc-error')).toBeTruthy();
      expect(root.innerHTML).not.toContain('<img src=x');
      expect(root.innerHTML).toContain('&lt;img');
    });
  });

  /* ── KPIs ────────────────────────────────────────────────────────────── */
  describe('KPIs', () => {
    it('affiche taux terrain 30j/90j, envois actifs/total, douane payée 30j', async () => {
      view().render(root);
      await flush();
      expect(root.innerHTML).toContain('15.5%');
      expect(root.innerHTML).toContain('14.2%');
      expect(root.innerHTML).toContain('1 / 1');
      expect(root.innerHTML).toContain(fmt(400000));
    });

    it('gère un décompte actifs/total correct avec un envoi inactif', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({
        shipments: [makeShipment({ id: 's1', is_active: true }), makeShipment({ id: 's2', is_active: false, reference: 'CUST-2' })],
      });
      view().render(root);
      await flush();
      expect(root.innerHTML).toContain('1 / 2');
    });

    it('valeurs par défaut à 0% quand rates est vide', async () => {
      global.KmcApi.getCustomsRatesEffective.mockResolvedValue({ rates: {} });
      view().render(root);
      await flush();
      expect(root.innerHTML).toContain('0.0%');
    });
  });

  /* ── renderForm ──────────────────────────────────────────────────────── */
  describe('renderForm', () => {
    it('génère une référence automatique CUST-YYYYMMDD-NNN', async () => {
      view().render(root);
      await flush();
      const ref = root.querySelector('#cv-ref');
      expect(ref.value).toMatch(/^CUST-\d{8}-002$/); // 1 envoi existant + 1
    });

    it('peuple le select transitaires quand la liste est non vide', async () => {
      view().render(root);
      await flush();
      const sel = root.querySelector('#cv-transit-sel');
      expect(sel).toBeTruthy();
      expect(sel.innerHTML).toContain('Ahmed Dubai');
      expect(sel.innerHTML).toContain('UAE');
      expect(sel.innerHTML).toContain('__custom__');
    });

    it('bascule vers la saisie libre quand "+ Autre" est sélectionné', async () => {
      view().render(root);
      await flush();
      const sel = root.querySelector('#cv-transit-sel');
      const input = root.querySelector('#cv-transit');
      expect(input.style.display).toBe('none');
      sel.value = '__custom__';
      sel.dispatchEvent(new Event('change'));
      expect(input.style.display).toBe('block');
    });

    it('revient à masquer la saisie libre et vide sa valeur si un vrai transitaire est resélectionné', async () => {
      view().render(root);
      await flush();
      const sel = root.querySelector('#cv-transit-sel');
      const input = root.querySelector('#cv-transit');
      sel.value = '__custom__';
      sel.dispatchEvent(new Event('change'));
      input.value = 'Test libre';
      sel.value = 't1';
      sel.dispatchEvent(new Event('change'));
      expect(input.style.display).toBe('none');
      expect(input.value).toBe('');
    });

    it('affiche la méthode de ventilation par défaut (by_cif_value) avec son aide', async () => {
      view().render(root);
      await flush();
      const box = root.querySelector('#cv-method-box');
      expect(box.innerHTML).toContain('Par valeur CIF');
    });

    it('met à jour le bloc explicatif au changement de méthode', async () => {
      view().render(root);
      await flush();
      const methodSel = root.querySelector('#cv-method');
      const box = root.querySelector('#cv-method-box');
      methodSel.value = 'by_weight';
      methodSel.dispatchEvent(new Event('change'));
      expect(box.innerHTML).toContain('Par poids');
    });
  });

  /* ── renderTable ─────────────────────────────────────────────────────── */
  describe('renderTable', () => {
    it('affiche un état vide quand aucun envoi', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [] });
      view().render(root);
      await flush();
      expect(root.innerHTML).toContain('Aucun envoi enregistré');
    });

    it('affiche une ligne peuplée avec toutes les colonnes', async () => {
      view().render(root);
      await flush();
      const row = root.querySelector('.cv-table tbody tr');
      expect(row).toBeTruthy();
      expect(row.innerHTML).toContain('2026-07-01');
      expect(row.innerHTML).toContain('CUST-20260701-001');
      expect(row.innerHTML).toContain('Ahmed Dubai');
      expect(row.innerHTML).toContain(fmt(2500000));
      expect(row.innerHTML).toContain(fmt(400000));
      expect(row.innerHTML).toContain('16.0%');
      expect(row.innerHTML).toContain('Par valeur CIF');
      expect(row.innerHTML).toContain('8/10');
    });

    it('applique la classe de taux basse (<15%)', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [makeShipment({ effective_rate_pct: 10 })] });
      view().render(root);
      await flush();
      expect(root.querySelector('.cv-rate-low')).toBeTruthy();
    });

    it('applique la classe de taux moyenne (15-25%)', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [makeShipment({ effective_rate_pct: 20 })] });
      view().render(root);
      await flush();
      expect(root.querySelector('.cv-rate-mid')).toBeTruthy();
    });

    it('applique la classe de taux haute (>25%)', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [makeShipment({ effective_rate_pct: 30 })] });
      view().render(root);
      await flush();
      expect(root.querySelector('.cv-rate-high')).toBeTruthy();
    });

    it('affiche le bouton "Actif" pour un envoi actif et "Inactif" pour un envoi désactivé', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({
        shipments: [makeShipment({ id: 's1', is_active: true }), makeShipment({ id: 's2', is_active: false, reference: 'CUST-2' })],
      });
      view().render(root);
      await flush();
      expect(root.querySelector('[data-action="deactivate"]')).toBeTruthy();
      expect(root.querySelector('[data-action="activate"]')).toBeTruthy();
      expect(root.querySelector('tr.inactive')).toBeTruthy();
    });

    it('échappe le HTML dans reference et transitaire_name (XSS)', async () => {
      global.KmcApi.getCustomsShipments.mockResolvedValue({
        shipments: [makeShipment({ reference: '<script>alert(1)</script>', transitaire_name: '<b>Evil</b>' })],
      });
      view().render(root);
      await flush();
      expect(root.innerHTML).not.toContain('<script>alert(1)</script>');
      expect(root.innerHTML).not.toContain('<b>Evil</b>');
      expect(root.innerHTML).toContain('&lt;script&gt;');
    });
  });

  /* ── renderAllocPanel ────────────────────────────────────────────────── */
  describe('renderAllocPanel (détail envoi)', () => {
    it("s'ouvre au clic sur une ligne et affiche le tableau de colis ventilés", async () => {
      view().render(root);
      await flush();
      root.querySelector('.cv-table tbody tr').click();
      await flush();
      const panel = root.querySelector('.cv-alloc');
      expect(panel).toBeTruthy();
      expect(panel.innerHTML).toContain('COL-500');
      expect(panel.innerHTML).toContain('CMD-900');
      expect(panel.innerHTML).toContain('Fatima B.');
      expect(panel.innerHTML).toContain(fmt(24000));
    });

    it('affiche un avertissement quand l\'envoi sélectionné est désactivé', async () => {
      global.KmcApi.getCustomsShipment.mockResolvedValue({
        shipment: makeShipment({ is_active: false }), parcels: [makeParcel()],
      });
      view().render(root);
      await flush();
      root.querySelector('.cv-table tbody tr').click();
      await flush();
      expect(root.querySelector('.cv-alloc').innerHTML).toContain('Envoi désactivé');
    });

    it('affiche un état vide si aucun colis ventilé', async () => {
      global.KmcApi.getCustomsShipment.mockResolvedValue({ shipment: makeShipment(), parcels: [] });
      view().render(root);
      await flush();
      root.querySelector('.cv-table tbody tr').click();
      await flush();
      expect(root.querySelector('.cv-alloc').innerHTML).toContain('Aucun colis ventilé');
    });

    it('se ferme via data-action="close-detail"', async () => {
      view().render(root);
      await flush();
      root.querySelector('.cv-table tbody tr').click();
      await flush();
      root.querySelector('[data-action="close-detail"]').click();
      expect(root.querySelector('.cv-alloc')).toBeFalsy();
    });

    it('échappe le HTML des champs colis (reference, allocation_basis, client_name)', async () => {
      global.KmcApi.getCustomsShipment.mockResolvedValue({
        shipment: makeShipment({ reference: '<i>x</i>' }),
        parcels: [makeParcel({ parcel_ref: '<u>ref</u>', client_name: '<s>c</s>', allocation_basis: '<em>b</em>' })],
      });
      view().render(root);
      await flush();
      root.querySelector('.cv-table tbody tr').click();
      await flush();
      const panel = root.querySelector('.cv-alloc');
      expect(panel.innerHTML).not.toContain('<i>x</i>');
      expect(panel.innerHTML).not.toContain('<u>ref</u>');
      expect(panel.innerHTML).not.toContain('<s>c</s>');
      expect(panel.innerHTML).not.toContain('<em>b</em>');
    });
  });

  /* ── submitNewShipment ───────────────────────────────────────────────── */
  describe('submitNewShipment', () => {
    function fillRequiredFields(container, overrides = {}) {
      const vals = Object.assign({
        '#cv-ref': 'CUST-TEST-001',
        '#cv-date': '2026-07-05',
        '#cv-cif': '1000000',
        '#cv-paid': '200000',
      }, overrides);
      Object.entries(vals).forEach(([sel, v]) => { container.querySelector(sel).value = v; });
    }

    it('bloque la soumission si un champ requis manque (alert)', async () => {
      window.alert = jest.fn();
      view().render(root);
      await flush();
      root.querySelector('#cv-ref').value = '';
      root.querySelector('#cv-submit').click();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Champs requis'));
      expect(global.KmcApi.createCustomsShipment).not.toHaveBeenCalled();
    });

    it('soumet avec un transitaire choisi dans le select puis re-render', async () => {
      view().render(root);
      await flush();
      fillRequiredFields(root);
      root.querySelector('#cv-transit-sel').value = 't1';
      root.querySelector('#cv-submit').click();
      await flush();
      expect(global.KmcApi.createCustomsShipment).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 't1', reference: 'CUST-TEST-001' })
      );
      expect(global.KmcApi.getCustomsShipments).toHaveBeenCalledTimes(2);
    });

    it('soumet avec un transitaire en saisie libre (option __custom__)', async () => {
      view().render(root);
      await flush();
      fillRequiredFields(root);
      const sel = root.querySelector('#cv-transit-sel');
      sel.value = '__custom__';
      sel.dispatchEvent(new Event('change'));
      root.querySelector('#cv-transit').value = 'Nouveau Transitaire';
      root.querySelector('#cv-submit').click();
      await flush();
      expect(global.KmcApi.createCustomsShipment).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: null, transitaire_name: 'Nouveau Transitaire' })
      );
    });

    it('affiche une alerte en cas d\'échec API de création', async () => {
      window.alert = jest.fn();
      global.KmcApi.createCustomsShipment.mockRejectedValue(new Error('duplicate reference'));
      view().render(root);
      await flush();
      fillRequiredFields(root);
      root.querySelector('#cv-submit').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('duplicate reference'));
    });

    it('le bouton Réinitialiser relance un render() complet', async () => {
      view().render(root);
      await flush();
      root.querySelector('#cv-reset').click();
      await flush();
      expect(global.KmcApi.getCustomsShipments).toHaveBeenCalledTimes(2);
    });

    it('utilise la saisie libre directement (input seul) quand aucun transitaire enregistré', async () => {
      global.KmcApi.getPartnersLogistique.mockResolvedValue([]);
      view().render(root);
      await flush();
      expect(root.querySelector('#cv-transit-sel')).toBeFalsy();
      fillRequiredFields(root);
      root.querySelector('#cv-transit').value = 'Saisie directe';
      root.querySelector('#cv-submit').click();
      await flush();
      expect(global.KmcApi.createCustomsShipment).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: null, transitaire_name: 'Saisie directe' })
      );
    });
  });

  /* ── handleDeactivate ────────────────────────────────────────────────── */
  describe('handleDeactivate', () => {
    it('annule si prompt() renvoie null', async () => {
      window.prompt = jest.fn(() => null);
      view().render(root);
      await flush();
      root.querySelector('[data-action="deactivate"]').click();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('désactive avec une raison renseignée puis re-render', async () => {
      window.prompt = jest.fn(() => 'valeur erronée');
      window.alert = jest.fn();
      view().render(root);
      await flush();
      root.querySelector('[data-action="deactivate"]').click();
      await flush();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/deactivate'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'valeur erronée' }) })
      );
      expect(window.alert).toHaveBeenCalled();
      expect(global.KmcApi.getCustomsShipments).toHaveBeenCalledTimes(2);
    });

    it('envoie reason: null quand le prompt est validé vide', async () => {
      window.prompt = jest.fn(() => '');
      window.alert = jest.fn();
      view().render(root);
      await flush();
      root.querySelector('[data-action="deactivate"]').click();
      await flush();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ reason: null }) })
      );
    });

    it('affiche une alerte en cas d\'échec réseau', async () => {
      window.prompt = jest.fn(() => 'x');
      window.alert = jest.fn();
      global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('server error') });
      view().render(root);
      await flush();
      root.querySelector('[data-action="deactivate"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('server error'));
    });
  });

  /* ── handleActivate ──────────────────────────────────────────────────── */
  describe('handleActivate', () => {
    it('annule si confirm() renvoie false', async () => {
      window.confirm = jest.fn(() => false);
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [makeShipment({ is_active: false })] });
      view().render(root);
      await flush();
      root.querySelector('[data-action="activate"]').click();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('réactive après confirmation puis re-render', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [makeShipment({ is_active: false })] });
      view().render(root);
      await flush();
      root.querySelector('[data-action="activate"]').click();
      await flush();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/activate'), expect.any(Object));
      expect(window.alert).toHaveBeenCalled();
      expect(global.KmcApi.getCustomsShipments).toHaveBeenCalledTimes(2);
    });

    it('affiche une alerte en cas d\'échec réseau', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('boom') });
      global.KmcApi.getCustomsShipments.mockResolvedValue({ shipments: [makeShipment({ is_active: false })] });
      view().render(root);
      await flush();
      root.querySelector('[data-action="activate"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });

  /* ── handleView ──────────────────────────────────────────────────────── */
  describe('handleView', () => {
    it('charge le détail et affiche le panel de ventilation', async () => {
      view().render(root);
      await flush();
      root.querySelector('[data-action="view"]').click();
      await flush();
      expect(global.KmcApi.getCustomsShipment).toHaveBeenCalledWith('ship-1');
      expect(root.querySelector('.cv-alloc')).toBeTruthy();
    });

    it('affiche une alerte en cas d\'échec réseau', async () => {
      window.alert = jest.fn();
      global.KmcApi.getCustomsShipment.mockRejectedValue(new Error('timeout'));
      view().render(root);
      await flush();
      root.querySelector('[data-action="view"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('timeout'));
      expect(root.querySelector('.cv-alloc')).toBeFalsy();
    });

    it('scrolle vers le panel après le délai de 50ms', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      view().render(root);
      await flush();
      root.querySelector('[data-action="view"]').click();
      await flush();
      const panel = root.querySelector('.cv-alloc');
      panel.scrollIntoView = jest.fn();
      jest.advanceTimersByTime(50);
      expect(panel.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });
  });
});
