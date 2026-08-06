'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/dashboard-clients-queries.js (R9)
 *
 * Couvre :
 *   getClientsAnalysis — KPI globaux, segmentation, top clients/produits, relais, évolution
 *   getClientsList     — pagination, filtres (search, segment, island)
 *   getClientDetail    — profil + commandes + top produits, null si introuvable
 *   getHistory         — historique mensuel + taux de change
 *   getRelais          — colis en_transit / a_remettre + enrichissement items
 *
 * db et dashboard-shared (getEurKmf) sont mockés (aucune connexion réelle).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../routes/dashboard-shared', () => ({
  getEurKmf: jest.fn(),
  loadDashConfig: jest.fn(),
}));

const db = require('../../db');
const { getEurKmf } = require('../../routes/dashboard-shared');
const clientsQueries = require('../../services/dashboard-clients-queries');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── getClientsAnalysis ───────────────────────────────────────────────────────

describe('getClientsAnalysis', () => {
  function mockAllQueries() {
    db.query
      // 1. KPI globaux
      .mockResolvedValueOnce({ rows: [{
        nb_clients: 10, commandes_valides: 25, ca_kmf: 500000,
        panier_moyen: 20000, clients_recurrents: 4,
      }] })
      // 2. Top clients
      .mockResolvedValueOnce({ rows: [{
        name: 'Fatima', phone: '+269123', nb_commandes: 5,
        ca_kmf: 100000, derniere_commande: '2026-06-01', premiere_commande: '2026-01-01',
      }] })
      // 3. Top produits
      .mockResolvedValueOnce({ rows: [{
        name: 'Riz', category: 'alimentaire', qty: 50, nb_commandes: 12, ca_kmf: 75000,
      }] })
      // 4. Par relais
      .mockResolvedValueOnce({ rows: [{
        relais: 'Relais Moroni', island: 'Grande Comore', nb_commandes: 8, ca_kmf: 200000, livrees: 6,
      }] })
      // 5. Évolution mensuelle
      .mockResolvedValueOnce({ rows: [{ mois: '2026-05', nb_commandes: 10, nb_clients: 6, ca_kmf: 150000 }] })
      // 6. Segmentation
      .mockResolvedValueOnce({ rows: [{
        nb_total: 10, nb_new: 3, nb_recurrent: 4, nb_vip: 1, nb_at_risk: 1, nb_dormant: 1,
      }] })
      // 7. Clients à risque
      .mockResolvedValueOnce({ rows: [{
        phone: '+269456', name: 'Ali', nb_commandes: 2, ltv_kmf: 60000,
        derniere_commande: '2026-04-01', jours_silence: 75,
      }] })
      // 8. VIP actifs
      .mockResolvedValueOnce({ rows: [{
        phone: '+269789', name: 'Zara', nb_commandes: 6, ltv_kmf: 300000,
        derniere_commande: '2026-06-10', jours_silence: 4,
      }] });
  }

  it('retourne la structure complète avec kpi, segments, top_clients, top_produits, par_relais, evolution', async () => {
    mockAllQueries();
    const result = await clientsQueries.getClientsAnalysis({});

    expect(result.kpi.nb_clients).toBe(10);
    expect(result.kpi.commandes_valides).toBe(25);
    expect(result.kpi.ca_total_kmf).toBe(500000);
    expect(result.kpi.panier_moyen_kmf).toBe(20000);
    expect(result.kpi.clients_recurrents).toBe(4);
    expect(result.kpi.taux_recurrence_pct).toBe(40); // 4/10 * 100

    expect(result.segments).toEqual({
      nb_total: 10, new: 3, recurrent: 4, vip: 1, at_risk: 1, dormant: 1,
    });

    expect(result.top_clients).toHaveLength(1);
    expect(result.top_clients[0].name).toBe('Fatima');
    expect(result.top_produits[0].categorie).toBe('alimentaire');
    expect(result.par_relais[0].relais).toBe('Relais Moroni');
    expect(result.at_risk_clients[0].name).toBe('Ali');
    expect(result.vip_clients[0].name).toBe('Zara');
    expect(result.evolution).toEqual([{ mois: '2026-05', nb_commandes: 10, nb_clients: 6, ca_kmf: 150000 }]);
  });

  it('utilise la date du jour comme "fin" par défaut et renvoie la periode', async () => {
    mockAllQueries();
    const result = await clientsQueries.getClientsAnalysis({ debut: '2026-01-01' });
    expect(result.periode.debut).toBe('2026-01-01');
    expect(result.periode.fin).toBe(new Date().toISOString().split('T')[0]);
    expect(result.periode.vip_threshold_kmf).toBe(200000);
  });

  it('taux_recurrence_pct = 0 si nb_clients = 0 (pas de division par zéro)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ nb_clients: 0, commandes_valides: 0, ca_kmf: 0, panier_moyen: 0, clients_recurrents: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ nb_total: 0, nb_new: 0, nb_recurrent: 0, nb_vip: 0, nb_at_risk: 0, nb_dormant: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await clientsQueries.getClientsAnalysis({});
    expect(result.kpi.nb_clients).toBe(0);
    expect(result.kpi.taux_recurrence_pct).toBe(0);
  });

  it('passe le seuil VIP custom dans la requête de segmentation et dans la périoder', async () => {
    mockAllQueries();
    await clientsQueries.getClientsAnalysis({ seuilVipKmf: 500000 });
    // 6ème appel = segmentation, reçoit seuilVipKmf en paramètre
    const [, params] = db.query.mock.calls[5];
    expect(params).toEqual([500000]);
  });
});

// ── getClientsList ────────────────────────────────────────────────────────────

describe('getClientsList', () => {
  it('retourne page/page_size/total/total_pages + clients formatés', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        phone: '+269111', name: 'Mariam', nb_commandes: 3, ltv_kmf: 45000,
        panier_moyen_kmf: 15000, premiere_commande: '2026-01-01', derniere_commande: '2026-05-01', jours_silence: 44,
      }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await clientsQueries.getClientsList({});
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(25);
    expect(result.total).toBe(1);
    expect(result.total_pages).toBe(1);
    expect(result.clients).toHaveLength(1);
    expect(result.clients[0].name).toBe('Mariam');
    expect(result.clients[0].ltv_kmf).toBe(45000);
  });

  it('applique le filtre segment=vip avec le seuil dans les params', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await clientsQueries.getClientsList({ segment: 'vip', seuilVipKmf: 300000 });

    const [listSql, listParams] = db.query.mock.calls[0];
    expect(listSql).toContain('HAVING');
    expect(listSql).toContain('SUM(total_kmf)');
    expect(listParams).toContain(300000);
  });

  it('applique le filtre island et le filtre search ensemble', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await clientsQueries.getClientsList({ search: 'Fatima', island: 'Mayotte' });

    const [listSql, listParams] = db.query.mock.calls[0];
    expect(listSql).toContain('LOWER(client_name) LIKE');
    expect(listSql).toContain("rl.island = $");
    expect(listParams).toEqual(expect.arrayContaining(['%fatima%', 'Mayotte']));
  });

  it('calcule total_pages par arrondi supérieur', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 51 }] });

    const result = await clientsQueries.getClientsList({ page: 2, pageSize: 25 });
    expect(result.total_pages).toBe(3); // ceil(51/25)
  });
});

// ── getClientDetail ───────────────────────────────────────────────────────────

describe('getClientDetail', () => {
  it('retourne null si aucun profil trouvé', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await clientsQueries.getClientDetail('+269000');
    expect(result).toBeNull();
  });

  it('retourne profile + orders + top_products quand le client existe', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        name: 'Yasmine', phone: '+269222', email: 'y@x.com', country: 'KM',
        nb_orders_total: 5, nb_orders_valid: 4, nb_orders_cancelled: 1,
        ltv_kmf: 120000, panier_moyen_kmf: 30000,
        premiere_commande: '2026-01-01', derniere_commande: '2026-06-01', jours_silence: 13,
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 1, reference: 'CMD-1', total_kmf: 30000, status: 'collected', payment_mode: 'cash_relais',
        created_at: '2026-05-01', collected_at: '2026-05-05', cancelled_at: null,
        relais_name: 'Relais Moroni', island: 'Grande Comore',
      }] })
      .mockResolvedValueOnce({ rows: [{
        name: 'Huile', category: 'alimentaire', qty: 4, total_kmf: 20000, nb_orders: 2,
      }] });

    const result = await clientsQueries.getClientDetail('+269222');
    expect(result.profile.name).toBe('Yasmine');
    expect(result.profile.ltv_kmf).toBe(120000);
    expect(result.profile.jours_silence).toBe(13);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].relais).toBe('Relais Moroni');
    expect(result.top_products[0].categorie).toBe('alimentaire');
  });
});

// ── getHistory ────────────────────────────────────────────────────────────────

describe('getHistory', () => {
  it('retourne nb_mois, taux et history avec valeurs arrondies', async () => {
    getEurKmf.mockResolvedValueOnce({ eur_kmf: 491, aed_kmf: 134 });
    db.query.mockResolvedValueOnce({ rows: [
      { mois: '2026-05', total_commandes: 12, livrees: 10, ca_kmf: 150000.6, ca_eur: 305.3 },
    ] });

    const result = await clientsQueries.getHistory(6);
    expect(result.nb_mois).toBe(6);
    expect(result.taux).toEqual({ eur_kmf: 491, aed_kmf: 134 });
    expect(result.history[0]).toEqual({
      mois: '2026-05', total_commandes: 12, livrees: 10, ca_kmf: 150001, ca_eur: 305,
    });
  });

  it('utilise nb_mois=6 par défaut et le passe en paramètre de la requête', async () => {
    getEurKmf.mockResolvedValueOnce({ eur_kmf: 491, aed_kmf: 134 });
    db.query.mockResolvedValueOnce({ rows: [] });

    await clientsQueries.getHistory();
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([6]);
  });
});

// ── getRelais ─────────────────────────────────────────────────────────────────

describe('getRelais', () => {
  it('retourne en_transit/a_remettre vides + kpi à zéro sans appel items si aucun colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await clientsQueries.getRelais();
    expect(result.en_transit).toEqual([]);
    expect(result.a_remettre).toEqual([]);
    expect(result.kpi).toEqual({ en_transit: 0, a_remettre: 0, cash_pending: 0 });
    expect(db.query).toHaveBeenCalledTimes(1); // pas de 2ème requête si parcelIds vide
  });

  it('classe les colis par statut, enrichit avec les produits et calcule la priorité', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        {
          id: 1, reference: 'COL-1', status: 'in_transit', type: 'box', weight_kg: 5,
          external_code: 'EXT1', seal_code: 'SEAL1', pickup_code: 'PICK1', items_count: 2,
          created_at: '2026-06-01', updated_at: '2026-06-01',
          order_id: 10, order_reference: 'CMD-10', order_total_kmf: 50000,
          payment_mode: 'stripe_eur', payment_status: 'paid',
          client_nom: 'Yasmine', client_phone: '+269222',
          relais_nom: 'Relais Moroni', ile: 'Grande Comore',
          heures_attente: 150,
        },
        {
          id: 2, reference: 'COL-2', status: 'available', type: 'box', weight_kg: 3,
          external_code: null, seal_code: null, pickup_code: 'PICK2', items_count: 1,
          created_at: '2026-06-05', updated_at: '2026-06-05',
          order_id: 11, order_reference: 'CMD-11', order_total_kmf: 20000,
          payment_mode: 'cash_relais', payment_status: 'pending',
          client_nom: null, client_phone: null,
          relais_nom: null, ile: null,
          heures_attente: 10,
        },
      ] })
      .mockResolvedValueOnce({ rows: [
        { parcel_id: 1, nom: 'Riz', quantite: 2, prix_kmf: 1000 },
      ] });

    const result = await clientsQueries.getRelais();

    expect(result.en_transit).toHaveLength(1);
    expect(result.en_transit[0].priorite).toBe('urgente'); // 150h > 120
    expect(result.en_transit[0].produits).toEqual([{ nom: 'Riz', quantite: 2, prix_kmf: 1000 }]);

    expect(result.a_remettre).toHaveLength(1);
    expect(result.a_remettre[0].priorite).toBe('normale'); // 10h <= 120
    expect(result.a_remettre[0].client_nom).toBe('Client'); // fallback
    expect(result.a_remettre[0].relais_nom).toBe('Relais inconnu'); // fallback
    expect(result.a_remettre[0].ile).toBe('Comores'); // fallback
    expect(result.a_remettre[0].payment_mode).toBe('cash_relais');
    expect(result.a_remettre[0].payment_status).toBe('pending');

    expect(result.kpi).toEqual({ en_transit: 1, a_remettre: 1, cash_pending: 1 });

    // 2ème requête : items, scoping par parcelIds
    const [, itemsParams] = db.query.mock.calls[1];
    expect(itemsParams).toEqual([[1, 2]]);
  });
});
