import type {
  OpsData,
  FinanceData,
  PilotageData,
  PipelineData,
  RetardsData,
  ForecastData,
  ClientsData,
  HistoryData,
  HubData,
  RelaisOrderData,
} from '../types';

// ── Hub Dubai ─────────────────────────────────────────────────────────

export const mockHubData: HubData = {
  a_receptionner: [
    {
      reference: 'K101', client_nom: 'Ali Mohamed', total_kmf: 170000, date_commande: '2026-03-28', jours: 9, fournisseur: 'Al Fahim Textiles', poids_kg: 2.4, priorite: 'urgente',
      produits: [
        { nom: 'Ensemble cérémonie doré', quantite: 1, prix_kmf: 95000, status: 'complet' },
        { nom: 'Ceinture assortie', quantite: 1, prix_kmf: 35000, status: 'complet' },
        { nom: 'Chaussures dorées', quantite: 1, prix_kmf: 40000, status: 'hors_stock', note: 'Rupture fournisseur, retour prévu 10/04' },
      ],
    },
    {
      reference: 'K102', client_nom: 'Mariama Said', total_kmf: 127000, date_commande: '2026-04-01', jours: 5, fournisseur: 'Dubai Perfumes LLC', poids_kg: 0.9,
      produits: [
        { nom: 'Parfum Oud Collection 100ml', quantite: 1, prix_kmf: 55000, status: 'complet' },
        { nom: 'Parfum Musc 50ml', quantite: 1, prix_kmf: 32000, status: 'complet' },
        { nom: 'Coffret miniatures x5', quantite: 1, prix_kmf: 40000, status: 'defectueux', note: '2 flacons fissurés' },
      ],
    },
    {
      reference: 'K103', client_nom: 'Ibrahim Youssouf', total_kmf: 45000, date_commande: '2026-04-03', jours: 3, fournisseur: 'Gold Souk Store', poids_kg: 0.3,
      produits: [
        { nom: 'Montre Casio Vintage', quantite: 1, prix_kmf: 45000, status: 'complet' },
      ],
    },
    {
      reference: 'K104', client_nom: 'Fatima Abdou', total_kmf: 185000, date_commande: '2026-03-30', jours: 7, fournisseur: 'Leather World', poids_kg: 2.8, priorite: 'urgente',
      produits: [
        { nom: 'Sac à main cuir noir', quantite: 1, prix_kmf: 95000, status: 'complet' },
        { nom: 'Portefeuille assorti', quantite: 1, prix_kmf: 40000, status: 'retard', note: 'Livraison fournisseur J+3' },
        { nom: 'Ceinture cuir', quantite: 1, prix_kmf: 50000, status: 'annule', note: 'Client a annulé cet article' },
      ],
    },
  ],
  a_emballer: [
    {
      reference: 'K201', client_nom: 'Said Omar', total_kmf: 180000, date_commande: '2026-03-25', jours: 12, poids_kg: 0.5,
      produits: [
        { nom: 'Collier plaqué or', quantite: 1, prix_kmf: 55000, status: 'complet' },
        { nom: 'Bracelet plaqué or', quantite: 1, prix_kmf: 35000, status: 'complet' },
        { nom: 'Boucles oreilles', quantite: 1, prix_kmf: 45000, status: 'complet' },
        { nom: 'Bague assortie', quantite: 1, prix_kmf: 45000, status: 'incomplet', note: 'Taille non confirmée' },
      ],
    },
    {
      reference: 'K202', client_nom: 'Amina Hassan', total_kmf: 65000, date_commande: '2026-03-27', jours: 10, poids_kg: 1.0,
      produits: [
        { nom: 'Chaussures cérémonie ivoire', quantite: 1, prix_kmf: 65000, status: 'complet' },
      ],
    },
    {
      reference: 'K203', client_nom: 'Houssein Ali', total_kmf: 150000, date_commande: '2026-03-26', jours: 11, poids_kg: 2.5, priorite: 'urgente',
      produits: [
        { nom: 'Tissu Bazin Riche 3 yards', quantite: 1, prix_kmf: 75000, status: 'complet' },
        { nom: 'Tissu Bazin Doré 3 yards', quantite: 1, prix_kmf: 75000, status: 'defectueux', note: 'Tâche sur le tissu, remplacement demandé' },
      ],
    },
  ],
  a_expedier: [
    {
      reference: 'K301', client_nom: 'Nouria Ahmed', total_kmf: 210000, date_commande: '2026-03-20', jours: 17, poids_kg: 2.0,
      produits: [
        { nom: 'Fond de teint MAC', quantite: 1, prix_kmf: 35000, status: 'complet' },
        { nom: 'Palette yeux Huda', quantite: 1, prix_kmf: 55000, status: 'complet' },
        { nom: 'Rouge lèvres set x3', quantite: 1, prix_kmf: 40000, status: 'complet' },
        { nom: 'Pinceaux set pro', quantite: 1, prix_kmf: 45000, status: 'complet' },
        { nom: 'Trousse beauté', quantite: 1, prix_kmf: 35000, status: 'complet' },
      ],
    },
    {
      reference: 'K302', client_nom: 'Youssouf Abdallah', total_kmf: 120000, date_commande: '2026-03-22', jours: 15, poids_kg: 0.4,
      produits: [
        { nom: 'Ray-Ban Aviator', quantite: 1, prix_kmf: 70000, status: 'complet' },
        { nom: 'Ray-Ban Wayfarer', quantite: 1, prix_kmf: 50000, status: 'retard', note: 'En transit depuis Abu Dhabi' },
      ],
    },
  ],
};

// ── Relais Orders ─────────────────────────────────────────────────────

export const mockRelaisOrders: RelaisOrderData = {
  a_valider: [
    {
      reference: 'K401', client_nom: 'Ali Mohamed', client_phone: '+269 321 45 67', total_kmf: 170000, payment_mode: 'cash_relais', payment_status: 'pending', date_arrivee: '2026-04-05', heures_attente: 18, relais_nom: 'Relais Mutsamudu', ile: 'Anjouan',
      produits: [
        { nom: 'Ensemble cérémonie doré', quantite: 1, prix_kmf: 95000, status: 'complet' },
        { nom: 'Ceinture assortie', quantite: 1, prix_kmf: 35000, status: 'complet' },
        { nom: 'Chaussures dorées', quantite: 1, prix_kmf: 40000, status: 'hors_stock', note: 'Non livré — rupture' },
      ],
    },
    {
      reference: 'K402', client_nom: 'Fatima Abdou', client_phone: '+269 322 11 22', total_kmf: 42000, payment_mode: 'stripe', payment_status: 'paid', date_arrivee: '2026-04-05', heures_attente: 12, relais_nom: 'Relais Mutsamudu', ile: 'Anjouan',
      produits: [
        { nom: 'Parfum Oud 100ml', quantite: 1, prix_kmf: 42000, status: 'complet' },
      ],
    },
    {
      reference: 'K403', client_nom: 'Ibrahim Youssouf', client_phone: '+269 323 33 44', total_kmf: 90000, payment_mode: 'cash_relais', payment_status: 'pending', date_arrivee: '2026-04-04', heures_attente: 36, relais_nom: 'Relais Domoni', ile: 'Anjouan', priorite: 'urgente',
      produits: [
        { nom: 'Montre Casio Vintage', quantite: 1, prix_kmf: 45000, status: 'complet' },
        { nom: 'Bracelet cuir', quantite: 1, prix_kmf: 25000, status: 'defectueux', note: 'Fermoir cassé' },
        { nom: 'Étui montre', quantite: 1, prix_kmf: 20000, status: 'complet' },
      ],
    },
    {
      reference: 'K404', client_nom: 'Nouria Ahmed', client_phone: '+269 771 22 33', total_kmf: 95000, payment_mode: 'stripe', payment_status: 'paid', date_arrivee: '2026-04-06', heures_attente: 6, relais_nom: 'Relais Moroni Centre', ile: 'Grande Comore',
      produits: [
        { nom: 'Sac cuir noir', quantite: 1, prix_kmf: 95000, status: 'complet' },
      ],
    },
    {
      reference: 'K405', client_nom: 'Houssein Ali', client_phone: '+269 772 44 55', total_kmf: 150000, payment_mode: 'cash_relais', payment_status: 'pending', date_arrivee: '2026-04-04', heures_attente: 42, relais_nom: 'Relais Moroni Centre', ile: 'Grande Comore', priorite: 'urgente',
      produits: [
        { nom: 'Tissu Bazin Riche', quantite: 1, prix_kmf: 75000, status: 'complet' },
        { nom: 'Tissu Bazin Doré', quantite: 1, prix_kmf: 75000, status: 'incomplet', note: '2 yards sur 3 livrés' },
      ],
    },
  ],
  a_remettre: [
    {
      reference: 'K501', client_nom: 'Mariama Said', client_phone: '+269 321 88 99', total_kmf: 180000, payment_mode: 'stripe', payment_status: 'paid', date_arrivee: '2026-04-01', heures_attente: 120, relais_nom: 'Relais Mutsamudu', ile: 'Anjouan',
      produits: [
        { nom: 'Collier plaqué or', quantite: 1, prix_kmf: 55000, status: 'complet' },
        { nom: 'Bracelet plaqué or', quantite: 1, prix_kmf: 35000, status: 'complet' },
        { nom: 'Boucles oreilles', quantite: 1, prix_kmf: 45000, status: 'complet' },
        { nom: 'Bague assortie', quantite: 1, prix_kmf: 45000, status: 'complet' },
      ],
    },
    {
      reference: 'K502', client_nom: 'Said Omar', client_phone: '+269 322 55 66', total_kmf: 65000, payment_mode: 'cash_relais', payment_status: 'pending', date_arrivee: '2026-04-02', heures_attente: 96, relais_nom: 'Relais Mutsamudu', ile: 'Anjouan',
      produits: [
        { nom: 'Chaussures cérémonie', quantite: 1, prix_kmf: 65000, status: 'complet' },
      ],
    },
    {
      reference: 'K503', client_nom: 'Amina Hassan', client_phone: '+269 323 77 88', total_kmf: 210000, payment_mode: 'stripe', payment_status: 'paid', date_arrivee: '2026-04-03', heures_attente: 72, relais_nom: 'Relais Domoni', ile: 'Anjouan',
      produits: [
        { nom: 'Fond de teint MAC', quantite: 1, prix_kmf: 35000, status: 'complet' },
        { nom: 'Palette Huda', quantite: 1, prix_kmf: 55000, status: 'complet' },
        { nom: 'Rouge lèvres set', quantite: 1, prix_kmf: 40000, status: 'retard', note: 'Manquant au colis' },
        { nom: 'Pinceaux set pro', quantite: 1, prix_kmf: 45000, status: 'complet' },
        { nom: 'Trousse beauté', quantite: 1, prix_kmf: 35000, status: 'complet' },
      ],
    },
    {
      reference: 'K504', client_nom: 'Youssouf Abdallah', client_phone: '+269 771 99 00', total_kmf: 120000, payment_mode: 'cash_relais', payment_status: 'pending', date_arrivee: '2026-03-30', heures_attente: 168, relais_nom: 'Relais Moroni Centre', ile: 'Grande Comore', priorite: 'urgente',
      produits: [
        { nom: 'Ray-Ban Aviator', quantite: 1, prix_kmf: 70000, status: 'complet' },
        { nom: 'Ray-Ban Wayfarer', quantite: 1, prix_kmf: 50000, status: 'annule', note: 'Client a annulé' },
      ],
    },
    {
      reference: 'K505', client_nom: 'Zaïna Mohamed', client_phone: '+269 341 22 33', total_kmf: 85000, payment_mode: 'stripe', payment_status: 'paid', date_arrivee: '2026-04-02', heures_attente: 96, relais_nom: 'Relais Fomboni', ile: 'Mohéli',
      produits: [
        { nom: 'Parfum Oud 100ml', quantite: 1, prix_kmf: 55000, status: 'complet' },
        { nom: 'Parfum Musc 50ml', quantite: 1, prix_kmf: 30000, status: 'complet' },
      ],
    },
  ],
};

// ── Ops ─────────────────────────────────────────────────────────────

export const mockOpsData: OpsData = {
  activite: {
    commandes_aujourd_hui: 3,
    commandes_en_cours: 18,
    commandes_bloquees: 2,
    livrees_aujourd_hui: 1,
    livrees_30j: 24,
  },
  sla: {
    on_time: 8,
    warning: 5,
    late: 3,
    blocked: 2,
    details: {
      late: [
        { reference: 'KABC123', status: 'shipped', jours: 45 },
        { reference: 'KDEF456', status: 'in_transit', jours: 38 },
        { reference: 'KGHI789', status: 'shipped', jours: 42 },
      ],
    },
  },
  logistique: {
    dubai_reception: {
      count: 4,
      items: [
        { reference: 'K101', status: 'ordered', jours: 3 },
        { reference: 'K102', status: 'ordered', jours: 5 },
        { reference: 'K103', status: 'confirmed', jours: 1 },
        { reference: 'K104', status: 'ordered', jours: 7 },
      ],
      label: '📥 Réceptionner',
    },
    dubai_expedition: {
      count: 3,
      items: [
        { reference: 'K201', status: 'preparation', jours: 2 },
        { reference: 'K202', status: 'preparation', jours: 4 },
        { reference: 'K203', status: 'preparation', jours: 1 },
      ],
      label: '📦 Expédier',
    },
    transitaire: {
      count: 2,
      items: [
        { reference: 'K301', status: 'shipped', jours: 6 },
        { reference: 'K302', status: 'shipped', jours: 3 },
      ],
      label: '🏢 Transitaire',
    },
    bateau: {
      count: 5,
      items: [
        { reference: 'K401', status: 'in_transit', jours: 12 },
        { reference: 'K402', status: 'in_transit', jours: 8 },
        { reference: 'K403', status: 'in_transit', jours: 15 },
        { reference: 'K404', status: 'in_transit', jours: 5 },
        { reference: 'K405', status: 'in_transit', jours: 20 },
      ],
      label: '🚢 En mer',
    },
    anjouan: {
      count: 6,
      items: [
        { reference: 'K501', status: 'available', jours: 2, destinataire: 'Ali Mohamed', relais_nom: 'Relais Mutsamudu', heures_en_attente: 72 },
        { reference: 'K502', status: 'available', jours: 5, destinataire: 'Mariama Said', relais_nom: 'Relais Mutsamudu', heures_en_attente: 120 },
        { reference: 'K503', status: 'available', jours: 1, destinataire: 'Ibrahim Youssouf', relais_nom: 'Relais Domoni', heures_en_attente: 24 },
        { reference: 'K504', status: 'available', jours: 3, destinataire: 'Fatima Abdou', relais_nom: 'Relais Mutsamudu', heures_en_attente: 48 },
        { reference: 'K505', status: 'available', jours: 7, destinataire: 'Amina Hassan', relais_nom: 'Relais Domoni', heures_en_attente: 168 },
        { reference: 'K506', status: 'available', jours: 4, destinataire: 'Said Omar', relais_nom: 'Relais Sima', heures_en_attente: 96 },
      ],
      label: '📍 Relais Anjouan',
    },
  },
  delais: {
    avg_preparation_jours: 5,
    avg_livraison_totale_jours: 28,
  },
  alertes: {
    cash_pending: 2,
    anomalies: 3,
    low_stock: 1,
  },
};

// ── Finance ─────────────────────────────────────────────────────────

export const mockFinanceData: FinanceData = {
  period: 30,
  taux: { eur_kmf: 492, aed_kmf: 134 },
  kpi: {
    ca_kmf: 2850000,
    ca_eur: 5793,
    nb_commandes: 42,
    nb_livrees: 24,
    nb_annulees: 3,
    panier_moyen_kmf: 67857,
    evolution: { ca_pct: 15.2, cmd_pct: 8.5 },
  },
  paiements: {
    cash: { count: 28, total_kmf: 1900000 },
    stripe: { count: 14, total_eur: 1930.5 },
  },
  marges: {
    marge_reelle_kmf: 855000,
    cout_logistique_kmf: 1995000,
    taux_marge_pct: 30.0,
    nb_avec_cost: 35,
    nb_sans_cost: 7,
    alertes_perte: { count: 1, refs: ['KDEF456'] },
  },
  par_categorie: [
    { categorie: 'ceremony', nb_commandes: 18, ca_kmf: 1200000, marge_kmf: 400000, taux_marge: 33.3 },
    { categorie: 'beauty', nb_commandes: 12, ca_kmf: 800000, marge_kmf: 280000, taux_marge: 35.0 },
    { categorie: 'accessories', nb_commandes: 8, ca_kmf: 550000, marge_kmf: 125000, taux_marge: 22.7 },
    { categorie: 'electronics', nb_commandes: 4, ca_kmf: 300000, marge_kmf: 50000, taux_marge: 16.7 },
  ],
  top_produits: [
    { nom: 'Robe Saharienne Dorée', categorie: 'ceremony', qty: 8, ca_kmf: 480000 },
    { nom: 'Parfum Oud Al Shams', categorie: 'beauty', qty: 12, ca_kmf: 360000 },
    { nom: 'Tissu Wax Premium 6y', categorie: 'ceremony', qty: 15, ca_kmf: 375000 },
    { nom: 'Lunettes Ray-Ban', categorie: 'accessories', qty: 4, ca_kmf: 240000 },
    { nom: 'Montre Casio Vintage', categorie: 'accessories', qty: 6, ca_kmf: 180000 },
  ],
};

// ── Pilotage ────────────────────────────────────────────────────────

export const mockPilotageData: PilotageData = {
  periode: '2026-04',
  taux: { eur_kmf: 492, aed_kmf: 134 },
  taux_history: [
    { eur_kmf: 492, aed_kmf: 134, valid_from: '2026-04-01' },
    { eur_kmf: 490, aed_kmf: 133, valid_from: '2026-03-01' },
  ],
  volume: { total: 42, livrees: 24, annulees: 3, en_cours: 15 },
  ca: { total_kmf: 2850000, total_eur: 5793, cash_kmf: 1900000, stripe_kmf: 950000 },
  categories: [
    { categorie: 'ceremony', nb_commandes: 18, nb_articles: 25, ca_kmf: 1200000, pct_ca: 42.1 },
    { categorie: 'beauty', nb_commandes: 12, nb_articles: 18, ca_kmf: 800000, pct_ca: 28.1 },
    { categorie: 'accessories', nb_commandes: 8, nb_articles: 10, ca_kmf: 550000, pct_ca: 19.3 },
    { categorie: 'electronics', nb_commandes: 4, nb_articles: 4, ca_kmf: 300000, pct_ca: 10.5 },
  ],
  couts: { taux_terrain_pct: 42, source_taux: 'decision_v75_42pct', hub_fixe_mensuel_kmf: 938000 },
  pipeline: [
    { statut: 'available', nb: 6 },
    { statut: 'shipped', nb: 5 },
    { statut: 'preparation', nb: 3 },
    { statut: 'ordered', nb: 4 },
    { statut: 'confirmed', nb: 2 },
    { statut: 'collected', nb: 24 },
  ],
};

// ── Pipeline ────────────────────────────────────────────────────────

const makeOrder = (
  id: string,
  reference: string,
  status: string,
  total_kmf: number,
  payment_mode: string,
  payment_status: string,
  created_at: string,
  client_name: string,
  recipient_name: string,
  relais_name: string,
  product_name: string,
  items_count: number,
  age_jours: number,
  inactif_jours: number,
) => ({
  id, reference, status, total_kmf, payment_mode, payment_status, created_at,
  client_name, recipient_name, relais_name, product_name, items_count, age_jours, inactif_jours,
});

export const mockPipelineData: PipelineData = {
  total: 60,
  active: 18,
  pipeline: {
    confirmed: {
      count: 2,
      orders: [
        makeOrder('u1', 'K001', 'confirmed', 45000, 'cash_relais', 'pending', '2026-04-03', 'Fatima Ali', 'Amina', 'Relais Mutsamudu', 'Robe Saharienne', 2, 3, 1),
        makeOrder('u2', 'K002', 'confirmed', 68000, 'stripe', 'paid', '2026-04-04', 'Ibrahim Youssouf', 'Ibrahim', 'Relais Moroni Centre', 'Parfum Oud Al Shams', 1, 2, 0),
      ],
    },
    ordered: {
      count: 4,
      orders: [
        makeOrder('u3', 'K003', 'ordered', 52000, 'cash_relais', 'pending', '2026-03-30', 'Mariama Said', 'Halima', 'Relais Mutsamudu', 'Tissu Wax Premium', 3, 7, 2),
        makeOrder('u4', 'K004', 'ordered', 95000, 'stripe', 'paid', '2026-03-28', 'Ali Mohamed', 'Ali', 'Relais Fomboni', 'Montre Casio Vintage', 1, 9, 3),
        makeOrder('u5', 'K005', 'ordered', 35000, 'cash_relais', 'pending', '2026-04-01', 'Amina Hassan', 'Zahra', 'Relais Domoni', 'Lunettes Ray-Ban', 1, 5, 1),
        makeOrder('u6', 'K006', 'ordered', 72000, 'stripe', 'paid', '2026-03-25', 'Said Omar', 'Said', 'Relais Moroni Centre', 'Robe Saharienne Dorée', 2, 12, 5),
      ],
    },
    preparation: {
      count: 3,
      orders: [
        makeOrder('u7', 'K007', 'preparation', 48000, 'cash_relais', 'pending', '2026-03-27', 'Nadia Abdallah', 'Nadia', 'Relais Mutsamudu', 'Parfum Oud', 2, 10, 4),
        makeOrder('u8', 'K008', 'preparation', 120000, 'stripe', 'paid', '2026-03-29', 'Hassan Ahamada', 'Hassan', 'Relais Moroni Centre', 'Ensemble Cérémonie', 4, 8, 2),
        makeOrder('u9', 'K009', 'preparation', 55000, 'cash_relais', 'pending', '2026-04-02', 'Zainaba Moussa', 'Raissa', 'Relais Fomboni', 'Tissu Wax', 1, 4, 1),
      ],
    },
    shipped: {
      count: 5,
      orders: [
        makeOrder('u10', 'K010', 'shipped', 87000, 'stripe', 'paid', '2026-03-15', 'Soilihi Ahmed', 'Soilihi', 'Relais Mutsamudu', 'Robe Dorée + Parfum', 3, 22, 0),
        makeOrder('u11', 'K011', 'shipped', 42000, 'cash_relais', 'pending', '2026-03-10', 'Naima Combo', 'Naima', 'Relais Domoni', 'Montre Casio', 1, 27, 0),
        makeOrder('u12', 'K012', 'shipped', 65000, 'stripe', 'paid', '2026-03-01', 'Abdou Bacar', 'Abdou', 'Relais Moroni Centre', 'Lunettes + Tissu', 2, 36, 0),
        makeOrder('u13', 'K013', 'shipped', 38000, 'cash_relais', 'pending', '2026-02-20', 'Halima Ousseni', 'Halima', 'Relais Fomboni', 'Parfum Oud Al Shams', 1, 45, 0),
        makeOrder('u14', 'K014', 'shipped', 92000, 'stripe', 'paid', '2026-03-20', 'Mohamed Ismail', 'Mohamed', 'Relais Sima', 'Ensemble Mariage', 5, 17, 0),
      ],
    },
    in_transit: {
      count: 2,
      orders: [
        makeOrder('u15', 'K015', 'in_transit', 76000, 'cash_relais', 'pending', '2026-03-12', 'Anli Said', 'Anli', 'Relais Mutsamudu', 'Robe + Accessoires', 3, 25, 0),
        makeOrder('u16', 'K016', 'in_transit', 55000, 'stripe', 'paid', '2026-03-18', 'Zahra Combo', 'Zahra', 'Relais Moroni Centre', 'Parfum Collection', 2, 19, 0),
      ],
    },
    available: {
      count: 6,
      orders: [
        makeOrder('u17', 'K017', 'available', 43000, 'cash_relais', 'pending', '2026-03-08', 'Ali Mohamed', 'Ali', 'Relais Mutsamudu', 'Tissu Wax', 1, 29, 3),
        makeOrder('u18', 'K018', 'available', 68000, 'stripe', 'paid', '2026-03-05', 'Mariama Ali', 'Mariama', 'Relais Domoni', 'Robe Saharienne', 2, 32, 5),
        makeOrder('u19', 'K019', 'available', 31000, 'cash_relais', 'pending', '2026-03-20', 'Youssouf Hadji', 'Youssouf', 'Relais Moroni Centre', 'Montre Casio', 1, 17, 2),
        makeOrder('u20', 'K020', 'available', 85000, 'stripe', 'paid', '2026-03-15', 'Fatima Moussa', 'Fatima', 'Relais Mutsamudu', 'Ensemble Cérémonie', 3, 22, 4),
        makeOrder('u21', 'K021', 'available', 47000, 'cash_relais', 'pending', '2026-03-22', 'Nadia Combo', 'Nadia', 'Relais Fomboni', 'Lunettes + Parfum', 2, 15, 1),
        makeOrder('u22', 'K022', 'available', 58000, 'stripe', 'paid', '2026-03-10', 'Ibrahim Said', 'Ibrahim', 'Relais Sima', 'Tissu + Accessoires', 2, 27, 6),
      ],
    },
    collected: {
      count: 24,
      orders: [
        makeOrder('u23', 'K023', 'collected', 52000, 'cash_relais', 'paid', '2026-02-15', 'Amina Abdou', 'Amina', 'Relais Mutsamudu', 'Parfum Oud', 1, 50, 0),
        makeOrder('u24', 'K024', 'collected', 78000, 'stripe', 'paid', '2026-02-20', 'Said Bacar', 'Said', 'Relais Moroni Centre', 'Robe Dorée', 2, 45, 0),
        makeOrder('u25', 'K025', 'collected', 63000, 'cash_relais', 'paid', '2026-03-01', 'Hassan Ali', 'Hassan', 'Relais Domoni', 'Tissu + Montre', 2, 36, 0),
      ],
    },
    cancelled: {
      count: 3,
      orders: [
        makeOrder('u26', 'K026', 'cancelled', 45000, 'cash_relais', 'refunded', '2026-03-05', 'Zahra Ousseni', 'Zahra', 'Relais Mutsamudu', 'Parfum Oud', 1, 32, 0),
        makeOrder('u27', 'K027', 'cancelled', 92000, 'stripe', 'refunded', '2026-03-10', 'Ali Combo', 'Ali', 'Relais Moroni Centre', 'Ensemble Mariage', 3, 27, 0),
        makeOrder('u28', 'K028', 'cancelled', 35000, 'cash_relais', 'pending', '2026-03-15', 'Naima Said', 'Naima', 'Relais Fomboni', 'Lunettes', 1, 22, 0),
      ],
    },
    refunded: {
      count: 1,
      orders: [
        makeOrder('u29', 'K029', 'refunded', 68000, 'stripe', 'refunded', '2026-02-10', 'Mohamed Abdou', 'Mohamed', 'Relais Mutsamudu', 'Robe Saharienne', 2, 55, 0),
      ],
    },
  },
};

// ── Retards ─────────────────────────────────────────────────────────

export const mockRetardsData: RetardsData = {
  total: 8,
  par_niveau: {
    remboursement_possible: { count: 1, label: 'Remboursement possible (8 sem+)' },
    remise_10pct_prochaine_cmd: { count: 2, label: 'Remise −10% prochaine commande' },
    avoir_5pct: { count: 2, label: 'Avoir 5% offert' },
    contact_preventif: { count: 3, label: 'Contact préventif' },
  },
  clients: [
    {
      reference: 'K013', status: 'shipped', client_nom: 'Halima Ousseni',
      client_phone: '+2693210001', client_email: 'halima@mail.com',
      jours_retard: 62, compensation: 'remboursement_possible',
      sms_suggere: 'Bonjour Halima Ousseni, votre commande K013 accuse un retard important de 62 jours. Nous vous proposons un remboursement complet. Contactez-nous pour les modalités.',
    },
    {
      reference: 'K012', status: 'shipped', client_nom: 'Abdou Bacar',
      client_phone: '+2693210002', client_email: 'abdou@mail.com',
      jours_retard: 45, compensation: 'remise_10pct_prochaine_cmd',
      sms_suggere: 'Bonjour Abdou Bacar, votre commande K012 est en retard de 45 jours. Nous vous offrons une remise de 10% sur votre prochaine commande en compensation.',
    },
    {
      reference: 'KABC123', status: 'shipped', client_nom: 'Fatima Ali',
      client_phone: '+2693210003', client_email: 'fatima@mail.com',
      jours_retard: 45, compensation: 'remise_10pct_prochaine_cmd',
      sms_suggere: 'Bonjour Fatima Ali, votre commande KABC123 accuse un retard de 45 jours. Nous vous offrons une remise de 10% sur votre prochaine commande.',
    },
    {
      reference: 'KDEF456', status: 'in_transit', client_nom: 'Ibrahim Youssouf',
      client_phone: '+2693210004', client_email: 'ibrahim@mail.com',
      jours_retard: 38, compensation: 'avoir_5pct',
      sms_suggere: 'Bonjour Ibrahim Youssouf, votre commande KDEF456 est en retard de 38 jours. Un avoir de 5% vous sera crédité sur votre compte.',
    },
    {
      reference: 'KGHI789', status: 'shipped', client_nom: 'Mariama Said',
      client_phone: '+2693210005', client_email: 'mariama@mail.com',
      jours_retard: 42, compensation: 'avoir_5pct',
      sms_suggere: 'Bonjour Mariama Said, votre commande KGHI789 est en retard de 42 jours. Un avoir de 5% vous sera crédité en compensation.',
    },
    {
      reference: 'K011', status: 'shipped', client_nom: 'Naima Combo',
      client_phone: '+2693210006', client_email: 'naima@mail.com',
      jours_retard: 30, compensation: 'contact_preventif',
      sms_suggere: 'Bonjour Naima Combo, votre commande K011 est en cours d\'acheminement. Nous faisons le maximum pour accélérer la livraison.',
    },
    {
      reference: 'K015', status: 'in_transit', client_nom: 'Anli Said',
      client_phone: '+2693210007', client_email: 'anli@mail.com',
      jours_retard: 29, compensation: 'contact_preventif',
      sms_suggere: 'Bonjour Anli Said, votre commande K015 est en transit. La livraison devrait intervenir prochainement.',
    },
    {
      reference: 'K010', status: 'shipped', client_nom: 'Soilihi Ahmed',
      client_phone: '+2693210008', client_email: 'soilihi@mail.com',
      jours_retard: 28, compensation: 'contact_preventif',
      sms_suggere: 'Bonjour Soilihi Ahmed, votre commande K010 est en cours d\'expédition. Nous surveillons son acheminement.',
    },
  ],
};

// ── Forecast ────────────────────────────────────────────────────────

export const mockForecastData: ForecastData = {
  target_date: '2026-04-30',
  days_remaining: 24,
  realise_kmf: 1200000,
  modele: { ref_period_jours: 30, avg_ca_jour: 95000, stddev: 35000 },
  projection: { pessimiste: 2640000, attendu: 3480000, optimiste: 4320000 },
};

// ── Clients ─────────────────────────────────────────────────────────

export const mockClientsData: ClientsData = {
  periode: { debut: '2024-01-01', fin: '2026-04-06' },
  kpi: {
    nb_clients: 156,
    commandes_valides: 342,
    ca_total_kmf: 24500000,
    panier_moyen_kmf: 71637,
    clients_recurrents: 48,
    taux_recurrence_pct: 30.8,
  },
  top_clients: [
    { name: 'Fatima Ali', phone: '+2693210001', nb_commandes: 12, ca_kmf: 850000, derniere_commande: '2026-04-01' },
    { name: 'Ibrahim Youssouf', phone: '+2693210004', nb_commandes: 9, ca_kmf: 720000, derniere_commande: '2026-03-28' },
    { name: 'Mariama Said', phone: '+2693210005', nb_commandes: 8, ca_kmf: 680000, derniere_commande: '2026-03-25' },
    { name: 'Ali Mohamed', phone: '+2693210009', nb_commandes: 7, ca_kmf: 520000, derniere_commande: '2026-04-03' },
    { name: 'Amina Hassan', phone: '+2693210010', nb_commandes: 6, ca_kmf: 450000, derniere_commande: '2026-03-20' },
    { name: 'Nadia Abdallah', phone: '+2693210011', nb_commandes: 5, ca_kmf: 380000, derniere_commande: '2026-03-15' },
    { name: 'Hassan Ahamada', phone: '+2693210012', nb_commandes: 5, ca_kmf: 360000, derniere_commande: '2026-03-18' },
    { name: 'Said Omar', phone: '+2693210013', nb_commandes: 4, ca_kmf: 310000, derniere_commande: '2026-02-28' },
  ],
  top_produits: [
    { nom: 'Robe Saharienne Dorée', categorie: 'ceremony', qty: 45, nb_commandes: 38, ca_kmf: 2700000 },
    { nom: 'Parfum Oud Al Shams', categorie: 'beauty', qty: 62, nb_commandes: 50, ca_kmf: 1860000 },
    { nom: 'Tissu Wax Premium 6y', categorie: 'ceremony', qty: 80, nb_commandes: 55, ca_kmf: 2000000 },
    { nom: 'Montre Casio Vintage', categorie: 'accessories', qty: 30, nb_commandes: 28, ca_kmf: 900000 },
    { nom: 'Lunettes Ray-Ban', categorie: 'accessories', qty: 22, nb_commandes: 20, ca_kmf: 1320000 },
  ],
  par_relais: [
    { relais: 'Relais Mutsamudu', ile: 'Anjouan', nb_commandes: 120, ca_kmf: 8500000, livrees: 95 },
    { relais: 'Relais Moroni Centre', ile: 'Grande Comore', nb_commandes: 85, ca_kmf: 6200000, livrees: 70 },
    { relais: 'Relais Fomboni', ile: 'Mohéli', nb_commandes: 45, ca_kmf: 3100000, livrees: 38 },
    { relais: 'Relais Domoni', ile: 'Anjouan', nb_commandes: 52, ca_kmf: 3800000, livrees: 44 },
    { relais: 'Relais Sima', ile: 'Anjouan', nb_commandes: 28, ca_kmf: 1900000, livrees: 22 },
    { relais: 'Relais Itsandra', ile: 'Grande Comore', nb_commandes: 12, ca_kmf: 1000000, livrees: 10 },
  ],
  evolution: [
    { mois: '2026-01', nb_commandes: 35, nb_clients: 28, ca_kmf: 2400000 },
    { mois: '2026-02', nb_commandes: 38, nb_clients: 30, ca_kmf: 2650000 },
    { mois: '2026-03', nb_commandes: 42, nb_clients: 35, ca_kmf: 2850000 },
    { mois: '2026-04', nb_commandes: 15, nb_clients: 12, ca_kmf: 1200000 },
  ],
};

// ── History ─────────────────────────────────────────────────────────

export const mockHistoryData: HistoryData = {
  nb_mois: 6,
  taux: { eur_kmf: 492, aed_kmf: 134 },
  history: [
    { mois: '2025-11', total_commandes: 28, livrees: 22, ca_kmf: 1800000, ca_eur: 3659 },
    { mois: '2025-12', total_commandes: 35, livrees: 28, ca_kmf: 2200000, ca_eur: 4472 },
    { mois: '2026-01', total_commandes: 30, livrees: 25, ca_kmf: 2400000, ca_eur: 4878 },
    { mois: '2026-02', total_commandes: 38, livrees: 30, ca_kmf: 2650000, ca_eur: 5387 },
    { mois: '2026-03', total_commandes: 42, livrees: 35, ca_kmf: 2850000, ca_eur: 5793 },
    { mois: '2026-04', total_commandes: 15, livrees: 8, ca_kmf: 1200000, ca_eur: 2439 },
  ],
};
