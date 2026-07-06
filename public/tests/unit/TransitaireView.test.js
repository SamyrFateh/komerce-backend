'use strict';

/**
 * tests/unit/TransitaireView.test.js
 *
 * admin/js/views/TransitaireView.js (425L) — Vue Transitaire /admin/transitaire
 * Export public unique : render(rootEl).
 *
 * Dépendances externes (globals mockés) :
 *   - KmcApi.getTransitaireStats() / getTransitaireParcels() /
 *     getTransitaireHistory() / shipTransitaireParcel(id)
 *   - KpiCard.renderBar(container, kpis)
 *
 * Périmètre couvert :
 *   - render() : shell, chargement stats+colis en parallèle, guard rootEl
 *     détaché, bouton rafraîchir, erreur chargement initial, historique
 *     chargé en async séparé (n'empêche pas l'affichage des colis)
 *   - renderKpiBar : 4 KPI de base, KPI "Retard > 48h" conditionnel
 *     (overdue_shipments > 0), valeurs par défaut à 0/'0 kg'
 *   - renderParcelsTable : état vide (parcels absent ou []), rendu peuplé
 *     (référence, commande, client, articles, poids, destination avec/sans
 *     relais), badge compteur, échappement XSS
 *   - timeSince : < 1h ("Xmin"), < 24h ("Xh"), >= 48h ("Xj" + warn),
 *     24h-48h ("Xj" sans warn), date absente ("—")
 *   - handleShipOne : annulation confirm(), succès (flash + suppression
 *     différée 1400ms, badge décrémenté, assombrissement à 0), échec
 *     métier (avec/sans message), erreur réseau (avec/sans message),
 *     état désactivé pendant l'appel
 *   - handleShipAll : annulation confirm(), garde 0 bouton restant, succès
 *     total (pluriel, déclenche onRefresh → re-render), singulier,
 *     mélange succès/erreurs, rejet réseau compté comme erreur
 *   - renderHistory : vide, events absent (fallback []), plafond 20,
 *     échec de chargement → message de repli sans bloquer le reste
 */

function makeParcel(overrides) {
  return Object.assign({
    id: 'p1',
    reference: 'COL-001',
    order_ref: 'CMD-100',
    customer_name: 'Ali Mze',
    destination_island: 'Anjouan',
    relais_name: 'Relais Mutsamudu',
    nb_items: 3,
    weight_kg: 2.5,
    shipped_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  }, overrides);
}

function baseStats(overrides) {
  return Object.assign({
    ready_to_ship: 5,
    in_transit: 12,
    total_weight_shipped: 340,
    avg_wait_hours: 6,
    overdue_shipments: 0,
  }, overrides);
}

describe('TransitaireView', () => {
  let root;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="main"></div>';
    root = document.getElementById('main');

    global.KpiCard = { renderBar: jest.fn() };
    global.KmcApi = {
      getTransitaireStats: jest.fn().mockResolvedValue(baseStats()),
      getTransitaireParcels: jest.fn().mockResolvedValue({ parcels: [makeParcel()] }),
      getTransitaireHistory: jest.fn().mockResolvedValue({ events: [] }),
      shipTransitaireParcel: jest.fn().mockResolvedValue({ success: true }),
    };

    require('../../dashboards/admin/js/views/TransitaireView.js');
  });

  afterEach(() => {
    document.getElementById('kmc-transitaire-styles')?.remove();
    delete global.KpiCard;
    delete global.KmcApi;
    jest.useRealTimers();
  });

  async function flush(times = 5) {
    for (let i = 0; i < times; i++) await Promise.resolve();
  }

  it('expose render() (contrat app.js#invokeView)', () => {
    expect(typeof window.TransitaireView).toBe('object');
    expect(typeof window.TransitaireView.render).toBe('function');
  });

  describe('render() — shell et chargement initial', () => {
    it('pose le shell, charge stats+colis en parallèle', async () => {
      await window.TransitaireView.render(root);
      await flush();

      expect(root.querySelector('.page-title').textContent).toBe('Transitaire');
      expect(global.KmcApi.getTransitaireStats).toHaveBeenCalled();
      expect(global.KmcApi.getTransitaireParcels).toHaveBeenCalled();
    });

    it('injecte le style une seule fois même après plusieurs render', async () => {
      await window.TransitaireView.render(root);
      await flush();
      await window.TransitaireView.render(root);
      await flush();
      expect(document.querySelectorAll('#kmc-transitaire-styles').length).toBe(1);
    });

    it("n'explose pas si rootEl est détaché du document pendant le chargement (navigation entre-temps)", async () => {
      let resolveStats;
      global.KmcApi.getTransitaireStats = jest.fn(() => new Promise((r) => { resolveStats = r; }));

      const renderPromise = window.TransitaireView.render(root);
      await flush();
      root.remove();
      resolveStats(baseStats());
      await renderPromise;

      expect(global.KpiCard.renderBar).not.toHaveBeenCalled();
    });

    it('affiche la meta "Mis à jour le ..." après chargement réussi', async () => {
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-meta').textContent).toMatch(/Mis à jour le/);
    });

    it('erreur au chargement initial → error-state dans les KPI, table colis vidée', async () => {
      global.KmcApi.getTransitaireStats = jest.fn().mockRejectedValue(new Error('boom'));
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-kpis').innerHTML).toMatch(/Erreur chargement/);
      expect(document.getElementById('tr-kpis').innerHTML).toMatch(/boom/);
      expect(document.getElementById('tr-parcels').innerHTML).toBe('');
    });

    it('bouton rafraîchir relance render() (nouveaux appels API)', async () => {
      await window.TransitaireView.render(root);
      await flush();
      global.KmcApi.getTransitaireStats.mockClear();
      global.KmcApi.getTransitaireParcels.mockClear();

      document.getElementById('tr-refresh').click();
      await flush();

      expect(global.KmcApi.getTransitaireStats).toHaveBeenCalledTimes(1);
      expect(global.KmcApi.getTransitaireParcels).toHaveBeenCalledTimes(1);
    });
  });

  describe('renderKpiBar', () => {
    it('4 KPI de base, sans "Retard > 48h" si overdue_shipments=0', async () => {
      await window.TransitaireView.render(root);
      await flush();
      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.length).toBe(4);
      expect(kpis.find(k => k.label === 'Retard > 48h')).toBeUndefined();
    });

    it('ajoute le KPI "Retard > 48h" si overdue_shipments > 0', async () => {
      global.KmcApi.getTransitaireStats = jest.fn().mockResolvedValue(baseStats({ overdue_shipments: 3 }));
      await window.TransitaireView.render(root);
      await flush();
      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.length).toBe(5);
      expect(kpis.find(k => k.label === 'Retard > 48h').value).toBe(3);
    });

    it('valeurs par défaut (0 / "0 kg") si stats vides', async () => {
      global.KmcApi.getTransitaireStats = jest.fn().mockResolvedValue({});
      await window.TransitaireView.render(root);
      await flush();
      const kpis = global.KpiCard.renderBar.mock.calls[0][1];
      expect(kpis.find(k => k.label === 'À expédier').value).toBe(0);
      expect(kpis.find(k => k.label === 'Poids total').value).toBe('0 kg');
      expect(kpis.find(k => k.label === 'Attente moy.').value).toBe('0 h');
    });
  });

  describe('renderParcelsTable — état vide', () => {
    it('affiche le message "Aucun colis" si liste vide', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({ parcels: [] });
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-parcels').textContent).toMatch(/Aucun colis en attente de transit/);
      expect(document.getElementById('tr-ship-all')).toBeNull();
    });

    it('gère parcelsData.parcels absent (fallback [])', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({});
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-parcels').textContent).toMatch(/Aucun colis/);
    });
  });

  describe('renderParcelsTable — état peuplé', () => {
    it('affiche une ligne par colis avec référence, commande, client, articles, poids', async () => {
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row).not.toBeNull();
      expect(row.textContent).toMatch(/COL-001/);
      expect(row.textContent).toMatch(/CMD-100/);
      expect(row.textContent).toMatch(/Ali Mze/);
      expect(row.textContent).toMatch(/2\.5 kg/);
    });

    it('destination : île + relais si relais_name présent', async () => {
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.textContent).toMatch(/Anjouan · Relais Mutsamudu/);
    });

    it('destination : île seule si relais_name absent', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({ parcels: [makeParcel({ relais_name: null })] });
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.textContent).toMatch(/Anjouan/);
      expect(row.textContent).not.toMatch(/·/);
    });

    it('badge compteur "Expédier tous" = nombre de colis', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ id: 'p1' }), makeParcel({ id: 'p2' })],
      });
      await window.TransitaireView.render(root);
      await flush();
      expect(document.querySelector('.tr-count-badge').textContent).toBe('2');
    });

    it('échappe les champs texte (XSS)', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ customer_name: '<script>x</script>' })],
      });
      await window.TransitaireView.render(root);
      await flush();
      const html = document.getElementById('tr-parcels').innerHTML;
      expect(html).not.toMatch(/<script>x<\/script>/);
      expect(html).toMatch(/&lt;script&gt;/);
    });
  });

  describe('timeSince (colonne "Depuis")', () => {
    it('< 1h → "Xmin", pas de warn', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ shipped_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })],
      });
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.textContent).toMatch(/5 min/);
      expect(row.querySelector('.tr-age-warn')).toBeNull();
    });

    it('< 24h → "Xh", pas de warn', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ shipped_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() })],
      });
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.textContent).toMatch(/5 h/);
      expect(row.querySelector('.tr-age-warn')).toBeNull();
    });

    it('>= 48h (2j+) → "Xj" avec classe warn', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ shipped_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString() })],
      });
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.querySelector('.tr-age-warn')).not.toBeNull();
      expect(row.textContent).toMatch(/3 j/);
    });

    it('24h-48h (1j) → "Xj" sans warn', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ shipped_at: new Date(Date.now() - 1.5 * 86400 * 1000).toISOString() })],
      });
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.querySelector('.tr-age-warn')).toBeNull();
    });

    it('shipped_at absent → "—", pas de warn', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({
        parcels: [makeParcel({ shipped_at: null })],
      });
      await window.TransitaireView.render(root);
      await flush();
      const row = document.getElementById('tr-pcl-p1');
      expect(row.textContent).toMatch(/—/);
      expect(row.querySelector('.tr-age-warn')).toBeNull();
    });
  });

  describe('handleShipOne', () => {
    it("annule si confirm() renvoie false — pas d'appel API", async () => {
      window.confirm = jest.fn(() => false);
      await window.TransitaireView.render(root);
      await flush();
      document.querySelector('[data-parcel-id="p1"]').click();
      await flush();
      expect(global.KmcApi.shipTransitaireParcel).not.toHaveBeenCalled();
    });

    it('confirm() ok + succès → flash puis suppression différée (1400ms), badge décrémenté', async () => {
      jest.useFakeTimers();
      window.confirm = jest.fn(() => true);
      await window.TransitaireView.render(root);
      await flush();

      document.querySelector('[data-parcel-id="p1"]').click();
      await flush();

      expect(global.KmcApi.shipTransitaireParcel).toHaveBeenCalledWith('p1');
      const row = document.getElementById('tr-pcl-p1');
      expect(row.classList.contains('tr-row-shipped')).toBe(true);
      expect(document.querySelector('.tr-count-badge').textContent).toBe('0');

      jest.advanceTimersByTime(1400);
      expect(document.getElementById('tr-pcl-p1')).toBeNull();
    });

    it('badge à 0 → assombrit la barre "Expédier tous" (opacity 0.4)', async () => {
      jest.useFakeTimers();
      window.confirm = jest.fn(() => true);
      await window.TransitaireView.render(root);
      await flush();
      document.querySelector('[data-parcel-id="p1"]').click();
      await flush();
      expect(document.querySelector('.tr-ship-all-bar').style.opacity).toBe('0.4');
    });

    it('échec métier (success:false) → alert avec message, bouton réactivé', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      global.KmcApi.shipTransitaireParcel = jest.fn().mockResolvedValue({ success: false, error: 'Stock indispo' });
      await window.TransitaireView.render(root);
      await flush();
      const btn = document.querySelector('[data-parcel-id="p1"]');
      btn.click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('❌ Stock indispo');
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('✈️ Expédier');
    });

    it('échec métier sans message → fallback "Erreur serveur"', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      global.KmcApi.shipTransitaireParcel = jest.fn().mockResolvedValue({ success: false });
      await window.TransitaireView.render(root);
      await flush();
      document.querySelector('[data-parcel-id="p1"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('❌ Erreur serveur');
    });

    it('erreur réseau (rejet) → alert avec message, bouton réactivé', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      global.KmcApi.shipTransitaireParcel = jest.fn().mockRejectedValue(new Error('Timeout'));
      await window.TransitaireView.render(root);
      await flush();
      const btn = document.querySelector('[data-parcel-id="p1"]');
      btn.click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('❌ Timeout');
      expect(btn.disabled).toBe(false);
    });

    it('erreur réseau sans message → fallback "Erreur réseau"', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      global.KmcApi.shipTransitaireParcel = jest.fn().mockRejectedValue(new Error());
      await window.TransitaireView.render(root);
      await flush();
      document.querySelector('[data-parcel-id="p1"]').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('❌ Erreur réseau');
    });

    it('désactive le bouton et affiche "…" pendant l\'appel en cours', async () => {
      window.confirm = jest.fn(() => true);
      let resolveShip;
      global.KmcApi.shipTransitaireParcel = jest.fn(() => new Promise((r) => { resolveShip = r; }));
      await window.TransitaireView.render(root);
      await flush();
      const btn = document.querySelector('[data-parcel-id="p1"]');
      btn.click();
      await flush();
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('…');
      resolveShip({ success: true });
      await flush();
    });
  });

  describe('handleShipAll', () => {
    function twoParcels() {
      return [makeParcel({ id: 'p1', reference: 'COL-001' }), makeParcel({ id: 'p2', reference: 'COL-002' })];
    }

    it("annule si confirm() renvoie false — pas d'appel API", async () => {
      window.confirm = jest.fn(() => false);
      await window.TransitaireView.render(root);
      await flush();
      document.getElementById('tr-ship-all').click();
      await flush();
      expect(global.KmcApi.shipTransitaireParcel).not.toHaveBeenCalled();
    });

    it('ne fait rien si 0 bouton colis restant (tous déjà expédiés individuellement)', async () => {
      jest.useFakeTimers();
      window.confirm = jest.fn(() => true);
      await window.TransitaireView.render(root);
      await flush();
      document.querySelector('[data-parcel-id="p1"]').click();
      await flush();
      jest.advanceTimersByTime(1400);

      window.confirm.mockClear();
      document.getElementById('tr-ship-all').click();
      await flush();
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it('confirm ok, tout succès → alert pluriel, déclenche onRefresh (re-render)', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({ parcels: twoParcels() });
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      await window.TransitaireView.render(root);
      await flush();

      global.KmcApi.getTransitaireStats.mockClear();
      global.KmcApi.getTransitaireParcels.mockClear();

      document.getElementById('tr-ship-all').click();
      await flush();

      expect(global.KmcApi.shipTransitaireParcel).toHaveBeenCalledWith('p1');
      expect(global.KmcApi.shipTransitaireParcel).toHaveBeenCalledWith('p2');
      expect(window.alert).toHaveBeenCalledWith('✈️ 2 colis expédiés');
      expect(global.KmcApi.getTransitaireStats).toHaveBeenCalledTimes(1);
    });

    it('un seul colis → singulier dans le message', async () => {
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      await window.TransitaireView.render(root);
      await flush();
      document.getElementById('tr-ship-all').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('✈️ 1 colis expédié');
    });

    it('mélange succès/erreur → compteurs corrects, singulier erreur', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({ parcels: twoParcels() });
      global.KmcApi.shipTransitaireParcel = jest.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'x' });
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      await window.TransitaireView.render(root);
      await flush();
      document.getElementById('tr-ship-all').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('✈️ 1 colis expédié · 1 erreur');
    });

    it('toutes en erreur → "0 colis expédié" + pluriel erreurs', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({ parcels: twoParcels() });
      global.KmcApi.shipTransitaireParcel = jest.fn().mockResolvedValue({ success: false, error: 'x' });
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      await window.TransitaireView.render(root);
      await flush();
      document.getElementById('tr-ship-all').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('✈️ 0 colis expédié · 2 erreurs');
    });

    it('rejet réseau pour un colis → compté comme erreur, bouton réactivé', async () => {
      global.KmcApi.getTransitaireParcels = jest.fn().mockResolvedValue({ parcels: twoParcels() });
      global.KmcApi.shipTransitaireParcel = jest.fn()
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('net'));
      window.confirm = jest.fn(() => true);
      window.alert = jest.fn();
      await window.TransitaireView.render(root);
      await flush();
      document.getElementById('tr-ship-all').click();
      await flush();
      expect(window.alert).toHaveBeenCalledWith('✈️ 1 colis expédié · 1 erreur');
    });
  });

  describe('renderHistory', () => {
    it('affiche un message si aucun événement', async () => {
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-history').textContent).toMatch(/Aucun transit récent/);
    });

    it('gère events absent (fallback [])', async () => {
      global.KmcApi.getTransitaireHistory = jest.fn().mockResolvedValue({});
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-history').textContent).toMatch(/Aucun transit récent/);
    });

    it('affiche une ligne par événement, plafonnée à 20', async () => {
      const events = Array.from({ length: 25 }, (_, i) => ({
        parcel_ref: `COL-${i}`, order_ref: `CMD-${i}`, actor_name: 'Admin',
        created_at: new Date().toISOString(), notes: null,
      }));
      global.KmcApi.getTransitaireHistory = jest.fn().mockResolvedValue({ events });
      await window.TransitaireView.render(root);
      await flush();
      const rows = document.querySelectorAll('#tr-history tbody tr');
      expect(rows.length).toBe(20);
    });

    it("échec du chargement historique → message de repli, n'empêche pas le reste", async () => {
      global.KmcApi.getTransitaireHistory = jest.fn().mockRejectedValue(new Error('fail'));
      await window.TransitaireView.render(root);
      await flush();
      expect(document.getElementById('tr-history').textContent).toMatch(/Impossible de charger l'historique/);
      expect(document.getElementById('tr-pcl-p1')).not.toBeNull();
    });
  });
});
