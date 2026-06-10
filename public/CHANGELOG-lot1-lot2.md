# CHANGELOG — Lot 1 + Lot 2
> Komerce Dashboards — Juin 2026

---

## Lot 1 — Fondation CSS

### `css/tokens.css`
- Ajout de 9 alias rétrocompat manquants : `--surface-primary`, `--surface-secondary`, `--bg-secondary`, `--bg-tertiary`, `--kmc-amber-dark`, `--text-muted`, `--border`, `--radius`, `--radius-lg`
- Impact : toutes les vues qui référençaient ces variables dans le vide héritent maintenant d'une valeur

### `css/components.css`
- Système de boutons complet : `.btn` base + 5 variants (`primary`, `secondary`, `ghost`, `danger`, `info`) + 3 tailles (`sm`, `lg`, `icon`) + états `disabled/focus`
- Aliases rétrocompat `.kmc-btn`, `.kmc-btn-primary`, `.kmc-btn-secondary`, `.kmc-btn-ghost`
- Utilitaires : `.text-truncate`, `.fs-floor-sm`, `.fs-floor-xs`
- Classes texte sémantiques : `.text-success`, `.text-warning`, `.text-danger-c`, `.text-info-c`, `.text-muted-c`
- Classes bg KMC : `.kmc-bg-green/orange/red/blue/amber/gray`

### `hub/index.html` + `relais/index.html`
- `.tab-badge` : 10px → 12px
- `.card-age` : 10px → 12px
- `.info-val` : 12px → 13px
- Toutes les polices sub-11px portées à 11px minimum

---

## Lot 2 — Typographie et tableaux

**Règle appliquée :** données opérationnelles ≥ `var(--fs-sm)` (14px) · labels/th ≥ `var(--fs-xs)` (12px)

### Vues 🔴 critiques (font-size → tokens)

| Vue | Occurrences corrigées | Détail |
|---|---|---|
| `HubRelaisView.js` | 48 | 10px→`--fs-xs`, 11/12px→`--fs-sm`; paddings boutons 3/4px → `sp-1/sp-3` |
| `AccountingView.js` | 14 | idem pattern |
| `SourcingScannerView.js` | 16 | idem pattern |
| `SettingsView.js` | 15 | idem pattern |

### `PricingWorkshopView.js` (rem)
- `0.70–0.72rem` → `var(--fs-xs)`
- `0.75rem` → `var(--fs-xs)` (alias)
- `0.76–0.79rem` → `var(--fs-sm)`
- Couleurs hardcodées `#475569`, `#94a3b8`, `#64748b`, `#1e293b`, `#f8fafc` → tokens

### Vues 🟠 secondaires (corrections ponctuelles)

`SimulatorView`, `SharedCartsView`, `SourcingView`, `SuppliersView`, `CustomsView`, `ProductsView`, `EconomicView`, `ActionCenterView`, `ProblemsView`

- 10px → `var(--fs-xs)` · 11px → `var(--fs-xs)` · 12px → `var(--fs-sm)`
- paddings boutons 3/4px → `var(--sp-1) var(--sp-3)`

---

## Ce qui reste (Lot 3+)

- Migration des styles inline massifs en classes (HubRelaisView, ProductsView, AccountingView, SourcingScannerView)
- Restructuration boutons (remplacement des classes disparates par `.btn .btn-*`)
- `.data-table` unification dans les vues concernées
- Couleurs hardcodées restantes (Lot 3 / Lot 4)
