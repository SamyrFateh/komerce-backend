// Komerce Dashboard — Shared Types

// ── Reusable sub-types ──────────────────────────────────────────────

export interface LogistiqueItem {
  reference: string;
  status: string;
  jours: number;
  destinataire?: string;
  relais_nom?: string;
  heures_en_attente?: number;
}

export interface LogistiqueStep {
  count: number;
  items: LogistiqueItem[];
  label: string;
}

export interface Order {
  id: string;
  reference: string;
  status: string;
  total_kmf: number;
  payment_mode: string;
  payment_status: string;
  created_at: string;
  client_name: string;
  recipient_name: string;
  relais_name: string;
  product_name: string;
  items_count: number;
  age_jours: number;
  inactif_jours: number;
}

export interface RelaisInfo {
  relais: string;
  ile: string;
  nb_commandes: number;
  ca_kmf: number;
  livrees: number;
}

export interface ClientInfo {
  name: string;
  phone: string;
  nb_commandes: number;
  ca_kmf: number;
  derniere_commande: string;
}

export interface TopProduit {
  nom: string;
  name?: string;
  categorie: string;
  qty: number;
  ca_kmf: number;
  nb_commandes?: number;
}

export interface CategoryInfo {
  categorie: string;
  nb_commandes: number;
  nb_articles?: number;
  ca_kmf: number;
  pct_ca?: number;
  marge_kmf?: number;
  taux_marge?: number;
}

export interface EvolutionMonth {
  mois: string;
  nb_commandes: number;
  nb_clients: number;
  ca_kmf: number;
}

export interface HistoryMonth {
  mois: string;
  total_commandes: number;
  livrees: number;
  ca_kmf: number;
  ca_eur: number;
}

export interface RetardClient {
  reference: string;
  status: string;
  client_nom: string;
  client_phone: string;
  client_email: string;
  jours_retard: number;
  compensation: string;
  sms_suggere: string;
}

// ── Product & Order statuses ───────────────────────────────────────

export type ProductStatus =
  | 'complet'
  | 'incomplet'
  | 'retard'
  | 'defectueux'
  | 'annule'
  | 'hors_stock'
  | 'en_attente';

export interface OrderProduct {
  nom: string;
  quantite: number;
  prix_kmf: number;
  status: ProductStatus;
  note?: string;
}

export type OrderGlobalStatus =
  | 'tous_complets'
  | 'partiel'
  | 'bloque'
  | 'annule';

export interface HubOrder {
  reference: string;
  client_nom: string;
  produits: OrderProduct[];
  total_kmf: number;
  date_commande: string;
  jours: number;
  fournisseur?: string;
  poids_kg?: number;
  priorite?: 'normale' | 'urgente';
  note?: string;
}

export interface HubData {
  a_receptionner: HubOrder[];
  a_emballer: HubOrder[];
  a_expedier: HubOrder[];
}

export interface RelaisOrder {
  reference: string;
  client_nom: string;
  client_phone: string;
  produits: OrderProduct[];
  total_kmf: number;
  payment_mode: 'cash_relais' | 'stripe';
  payment_status: 'paid' | 'pending';
  date_arrivee: string;
  heures_attente: number;
  relais_nom: string;
  ile: string;
  priorite?: 'normale' | 'urgente';
  note?: string;
}

export interface RelaisOrderData {
  a_valider: RelaisOrder[];
  a_remettre: RelaisOrder[];
}

// ── Endpoint data shapes ────────────────────────────────────────────

export interface OpsData {
  activite: {
    commandes_aujourd_hui: number;
    commandes_en_cours: number;
    commandes_bloquees: number;
    livrees_aujourd_hui: number;
    livrees_30j: number;
  };
  sla: {
    on_time: number;
    warning: number;
    late: number;
    blocked: number;
    details: {
      late: { reference: string; status: string; jours: number }[];
    };
  };
  logistique: {
    dubai_reception: LogistiqueStep;
    dubai_expedition: LogistiqueStep;
    transitaire: LogistiqueStep;
    bateau: LogistiqueStep;
    anjouan: LogistiqueStep;
  };
  delais: {
    avg_preparation_jours: number;
    avg_livraison_totale_jours: number;
  };
  alertes: {
    cash_pending: number;
    anomalies: number;
    low_stock: number;
  };
}

export interface FinanceData {
  period: number;
  taux: { eur_kmf: number; aed_kmf: number };
  kpi: {
    ca_kmf: number;
    ca_eur: number;
    nb_commandes: number;
    nb_livrees: number;
    nb_annulees: number;
    panier_moyen_kmf: number;
    evolution: { ca_pct: number; cmd_pct: number };
  };
  paiements: {
    cash: { count: number; total_kmf: number };
    stripe: { count: number; total_eur: number };
  };
  marges: {
    marge_reelle_kmf: number;
    cout_logistique_kmf: number;
    taux_marge_pct: number;
    nb_avec_cost: number;
    nb_sans_cost: number;
    alertes_perte: { count: number; refs: string[] };
  };
  par_categorie: CategoryInfo[];
  top_produits: TopProduit[];
}

export interface PilotageData {
  periode: string;
  taux: { eur_kmf: number; aed_kmf: number };
  taux_history: { eur_kmf: number; aed_kmf: number; valid_from: string }[];
  volume: {
    total: number;
    livrees: number;
    annulees: number;
    en_cours: number;
  };
  ca: {
    total_kmf: number;
    total_eur: number;
    cash_kmf: number;
    stripe_kmf: number;
  };
  categories: CategoryInfo[];
  couts: {
    taux_terrain_pct: number;
    source_taux: string;
    hub_fixe_mensuel_kmf: number;
  };
  pipeline: { statut: string; nb: number }[];
}

export interface PipelineData {
  total: number;
  active: number;
  pipeline: {
    confirmed: { count: number; orders: Order[] };
    ordered: { count: number; orders: Order[] };
    preparation: { count: number; orders: Order[] };
    shipped: { count: number; orders: Order[] };
    in_transit: { count: number; orders: Order[] };
    available: { count: number; orders: Order[] };
    collected: { count: number; orders: Order[] };
    cancelled: { count: number; orders: Order[] };
    refunded: { count: number; orders: Order[] };
  };
}

export interface RetardsData {
  total: number;
  par_niveau: {
    remboursement_possible: { count: number; label: string };
    remise_10pct_prochaine_cmd: { count: number; label: string };
    avoir_5pct: { count: number; label: string };
    contact_preventif: { count: number; label: string };
  };
  clients: RetardClient[];
}

export interface ForecastData {
  target_date: string;
  days_remaining: number;
  realise_kmf: number;
  modele: {
    ref_period_jours: number;
    avg_ca_jour: number;
    stddev: number;
  };
  projection: {
    pessimiste: number;
    attendu: number;
    optimiste: number;
  };
}

export interface ClientsData {
  periode: { debut: string; fin: string };
  kpi: {
    nb_clients: number;
    commandes_valides: number;
    ca_total_kmf: number;
    panier_moyen_kmf: number;
    clients_recurrents: number;
    taux_recurrence_pct: number;
  };
  top_clients: ClientInfo[];
  top_produits: TopProduit[];
  par_relais: RelaisInfo[];
  evolution: EvolutionMonth[];
}

export interface HistoryData {
  nb_mois: number;
  taux: { eur_kmf: number; aed_kmf: number };
  history: HistoryMonth[];
}
