/* ===================================================================
   Komerce Platform — ct-platform.js
   Rôles · Shells · View Registry · Contrats
   v1.0 — Architecture CT / BO
   =================================================================== */
window.CT = window.CT || {};

CT.platform = {

  /* ─── ROLES ──────────────────────────────────────────────────── */
  ROLES: {
    founder:  { label: 'Fondateur',      level: 100, shells: ['ct','bo'], canConfig: true  },
    admin:    { label: 'Administrateur', level: 90,  shells: ['ct','bo'], canConfig: true  },
    finance:  { label: 'Finance',        level: 50,  shells: ['ct','bo'], canConfig: false },
    sourcing: { label: 'Sourcing',       level: 50,  shells: ['ct','bo'], canConfig: false },
    hub:      { label: 'Agent Hub',      level: 30,  shells: ['bo'],      canConfig: false },
    relais:   { label: 'Agent Relais',   level: 30,  shells: ['bo'],      canConfig: false },
    support:  { label: 'Support Client', level: 30,  shells: ['bo'],      canConfig: false }
  },

  /* ─── SHELLS ─────────────────────────────────────────────────── */
  SHELLS: {
    ct: {
      id: 'ct',
      label: 'Tour de Contrôle',
      shortLabel: 'CT',
      emoji: '🗼',
      accent: '#3b82f6',
      accentBg: '#1e3a5f',
      description: 'Signal · Synthèse · Arbitrage · Décision'
    },
    bo: {
      id: 'bo',
      label: 'Back Office',
      shortLabel: 'BO',
      emoji: '🗄️',
      accent: '#0d9488',
      accentBg: '#134e4a',
      description: 'Traitement · Mise à jour · Exécution'
    }
  },

  /* ─── SECTIONS ───────────────────────────────────────────────── */
  SECTIONS: {
    /* CT */
    cockpit:    { label: 'Cockpit',    order: 1, shell: 'ct' },
    pilotage:   { label: 'Pilotage',   order: 2, shell: 'ct' },
    strategie:  { label: 'Stratégie',  order: 3, shell: 'ct' },
    /* BO */
    operations: { label: 'Opérations',    order: 1, shell: 'bo' },
    logistique: { label: 'Logistique',    order: 2, shell: 'bo' },
    catalogue:  { label: 'Catalogue',     order: 3, shell: 'bo' },
    finance_bo: { label: 'Finance',       order: 4, shell: 'bo' },
    config:     { label: 'Configuration', order: 5, shell: 'bo' }
  },

  /* ─── VIEW REGISTRY ──────────────────────────────────────────── */
  VIEWS: [

    /* ══════ CT : Cockpit ══════ */
    {
      id:    'dashboard',
      shell: 'ct',  section: 'cockpit',
      emoji: '🎯',  label:   'Dashboard',
      roles: ['founder','admin','finance'],
      tabs:  ['overview','revenue','operations'],
      supportedFilters: ['period'],
      readOnly: ['finance']                      // finance = lecture seule
    },
    {
      id:    'action-center',
      shell: 'ct',  section: 'cockpit',
      emoji: '⚡',  label:   'Centre d\'actions',
      roles: ['founder','admin'],
      tabs:  ['all','ops','eco','sourcing','disputes'],
      supportedFilters: ['severity','owner_role'],
      readOnly: []
    },
    {
      id:    'problems',
      shell: 'ct',  section: 'cockpit',
      emoji: '🚨',  label:   'Problèmes',
      roles: ['founder','admin'],
      tabs:  [],
      supportedFilters: ['type','severity'],
      readOnly: []
    },

    /* ══════ CT : Pilotage ══════ */
    {
      id:    'pilotage',
      shell: 'ct',  section: 'pilotage',
      emoji: '📊',  label:   'Pilotage Stratégique',
      roles: ['founder','admin','finance'],
      tabs:  ['temporal','categories','ops'],
      supportedFilters: ['period','category'],
      readOnly: ['finance']
    },

    /* ══════ CT : Stratégie ══════ */
    {
      id:    'economic',
      shell: 'ct',  section: 'strategie',
      emoji: '🧠',  label:   'Modèle économique',
      roles: ['founder','admin','finance'],
      tabs:  ['executive','variables','charges','coherence'],
      supportedFilters: [],
      readOnly: ['finance']
    },
    {
      id:    'pricing',
      shell: 'ct',  section: 'strategie',
      emoji: '🧮',  label:   'Pricing',
      roles: ['founder','admin','finance','sourcing'],
      tabs:  ['unit','mass','customs','config'],
      supportedFilters: ['category'],
      readOnly: ['finance','sourcing']
    },
    {
      id:    'sourcing',
      shell: 'ct',  section: 'strategie',
      emoji: '🔍',  label:   'Intelligence Sourcing',
      roles: ['founder','admin','sourcing'],
      tabs:  ['portfolio','opportunities','risks'],
      supportedFilters: ['category','rail'],
      readOnly: []
    },

    /* ══════ BO : Opérations ══════ */
    {
      id:    'orders',
      shell: 'bo',  section: 'operations',
      emoji: '📋',  label:   'Commandes',
      roles: ['founder','admin','hub','relais','support'],
      tabs:  [],
      supportedFilters: ['status','date','client','search'],
      readOnly: []
    },
    {
      id:    'parcels',
      shell: 'bo',  section: 'operations',
      emoji: '📦',  label:   'Colis',
      roles: ['founder','admin','hub','relais','support'],
      tabs:  [],
      supportedFilters: ['status','island','relay','search'],
      readOnly: []
    },

    /* ══════ BO : Logistique ══════ */
    {
      id:    'hub',
      shell: 'bo',  section: 'logistique',
      emoji: '🏭',  label:   'Hub Dubai',
      roles: ['founder','admin','hub'],
      tabs:  [],
      supportedFilters: ['status'],
      readOnly: []
    },
    {
      id:    'transitaire',
      shell: 'bo',  section: 'logistique',
      emoji: '🚢',  label:   'Transitaire',
      roles: ['founder','admin'],
      tabs:  [],
      supportedFilters: ['status','date'],
      readOnly: []
    },
    {
      id:    'relais',
      shell: 'bo',  section: 'logistique',
      emoji: '📍',  label:   'Relais Comores',
      roles: ['founder','admin','relais'],
      tabs:  [],
      supportedFilters: ['island','status'],
      readOnly: []
    },

    /* ══════ BO : Catalogue ══════ */
    {
      id:    'inventory',
      shell: 'bo',  section: 'catalogue',
      emoji: '📦',  label:   'Inventaire',
      roles: ['founder','admin','sourcing'],
      tabs:  [],
      supportedFilters: ['category','status','search'],
      readOnly: []
    },

    /* ══════ BO : Finance ══════ */
    {
      id:    'finances',
      shell: 'bo',  section: 'finance_bo',
      emoji: '💰',  label:   'Finances',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['period','type'],
      readOnly: []
    },
    {
      id:    'invoices',
      shell: 'bo',  section: 'finance_bo',
      emoji: '🧾',  label:   'Factures',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['status','date','search'],
      readOnly: []
    },
    {
      id:    'reconciliation',
      shell: 'bo',  section: 'finance_bo',
      emoji: '⚖️',  label:   'Réconciliation',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['status','period'],
      readOnly: []
    },

    /* ══════ BO : Configuration ══════ */
    {
      id:    'settings',
      shell: 'bo',  section: 'config',
      emoji: '⚙️',  label:   'Paramètres',
      roles: ['founder','admin'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'simulator',
      shell: 'bo',  section: 'config',
      emoji: '🤖',  label:   'Simulateur Flux',
      roles: ['founder','admin'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    }
  ],

  /* Legacy views — accessible par URL mais pas dans sidebar */
  LEGACY_VIEWS: ['alerts','incidents','previsions'],

  /* ─── STATE ──────────────────────────────────────────────────── */
  state: {
    shell: 'ct',
    role:  'founder',
    user:  null
  },

  /* ═══════════════════════════════════════════════════════════════
     METHODS
     ═══════════════════════════════════════════════════════════════ */

  resolveRole: function(user) {
    if (!user) return 'founder';
    var r = user.role || 'founder';
    return CT.platform.ROLES[r] ? r : 'founder';
  },

  getShellsForRole: function(role) {
    var r = CT.platform.ROLES[role || 'founder'];
    return r ? r.shells.slice() : ['bo'];
  },

  canAccessShell: function(shell, role) {
    return CT.platform.getShellsForRole(role).indexOf(shell) !== -1;
  },

  /* Return views for a given shell + role, ordered by section */
  getViewsForShell: function(shell, role) {
    return CT.platform.VIEWS.filter(function(v) {
      return v.shell === shell && v.roles.indexOf(role) !== -1;
    });
  },

  /* Return ordered sections that have ≥1 visible view */
  getSectionsForShell: function(shell, role) {
    var viewsBySection = {};
    CT.platform.getViewsForShell(shell, role).forEach(function(v) {
      viewsBySection[v.section] = true;
    });
    return Object.keys(CT.platform.SECTIONS)
      .filter(function(k) { return CT.platform.SECTIONS[k].shell === shell && viewsBySection[k]; })
      .map(function(k) { return { id: k, label: CT.platform.SECTIONS[k].label, order: CT.platform.SECTIONS[k].order }; })
      .sort(function(a, b) { return a.order - b.order; });
  },

  /* Access check — view × role */
  canAccess: function(viewId, role) {
    if (CT.platform.LEGACY_VIEWS.indexOf(viewId) !== -1) {
      return role === 'founder' || role === 'admin';
    }
    var v = CT.platform.getView(viewId);
    return v ? v.roles.indexOf(role) !== -1 : false;
  },

  /* Read-only check — view × role */
  isReadOnly: function(viewId, role) {
    var v = CT.platform.getView(viewId);
    return v && v.readOnly && v.readOnly.indexOf(role) !== -1;
  },

  /* Get view definition by id */
  getView: function(viewId) {
    return CT.platform.VIEWS.find(function(v) { return v.id === viewId; }) || null;
  },

  /* Default view for a shell + role */
  getDefaultView: function(shell, role) {
    var views = CT.platform.getViewsForShell(shell, role);
    return views.length > 0 ? views[0].id : null;
  },

  /* Which shell owns a view? */
  shellForView: function(viewId) {
    var v = CT.platform.getView(viewId);
    return v ? v.shell : null;
  },

  /* Switch shell — updates state + triggers UI rebuild */
  setShell: function(shell) {
    var role = CT.platform.state.role;
    if (!CT.platform.canAccessShell(shell, role)) return;
    CT.platform.state.shell = shell;
    CT.app.renderShellSwitcher();
    CT.app.renderSidebar();
    var dv = CT.platform.getDefaultView(shell, role);
    if (dv) CT.app.navigate(dv);
  },

  /* ─── DRILL-DOWN CONTRACT (Phase 2 — stub) ──────────────────── */
  /*
    Params: {
      shell:       'ct' | 'bo',
      view:        string,
      tab:         string | null,
      section:     string | null,
      filters:     { key: value, ... },
      highlightId: string | null,
      origin:      { shell, view } | null,
      returnTo:    { shell, view, tab } | null
    }
  */
  drillDown: function(params) {
    if (!params || !params.view) return;
    var targetShell = params.shell || CT.platform.shellForView(params.view);
    if (targetShell && targetShell !== CT.platform.state.shell) {
      CT.platform.state.shell = targetShell;
      CT.app.renderShellSwitcher();
      CT.app.renderSidebar();
    }
    CT.app.navigate(params.view, params);
  },

  /* ─── SIGNAL TYPES (Phase 3 — schema) ───────────────────────── */
  SIGNAL_TYPES: {
    parcel_blocked:    { label: 'Colis bloqué',         family: 'ops',      owner: 'hub'     },
    cash_expiring:     { label: 'Cash expirant',        family: 'ops',      owner: 'relais'  },
    stock_rupture:     { label: 'Rupture stock',        family: 'ops',      owner: 'sourcing'},
    sla_breach:        { label: 'SLA dépassé',          family: 'ops',      owner: 'support' },
    margin_drift:      { label: 'Dérive marge',         family: 'eco',      owner: 'finance' },
    pricing_outlier:   { label: 'Prix aberrant',        family: 'eco',      owner: 'finance' },
    dispute_sensitive: { label: 'Litige sensible',      family: 'disputes', owner: 'support' },
    sourcing_arbitrage:{ label: 'Sourcing à arbitrer',  family: 'sourcing', owner: 'sourcing'},
    product_dead:      { label: 'Produit mort',         family: 'sourcing', owner: 'sourcing'},
    product_star:      { label: 'Produit star',         family: 'sourcing', owner: 'sourcing'},
    category_drift:    { label: 'Catégorie en dérive',  family: 'eco',      owner: 'admin'   },
    hub_tension:       { label: 'Tension hub',          family: 'ops',      owner: 'hub'     },
    relay_tension:     { label: 'Tension relais',       family: 'ops',      owner: 'relais'  },
    recon_anomaly:     { label: 'Anomalie réconcil.',   family: 'eco',      owner: 'finance' },
    loyalty_pending:   { label: 'Fidélité en attente',  family: 'ops',      owner: 'admin'   }
  },

  SEVERITIES: ['info','warning','critical','urgent'],

  /* ─── VISUAL CONVENTION O/C/P/R (Phase 5 — schema) ──────────── */
  DATA_NATURES: {
    observed:    { badge: null,   css: 'kn-observed',    label: null,         tip: 'Donnée réelle terrain',     color: 'inherit'  },
    calculated:  { badge: 'calc', css: 'kn-calculated',  label: 'Calculé',    tip: 'Agrégation calculée',       color: '#3b82f6'  },
    projected:   { badge: 'proj', css: 'kn-projected',   label: 'Projeté',    tip: 'Projection / scénario',     color: '#f59e0b'  },
    recommended: { badge: 'reco', css: 'kn-recommended', label: 'Recommandé', tip: 'Suggestion du moteur',      color: '#10b981'  }
  }
};
