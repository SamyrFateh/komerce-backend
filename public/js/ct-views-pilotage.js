// ═══════════════════════════════════════════════════════════════════════════
// CT Views — Pilotage Stratégique Komerce
// Control Tower Module: Strategic cockpit combining projections, mix analysis,
// live dashboard, operational metrics, loyalty tracking & client analytics.
// ═══════════════════════════════════════════════════════════════════════════
(function() {
'use strict';

if (!window.CT) window.CT = {};
if (!CT.views) CT.views = {};

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const PIL_CATS = {
  telephone:  { label: '📱 Téléphones',        dims: [17,12,11], douane: 10, taxeAdd: 10 },
  tablette:   { label: '📲 Tablettes',          dims: [30,22,4],  douane: 10, taxeAdd: 10 },
  pc:         { label: '💻 PC Portables',        dims: [38,26,3],  douane: 10, taxeAdd: 10 },
  accessoire: { label: '🎧 Accessoires Tech',    dims: [15,10,5],  douane: 20, taxeAdd: 0  },
  electromenager: { label: '🏠 Électroménager', dims: [40,35,35], douane: 20, taxeAdd: 0  },
  mode:       { label: '👗 Mode & Textile',      dims: [30,20,5],  douane: 20, taxeAdd: 0  },
  cosmetique: { label: '💄 Cosmétique',          dims: [15,10,8],  douane: 30, taxeAdd: 0  },
  jouet:      { label: '🧸 Jouets & Enfants',    dims: [25,20,15], douane: 20, taxeAdd: 0  }
};
const EMBARK_AED = 3;
const PALETTE_COLORS = ['#f59e0b','#0d9488','#3b82f6','#8b5cf6','#10b981','#ec4899','#f97316','#6366f1','#14b8a6','#e11d48'];
const FMT = new Intl.NumberFormat('fr-FR');
const N = v => FMT.format(Math.round(v || 0));

// ─── STYLES ─────────────────────────────────────────────────────────────────
const PIL_STYLES = `
/* ── Sub-tab navigation ── */
.pil-tabs {
  display: flex; gap: 4px; padding: 6px 0 12px; flex-wrap: wrap;
  border-bottom: 1px solid var(--ct-border, #e2e8f0);
  margin-bottom: 16px;
}
.pil-tab {
  padding: 8px 14px; font-size: 0.78rem; font-weight: 600;
  border-radius: 6px; cursor: pointer; white-space: nowrap;
  color: var(--ct-text-muted, #64748b);
  background: var(--ct-bg-alt, #f8fafc);
  border: 1px solid transparent;
  transition: all 0.15s;
}
.pil-tab:hover { background: var(--ct-bg-hover, #f1f5f9); }
.pil-tab.active {
  background: var(--ct-primary, #3b82f6); color: #fff;
  border-color: var(--ct-primary, #3b82f6);
}

/* ── Screen panels ── */
.pil-screen { display: none; animation: pilFadeIn 0.2s ease; }
.pil-screen.active { display: block; }
@keyframes pilFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ── Metric cards ── */
.pil-metric-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px; margin-bottom: 16px;
}
.pil-metric {
  background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border, #e2e8f0);
  border-radius: 10px; padding: 14px 16px; text-align: center;
}
.pil-metric-label {
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--ct-text-muted, #64748b); margin-bottom: 6px;
}
.pil-metric-val {
  font-size: 1.5rem; font-weight: 800; font-variant-numeric: tabular-nums;
  color: var(--ct-text, #1e293b);
}
.pil-metric-val.green { color: #16a34a; }
.pil-metric-val.red { color: #ef4444; }
.pil-metric-val.amber { color: #d97706; }
.pil-metric-val.blue { color: #3b82f6; }
.pil-metric-val.teal { color: #0d9488; }
.pil-metric-sub {
  font-size: 0.72rem; color: var(--ct-text-muted, #94a3b8); margin-top: 4px;
}

/* ── Slider ── */
.pil-slider-wrap { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.pil-slider-wrap label { font-size: 0.78rem; font-weight: 600; color: var(--ct-text, #1e293b); white-space: nowrap; }
.pil-slider-wrap input[type="range"] {
  flex: 1; height: 6px; -webkit-appearance: none; appearance: none;
  background: var(--ct-border, #e2e8f0); border-radius: 3px; outline: none;
}
.pil-slider-wrap input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px;
  background: var(--ct-primary, #3b82f6); border-radius: 50%; cursor: pointer;
}
.pil-slider-val {
  font-size: 0.82rem; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--ct-primary, #3b82f6); min-width: 50px; text-align: right;
}

/* ── CSS Bar Charts ── */
.pil-bar-chart { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
.pil-bar-row { display: flex; align-items: center; gap: 8px; }
.pil-bar-label {
  font-size: 0.72rem; color: var(--ct-text-muted, #64748b);
  min-width: 100px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pil-bar {
  height: 22px; border-radius: 4px; display: flex; align-items: center;
  padding: 0 8px; font-size: 0.68rem; font-weight: 700; color: #fff;
  min-width: 28px; transition: width 0.4s ease;
  background: var(--bar-color, #3b82f6);
  width: var(--bar-w, 0%);
}
.pil-bar-val {
  font-size: 0.72rem; font-weight: 600; color: var(--ct-text, #1e293b);
  min-width: 60px; font-variant-numeric: tabular-nums;
}

/* ── Horizontal stacked bar ── */
.pil-stacked-bar {
  display: flex; height: 28px; border-radius: 6px; overflow: hidden; margin: 8px 0;
}
.pil-stacked-seg { display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; color: #fff; transition: flex 0.3s; }

/* ── Pipeline ── */
.pil-pipeline { display: flex; gap: 4px; flex-wrap: wrap; margin: 12px 0; }
.pil-pipeline-step {
  flex: 1; min-width: 90px; background: var(--ct-bg-alt, #f8fafc);
  border: 1px solid var(--ct-border, #e2e8f0); border-radius: 8px;
  padding: 10px 8px; text-align: center; position: relative;
}
.pil-pipeline-step::after {
  content: '→'; position: absolute; right: -10px; top: 50%; transform: translateY(-50%);
  font-size: 0.9rem; color: var(--ct-text-muted, #94a3b8);
}
.pil-pipeline-step:last-child::after { display: none; }
.pil-pipeline-label { font-size: 0.65rem; color: var(--ct-text-muted, #64748b); margin-bottom: 4px; }
.pil-pipeline-val { font-size: 1.2rem; font-weight: 800; color: var(--ct-primary, #3b82f6); }

/* ── Phase badges ── */
.pil-phase {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 0.68rem; font-weight: 700;
}
.pil-phase-amorcage { background: #fef3c7; color: #92400e; }
.pil-phase-croissance { background: #d1fae5; color: #065f46; }
.pil-phase-croisiere { background: #dbeafe; color: #1e40af; }

/* ── Alert strips ── */
.pil-alert {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; font-size: 0.8rem;
}
.pil-alert-ok { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.pil-alert-warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.pil-alert-err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

/* ── Progress bar ── */
.pil-pbar-wrap { height: 6px; background: var(--ct-border, #e2e8f0); border-radius: 3px; overflow: hidden; margin-top: 4px; }
.pil-pbar { height: 100%; border-radius: 3px; transition: width 0.3s; }

/* ── Perf badges ── */
.pil-perf-ok { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; background: #dcfce7; color: #16a34a; }
.pil-perf-warn { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; background: #fef3c7; color: #92400e; }
.pil-perf-red { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; background: #fef2f2; color: #991b1b; }

/* ── Section spacing ── */
.pil-section { margin-bottom: 20px; }
.pil-section h3 { font-size: 0.88rem; font-weight: 700; margin-bottom: 10px; color: var(--ct-text, #1e293b); }
.pil-section h4 { font-size: 0.8rem; font-weight: 600; margin: 12px 0 6px; color: var(--ct-text-muted, #64748b); }

/* ── Inline filter row ── */
.pil-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.pil-filter-btn {
  padding: 5px 12px; font-size: 0.75rem; font-weight: 600; border-radius: 6px;
  cursor: pointer; border: 1px solid var(--ct-border, #e2e8f0);
  background: var(--ct-bg-alt, #f8fafc); color: var(--ct-text-muted, #64748b);
  transition: all 0.15s;
}
.pil-filter-btn:hover { background: var(--ct-bg-hover, #f1f5f9); }
.pil-filter-btn.active {
  background: var(--ct-primary, #3b82f6); color: #fff;
  border-color: var(--ct-primary, #3b82f6);
}

/* ── Tier pills ── */
.pil-tier-grid { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
.pil-tier-card {
  flex: 1; min-width: 130px; padding: 12px; border-radius: 8px;
  border-left: 4px solid var(--tier-color, #94a3b8);
  background: var(--ct-card-bg, #fff); border-top: 1px solid var(--ct-border, #e2e8f0);
  border-right: 1px solid var(--ct-border, #e2e8f0);
  border-bottom: 1px solid var(--ct-border, #e2e8f0);
}

/* ── Responsive tables inside pilotage ── */
.pil-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 8px 0; }

/* ── Mix category row ── */
.pil-mix-row.inactive { opacity: 0.4; }

/* ── Donut placeholder (CSS only) ── */
.pil-donut-wrap { display: flex; justify-content: center; margin: 12px 0; }
.pil-donut {
  width: 160px; height: 160px; border-radius: 50%; position: relative;
  display: flex; align-items: center; justify-content: center;
}
.pil-donut-center {
  width: 80px; height: 80px; border-radius: 50%; background: var(--ct-card-bg, #fff);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.82rem; font-weight: 700; color: var(--ct-text, #1e293b);
}
.pil-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: center; margin-top: 8px; }
.pil-legend-item { display: flex; align-items: center; gap: 4px; font-size: 0.7rem; color: var(--ct-text-muted, #64748b); }
.pil-legend-dot { width: 10px; height: 10px; border-radius: 2px; }

/* ── Impact douane ── */
.pil-douane-impact {
  padding: 10px 14px; border-radius: 8px; font-size: 0.8rem;
  margin: 8px 0; display: none;
}
.pil-douane-impact.warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.pil-douane-impact.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.pil-douane-impact.visible { display: block; }
`;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════
CT.views.pilotage = function(main) {
  // State object
  const _pil = {
    activeTab: 'temporel',
    loaded: {},
    // Temporel
    months: 12,
    growthPct: 8,
    phase: 'croissance',
    baseline: null,
    timeline: [],
    // Mix
    mixCats: {},
    prixTerrain: {},
    mixTauxAed: 139,
    mixTauxEur: 495,
    mixMargePct: 12,
    mixVolume: 100,
    // Dashboard
    dashPeriod: 'month',
    dashDouane: 30,
    dashData: null,
    // Ops
    opsData: null,
    // Fidelite
    fidData: null,
    // Clients
    cliData: null,
  };

  // Initialize mix categories
  Object.keys(PIL_CATS).forEach(k => {
    _pil.mixCats[k] = {
      active: ['telephone','tablette','accessoire','mode'].includes(k),
      prixAed: k === 'telephone' ? 359 : k === 'tablette' ? 200 : k === 'pc' ? 450 : k === 'electromenager' ? 150 : k === 'mode' ? 25 : k === 'cosmetique' ? 15 : k === 'jouet' ? 20 : 50,
      pct: k === 'telephone' ? 40 : k === 'tablette' ? 15 : k === 'accessoire' ? 20 : k === 'mode' ? 25 : 0,
    };
  });

  // Try to restore prix terrain from localStorage
  try {
    const saved = localStorage.getItem('komerce_prix_terrain_cat');
    if (saved) _pil.prixTerrain = JSON.parse(saved);
  } catch(e) {}

  // ─── RENDER SHELL ──────────────────────────────────────────────────────
  main.innerHTML = `
<style>${PIL_STYLES}</style>

<div class="ct-view-header">
  <h2>📈 Pilotage Stratégique</h2>
  <p class="ct-view-desc" style="font-size:0.78rem;color:var(--ct-text-muted,#64748b);margin-top:2px;">
    Cockpit de pilotage — Projections, mix, données réelles, opérations, fidélité & clients
  </p>
</div>

<div class="pil-tabs" data-pil-tabs>
  <div class="pil-tab active" data-pil-tab="temporel">📅 Temporel</div>
  <div class="pil-tab" data-pil-tab="mix">🗂️ Mix Catégories</div>
  <div class="pil-tab" data-pil-tab="dashboard">📊 Dashboard Live</div>
  <div class="pil-tab" data-pil-tab="ops">🚦 Opérationnel</div>
  <div class="pil-tab" data-pil-tab="fidelite">⭐ Fidélité & Invendus</div>
  <div class="pil-tab" data-pil-tab="clients">👥 Clients & Ventes</div>
</div>

<!-- ═══ TAB 1: TEMPOREL ═══ -->
<div class="pil-screen active" data-pil-screen="temporel">
  <div class="ct-section-block pil-section">
    <h3>📅 Projections temporelles</h3>
    <div class="pil-filters">
      <span style="font-size:0.75rem;font-weight:600;color:var(--ct-text-muted,#64748b);">Période :</span>
      <button class="pil-filter-btn" data-pil-months="3">3 mois</button>
      <button class="pil-filter-btn" data-pil-months="6">6 mois</button>
      <button class="pil-filter-btn active" data-pil-months="12">12 mois</button>
      <button class="pil-filter-btn" data-pil-months="18">18 mois</button>
      <button class="pil-filter-btn" data-pil-months="24">24 mois</button>
    </div>
    <div class="pil-slider-wrap">
      <label>Croissance volume :</label>
      <input type="range" min="0" max="30" value="8" data-pil-growth>
      <span class="pil-slider-val" data-pil-growth-val>8%</span>
    </div>
    <div class="pil-filters" style="margin-top:6px;">
      <span style="font-size:0.75rem;font-weight:600;color:var(--ct-text-muted,#64748b);">Phase :</span>
      <button class="pil-filter-btn" data-pil-phase="amorcage">🌱 Amorçage</button>
      <button class="pil-filter-btn active" data-pil-phase="croissance">🚀 Croissance</button>
      <button class="pil-filter-btn" data-pil-phase="croisiere">✈️ Croisière</button>
    </div>
  </div>
  <div data-pil-temporel-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>Évolution mensuelle projetée</h4>
    <div data-pil-temporel-chart></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Détail par mois</h4>
    <div class="pil-table-wrap">
      <table class="ct-table" data-pil-temporel-table>
        <thead>
          <tr>
            <th>Mois</th><th>Phase</th><th>Volume</th><th>CA projeté</th>
            <th>Panier moyen</th><th>Marge brute</th><th>Charges fixes</th>
            <th>Profit net</th><th>Cumulé</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══ TAB 2: MIX CATÉGORIES ═══ -->
<div class="pil-screen" data-pil-screen="mix">
  <div class="ct-section-block pil-section">
    <h3>🗂️ Mix Catégories — Optimisation marge</h3>
    <div class="pil-filters">
      <span style="font-size:0.72rem;font-weight:600;">Taux AED:</span>
      <input class="ct-input" type="number" value="139" min="100" max="200" step="1" data-pil-mix-aed style="width:70px;">
      <span style="font-size:0.72rem;font-weight:600;margin-left:8px;">Taux EUR:</span>
      <input class="ct-input" type="number" value="495" min="400" max="600" step="1" data-pil-mix-eur style="width:70px;">
      <span style="font-size:0.72rem;font-weight:600;margin-left:8px;">Marge cible %:</span>
      <input class="ct-input" type="number" value="12" min="5" max="30" step="1" data-pil-mix-marge style="width:60px;">
      <span style="font-size:0.72rem;font-weight:600;margin-left:8px;">Volume total:</span>
      <input class="ct-input" type="number" value="100" min="10" max="1000" step="10" data-pil-mix-vol style="width:70px;">
    </div>
  </div>
  <div data-pil-mix-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>Répartition par catégorie</h4>
    <div class="pil-table-wrap">
      <table class="ct-table" data-pil-mix-table>
        <thead>
          <tr>
            <th>✓</th><th>Catégorie</th><th>Prix AED</th><th>% Mix</th>
            <th>Cmds</th><th>CDR</th><th>Prix client</th><th>Marge brute</th>
            <th>Marge nette</th><th>CA estimé</th><th>Prix terrain</th>
          </tr>
        </thead>
        <tbody data-pil-mix-tbody></tbody>
      </table>
    </div>
    <div data-pil-mix-alert style="display:none;padding:8px 12px;border-radius:6px;background:#fef3c7;color:#92400e;font-size:0.78rem;margin:8px 0;">
      ⚠️ La répartition ne fait pas 100% — ajustez les pourcentages.
    </div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Contribution au CA par catégorie</h4>
    <div data-pil-mix-chart-ca></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Marge nette par catégorie</h4>
    <div data-pil-mix-chart-marge></div>
  </div>
</div>

<!-- ═══ TAB 3: DASHBOARD LIVE ═══ -->
<div class="pil-screen" data-pil-screen="dashboard">
  <div class="ct-section-block pil-section">
    <h3>📊 Dashboard Live — Données réelles</h3>
    <div class="pil-filters">
      <span style="font-size:0.72rem;font-weight:600;">Période :</span>
      <button class="pil-filter-btn" data-pil-dash-period="today">Aujourd'hui</button>
      <button class="pil-filter-btn" data-pil-dash-period="week">Semaine</button>
      <button class="pil-filter-btn active" data-pil-dash-period="month">Mois</button>
      <button class="pil-filter-btn" data-pil-dash-period="quarter">Trimestre</button>
      <button class="ct-btn ct-btn-primary" data-pil-dash-refresh style="margin-left:auto;font-size:0.72rem;padding:5px 12px;">
        🔄 Actualiser
      </button>
    </div>
    <div class="pil-slider-wrap">
      <label>Taux douane effectif :</label>
      <input type="range" min="15" max="60" value="30" step="1" data-pil-douane-range>
      <span class="pil-slider-val" data-pil-douane-val>30%</span>
    </div>
    <div class="pil-douane-impact" data-pil-douane-impact></div>
  </div>
  <div data-pil-dash-status style="padding:12px;text-align:center;font-size:0.82rem;"></div>
  <div data-pil-dash-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>Pipeline logistique</h4>
    <div class="pil-pipeline" data-pil-dash-pipeline></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Évolution du CA</h4>
    <div data-pil-dash-chart-ca></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Top 5 produits</h4>
    <div class="pil-table-wrap" data-pil-dash-top></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Décomposition marge par catégorie</h4>
    <div data-pil-dash-chart-marge></div>
  </div>
</div>

<!-- ═══ TAB 4: OPÉRATIONNEL ═══ -->
<div class="pil-screen" data-pil-screen="ops">
  <div class="ct-section-block pil-section">
    <h3>🚦 Performance opérationnelle</h3>
    <div class="pil-filters">
      <button class="ct-btn ct-btn-primary" data-pil-ops-refresh style="font-size:0.72rem;padding:5px 12px;">
        🔄 Actualiser les données
      </button>
    </div>
  </div>
  <div data-pil-ops-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>🔴 Alertes actives</h4>
    <div data-pil-ops-alerts></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>⏱️ Délais par étape (médian)</h4>
    <div class="pil-table-wrap">
      <table class="ct-table" data-pil-ops-delais>
        <thead><tr><th>Étape</th><th>Délai médian</th><th>Cible SLA</th><th>Statut</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>🏪 Performance par relais</h4>
    <div class="pil-table-wrap" data-pil-ops-relais></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>🏭 Performance fournisseurs</h4>
    <div class="pil-table-wrap" data-pil-ops-fournisseurs></div>
  </div>
</div>

<!-- ═══ TAB 5: FIDÉLITÉ & INVENDUS ═══ -->
<div class="pil-screen" data-pil-screen="fidelite">
  <div class="ct-section-block pil-section">
    <h3>⭐ Fidélité clients</h3>
  </div>
  <div data-pil-fid-status style="padding:8px 12px;font-size:0.8rem;text-align:center;display:none;border-radius:6px;margin-bottom:10px;"></div>
  <div data-pil-fid-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>Répartition par palier</h4>
    <div class="pil-tier-grid" data-pil-fid-tiers></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Top clients fidélisés</h4>
    <div class="pil-table-wrap" data-pil-fid-top></div>
  </div>

  <div class="ct-section-block pil-section" style="margin-top:24px;border-top:2px solid var(--ct-border,#e2e8f0);padding-top:16px;">
    <h3>📦 Invendus & Liquidation</h3>
  </div>
  <div data-pil-uns-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>Répartition par canal</h4>
    <div data-pil-uns-canaux></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>Pipeline invendus</h4>
    <div class="pil-table-wrap" data-pil-uns-pipeline></div>
  </div>
</div>

<!-- ═══ TAB 6: CLIENTS & VENTES ═══ -->
<div class="pil-screen" data-pil-screen="clients">
  <div class="ct-section-block pil-section">
    <h3>👥 Clients & Ventes</h3>
    <div class="pil-filters">
      <span style="font-size:0.72rem;font-weight:600;">Période :</span>
      <button class="pil-filter-btn active" data-pil-cli-period="30">30j</button>
      <button class="pil-filter-btn" data-pil-cli-period="90">90j</button>
      <button class="pil-filter-btn" data-pil-cli-period="180">6 mois</button>
      <button class="pil-filter-btn" data-pil-cli-period="365">1 an</button>
      <button class="ct-btn ct-btn-primary" data-pil-cli-refresh style="margin-left:auto;font-size:0.72rem;padding:5px 12px;">
        🔄 Actualiser
      </button>
    </div>
  </div>
  <div data-pil-cli-kpis class="pil-metric-grid"></div>
  <div class="ct-section-block pil-section">
    <h4>🏆 Top 20 clients par CA</h4>
    <div class="pil-table-wrap" data-pil-cli-top-clients></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>🏅 Top 20 produits par unités vendues</h4>
    <div class="pil-table-wrap" data-pil-cli-top-products></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>🏪 Ventes par relais</h4>
    <div data-pil-cli-relais></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>📦 Distribution par catégorie</h4>
    <div data-pil-cli-categories></div>
  </div>
  <div class="ct-section-block pil-section">
    <h4>📈 Évolution mensuelle (6 derniers mois)</h4>
    <div data-pil-cli-monthly></div>
  </div>
</div>
`;

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════
  const $ = (sel) => main.querySelector(sel);
  const $$ = (sel) => main.querySelectorAll(sel);

  function apiFetch(path) {
    return fetch(path, { credentials: 'include' }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fmtH(h) {
    if (h === null || h === undefined) return '—';
    return h < 24 ? h + 'h' : Math.round(h / 24) + 'j';
  }

  function ageH(d) {
    if (!d) return null;
    return Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  }

  function ageJ(d) {
    if (!d) return null;
    return Math.round((Date.now() - new Date(d).getTime()) / 86400000);
  }

  function medianH(arr, fromKey, toKey) {
    const vals = arr.filter(o => o[fromKey] && o[toKey])
      .map(o => (new Date(o[toKey]) - new Date(o[fromKey])) / 3600000);
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return Math.round(vals[Math.floor(vals.length / 2)]);
  }

  function perfBadge(h, okH, warnH) {
    if (h === null || h === undefined) return '<span class="ct-badge">—</span>';
    if (h <= okH) return '<span class="pil-perf-ok">✅ OK</span>';
    if (h <= warnH) return '<span class="pil-perf-warn">⚠️ Lent</span>';
    return '<span class="pil-perf-red">🔴 Critique</span>';
  }

  function buildBarChart(container, items) {
    // items = [{ label, value, max, color? }]
    if (!items.length) { container.innerHTML = '<div class="ct-empty">Aucune donnée</div>'; return; }
    const maxVal = Math.max(...items.map(i => Math.abs(i.value)), 1);
    container.innerHTML = '<div class="pil-bar-chart">' + items.map(it => {
      const pct = Math.min(Math.abs(it.value) / (it.max || maxVal) * 100, 100);
      const color = it.color || '#3b82f6';
      return `<div class="pil-bar-row">
        <span class="pil-bar-label">${it.label}</span>
        <div class="pil-bar" style="--bar-w:${pct}%;--bar-color:${color}">${typeof it.display !== 'undefined' ? it.display : N(it.value)}</div>
        <span class="pil-bar-val">${it.suffix || ''}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function buildLegend(items) {
    // items = [{ label, color }]
    return '<div class="pil-legend">' + items.map(it =>
      `<span class="pil-legend-item"><span class="pil-legend-dot" style="background:${it.color}"></span>${it.label}</span>`
    ).join('') + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB SWITCHING
  // ═══════════════════════════════════════════════════════════════════════
  function switchTab(tabId) {
    if (_pil.activeTab === tabId) return;
    _pil.activeTab = tabId;

    $$('.pil-tab').forEach(t => t.classList.toggle('active', t.dataset.pilTab === tabId));
    $$('.pil-screen').forEach(s => s.classList.toggle('active', s.dataset.pilScreen === tabId));

    // Lazy load on first activation
    if (!_pil.loaded[tabId]) {
      _pil.loaded[tabId] = true;
      switch(tabId) {
        case 'temporel':  loadTemporel(); break;
        case 'mix':       renderMix(); break;
        case 'dashboard': loadDashboard(); break;
        case 'ops':       loadOps(); break;
        case 'fidelite':  loadFidelite(); break;
        case 'clients':   loadClients(); break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB 1: TEMPOREL — PROJECTIONS
  // ═══════════════════════════════════════════════════════════════════════
  function loadTemporel() {
    // Load baseline from API
    apiFetch('/api/dashboard/stats').then(data => {
      _pil.baseline = {
        avgBasket: data.panier_moyen_kmf || data.avgBasket || 45000,
        volume: data.total_commandes || data.volume || 30,
        margin: data.marge_pct || 12,
        fixedCosts: 700000, // Hub AED 7000 * 100 KMF
      };
      computeTemporel();
    }).catch(() => {
      // Fallback baseline
      _pil.baseline = { avgBasket: 45000, volume: 30, margin: 12, fixedCosts: 700000 };
      computeTemporel();
    });
  }

  function computeTemporel() {
    const b = _pil.baseline;
    const months = _pil.months;
    const growthRate = _pil.growthPct / 100;
    const phase = _pil.phase;

    // Phase multipliers
    const phaseConfig = {
      amorcage:   { volMult: 0.5, marginMult: 0.8, fixedMult: 1.2, label: '🌱 Amorçage' },
      croissance: { volMult: 1.0, marginMult: 1.0, fixedMult: 1.0, label: '🚀 Croissance' },
      croisiere:  { volMult: 1.5, marginMult: 1.1, fixedMult: 0.8, label: '✈️ Croisière' },
    };
    const pc = phaseConfig[phase] || phaseConfig.croissance;

    const timeline = [];
    let cumProfit = 0;
    let breakEvenMonth = null;

    for (let i = 0; i < months; i++) {
      const monthLabel = new Date(Date.now() + i * 30 * 86400000).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
      const vol = Math.round(b.volume * pc.volMult * Math.pow(1 + growthRate, i));
      const basket = Math.round(b.avgBasket * (1 + i * 0.005)); // slight increase
      const ca = vol * basket;
      const marginPct = b.margin * pc.marginMult;
      const margeBrute = ca * (marginPct / 100);
      const charges = b.fixedCosts * pc.fixedMult;
      const profitNet = margeBrute - charges;
      cumProfit += profitNet;

      if (breakEvenMonth === null && cumProfit >= 0) breakEvenMonth = i + 1;

      // Auto-assign phase based on month
      let rowPhase = phase;
      if (months >= 12) {
        if (i < 3) rowPhase = 'amorcage';
        else if (i < 9) rowPhase = 'croissance';
        else rowPhase = 'croisiere';
      }

      timeline.push({
        month: i + 1, label: monthLabel, vol, basket, ca,
        marginPct, margeBrute, charges, profitNet, cumProfit, phase: rowPhase
      });
    }

    _pil.timeline = timeline;

    // Render KPIs
    const last = timeline[timeline.length - 1] || {};
    const totalCA = timeline.reduce((s, r) => s + r.ca, 0);
    const totalProfit = timeline.reduce((s, r) => s + r.profitNet, 0);
    const avgMonthCA = totalCA / months;

    $('[data-pil-temporel-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">CA mensuel projeté (M${months})</div>
        <div class="pil-metric-val teal">${N(last.ca)} KMF</div>
        <div class="pil-metric-sub">${N(last.vol)} commandes/mois</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">CA cumulé ${months} mois</div>
        <div class="pil-metric-val blue">${N(totalCA)} KMF</div>
        <div class="pil-metric-sub">Moy. ${N(avgMonthCA)}/mois</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Profit cumulé</div>
        <div class="pil-metric-val ${totalProfit >= 0 ? 'green' : 'red'}">${N(totalProfit)} KMF</div>
        <div class="pil-metric-sub">${totalProfit >= 0 ? '✅ Rentable' : '⚠️ Pas encore rentable'}</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Break-even</div>
        <div class="pil-metric-val ${breakEvenMonth ? 'green' : 'amber'}">${breakEvenMonth ? 'Mois ' + breakEvenMonth : '> ' + months + ' mois'}</div>
        <div class="pil-metric-sub">${breakEvenMonth ? '🎯 Seuil de rentabilité' : '⚠️ Pas atteint sur la période'}</div>
      </div>
    `;

    // Render chart (CSS bar chart for CA)
    const chartContainer = $('[data-pil-temporel-chart]');
    const maxCA = Math.max(...timeline.map(r => r.ca), 1);
    buildBarChart(chartContainer, timeline.map(r => ({
      label: r.label,
      value: r.ca,
      max: maxCA,
      color: r.profitNet >= 0 ? '#10b981' : '#f59e0b',
      display: N(r.ca),
      suffix: r.profitNet >= 0 ? '✅' : '⚠️'
    })));

    // Render table
    const tbody = $('[data-pil-temporel-table] tbody');
    tbody.innerHTML = timeline.map(r => {
      const phaseLabels = { amorcage: 'Amorçage', croissance: 'Croissance', croisiere: 'Croisière' };
      const phaseClass = 'pil-phase pil-phase-' + r.phase;
      return `<tr>
        <td>${r.label}</td>
        <td><span class="${phaseClass}">${phaseLabels[r.phase] || r.phase}</span></td>
        <td>${N(r.vol)}</td>
        <td>${N(r.ca)} KMF</td>
        <td>${N(r.basket)} KMF</td>
        <td>${r.marginPct.toFixed(1)}%</td>
        <td>${N(r.charges)} KMF</td>
        <td class="${r.profitNet >= 0 ? '' : 'ct-text-danger'}" style="color:${r.profitNet >= 0 ? '#16a34a' : '#ef4444'};font-weight:700;">${N(r.profitNet)} KMF</td>
        <td style="color:${r.cumProfit >= 0 ? '#0d9488' : '#ef4444'};font-weight:600;">${N(r.cumProfit)} KMF</td>
      </tr>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB 2: MIX CATÉGORIES
  // ═══════════════════════════════════════════════════════════════════════
  function computeMixRow(key, prixAed, tAED, tEUR, margePctDecimal) {
    const cat = PIL_CATS[key];
    if (!cat) return null;
    const d = cat.dims;
    const volM3 = d[0] * d[1] * d[2] / 1e6;
    const fretKmf = volM3 * 180 * tEUR;
    const prixAchat = prixAed * tAED;
    const emb = EMBARK_AED * tAED;
    const hubCmd = 1000 + 150 + 100;
    const couv = prixAchat * 0.004;
    const valCIF = prixAchat + fretKmf;
    const trans = valCIF * 0.02 + 450;
    const douane = valCIF * cat.douane / 100;
    const tva = valCIF * 0.10;
    const taxeAdd = valCIF * cat.taxeAdd / 100;
    const port = 1200;
    const tRelais = 840, cRelais = 500;
    const cdr = prixAchat + emb + hubCmd + fretKmf + couv + trans + douane + tva + taxeAdd + port + tRelais + cRelais;
    const marge = cdr * margePctDecimal;
    const prix = cdr + marge;
    return { cdr, marge, prix };
  }

  function renderMix() {
    const tAED = _pil.mixTauxAed;
    const tEUR = _pil.mixTauxEur;
    const margePct = _pil.mixMargePct / 100;
    const volTotal = _pil.mixVolume;
    const hubMensuel = (3000 + 4000) * tAED; // Hub loyer + salaire

    let totalPct = 0, totalCA = 0, totalCmdActifs = 0;
    let sommeMB = 0, sommeMN = 0;
    const caItems = [], margeItems = [];

    // Build table rows
    const tbody = $('[data-pil-mix-tbody]');
    let rows = '';
    Object.entries(PIL_CATS).forEach(([key, cat]) => {
      const m = _pil.mixCats[key];
      const rowR = computeMixRow(key, m.prixAed, tAED, tEUR, margePct);
      if (!rowR) return;

      const cmd = m.active ? Math.round(volTotal * m.pct / 100) : 0;
      const ca = rowR.prix * cmd;
      const hubParCmd = cmd > 0 ? hubMensuel / volTotal : 0;
      const margeNette = rowR.marge - hubParCmd;
      const margeBrutePct = rowR.prix > 0 ? rowR.marge / rowR.prix * 100 : 0;
      const margeNettePct = rowR.prix > 0 ? margeNette / rowR.prix * 100 : 0;

      if (m.active) {
        totalPct += m.pct;
        totalCA += ca;
        totalCmdActifs += cmd;
        sommeMB += margeBrutePct * m.pct;
        sommeMN += margeNettePct * m.pct;
        caItems.push({ label: cat.label.split(' ').slice(0, 2).join(' '), value: Math.round(ca), color: PALETTE_COLORS[caItems.length % PALETTE_COLORS.length] });
        margeItems.push({ label: cat.label.split(' ').slice(0, 2).join(' '), value: parseFloat(margeNettePct.toFixed(1)), color: margeNettePct >= 0 ? '#10b981' : '#ef4444', display: margeNettePct.toFixed(1) + '%' });
      }

      // Prix terrain comparison
      const pt = _pil.prixTerrain[key];
      let terrainEcart = '—';
      let terrainColor = 'var(--ct-text-muted,#94a3b8)';
      if (pt && m.active) {
        const ecart = pt - rowR.prix;
        terrainColor = ecart >= 0 ? '#34d399' : '#f87171';
        terrainEcart = `${ecart >= 0 ? '🟢 +' : '🔴 '}${N(ecart)} KMF`;
      }

      rows += `<tr class="pil-mix-row ${m.active ? '' : 'inactive'}" data-pil-mix-key="${key}">
        <td><input type="checkbox" ${m.active ? 'checked' : ''} data-pil-mix-check="${key}"></td>
        <td>${cat.label}</td>
        <td><input class="ct-input" type="number" value="${m.prixAed}" min="0" step="5" data-pil-mix-prix="${key}" ${!m.active ? 'disabled' : ''} style="width:70px;"></td>
        <td><input class="ct-input" type="number" value="${m.pct}" min="0" max="100" step="1" data-pil-mix-pct="${key}" ${!m.active ? 'disabled' : ''} style="width:55px;"></td>
        <td>${m.active ? cmd + ' cmd' : '—'}</td>
        <td>${m.active ? N(rowR.cdr) + ' KMF' : '—'}</td>
        <td style="font-weight:700;">${m.active ? N(rowR.prix) + ' KMF' : '—'}</td>
        <td style="color:#16a34a;">${m.active ? margeBrutePct.toFixed(1) + '%' : '—'}</td>
        <td style="color:${m.active ? (margeNettePct >= 0 ? '#16a34a' : '#ef4444') : 'inherit'};font-weight:600;">${m.active ? margeNettePct.toFixed(1) + '%' : '—'}</td>
        <td>${m.active ? N(ca) + ' KMF' : '—'}</td>
        <td>
          <input class="ct-input" type="number" value="${pt || ''}" placeholder="—" min="0" step="100" data-pil-mix-terrain="${key}" style="width:80px;">
          <div style="font-size:0.65rem;margin-top:2px;color:${terrainColor};">${terrainEcart}</div>
        </td>
      </tr>`;
    });
    tbody.innerHTML = rows;

    // KPIs
    const mbMoy = totalPct > 0 ? sommeMB / totalPct : 0;
    const mnMoy = totalPct > 0 ? sommeMN / totalPct : 0;

    $('[data-pil-mix-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">Volume actif</div>
        <div class="pil-metric-val blue">${totalCmdActifs} cmd</div>
        <div class="pil-metric-sub">sur ${volTotal} cmd totales</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Répartition</div>
        <div class="pil-metric-val ${Math.abs(totalPct - 100) < 1 ? 'green' : 'red'}">${totalPct.toFixed(0)}%</div>
        <div class="pil-metric-sub">${Math.abs(totalPct - 100) < 1 ? '✅ Équilibré' : '⚠️ Écart : ' + (totalPct - 100).toFixed(0) + '%'}</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Marge brute moy.</div>
        <div class="pil-metric-val green">${mbMoy.toFixed(1)}%</div>
        <div class="pil-metric-sub">pondérée par mix</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Marge nette moy.</div>
        <div class="pil-metric-val ${mnMoy >= 0 ? 'green' : 'red'}">${mnMoy.toFixed(1)}%</div>
        <div class="pil-metric-sub">après charges hub</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">CA estimé</div>
        <div class="pil-metric-val teal">${N(totalCA)} KMF</div>
        <div class="pil-metric-sub">mensuel total</div>
      </div>
    `;

    // Alert
    const alertEl = $('[data-pil-mix-alert]');
    alertEl.style.display = Math.abs(totalPct - 100) < 1 ? 'none' : 'block';

    // Charts
    const maxCA = Math.max(...caItems.map(i => i.value), 1);
    buildBarChart($('[data-pil-mix-chart-ca]'), caItems.map(i => ({ ...i, max: maxCA, suffix: N(i.value) + ' KMF' })));
    const maxMarge = Math.max(...margeItems.map(i => Math.abs(i.value)), 1);
    buildBarChart($('[data-pil-mix-chart-marge]'), margeItems.map(i => ({ ...i, max: maxMarge, suffix: '' })));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB 3: DASHBOARD LIVE
  // ═══════════════════════════════════════════════════════════════════════
  function loadDashboard() {
    const statusEl = $('[data-pil-dash-status]');
    statusEl.innerHTML = '<div class="ct-loading">⏳ Chargement des données…</div>';

    Promise.all([
      apiFetch('/api/dashboard/pilotage'),
      apiFetch('/api/dashboard/finance').catch(() => ({})),
      apiFetch('/api/orders?limit=100').catch(() => ({ rows: [] })),
    ]).then(([pilotage, finance, ordersData]) => {
      // Merge pilotage + finance into a unified stats object
      const vol = pilotage.volume || {};
      const stats = {
        ca: pilotage.ca,
        volume: { ...vol, total_commandes: vol.total },
        pipeline: pilotage.pipeline,
        categories: pilotage.categories,
        couts: pilotage.couts,
        // Finance data
        marges: finance.marges ? {
          brute_pct: finance.marges.taux_marge_pct,
          brute_kmf: finance.marges.marge_reelle_kmf,
          alerte: finance.marges.alertes_perte ? finance.marges.alertes_perte.count + ' vente(s) à perte' : null,
        } : null,
        top_produits: (finance.top_produits || []).map(p => ({
          produit: p.nom, categorie: p.categorie, qte: p.qty,
          prix_vente_kmf: p.ca_kmf, cdr_kmf: 0,
        })),
        taux_conversion: finance.kpi ? (finance.kpi.nb_livrees && finance.kpi.nb_commandes
          ? (finance.kpi.nb_livrees / finance.kpi.nb_commandes * 100).toFixed(1) + '%'
          : '—') : '—',
      };
      _pil.dashData = { stats, orders: ordersData.rows || ordersData || [] };
      statusEl.innerHTML = '<div style="color:#16a34a;font-size:0.78rem;">✅ Données chargées</div>';
      setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
      renderDashboard();
    }).catch(err => {
      statusEl.innerHTML = `<div class="ct-error">❌ Erreur chargement : ${err.message}</div>`;
    });
  }

  function renderDashboard() {
    const data = _pil.dashData;
    if (!data) return;
    const s = data.stats;
    const orders = data.orders;

    // KPIs
    const totalCA = s.ca_total_kmf || s.ca?.total_kmf || 0;
    const nbCmd = s.total_commandes || s.volume?.total_commandes || 0;
    const panierMoy = nbCmd > 0 ? totalCA / nbCmd : 0;
    const margePct = s.marge_pct || s.marges?.brute_pct || 0;
    const tauxConv = s.taux_conversion || '—';

    $('[data-pil-dash-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">CA total</div>
        <div class="pil-metric-val teal">${N(totalCA)} KMF</div>
        <div class="pil-metric-sub">${s.ca?.total_eur ? '≈ ' + N(s.ca.total_eur) + ' EUR' : ''}</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Nb commandes</div>
        <div class="pil-metric-val blue">${nbCmd}</div>
        <div class="pil-metric-sub">${s.volume?.livrees || 0} livrées · ${s.volume?.en_cours || 0} en cours</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Panier moyen</div>
        <div class="pil-metric-val amber">${N(panierMoy)} KMF</div>
        <div class="pil-metric-sub">par commande</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Marge globale</div>
        <div class="pil-metric-val ${margePct >= 0 ? 'green' : 'red'}">${typeof margePct === 'number' ? margePct.toFixed(1) + '%' : margePct}</div>
        <div class="pil-metric-sub">${s.marges?.alerte || (s.marges?.brute_kmf ? N(s.marges.brute_kmf) + ' KMF' : '')}</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Taux conversion</div>
        <div class="pil-metric-val blue">${tauxConv}</div>
        <div class="pil-metric-sub">confirmé → payé</div>
      </div>
    `;

    // Douane impact
    updateDouaneImpact();

    // Pipeline
    renderDashPipeline(s);

    // Revenue chart from orders
    renderDashRevenueChart(orders);

    // Top 5 products
    renderDashTopProducts(s);

    // Margin decomposition by category
    renderDashMargeChart(s);
  }

  function updateDouaneImpact() {
    const pct = _pil.dashDouane;
    const impactEl = $('[data-pil-douane-impact]');
    const tAED = _pil.mixTauxAed;
    const tEUR = _pil.mixTauxEur;

    const prixAchat = 359 * tAED;
    const fret = 17 * 12 * 11 / 1e6 * 180 * tEUR;
    const valCIF = prixAchat + fret;
    const douaneTheo = valCIF * 0.20;
    const douaneReel = valCIF * (pct / 100);
    const delta = douaneReel - douaneTheo;
    const impactMarge = prixAchat > 0 ? (delta / (prixAchat * 1.12) * 100) : 0;

    if (pct > 25) {
      impactEl.className = 'pil-douane-impact visible ' + (pct >= 45 ? 'err' : 'warn');
      impactEl.textContent = `⚡ Taux effectif ${pct}% vs 20% théorique : +${N(delta)} KMF/cmd · Impact marge estimé −${Math.abs(impactMarge).toFixed(1)}%`;
    } else {
      impactEl.className = 'pil-douane-impact';
    }
  }

  function renderDashPipeline(s) {
    const pipeline = s.pipeline || [];
    const pipeEl = $('[data-pil-dash-pipeline]');

    if (pipeline.length) {
      pipeEl.innerHTML = pipeline.map(p => {
        const labels = {
          confirmed: '✅ Confirmé', purchasing: '🛒 Achat', preparation: '📦 Préparation',
          shipped: '🚢 Expédié', transit_comores: '⚓ Transit', available: '🏪 Disponible', collected: '🎉 Livré'
        };
        return `<div class="pil-pipeline-step">
          <div class="pil-pipeline-label">${labels[p.statut] || p.statut}</div>
          <div class="pil-pipeline-val">${p.nb}</div>
        </div>`;
      }).join('');
    } else {
      // Fallback from volume data
      const vol = s.volume || {};
      pipeEl.innerHTML = `
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">🛒 En cours</div><div class="pil-pipeline-val">${vol.en_cours || 0}</div></div>
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">🚢 Transit</div><div class="pil-pipeline-val">${vol.en_transit || 0}</div></div>
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">🏪 Disponible</div><div class="pil-pipeline-val">${vol.disponibles || 0}</div></div>
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">🎉 Livrées</div><div class="pil-pipeline-val">${vol.livrees || 0}</div></div>
      `;
    }
  }

  function renderDashRevenueChart(orders) {
    const chartEl = $('[data-pil-dash-chart-ca]');
    if (!orders.length) {
      chartEl.innerHTML = '<div class="ct-empty">Aucune commande récente</div>';
      return;
    }

    // Group by month
    const monthly = {};
    orders.forEach(o => {
      if (!o.created_at) return;
      const key = o.created_at.slice(0, 7);
      if (!monthly[key]) monthly[key] = 0;
      monthly[key] += (o.total_kmf || 0);
    });

    const entries = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
    if (!entries.length) { chartEl.innerHTML = '<div class="ct-empty">Pas assez de données</div>'; return; }

    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    buildBarChart(chartEl, entries.map(([month, val]) => ({
      label: month,
      value: val,
      max: maxVal,
      color: '#3b82f6',
      suffix: N(val) + ' KMF'
    })));
  }

  function renderDashTopProducts(s) {
    const container = $('[data-pil-dash-top]');
    const produits = s.top_produits || [];

    if (!produits.length) {
      container.innerHTML = '<div class="ct-empty">Aucun produit disponible</div>';
      return;
    }

    container.innerHTML = `<table class="ct-table">
      <thead><tr><th>Produit</th><th>Catégorie</th><th>Qté</th><th>CDR estimé</th><th>Prix vente</th><th>Marge brute</th></tr></thead>
      <tbody>${produits.slice(0, 5).map(p => {
        const marge = (p.prix_vente_kmf || 0) - (p.cdr_kmf || 0);
        const margePct = p.prix_vente_kmf > 0 ? (marge / p.prix_vente_kmf * 100) : 0;
        const color = margePct >= 10 ? '#16a34a' : margePct >= 0 ? '#d97706' : '#ef4444';
        return `<tr>
          <td>${p.produit || p.name || '—'}</td>
          <td><span class="ct-badge">${p.categorie || p.category || '—'}</span></td>
          <td style="font-variant-numeric:tabular-nums;color:#d97706;font-weight:600;">${p.qte || 0}</td>
          <td>${N(p.cdr_kmf || 0)}</td>
          <td style="font-weight:600;">${N(p.prix_vente_kmf || 0)}</td>
          <td style="color:${color};font-weight:700;">${margePct.toFixed(1)}%</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function renderDashMargeChart(s) {
    const chartEl = $('[data-pil-dash-chart-marge]');
    const cats = s.categories || [];

    if (!cats.length) {
      chartEl.innerHTML = '<div class="ct-empty">Aucune donnée catégorie</div>';
      return;
    }

    const maxCA = Math.max(...cats.map(c => c.ca_kmf || 0), 1);
    buildBarChart(chartEl, cats.map((c, i) => ({
      label: c.categorie || c.category || 'Autre',
      value: c.ca_kmf || 0,
      max: maxCA,
      color: PALETTE_COLORS[i % PALETTE_COLORS.length],
      suffix: N(c.ca_kmf || 0) + ' KMF'
    })));

    // Legend
    chartEl.innerHTML += buildLegend(cats.map((c, i) => ({
      label: c.categorie || c.category || 'Autre',
      color: PALETTE_COLORS[i % PALETTE_COLORS.length]
    })));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB 4: OPÉRATIONNEL
  // ═══════════════════════════════════════════════════════════════════════
  function loadOps() {
    const kpiEl = $('[data-pil-ops-kpis]');
    const alertsEl = $('[data-pil-ops-alerts]');
    alertsEl.innerHTML = '<div class="ct-loading">⏳ Chargement…</div>';

    Promise.all([
      apiFetch('/api/dashboard/stats'),
      apiFetch('/api/orders?limit=500').catch(() => ({ rows: [] })),
      apiFetch('/api/admin/radar').catch(() => null),
    ]).then(([stats, ordersData, radar]) => {
      const orders = ordersData.rows || ordersData || [];
      _pil.opsData = { stats, orders, radar };
      renderOps();
    }).catch(err => {
      alertsEl.innerHTML = `<div class="ct-error">❌ Erreur : ${err.message}</div>`;
    });
  }

  function renderOps() {
    const data = _pil.opsData;
    if (!data) return;
    const { stats, orders, radar } = data;
    const now = Date.now();

    // KPIs
    const confirmed = orders.filter(o => o.status === 'confirmed');
    const available = orders.filter(o => o.status === 'available');
    const bloques48h = confirmed.filter(o => ageH(o.created_at) > 48);
    const avail7j = available.filter(o => ageJ(o.available_at) > 7);
    const totalNonCancelled = orders.filter(o => o.status !== 'cancelled');
    const totalPaies = orders.filter(o => o.payment_status === 'paid');
    const tauxConv = totalNonCancelled.length > 0 ? Math.round(totalPaies.length / totalNonCancelled.length * 100) : null;

    $('[data-pil-ops-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">Paiements bloqués >48h</div>
        <div class="pil-metric-val ${bloques48h.length > 0 ? 'red' : 'green'}">${bloques48h.length}</div>
        <div class="pil-metric-sub">${confirmed.length} confirmées total</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Retraits en retard >7j</div>
        <div class="pil-metric-val ${avail7j.length > 0 ? 'amber' : 'green'}">${avail7j.length}</div>
        <div class="pil-metric-sub">${available.length} disponibles total</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Taux conversion</div>
        <div class="pil-metric-val teal">${tauxConv !== null ? tauxConv + '%' : '—'}</div>
        <div class="pil-metric-sub">confirmed → payé</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Total commandes</div>
        <div class="pil-metric-val blue">${orders.length}</div>
        <div class="pil-metric-sub">chargées pour analyse</div>
      </div>
    `;

    // Alerts
    const alertes = [];
    bloques48h.forEach(o => alertes.push({ level: 'err', icon: '🔴', ref: o.reference, msg: `Commande en attente de paiement depuis ${fmtH(ageH(o.created_at))}` }));
    avail7j.forEach(o => alertes.push({ level: 'warn', icon: '⚠️', ref: o.reference, msg: `Disponible au relais depuis ${ageJ(o.available_at)}j — destinataire ne s'est pas présenté` }));
    if (alertes.length === 0) {
      alertes.push({ level: 'ok', icon: '✅', ref: '', msg: 'Aucune alerte active — tous les flux sont dans les délais' });
    }

    $('[data-pil-ops-alerts]').innerHTML = alertes.map(a =>
      `<div class="pil-alert pil-alert-${a.level}">
        <span>${a.icon}</span>
        <div>
          ${a.ref ? '<strong>' + a.ref + '</strong> — ' : ''}${a.msg}
        </div>
      </div>`
    ).join('');

    // Delays
    const dConfOrd = medianH(orders, 'created_at', 'ordered_at');
    const dOrdPrep = medianH(orders, 'ordered_at', 'preparation_at');
    const dPrepShip = medianH(orders, 'preparation_at', 'shipped_at');
    const dShipAvai = medianH(orders, 'shipped_at', 'available_at');
    const dAvaiColl = medianH(orders, 'available_at', 'collected_at');
    const dTotal = medianH(orders, 'created_at', 'collected_at');

    $('[data-pil-ops-delais] tbody').innerHTML = `
      <tr><td>Confirmation → Paiement</td><td>${fmtH(dConfOrd)}</td><td>&lt; 24h</td><td>${perfBadge(dConfOrd, 24, 48)}</td></tr>
      <tr><td>Paiement → Hub reçu</td><td>${fmtH(dOrdPrep)}</td><td>&lt; 4j</td><td>${perfBadge(dOrdPrep, 96, 168)}</td></tr>
      <tr><td>Hub → Expédié</td><td>${fmtH(dPrepShip)}</td><td>&lt; 2j</td><td>${perfBadge(dPrepShip, 48, 96)}</td></tr>
      <tr><td>Expédié → Disponible relais</td><td>${fmtH(dShipAvai)}</td><td>3–5 sem.</td><td>${perfBadge(dShipAvai, 504, 840)}</td></tr>
      <tr><td>Disponible → Retiré</td><td>${fmtH(dAvaiColl)}</td><td>&lt; 7j</td><td>${perfBadge(dAvaiColl, 72, 168)}</td></tr>
      <tr style="background:var(--ct-bg-alt,#f8fafc);font-weight:600;"><td><strong>Total bout en bout</strong></td><td>${fmtH(dTotal)}</td><td>&lt; 42j</td><td>${perfBadge(dTotal, 720, 1008)}</td></tr>
    `;

    // Relay performance
    renderOpsRelais(orders);

    // Supplier performance (from orders supplier_name if available)
    renderOpsFournisseurs(orders);
  }

  function renderOpsRelais(orders) {
    const container = $('[data-pil-ops-relais]');
    const relaisMap = {};
    orders.forEach(o => {
      const key = o.relais_name || o.relay_point_name;
      if (!key) return;
      if (!relaisMap[key]) relaisMap[key] = { name: key, total: 0, collected: 0, delais: [] };
      relaisMap[key].total++;
      if (o.status === 'collected') relaisMap[key].collected++;
      if (o.available_at && o.collected_at) {
        relaisMap[key].delais.push((new Date(o.collected_at) - new Date(o.available_at)) / 86400000);
      }
    });

    const arr = Object.values(relaisMap).sort((a, b) => b.total - a.total);
    if (!arr.length) {
      container.innerHTML = '<div class="ct-empty">Aucune donnée relais disponible</div>';
      return;
    }

    container.innerHTML = `<table class="ct-table">
      <thead><tr><th>Relais</th><th>Commandes</th><th>Taux collecte</th><th>Délai médian retrait</th></tr></thead>
      <tbody>${arr.map(r => {
        const tauxColl = r.total > 0 ? Math.round(r.collected / r.total * 100) : 0;
        const medD = r.delais.length ? Math.round(r.delais.sort((a, b) => a - b)[Math.floor(r.delais.length / 2)]) : null;
        const collColor = tauxColl >= 80 ? '#16a34a' : tauxColl >= 60 ? '#d97706' : '#ef4444';
        const dColor = medD === null ? '#94a3b8' : medD <= 3 ? '#16a34a' : medD <= 7 ? '#d97706' : '#ef4444';
        return `<tr>
          <td>${r.name}</td>
          <td>${r.total}</td>
          <td>
            <span style="color:${collColor};font-weight:600;">${tauxColl}%</span>
            <div class="pil-pbar-wrap"><div class="pil-pbar" style="width:${tauxColl}%;background:${collColor};"></div></div>
          </td>
          <td style="color:${dColor};font-weight:600;">${medD !== null ? medD + 'j' : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function renderOpsFournisseurs(orders) {
    const container = $('[data-pil-ops-fournisseurs]');
    // Try to extract supplier info from orders
    const supMap = {};
    orders.forEach(o => {
      const key = o.supplier_name || o.fournisseur;
      if (!key) return;
      if (!supMap[key]) supMap[key] = { name: key, total: 0, delivered: 0, delais: [] };
      supMap[key].total++;
      if (o.status === 'collected' || o.status === 'available') supMap[key].delivered++;
      if (o.ordered_at && o.shipped_at) {
        supMap[key].delais.push((new Date(o.shipped_at) - new Date(o.ordered_at)) / 86400000);
      }
    });

    const arr = Object.values(supMap).sort((a, b) => b.total - a.total);
    if (!arr.length) {
      container.innerHTML = '<div class="ct-empty">Aucune donnée fournisseur disponible — les données supplier ne sont pas incluses dans les commandes</div>';
      return;
    }

    container.innerHTML = `<table class="ct-table">
      <thead><tr><th>Fournisseur</th><th>Commandes</th><th>Taux livraison</th><th>Délai médian</th></tr></thead>
      <tbody>${arr.map(s => {
        const tauxHub = s.total > 0 ? Math.round(s.delivered / s.total * 100) : 0;
        const medD = s.delais.length ? Math.round(s.delais.sort((a, b) => a - b)[Math.floor(s.delais.length / 2)]) : null;
        const hubColor = tauxHub >= 90 ? '#16a34a' : tauxHub >= 70 ? '#d97706' : '#ef4444';
        const dColor = medD === null ? '#94a3b8' : medD <= 3 ? '#16a34a' : medD <= 7 ? '#d97706' : '#ef4444';
        return `<tr>
          <td>${s.name}</td>
          <td>${s.total}</td>
          <td>
            <span style="color:${hubColor};font-weight:600;">${tauxHub}%</span>
            <div class="pil-pbar-wrap"><div class="pil-pbar" style="width:${tauxHub}%;background:${hubColor};"></div></div>
          </td>
          <td style="color:${dColor};font-weight:600;">${medD !== null ? medD + 'j' : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB 5: FIDÉLITÉ & INVENDUS
  // ═══════════════════════════════════════════════════════════════════════
  function loadFidelite() {
    const statusEl = $('[data-pil-fid-status]');
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(217,119,6,0.08)';
    statusEl.style.color = '#d97706';
    statusEl.textContent = '⏳ Chargement données fidélité & invendus…';

    Promise.all([
      apiFetch('/api/admin/loyalty/pending').catch(() => ({ users: [], tiers: [] })),
      apiFetch('/api/products?limit=1000').catch(() => []),
    ]).then(([loyaltyData, productsData]) => {
      statusEl.style.display = 'none';
      const users = loyaltyData.users || loyaltyData || [];
      const tiers = loyaltyData.tiers || [];
      _pil.fidData = { users: Array.isArray(users) ? users : [], tiers: Array.isArray(tiers) ? tiers : [] };
      renderFidelite();
      renderInvendus(productsData);
    }).catch(err => {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(220,38,38,0.08)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = '❌ Erreur : ' + err.message;
    });
  }

  function renderFidelite() {
    const data = _pil.fidData;
    if (!data) return;
    const users = data.users;
    const tiers = data.tiers;
    const BADGE_MAP = { '*': '★', '**': '★★', '***': '★★★', 'VIP': '♛' };

    const fidelises = users.filter(u => u.tier_label);
    const totalClients = users.length;
    const pctFid = totalClients > 0 ? Math.round(fidelises.length / totalClients * 100) : 0;
    const prochains = users.filter(u => u.orders_until_next_tier === 1).length;

    $('[data-pil-fid-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">Clients fidélisés</div>
        <div class="pil-metric-val amber">${fidelises.length}</div>
        <div class="pil-metric-sub">${pctFid}% de la base (${totalClients} clients)</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Remises accordées</div>
        <div class="pil-metric-val blue">— KMF</div>
        <div class="pil-metric-sub">total des remises fidélité</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Impact marge</div>
        <div class="pil-metric-val">—</div>
        <div class="pil-metric-sub">% marge perdue en remises</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Prochain palier</div>
        <div class="pil-metric-val green">${prochains}</div>
        <div class="pil-metric-sub">clients à 1 cmd du prochain palier</div>
      </div>
    `;

    // Tiers
    const tiersEl = $('[data-pil-fid-tiers]');
    const tierColors = { '*': '#f59e0b', '**': '#f59e0b', '***': '#f59e0b', 'VIP': '#0d9488' };
    if (tiers.length) {
      tiersEl.innerHTML = tiers.map(t => {
        const nb = users.filter(u => u.tier_label === t.label).length;
        const pct = totalClients > 0 ? Math.round(nb / totalClients * 100) : 0;
        const badge = BADGE_MAP[t.badge] || t.badge;
        const col = tierColors[t.badge] || '#64748b';
        return `<div class="pil-tier-card" style="--tier-color:${col}">
          <div style="font-size:0.72rem;font-weight:700;color:var(--ct-text-muted,#64748b);">${badge} ${t.label}</div>
          <div style="font-size:1.3rem;font-weight:800;color:${col};margin:4px 0;">${nb}</div>
          <div style="font-size:0.68rem;color:var(--ct-text-muted,#94a3b8);">≥ ${t.min_orders} cmd · -${t.discount_pct}% · ${pct}% clients</div>
        </div>`;
      }).join('');
    } else {
      tiersEl.innerHTML = '<div class="ct-empty">Aucun palier configuré</div>';
    }

    // Top clients
    const topEl = $('[data-pil-fid-top]');
    const sorted = [...users].filter(u => u.orders_count > 0).sort((a, b) => (b.orders_count || 0) - (a.orders_count || 0)).slice(0, 10);
    if (sorted.length) {
      topEl.innerHTML = `<table class="ct-table">
        <thead><tr><th>Client</th><th>Commandes</th><th>Palier</th><th>Remise</th><th>Prochain</th></tr></thead>
        <tbody>${sorted.map(u => {
          const badge = BADGE_MAP[u.tier_badge] || '—';
          const remise = u.discount_pct ? u.discount_pct + '%' : '—';
          const proch = u.orders_until_next_tier > 0 ? 'encore ' + u.orders_until_next_tier + ' cmd' : u.next_tier_label ? '→ ' + u.next_tier_label : 'Max';
          return `<tr>
            <td>${u.name || '—'}</td>
            <td style="font-variant-numeric:tabular-nums;color:#d97706;font-weight:600;">${u.orders_count}</td>
            <td>${u.tier_label ? badge + ' ' + u.tier_label : '<span style="color:#94a3b8;">—</span>'}</td>
            <td style="color:#16a34a;">${remise}</td>
            <td style="font-size:0.72rem;color:#94a3b8;">${proch}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } else {
      topEl.innerHTML = '<div class="ct-empty">Aucun client avec commande</div>';
    }
  }

  function renderInvendus(productsData) {
    const products = Array.isArray(productsData) ? productsData : (productsData.rows || []);

    // Simulate unsold analysis from products (items without recent sales)
    const unsold = products.filter(p => p.is_active === false || p.unsold || p.stock_days > 30);
    const totalUnsold = unsold.length;
    const valeurInit = unsold.reduce((s, p) => s + (p.price_kmf || 0), 0);
    const valeurLiquid = unsold.reduce((s, p) => s + ((p.unsold_price_kmf || p.price_kmf * 0.7) || 0), 0);
    const joursMoy = unsold.length ? Math.round(unsold.reduce((s, p) => s + (p.stock_days || p.jours_en_stock || 15), 0) / unsold.length) : 0;

    $('[data-pil-uns-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">Articles invendus</div>
        <div class="pil-metric-val ${totalUnsold > 0 ? 'amber' : 'green'}">${totalUnsold}</div>
        <div class="pil-metric-sub">articles en stock prolongé</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Valeur liquidation</div>
        <div class="pil-metric-val amber">${N(valeurLiquid)} KMF</div>
        <div class="pil-metric-sub">prix réduit total</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Valeur initiale</div>
        <div class="pil-metric-val blue">${N(valeurInit)} KMF</div>
        <div class="pil-metric-sub">prix catalogue original</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Jours moy. en stock</div>
        <div class="pil-metric-val">${joursMoy || '—'} j</div>
        <div class="pil-metric-sub">durée moyenne immobilisation</div>
      </div>
    `;

    // Channels
    const canauxEl = $('[data-pil-uns-canaux]');
    const nbWA = unsold.filter(p => p.channel === 'whatsapp' || p.canal === 'whatsapp').length;
    const nbRev = unsold.filter(p => p.channel === 'revendeur' || p.canal === 'revendeur').length;
    const nbBoth = unsold.filter(p => p.channel === 'both' || p.canal === 'both').length;
    const nbNone = totalUnsold - nbWA - nbRev - nbBoth;

    if (totalUnsold > 0) {
      const items = [
        { label: '📱 WhatsApp', value: nbWA || Math.round(totalUnsold * 0.4), color: '#25d366' },
        { label: '🏪 Revendeur', value: nbRev || Math.round(totalUnsold * 0.3), color: '#3b82f6' },
        { label: '📱+🏪 Les deux', value: nbBoth || Math.round(totalUnsold * 0.2), color: '#8b5cf6' },
        { label: '❓ Non assigné', value: nbNone > 0 ? nbNone : Math.round(totalUnsold * 0.1), color: '#94a3b8' },
      ].filter(i => i.value > 0);
      const maxV = Math.max(...items.map(i => i.value), 1);
      buildBarChart(canauxEl, items.map(i => ({ ...i, max: maxV, suffix: i.value + ' articles' })));
    } else {
      canauxEl.innerHTML = '<div class="ct-empty" style="color:#16a34a;">✅ Aucun invendu actif — bonne santé du stock</div>';
    }

    // Pipeline table
    const pipeEl = $('[data-pil-uns-pipeline]');
    if (unsold.length) {
      pipeEl.innerHTML = `<table class="ct-table">
        <thead><tr><th>Article</th><th>Prix initial</th><th>Prix liquidation</th><th>Remise</th><th>Jours stock</th><th>Canal</th></tr></thead>
        <tbody>${unsold.slice(0, 20).map(p => {
          const jours = p.stock_days || p.jours_en_stock || 0;
          const jourColor = jours > 20 ? '#ef4444' : jours > 10 ? '#d97706' : '#64748b';
          const pInit = p.price_kmf || 0;
          const pLiquid = p.unsold_price_kmf || Math.round(pInit * 0.7);
          const remise = pInit > 0 ? Math.round((1 - pLiquid / pInit) * 100) : 0;
          return `<tr>
            <td>${p.name || p.product_name || '—'}</td>
            <td>${N(pInit)} KMF</td>
            <td style="color:#d97706;font-weight:700;">${N(pLiquid)} KMF</td>
            <td style="color:#ef4444;">-${remise}%</td>
            <td style="color:${jourColor};font-weight:600;">${jours}j</td>
            <td><span class="ct-badge">${p.channel || p.canal || '—'}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } else {
      pipeEl.innerHTML = '<div class="ct-empty" style="color:#16a34a;">✅ Aucun invendu actif</div>';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB 6: CLIENTS & VENTES
  // ═══════════════════════════════════════════════════════════════════════
  function loadClients() {
    const kpiEl = $('[data-pil-cli-kpis]');
    kpiEl.innerHTML = '<div class="ct-loading">⏳ Chargement…</div>';

    Promise.all([
      apiFetch('/api/dashboard/stats'),
      apiFetch('/api/orders?limit=500').catch(() => ({ rows: [] })),
    ]).then(([stats, ordersData]) => {
      const orders = ordersData.rows || ordersData || [];
      _pil.cliData = { stats, orders };
      renderClients();
    }).catch(err => {
      kpiEl.innerHTML = `<div class="ct-error">❌ Erreur : ${err.message}</div>`;
    });
  }

  function renderClients() {
    const data = _pil.cliData;
    if (!data) return;
    const { stats, orders } = data;

    // Build client map
    const clientMap = {};
    orders.forEach(o => {
      const key = o.client_email || o.email || o.phone || o.full_name || o.first_name || 'inconnu';
      if (!clientMap[key]) clientMap[key] = {
        name: o.full_name || o.first_name || '—',
        email: o.client_email || o.email || '',
        phone: o.phone || '',
        orders: 0, totalCA: 0, lastOrder: null
      };
      clientMap[key].orders++;
      clientMap[key].totalCA += (o.total_kmf || 0);
      const dt = o.created_at ? new Date(o.created_at) : null;
      if (dt && (!clientMap[key].lastOrder || dt > clientMap[key].lastOrder)) {
        clientMap[key].lastOrder = dt;
      }
    });

    const clients = Object.values(clientMap).sort((a, b) => b.totalCA - a.totalCA);
    const totalClients = clients.length;
    const recurrents = clients.filter(c => c.orders >= 2).length;
    const tauxReachat = totalClients > 0 ? Math.round(recurrents / totalClients * 100) : 0;
    const ltvMoyen = totalClients > 0 ? Math.round(clients.reduce((s, c) => s + c.totalCA, 0) / totalClients) : 0;
    const totalCA = clients.reduce((s, c) => s + c.totalCA, 0);

    // KPIs
    $('[data-pil-cli-kpis]').innerHTML = `
      <div class="pil-metric">
        <div class="pil-metric-label">Clients uniques</div>
        <div class="pil-metric-val blue">${totalClients}</div>
        <div class="pil-metric-sub">sur la période</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">CA total</div>
        <div class="pil-metric-val teal">${N(totalCA)} KMF</div>
        <div class="pil-metric-sub">${orders.length} commandes</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Taux réachat</div>
        <div class="pil-metric-val ${tauxReachat >= 20 ? 'green' : 'amber'}">${tauxReachat}%</div>
        <div class="pil-metric-sub">${recurrents} clients récurrents</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">LTV moyen</div>
        <div class="pil-metric-val amber">${N(ltvMoyen)} KMF</div>
        <div class="pil-metric-sub">valeur vie client</div>
      </div>
    `;

    // Top 20 clients
    const topCliEl = $('[data-pil-cli-top-clients]');
    const top20cli = clients.slice(0, 20);
    if (top20cli.length) {
      topCliEl.innerHTML = `<table class="ct-table">
        <thead><tr><th>#</th><th>Client</th><th>Contact</th><th>Commandes</th><th>CA total</th><th>Dernière commande</th></tr></thead>
        <tbody>${top20cli.map((c, i) => `<tr>
          <td style="color:#94a3b8;font-weight:700;">${i + 1}</td>
          <td style="font-weight:600;">${c.name}</td>
          <td style="font-size:0.72rem;color:#64748b;">${c.email || c.phone || '—'}</td>
          <td style="font-variant-numeric:tabular-nums;color:#d97706;font-weight:600;">${c.orders}</td>
          <td style="font-variant-numeric:tabular-nums;font-weight:700;color:#0d9488;">${N(c.totalCA)} KMF</td>
          <td style="font-size:0.72rem;color:#64748b;">${c.lastOrder ? c.lastOrder.toLocaleDateString('fr-FR') : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    } else {
      topCliEl.innerHTML = '<div class="ct-empty">Aucun client</div>';
    }

    // Top 20 products by units
    const prodMap = {};
    orders.forEach(o => {
      const items = o.items || [];
      items.forEach(it => {
        const key = it.product_name || it.name || 'inconnu';
        if (!prodMap[key]) prodMap[key] = { name: key, category: it.category || '', qty: 0, ca: 0 };
        prodMap[key].qty += (it.quantity || 1);
        prodMap[key].ca += (it.total_kmf || it.price_kmf || 0);
      });
      // Fallback: if no items, count the order itself
      if (!items.length && o.product_name) {
        const key = o.product_name;
        if (!prodMap[key]) prodMap[key] = { name: key, category: o.category || '', qty: 0, ca: 0 };
        prodMap[key].qty++;
        prodMap[key].ca += (o.total_kmf || 0);
      }
    });

    const topProd = Object.values(prodMap).sort((a, b) => b.qty - a.qty).slice(0, 20);
    const topProdEl = $('[data-pil-cli-top-products]');
    if (topProd.length) {
      topProdEl.innerHTML = `<table class="ct-table">
        <thead><tr><th>#</th><th>Produit</th><th>Catégorie</th><th>Unités vendues</th><th>CA</th></tr></thead>
        <tbody>${topProd.map((p, i) => `<tr>
          <td style="color:#94a3b8;font-weight:700;">${i + 1}</td>
          <td style="font-weight:600;">${p.name}</td>
          <td><span class="ct-badge">${p.category || '—'}</span></td>
          <td style="font-variant-numeric:tabular-nums;color:#d97706;font-weight:600;">${p.qty}</td>
          <td style="font-variant-numeric:tabular-nums;color:#0d9488;">${N(p.ca)} KMF</td>
        </tr>`).join('')}</tbody>
      </table>`;
    } else {
      topProdEl.innerHTML = '<div class="ct-empty">Aucun détail produit disponible dans les commandes</div>';
    }

    // Sales by relay
    renderCliRelais(orders);

    // Category distribution
    renderCliCategories(orders);

    // Monthly evolution
    renderCliMonthly(orders);
  }

  function renderCliRelais(orders) {
    const container = $('[data-pil-cli-relais]');
    const relaisMap = {};
    orders.forEach(o => {
      const key = o.relais_name || o.relay_point_name || o.relay_name;
      if (!key) return;
      if (!relaisMap[key]) relaisMap[key] = { name: key, total: 0, ca: 0 };
      relaisMap[key].total++;
      relaisMap[key].ca += (o.total_kmf || 0);
    });

    const arr = Object.values(relaisMap).sort((a, b) => b.ca - a.ca);
    if (!arr.length) {
      container.innerHTML = '<div class="ct-empty">Aucune donnée relais</div>';
      return;
    }

    const maxCA = Math.max(...arr.map(r => r.ca), 1);
    buildBarChart(container, arr.map((r, i) => ({
      label: r.name,
      value: r.ca,
      max: maxCA,
      color: PALETTE_COLORS[i % PALETTE_COLORS.length],
      suffix: r.total + ' cmd · ' + N(r.ca) + ' KMF'
    })));
  }

  function renderCliCategories(orders) {
    const container = $('[data-pil-cli-categories]');
    const catMap = {};
    orders.forEach(o => {
      const items = o.items || [];
      if (items.length) {
        items.forEach(it => {
          const cat = it.category || 'Autre';
          if (!catMap[cat]) catMap[cat] = 0;
          catMap[cat] += (it.total_kmf || it.price_kmf || 0);
        });
      } else {
        const cat = o.category || 'Non catégorisé';
        if (!catMap[cat]) catMap[cat] = 0;
        catMap[cat] += (o.total_kmf || 0);
      }
    });

    const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      container.innerHTML = '<div class="ct-empty">Aucune donnée catégorie</div>';
      return;
    }

    const maxVal = Math.max(...entries.map(e => e[1]), 1);
    buildBarChart(container, entries.map(([cat, val], i) => ({
      label: cat,
      value: val,
      max: maxVal,
      color: PALETTE_COLORS[i % PALETTE_COLORS.length],
      suffix: N(val) + ' KMF'
    })));

    container.innerHTML += buildLegend(entries.map(([cat], i) => ({
      label: cat,
      color: PALETTE_COLORS[i % PALETTE_COLORS.length]
    })));
  }

  function renderCliMonthly(orders) {
    const container = $('[data-pil-cli-monthly]');
    const monthly = {};
    orders.forEach(o => {
      if (!o.created_at) return;
      const key = o.created_at.slice(0, 7);
      if (!monthly[key]) monthly[key] = { ca: 0, count: 0 };
      monthly[key].ca += (o.total_kmf || 0);
      monthly[key].count++;
    });

    const entries = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
    if (!entries.length) {
      container.innerHTML = '<div class="ct-empty">Pas assez de données mensuelles</div>';
      return;
    }

    const maxCA = Math.max(...entries.map(e => e[1].ca), 1);
    buildBarChart(container, entries.map(([month, data]) => ({
      label: month,
      value: data.ca,
      max: maxCA,
      color: '#3b82f6',
      suffix: data.count + ' cmd · ' + N(data.ca) + ' KMF'
    })));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EVENT DELEGATION
  // ═══════════════════════════════════════════════════════════════════════
  main.addEventListener('click', function(e) {
    const target = e.target;

    // ── Tab switching
    if (target.dataset.pilTab) {
      switchTab(target.dataset.pilTab);
      return;
    }

    // ── Temporel: month selector
    if (target.dataset.pilMonths) {
      _pil.months = parseInt(target.dataset.pilMonths);
      $$('[data-pil-months]').forEach(b => b.classList.toggle('active', b.dataset.pilMonths === target.dataset.pilMonths));
      computeTemporel();
      return;
    }

    // ── Temporel: phase selector
    if (target.dataset.pilPhase) {
      _pil.phase = target.dataset.pilPhase;
      $$('[data-pil-phase]').forEach(b => b.classList.toggle('active', b.dataset.pilPhase === target.dataset.pilPhase));
      computeTemporel();
      return;
    }

    // ── Dashboard: period selector
    if (target.dataset.pilDashPeriod) {
      _pil.dashPeriod = target.dataset.pilDashPeriod;
      $$('[data-pil-dash-period]').forEach(b => b.classList.toggle('active', b.dataset.pilDashPeriod === target.dataset.pilDashPeriod));
      _pil.loaded['dashboard'] = false;
      _pil.loaded['dashboard'] = true;
      loadDashboard();
      return;
    }

    // ── Dashboard: refresh
    if (target.closest('[data-pil-dash-refresh]')) {
      loadDashboard();
      return;
    }

    // ── Ops: refresh
    if (target.closest('[data-pil-ops-refresh]')) {
      _pil.opsData = null;
      loadOps();
      return;
    }

    // ── Clients: period
    if (target.dataset.pilCliPeriod) {
      $$('[data-pil-cli-period]').forEach(b => b.classList.toggle('active', b.dataset.pilCliPeriod === target.dataset.pilCliPeriod));
      loadClients();
      return;
    }

    // ── Clients: refresh
    if (target.closest('[data-pil-cli-refresh]')) {
      _pil.cliData = null;
      loadClients();
      return;
    }
  });

  // ── Input events (range sliders, number inputs)
  main.addEventListener('input', function(e) {
    const target = e.target;

    // ── Temporel: growth slider
    if (target.dataset.pilGrowth !== undefined) {
      _pil.growthPct = parseInt(target.value);
      const valEl = $('[data-pil-growth-val]');
      if (valEl) valEl.textContent = target.value + '%';
      computeTemporel();
      return;
    }

    // ── Dashboard: douane slider
    if (target.dataset.pilDouaneRange !== undefined) {
      _pil.dashDouane = parseInt(target.value);
      const valEl = $('[data-pil-douane-val]');
      if (valEl) valEl.textContent = target.value + '%';
      updateDouaneImpact();
      return;
    }

    // ── Mix: global parameters
    if (target.dataset.pilMixAed !== undefined) {
      _pil.mixTauxAed = parseFloat(target.value) || 139;
      renderMix();
      return;
    }
    if (target.dataset.pilMixEur !== undefined) {
      _pil.mixTauxEur = parseFloat(target.value) || 495;
      renderMix();
      return;
    }
    if (target.dataset.pilMixMarge !== undefined) {
      _pil.mixMargePct = parseFloat(target.value) || 12;
      renderMix();
      return;
    }
    if (target.dataset.pilMixVol !== undefined) {
      _pil.mixVolume = parseFloat(target.value) || 100;
      renderMix();
      return;
    }

    // ── Mix: per-category inputs
    const prixKey = target.dataset.pilMixPrix;
    if (prixKey && _pil.mixCats[prixKey]) {
      _pil.mixCats[prixKey].prixAed = parseFloat(target.value) || 0;
      renderMix();
      return;
    }

    const pctKey = target.dataset.pilMixPct;
    if (pctKey && _pil.mixCats[pctKey]) {
      _pil.mixCats[pctKey].pct = parseFloat(target.value) || 0;
      renderMix();
      return;
    }

    const terrainKey = target.dataset.pilMixTerrain;
    if (terrainKey) {
      const v = parseFloat(target.value);
      if (!isNaN(v) && v > 0) {
        _pil.prixTerrain[terrainKey] = v;
      } else {
        delete _pil.prixTerrain[terrainKey];
      }
      try { localStorage.setItem('komerce_prix_terrain_cat', JSON.stringify(_pil.prixTerrain)); } catch(e) {}
      renderMix();
      return;
    }
  });

  // ── Change events (checkboxes)
  main.addEventListener('change', function(e) {
    const target = e.target;

    const checkKey = target.dataset.pilMixCheck;
    if (checkKey && _pil.mixCats[checkKey]) {
      _pil.mixCats[checkKey].active = target.checked;
      if (!target.checked) _pil.mixCats[checkKey].pct = 0;
      renderMix();
      return;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // INITIAL LOAD — first tab
  // ═══════════════════════════════════════════════════════════════════════
  _pil.loaded['temporel'] = true;
  loadTemporel();
};

})();
