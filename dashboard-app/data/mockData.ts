import { OpsData, FinanceData, PilotageData, Alert } from '../types';

export const mockOpsData: OpsData = {
  date: '2026-04-06',
  pipeline: {
    confirmed: 5,
    ordered: 12,
    preparation: 8,
    shipped: 3,
    in_transit: 7,
    available: 15,
    collected: 234,
    cancelled: 18,
    total_actif: 50,
    total_termine: 252,
  },
  today: {
    nouvelles_commandes: 4,
    scans_effectues: 7,
    collectes: 3,
    ca_kmf: 450000,
  },
  bottlenecks: [
    { reference: 'KOM-20260401-A1B2', status: 'ordered', jours_bloque: 5.2, client: 'Ali Mohamed', relais: 'Relais Moroni Centre' },
    { reference: 'KOM-20260328-C3D4', status: 'preparation', jours_bloque: 4.1, client: 'Fatima Abdou', relais: 'Relais Mutsamudu' },
    { reference: 'KOM-20260330-E5F6', status: 'ordered', jours_bloque: 3.8, client: 'Said Hassan', relais: 'Relais Fomboni' },
  ],
  hub_dubai: {
    en_preparation: 8,
    expedies: 3,
    en_transit: 7,
  },
};

export const mockFinanceData: FinanceData = {
  period: { start: '2026-03-07', end: '2026-04-06', days: 30 },
  revenue: {
    ca_kmf: 12500000,
    ca_eur: 25406,
    taux_eur_kmf: 492.17,
    nb_commandes: 87,
    panier_moyen_kmf: 143678,
    vs_previous: { ca_pct: 12.3, nb_pct: 8.1 },
  },
  payments: {
    cash_relais: { count: 52, total_kmf: 7200000, pct: 57.6 },
    stripe_eur: { count: 35, total_kmf: 5300000, pct: 42.4 },
    pending: { count: 8, total_kmf: 1100000 },
    confirmed: { count: 79, total_kmf: 11400000 },
  },
  margins: {
    avg_estimated_pct: 32.5,
    avg_real_pct: 28.1,
    gap_pct: -4.4,
    orders_costed: 65,
    orders_not_costed: 22,
    total_margin_kmf: 3512000,
    transport_kmf: 2100000,
    douane_kmf: 1450000,
    alerts: [
      { reference: 'KOM-20260320-X1Y2', margin_real_pct: -5.2, reason: 'marge_negative' },
      { reference: 'KOM-20260325-Z3W4', margin_real_pct: -2.8, reason: 'marge_negative' },
    ],
  },
  monthly_trend: [
    { mois: '2026-01', ca_kmf: 9800000, nb: 68, marge_pct: 29.1 },
    { mois: '2026-02', ca_kmf: 10200000, nb: 72, marge_pct: 27.8 },
    { mois: '2026-03', ca_kmf: 11500000, nb: 81, marge_pct: 30.2 },
  ],
};

export const mockPilotageData: PilotageData = {
  kpi: {
    clients_actifs_30j: 45,
    clients_nouveaux_30j: 12,
    taux_reachat_pct: 34.2,
    taux_livraison_pct: 92.8,
    taux_annulation_pct: 7.2,
    delai_moyen_jours: 8.5,
    nps_score: null,
  },
  top_products: [
    { name: 'Robe Cérémonie', category: 'ceremony', nb_commandes: 23, ca_kmf: 3450000 },
    { name: 'Parfum Dubai Gold', category: 'beauty', nb_commandes: 18, ca_kmf: 2700000 },
    { name: 'Encens Oud Premium', category: 'beauty', nb_commandes: 15, ca_kmf: 1875000 },
    { name: 'Abaya Brodée', category: 'ceremony', nb_commandes: 12, ca_kmf: 1800000 },
    { name: 'Montre Sport', category: 'accessories', nb_commandes: 9, ca_kmf: 1350000 },
  ],
  top_categories: [
    { category: 'ceremony', nb_commandes: 45, ca_kmf: 6750000, pct_ca: 54.0 },
    { category: 'beauty', nb_commandes: 33, ca_kmf: 4575000, pct_ca: 36.6 },
    { category: 'accessories', nb_commandes: 9, ca_kmf: 1175000, pct_ca: 9.4 },
  ],
  clients: {
    total: 120,
    actifs_30j: 45,
    actifs_90j: 78,
    top_clients: [
      { name: 'Ali Mohamed', nb_commandes: 8, ca_kmf: 1200000, derniere_commande: '2026-04-03' },
      { name: 'Fatima Abdou', nb_commandes: 6, ca_kmf: 900000, derniere_commande: '2026-04-05' },
      { name: 'Youssouf Said', nb_commandes: 5, ca_kmf: 750000, derniere_commande: '2026-03-28' },
    ],
  },
  pipeline_health: {
    score: 78,
    issues: [
      "12 commandes en 'ordered' depuis > 3 jours",
      'Taux d\'annulation en hausse (+2.1% vs mois précédent)',
    ],
  },
  forecast_30j: {
    ca_estime_kmf: 13500000,
    methode: 'moyenne_mobile_3m',
  },
};

export const mockAlerts: Alert[] = [
  { type: 'marge_negative', severity: 'critical', message: 'Marge négative détectée', reference: 'KOM-20260320-X1Y2', details: 'Marge réelle: -5.2%' },
  { type: 'marge_negative', severity: 'critical', message: 'Marge négative détectée', reference: 'KOM-20260325-Z3W4', details: 'Marge réelle: -2.8%' },
  { type: 'commande_bloquee', severity: 'warning', message: 'Commande bloquée depuis 5.2 jours', reference: 'KOM-20260401-A1B2', details: 'Status: ordered — Client: Ali Mohamed' },
  { type: 'commande_bloquee', severity: 'warning', message: 'Commande bloquée depuis 4.1 jours', reference: 'KOM-20260328-C3D4', details: 'Status: preparation — Client: Fatima Abdou' },
  { type: 'commande_bloquee', severity: 'warning', message: 'Commande bloquée depuis 3.8 jours', reference: 'KOM-20260330-E5F6', details: 'Status: ordered — Client: Said Hassan' },
  { type: 'paiement_attente', severity: 'warning', message: '8 paiements en attente', details: 'Total: 1 100 000 KMF — depuis > 7 jours' },
  { type: 'anomalie_douane', severity: 'info', message: 'Coûts douane élevés ce mois', details: '1 450 000 KMF — vérifier les tarifs appliqués' },
];
