// === OPS Dashboard ===
export interface OpsData {
  date: string;
  pipeline: {
    confirmed: number;
    ordered: number;
    preparation: number;
    shipped: number;
    in_transit: number;
    available: number;
    collected: number;
    cancelled: number;
    total_actif: number;
    total_termine: number;
  };
  today: {
    nouvelles_commandes: number;
    scans_effectues: number;
    collectes: number;
    ca_kmf: number;
  };
  bottlenecks: Bottleneck[];
  hub_dubai: {
    en_preparation: number;
    expedies: number;
    en_transit: number;
  };
}

export interface Bottleneck {
  reference: string;
  status: string;
  jours_bloque: number;
  client: string;
  relais: string;
}

// === FINANCE Dashboard ===
export interface FinanceData {
  period: { start: string; end: string; days: number };
  revenue: {
    ca_kmf: number;
    ca_eur: number;
    taux_eur_kmf: number;
    nb_commandes: number;
    panier_moyen_kmf: number;
    vs_previous: { ca_pct: number; nb_pct: number };
  };
  payments: {
    cash_relais: PaymentMethod;
    stripe_eur: PaymentMethod;
    pending: { count: number; total_kmf: number };
    confirmed: { count: number; total_kmf: number };
  };
  margins: {
    avg_estimated_pct: number;
    avg_real_pct: number;
    gap_pct: number;
    orders_costed: number;
    orders_not_costed: number;
    total_margin_kmf: number;
    transport_kmf: number;
    douane_kmf: number;
    alerts: MarginAlert[];
  };
  monthly_trend: MonthlyTrend[];
}

export interface PaymentMethod {
  count: number;
  total_kmf: number;
  pct: number;
}

export interface MarginAlert {
  reference: string;
  margin_real_pct: number;
  reason: string;
}

export interface MonthlyTrend {
  mois: string;
  ca_kmf: number;
  nb: number;
  marge_pct: number;
}

// === PILOTAGE Dashboard ===
export interface PilotageData {
  kpi: {
    clients_actifs_30j: number;
    clients_nouveaux_30j: number;
    taux_reachat_pct: number;
    taux_livraison_pct: number;
    taux_annulation_pct: number;
    delai_moyen_jours: number;
    nps_score: number | null;
  };
  top_products: TopProduct[];
  top_categories: TopCategory[];
  clients: {
    total: number;
    actifs_30j: number;
    actifs_90j: number;
    top_clients: TopClient[];
  };
  pipeline_health: {
    score: number;
    issues: string[];
  };
  forecast_30j: {
    ca_estime_kmf: number;
    methode: string;
  };
}

export interface TopProduct {
  name: string;
  category: string;
  nb_commandes: number;
  ca_kmf: number;
}

export interface TopCategory {
  category: string;
  nb_commandes: number;
  ca_kmf: number;
  pct_ca: number;
}

export interface TopClient {
  name: string;
  nb_commandes: number;
  ca_kmf: number;
  derniere_commande: string;
}

// === ALERTS ===
export interface Alert {
  type: 'marge_negative' | 'commande_bloquee' | 'anomalie_douane' | 'sourcing_bloque' | 'paiement_attente';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  reference?: string;
  details?: string;
}

// === Tabs ===
export type TabId = 'ops' | 'finance' | 'pilotage' | 'alerts';
