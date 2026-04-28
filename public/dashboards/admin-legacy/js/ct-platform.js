/* ===================================================================
   Komerce Platform — ct-platform.js
   Rôles · Shells · View Registry · Contrats
   v1.0 — Architecture CT / BO
   =================================================================== */
window.CT = window.CT || {};

CT.platform = {

  /* ─── FEATURE FLAGS (Lot B — doctrine économique) ────────────── */
  /* Désactive les modules pricing avancés : strategy, benchmarks, élasticité,
   * apply-all massif. Le code reste en place mais les UI sont cachées.
   * Pour réactiver : passer le flag à true.
   * Doctrine §3 : on n'automatise pas, l'admin décide. */
  FEATURES: {
    pricing_strategy:    false,  // ct-views-pricing-strategy.js (élasticité, loss leader, etc.)
    pricing_benchmarks:  false,  // section "manques sectoriels" dans l'Atelier
    pricing_apply_all:   false,  // bouton "Tout appliquer" dans le catalogue
    economic_full:       false,  // onglets Variables/Charges/Cohérence du Modèle économique (legacy)
  },

  /** Helper pour lire un flag avec fallback. Utilisable depuis n'importe quelle vue. */
  isFeatureEnabled: function(flagName) {
    return Boolean(this.FEATURES && this.FEATURES[flagName]);
  },

  /* ─── ROLES ──────────────────────────────────────────────────── */
  ROLES: {
    super_admin: { label: 'Super Admin',    level: 110, shells: ['ct','bo'], canConfig: true  },
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
  /* LOT E : navigation alignée doctrine en 3 sections cibles :
       - pilotage_op            → "Que doit-on traiter aujourd'hui ?"
       - atelier_prix_sourcing  → "Quoi vendre, à quel prix, faut-il sourcer ?"
       - sante_eco              → "Le modèle tient-il ?"
     Les anciennes sections (cockpit, pilotage_fin, strategie) restent
     déclarées en deprecated pour ne pas casser les anciens URL hash. */
  SECTIONS: {
    /* CT — Sections cibles Lot E */
    pilotage_op:           { label: '📦 Pilotage Opérationnel',  order: 1, shell: 'ct' },
    atelier_prix_sourcing: { label: '🏷️ Atelier Prix & Sourcing', order: 2, shell: 'ct' },
    sante_eco:             { label: '💰 Santé Économique',        order: 3, shell: 'ct' },

    /* CT — Sections deprecated (conservées pour les liens existants) */
    cockpit:       { label: 'Cockpit (legacy)',     order: 91, shell: 'ct', deprecated: true },
    pilotage_fin:  { label: 'Pilotage Fin (legacy)', order: 92, shell: 'ct', deprecated: true },
    strategie:     { label: 'Stratégie (legacy)',   order: 93, shell: 'ct', deprecated: true },
    pilotage:      { label: 'Pilotage (legacy)',    order: 94, shell: 'ct', deprecated: true },

    /* BO — inchangé */
    operations: { label: 'Opérations',    order: 1, shell: 'bo' },
    alerting:   { label: 'Alertes',       order: 2, shell: 'bo' },
    finance_bo: { label: 'Finance',       order: 3, shell: 'bo' },
    config:     { label: 'Configuration', order: 4, shell: 'bo' }
  },

  /* ─── VIEW REGISTRY ────────────────────────────────────────────
     ⚠️  Chaque id DOIT correspondre à un CT.views[id] existant.
     Vues non implémentées → PLANNED_VIEWS (pas dans sidebar).
     ─────────────────────────────────────────────────────────── */
  VIEWS: [

    /* ══════ CT : 📦 PILOTAGE OPÉRATIONNEL ══════
       "Que doit-on traiter aujourd'hui ?" — orders, parcels, shipments, alertes.
       Vues : SLA & Pipeline, Centre d'actions, Problèmes, et Santé Business
       (qui dit si la machine peut tenir). */
    {
      id:    'pilotage_op',
      shell: 'ct',  section: 'pilotage_op',
      emoji: '🚦',  label:   'Vue Aujourd\'hui',
      roles: ['founder','admin','hub','support'],
      tabs:  [],
      supportedFilters: ['period'],
      readOnly: ['support']
    },
    {
      id:    'sante',
      shell: 'ct',  section: 'pilotage_op',
      emoji: '🏥',  label:   'Santé Business',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: [],
      readOnly: ['finance']
    },
    {
      id:    'actionCenter',
      shell: 'ct',  section: 'pilotage_op',
      emoji: '⚡',  label:   'Alertes & Incidents',
      roles: ['founder','admin'],
      tabs:  ['all','ops','eco','sourcing','disputes'],
      supportedFilters: ['severity','owner_role'],
      readOnly: []
    },
    {
      id:    'problems',
      shell: 'ct',  section: 'pilotage_op',
      emoji: '🚨',  label:   'Problèmes',
      roles: ['founder','admin'],
      tabs:  [],
      supportedFilters: ['type','severity'],
      readOnly: []
    },
    {
      id:    'dashboard',
      shell: 'ct',  section: 'pilotage_op',
      emoji: '🎯',  label:   'Dashboard global',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['period'],
      readOnly: ['finance'],
      hidden: true,  // P7 : masqué dans la nav (mode expert) — accessible via URL hash
    },

    /* ══════ CT : Pilotage (LEGACY — mégavue ADR-008) ══════ */
    {
      id:    'pilotage',
      shell: 'ct',  section: 'pilotage',
      emoji: '📊',  label:   'Pilotage (legacy)',
      roles: [],  // [] → personne ne la voit dans la sidebar (mais l'URL marche)
      tabs:  ['temporal','categories','ops'],
      supportedFilters: ['period','category'],
      readOnly: ['finance']
    },

    /* ══════ CT : 💰 SANTÉ ÉCONOMIQUE ══════
       "Le modèle tient-il ?" — CA, marges, contribution, seuil de rentabilité,
       écarts terrain. Cette section consomme economic-engine + cost-allocation. */
    {
      id:    'economic',
      shell: 'ct',  section: 'sante_eco',
      emoji: '📊',  label:   'Santé Globale',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: [],
      readOnly: ['finance']
    },
    {
      id:    'pilotage_fin',
      shell: 'ct',  section: 'sante_eco',
      emoji: '💸',  label:   'Projection & Mix',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['period','category'],
      readOnly: ['finance'],
      hidden: true,  // P7 : masqué dans la nav (mode expert)
    },

    /* ══════ CT : 🏷️ ATELIER PRIX & SOURCING ══════
       "Quoi vendre, à quel prix, faut-il sourcer ?" — Pricing, Sourcing,
       Scanner Catalogue Fournisseur. */
    {
      id:    'pricing',
      shell: 'ct',  section: 'atelier_prix_sourcing',
      emoji: '🧮',  label:   'Construction du Prix',
      roles: ['founder','admin','finance','sourcing'],
      tabs:  [],
      supportedFilters: ['category'],
      readOnly: ['finance','sourcing']
    },
    {
      id:    'sourcing',
      shell: 'ct',  section: 'atelier_prix_sourcing',
      emoji: '🔍',  label:   'Intelligence Sourcing',
      roles: ['founder','admin','sourcing'],
      tabs:  ['portfolio','opportunities','risks'],
      supportedFilters: ['category','rail'],
      readOnly: []
    },
    {
      id:    'sourcing_scanner',
      shell: 'ct',  section: 'atelier_prix_sourcing',
      emoji: '📡',  label:   'Scanner Catalogue Fournisseur',
      roles: ['founder','admin','sourcing'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'pricing_workshop',
      shell: 'ct',  section: 'atelier_prix_sourcing',
      emoji: '⚙️',  label:   'Configuration des coûts',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: [],
      readOnly: ['finance'],
      hidden: true,  // accessible via le bouton "Configurer les composants" depuis Construction du prix
    },
    /* DÉSACTIVÉ avril 2026 — Option A.
       La fonction "Stratégie de prix" est couverte par cost_components
       (scope, channel, island) + l'Atelier dual mode. Le code reste sur
       disque pour rollback éventuel mais n'est ni chargé ni accessible.
    {
      id:    'pricing_strategy',
      shell: 'ct',  section: 'atelier_prix_sourcing',
      emoji: '💰',  label:   'Stratégie de prix',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: [],
      readOnly: ['finance'],
      hidden: true,
      featureFlag: 'FEATURE_PRICING_STRATEGY',
    },
    */

    /* ══════ BO : Opérations ══════ */
    {
      id:    'orders',
      shell: 'bo',  section: 'operations',
      emoji: '📋',  label:   'Commandes & Colis',
      roles: ['founder','admin','hub','relais','support'],
      tabs:  ['all','free','parceled','parcels'],
      supportedFilters: ['status','date','client','search'],
      readOnly: []
    },
    {
      id:    'pendingCash',
      shell: 'bo',  section: 'operations',
      emoji: '💰',  label:   'Paiements cash',
      roles: ['founder','admin','relais'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'createParcel',
      shell: 'bo',  section: 'operations',
      emoji: '📦',  label:   'Créer colis',
      roles: ['founder','admin','hub'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },

    /* ══════ BO : Alertes ══════ */
    {
      id:    'alerts',
      shell: 'bo',  section: 'alerting',
      emoji: '⚠️',  label:   'Alertes',
      roles: ['founder','admin','hub','support'],
      tabs:  [],
      supportedFilters: ['severity'],
      readOnly: []
    },
    {
      id:    'incidents',
      shell: 'bo',  section: 'alerting',
      emoji: '🔥',  label:   'Incidents',
      roles: ['founder','admin','hub','support'],
      tabs:  [],
      supportedFilters: ['severity','status'],
      readOnly: []
    },

    /* ══════ BO : Finance ══════ */
    /* Note: 'finances' a été retirée du registry (ADR-007 hygiène).
       Sa fonction est couverte par Comptabilité (CA, marges) + Dashboard
       (KPI temps réel) + Sales (panier moyen, top clients).
       Le code reste dans ct-views-v7.js pour ne pas casser les routes legacy. */
    {
      id:    'invoices',
      shell: 'bo',  section: 'finance_bo',
      emoji: '🧾',  label:   'Factures',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['status','date','search'],
      readOnly: []
    },
    /* Note: 'reconciliation' (réconciliation des COLIS bloqués/warning/OK)
       a été déplacée vers Opérations sous le nom 'parcel_reconciliation'.
       La VRAIE réconciliation cash (Attendu/Collecté/Déposé par agent)
       est dans la vue Comptabilité (ADR-003). */

    /* ══════ CT : Ventes (rattaché à Santé Éco — Lot E) ══════ */
    {
      id:    'sales',
      shell: 'ct',  section: 'sante_eco',
      emoji: '💰',  label:   'Ventes',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['period'],
      readOnly: ['finance'],
      hidden: true,  // P7 : masqué dans la nav (mode expert) — Santé Économique suffit
    },

    /* ══════ BO : Hub ══════ */
    {
      id:    'hub',
      shell: 'bo',  section: 'operations',
      emoji: '🏭',  label:   'Hub Dubai',
      roles: ['founder','admin','hub'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'relais',
      shell: 'bo',  section: 'operations',
      emoji: '📦',  label:   'Relais',
      roles: ['founder','admin','relais'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'transitaire',
      shell: 'bo',  section: 'operations',
      emoji: '🚢',  label:   'Transitaire',
      roles: ['founder','admin','hub'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'inventory',
      shell: 'bo',  section: 'operations',
      emoji: '📋',  label:   'Inventaire',
      roles: ['founder','admin','hub'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    /* DÉSACTIVÉ avril 2026 — vue parcel_reconciliation jamais implémentée.
       L'entrée fait référence à un CT.views.parcel_reconciliation qui n'existe pas.
       Cliquer dessus dans le menu ferait planter avec "Vue introuvable".
       Si tu veux réactiver, code la vue d'abord puis décommente.
    {
      id:    'parcel_reconciliation',
      shell: 'bo',  section: 'operations',
      emoji: '⚖️',  label:   'Colis à réconcilier',
      roles: ['founder','admin','hub','support'],
      tabs:  [],
      supportedFilters: ['status'],
      readOnly: []
    },
    */

    /* ══════ BO : Finance ══════ */
    {
      id:    'accounting',
      shell: 'bo',  section: 'finance_bo',
      emoji: '📊',  label:   'Comptabilité',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['period'],
      readOnly: []
    },
    {
      id:    'customs',
      shell: 'bo',  section: 'finance_bo',
      emoji: '📦',  label:   'Historique Douane',
      roles: ['founder','admin','finance'],
      tabs:  [],
      supportedFilters: ['period'],
      readOnly: []
    },

    /* ══════ BO : Configuration ══════ */
    {
      id:    'suppliers',
      shell: 'bo',  section: 'config',
      emoji: '🏭',  label:   'Fournisseurs',
      roles: ['founder','admin','sourcing'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
    {
      id:    'shared_carts',
      shell: 'bo',  section: 'operations',
      emoji: '🤝',  label:   'Paniers Partagés',
      roles: ['founder','admin','support'],
      tabs:  [],
      supportedFilters: [],
      readOnly: []
    },
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
    },

    /* ══════ CT : Clients (CRM analytique) ══════ */
    {
      id:    'clients',
      shell: 'ct',  section: 'pilotage_fin',
      emoji: '👥',  label:   'Clients',
      roles: ['founder','admin','finance','support'],
      tabs:  [],
      supportedFilters: ['period','island','segment'],
      readOnly: ['finance','support']
    }
  ],

  /* Vues prévues mais pas encore implémentées — documentées ici */
  PLANNED_VIEWS: [],

  /* Legacy views — accessible par URL mais pas dans sidebar */
  LEGACY_VIEWS: ['previsions'],

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
    var raw = String(user.role || 'founder').trim().toLowerCase();
    var aliases = {
      superadmin: 'super_admin',
      'super-admin': 'super_admin',
      super_admin: 'super_admin',
      founder: 'founder',
      admin: 'admin',
      finance: 'finance',
      sourcing: 'sourcing',
      hub: 'hub',
      relais: 'relais',
      support: 'support'
    };
    var r = aliases[raw] || raw;
    return CT.platform.ROLES[r] ? r : 'founder';
  },

  normalizeRole: function(role) {
    return CT.platform.resolveRole({ role: role });
  },

  getShellsForRole: function(role) {
    var r = CT.platform.ROLES[role || 'founder'];
    return r ? r.shells.slice() : ['ct', 'bo'];
  },

  canAccessShell: function(shell, role) {
    return CT.platform.getShellsForRole(role).indexOf(shell) !== -1;
  },

  /* Return views for a given shell + role, ordered by section */
  getViewsForShell: function(shell, role) {
    role = CT.platform.normalizeRole(role);
    var views = CT.platform.VIEWS.filter(function(v) {
      return v.shell === shell && v.roles.indexOf(role) !== -1;
    });
    if (shell === 'ct' && CT.platform.canAccess('pricing', role)) {
      var hasPricing = views.some(function(v) { return v.id === 'pricing'; });
      if (!hasPricing) {
        var pricingView = CT.platform.getView('pricing');
        if (pricingView) views.push(pricingView);
      }
    }
    return views;
  },

  getSidebarViewsForShell: function(shell, role) {
    role = CT.platform.normalizeRole(role);
    var views = CT.platform.getViewsForShell(shell, role).filter(function(v) {
      return v.hidden !== true;
    });
    if (shell === 'ct' && CT.platform.canAccess('pricing', role)) {
      var hasPricing = views.some(function(v) { return v.id === 'pricing'; });
      if (!hasPricing) {
        var pricingView = CT.platform.getView('pricing');
        if (pricingView) views.push(pricingView);
      }
    }
    return views.sort(function(a, b) {
      var ai = CT.platform.VIEWS.findIndex(function(v) { return v.id === a.id; });
      var bi = CT.platform.VIEWS.findIndex(function(v) { return v.id === b.id; });
      return ai - bi;
    });
  },

  /* Return ordered sections that have ≥1 visible view */
  getSectionsForShell: function(shell, role) {
    var viewsBySection = {};
    CT.platform.getSidebarViewsForShell(shell, role).forEach(function(v) {
      viewsBySection[v.section] = true;
    });
    return Object.keys(CT.platform.SECTIONS)
      .filter(function(k) { return CT.platform.SECTIONS[k].shell === shell && viewsBySection[k]; })
      .map(function(k) { return { id: k, label: CT.platform.SECTIONS[k].label, order: CT.platform.SECTIONS[k].order }; })
      .sort(function(a, b) { return a.order - b.order; });
  },

  /* Access check — view × role */
  canAccess: function(viewId, role) {
    role = CT.platform.normalizeRole(role);
    if (CT.platform.LEGACY_VIEWS.indexOf(viewId) !== -1) {
      return role === 'founder' || role === 'admin' || role === 'super_admin';
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

  /* ═══════════════════════════════════════════════════════════════
     DRILL-DOWN CONTRACT (Phase 2)
     ═══════════════════════════════════════════════════════════════

     Format:
       CT.platform.drillDown({
         shell:       'ct' | 'bo',           // target shell (auto-inferred from view)
         view:        'orders',              // REQUIRED — target view id
         tab:         'pending' | null,      // optional tab within view
         section:     'details' | null,      // optional section within view
         filters:     { status: 'blocked' }, // optional filters
         highlightId: 'ORD-1234' | null,     // optional row/card to highlight
         origin:      { shell, view },       // auto-set: where we came from
         returnTo:    { shell, view, tab }   // auto-set: where to go back
       })

     Guarantees:
       1. Access check before navigation
       2. Shell auto-switch
       3. Origin/returnTo auto-populated
       4. Hash URL serialization for deep-linking
       5. Filter validation against view's supportedFilters
       6. Graceful fallback on unknown view / unauthorized
       7. Return navigation via CT.platform.drillBack()
     ══════════════════════════════════════════════════════════════ */

  _drillDownStack: [],

  drillDown: function(params) {
    if (!params || !params.view) return false;
    var role = CT.platform.state.role;

    /* ── 1. Access check ── */
    if (!CT.platform.canAccess(params.view, role)) {
      console.warn('[drill-down] Access denied:', params.view, 'for role', role);
      return false;
    }

    /* ── 2. Auto-populate origin + returnTo ── */
    if (!params.origin) {
      params.origin = {
        shell: CT.platform.state.shell,
        view:  CT.app.currentView
      };
    }
    if (!params.returnTo) {
      params.returnTo = {
        shell: CT.platform.state.shell,
        view:  CT.app.currentView,
        tab:   null
      };
    }

    /* ── 3. Filter validation ── */
    var viewDef = CT.platform.getView(params.view);
    if (viewDef && params.filters) {
      var supported = viewDef.supportedFilters || [];
      var validated = {};
      Object.keys(params.filters).forEach(function(k) {
        if (supported.indexOf(k) !== -1) {
          validated[k] = params.filters[k];
        } else {
          console.warn('[drill-down] Filter "' + k + '" not supported by view "' + params.view + '", ignored');
        }
      });
      params.filters = validated;
    }

    /* ── 4. Push to stack ── */
    CT.platform._drillDownStack.push(params);

    /* ── 5. Shell switch ── */
    var targetShell = params.shell || CT.platform.shellForView(params.view);
    if (targetShell && targetShell !== CT.platform.state.shell) {
      CT.platform.state.shell = targetShell;
      CT.app.renderShellSwitcher();
      CT.app.renderSidebar();
    }

    /* ── 6. Serialize to hash URL ── */
    CT.platform._serializeToHash(params);

    /* ── 7. Navigate ── */
    CT.app.navigate(params.view, params);
    return true;
  },

  /* Return to origin — pop the drill-down stack */
  drillBack: function() {
    var stack = CT.platform._drillDownStack;
    if (stack.length === 0) return false;

    var last = stack.pop();
    var ret = last.returnTo || last.origin;
    if (!ret || !ret.view) return false;

    /* Switch shell back */
    if (ret.shell && ret.shell !== CT.platform.state.shell) {
      CT.platform.state.shell = ret.shell;
      CT.app.renderShellSwitcher();
      CT.app.renderSidebar();
    }

    CT.app.navigate(ret.view);
    return true;
  },

  /* Has a drill-down context to return from? */
  hasDrillBack: function() {
    return CT.platform._drillDownStack.length > 0;
  },

  /* Get current drill-down params (for the active view to read) */
  getDrillDownParams: function() {
    var stack = CT.platform._drillDownStack;
    return stack.length > 0 ? stack[stack.length - 1] : null;
  },

  /* ── Hash URL serialization ── */
  _serializeToHash: function(params) {
    var parts = [params.view];
    if (params.tab) parts.push('tab=' + params.tab);
    if (params.section) parts.push('sec=' + params.section);
    if (params.highlightId) parts.push('hl=' + params.highlightId);
    if (params.filters) {
      Object.keys(params.filters).forEach(function(k) {
        parts.push('f.' + k + '=' + encodeURIComponent(params.filters[k]));
      });
    }
    var hash = parts.join('&');
    if (history && history.replaceState) {
      history.replaceState(null, '', '#' + hash);
    }
  },

  /* Parse hash URL back to drill-down params */
  parseHash: function(hash) {
    if (!hash) hash = (location.hash || '').replace('#', '');
    if (!hash) return null;

    var parts = hash.split('&');
    var viewId = parts[0];
    if (!viewId) return null;

    var params = { view: viewId, filters: {} };
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length < 2) continue;
      var key = kv[0];
      var val = decodeURIComponent(kv.slice(1).join('='));
      if (key === 'tab')      params.tab = val;
      else if (key === 'sec') params.section = val;
      else if (key === 'hl')  params.highlightId = val;
      else if (key.indexOf('f.') === 0) params.filters[key.substring(2)] = val;
    }
    if (Object.keys(params.filters).length === 0) delete params.filters;
    return params;
  },

  /* ── Render drill-back button (reusable helper) ── */
  renderDrillBackButton: function() {
    if (!CT.platform.hasDrillBack()) return '';
    var last = CT.platform._drillDownStack[CT.platform._drillDownStack.length - 1];
    var origin = last.origin || {};
    var originView = CT.platform.getView(origin.view);
    var label = originView ? originView.label : 'Retour';
    var emoji = originView ? originView.emoji : '←';
    return '<button class="ct-btn ct-btn-ghost ct-drill-back" data-action="drill-back" ' +
           'style="margin-bottom:16px">' +
           '← ' + emoji + ' ' + label +
           '</button>';
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

  /* ═══════════════════════════════════════════════════════════════
     VISUAL CONVENTION O/C/P/R (Phase 5)
     ═══════════════════════════════════════════════════════════════
     Usage:
       CT.platform.nature('12 500 KMF', 'calculated')
       → '<span data-nature="calculated">12 500 KMF</span>'

       CT.platform.natureKPI('30%', 'Marge cible', 'projected')
       → KPI div tagged with data-nature

       CT.platform.natureTip('calculated')
       → 'Agrégation calculée'
     ══════════════════════════════════════════════════════════════ */
  DATA_NATURES: {
    observed:    { badge: null,   css: 'kn-observed',    label: null,         tip: 'Donnée réelle terrain',     color: 'inherit'  },
    calculated:  { badge: 'calc', css: 'kn-calculated',  label: 'Calculé',    tip: 'Agrégation calculée',       color: '#3b82f6'  },
    projected:   { badge: 'proj', css: 'kn-projected',   label: 'Projeté',    tip: 'Projection / scénario',     color: '#f59e0b'  },
    recommended: { badge: 'reco', css: 'kn-recommended', label: 'Recommandé', tip: 'Suggestion du moteur',      color: '#10b981'  }
  },

  /* Tag a value with a data nature */
  nature: function(value, nature) {
    if (!nature || nature === 'observed') return '' + value;
    return '<span data-nature="' + nature + '" title="' +
      (CT.platform.DATA_NATURES[nature] ? CT.platform.DATA_NATURES[nature].tip : '') +
      '">' + value + '</span>';
  },

  /* Create a KPI block tagged with a nature */
  natureKPI: function(emoji, value, label, nature, bg) {
    var attr = nature && nature !== 'observed' ? ' data-nature="' + nature + '"' : '';
    var tip  = nature && CT.platform.DATA_NATURES[nature] ? ' title="' + CT.platform.DATA_NATURES[nature].tip + '"' : '';
    return '<div class="ct-kpi" style="background:' + (bg || 'white') + '"' + attr + tip + '>' +
      '<div class="ct-kpi-icon">' + emoji + '</div>' +
      '<div><div class="ct-kpi-value">' + value + '</div>' +
      '<div class="ct-kpi-label">' + label + '</div></div></div>';
  },

  /* Get tooltip text for a nature */
  natureTip: function(nature) {
    var n = CT.platform.DATA_NATURES[nature];
    return n ? n.tip : '';
  }
};
