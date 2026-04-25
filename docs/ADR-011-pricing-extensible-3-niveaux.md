# ADR-011 — Pricing extensible 3 niveaux + UI épurée (Étape 2 refonte Pricing)

**Date :** avril 2026
**Statut :** Implémenté (Étape 2A + 2B + 2C complets)

---

## Problème résolu

Avant : le module Pricing avait les composants mécaniques (fret, douane, transit) mais **pas les composants stratégiques** (provisions risques, charges fixes business, marketing). De plus, ajouter une nouvelle composante de coût nécessitait une modification de code et un déploiement.

Après : système **pleinement extensible** — l'humain peut ajouter, modifier, désactiver, supprimer n'importe quelle composante de coût directement depuis la Control Tower.

## Architecture en 3 niveaux

```
┌─ NIVEAU 1 — VARIABLES PAR COMMANDE (extensibles) ────────────┐
│  Table: pricing_components                                    │
│  Catégories: sourcing, transit, douane, hub, distribution,    │
│              paiement                                         │
│  14 composants seedés + ajout libre                          │
└──────────────────────────────────────────────────────────────┘
                           ▼
┌─ NIVEAU 2 — CHARGES FIXES BUSINESS (mensuelles, amorties) ───┐
│  Table: charges (existante, enrichie avec emoji/order/flags) │
│  Calcul: total_mensuel ÷ volume_cible = part par cmd        │
└──────────────────────────────────────────────────────────────┘
                           ▼
┌─ NIVEAU 3 — PROVISIONS RISQUES (% sur cout total) ───────────┐
│  Table: risk_provisions                                       │
│  5 provisions seedées (retours, casse, impayés, etc.)        │
└──────────────────────────────────────────────────────────────┘
                           ▼
        PRIX RECOMMANDÉ = (N1 + N2 + N3) ÷ (1 - marge_cible)
                          + arrondi psychologique
```

## Capacités CRUD complètes

Chaque ligne, dans chaque niveau, peut être :

| Action | Composants système | Composants utilisateur |
|---|---|---|
| **Lire** | ✅ | ✅ |
| **Toggler on/off** | ✅ | ✅ |
| **Modifier valeur** | ✅ | ✅ |
| **Modifier label/key/unit** | ❌ verrouillé | ✅ |
| **Soft delete** | ✅ | ✅ |
| **Hard delete** | ❌ verrouillé | ✅ via `?force=true` |

## Tables créées (migration 037 / 037b ASCII)

### `pricing_components` (Niveau 1)

```sql
- id, key (unique), label, emoji
- category (sourcing|transit|douane|hub|distribution|paiement)
- default_value, unit (pct|kmf|kmf_per_kg|kmf_per_m3|aed|eur)
- applies_to ('all' | 'channel:diaspora' | 'category:phones' | ...)
- is_active, is_editable, is_deletable
- display_order, notes
```

14 composants seedés répartis sur 6 catégories.

### `risk_provisions` (Niveau 3)

```sql
- id, key (unique), label, emoji
- rate_pct (% sur subtotal Niveau 1+2)
- applies_to (idem)
- is_active, is_editable, is_deletable
- display_order, notes
```

5 provisions seedées :
- `returns` (1.5% all)
- `unpaid_cash` (3.0% channel:cash_relais)
- `damage_transit` (0.8% all)
- `damage_storage` (0.3% all, désactivée par défaut)
- `compensation` (0.5% all)

### `charges` (Niveau 2 — table existante enrichie)

ALTER ajoutant : `emoji`, `display_order`, `is_editable`, `is_deletable`.

## Endpoints créés

### Pour `pricing_components`
- `GET    /api/admin/pricing-components` — liste filtrable
- `GET    /api/admin/pricing-components/:id` — détail
- `POST   /api/admin/pricing-components` — créer (utilisateur)
- `PUT    /api/admin/pricing-components/:id` — modifier
- `PUT    /api/admin/pricing-components/:id/toggle` — toggle is_active
- `DELETE /api/admin/pricing-components/:id` — soft delete
- `DELETE /api/admin/pricing-components/:id?force=true` — hard delete

### Pour `risk_provisions`
- 7 endpoints équivalents

### Pour `customs_categories` (Étape 0, complétés ici)
- `PUT /api/admin/customs-categories/:key/toggle` — ajouté

### Pour `charges` (existants, completés ici)
- `DELETE /api/admin/economic/charges/:id` — ajouté

### Calcul de prix
- `POST /api/pricing/recommend` — calcul d'un produit unitaire (3 niveaux + verdict)
- `POST /api/pricing/recommend-batch` — calcul de tous les produits (jusqu'à 500)
- `PUT  /api/pricing/apply-price/:product_id` — applique un prix recommandé
- `PUT  /api/pricing/apply-all` — applique en masse (admin uniquement)

### Audit
- Table `price_history` (migration 038) — log de chaque application de prix

## Refonte UI complète (Étape 2C)

### Avant : 3 tabs (Simulateur · Masse · Configuration), 2145 lignes

### Après : 1 vue unique scrollable, 820 lignes (-62%)

```
┌─ Header ────────────────────────────────────────┐
│  🧮 Moteur de prix Komerce                      │
│  [🔄 Recalculer] [+ Variable] [+ Provision]     │
└─────────────────────────────────────────────────┘
│
├─ Section Simulateur (ouverte)
│   ├─ Inputs produit (catégorie, prix AED, dim, poids, canal)
│   ├─ Niveau 1 — Variables (ouverte) avec toggles + ajout
│   ├─ Niveau 2 — Charges fixes (réduite, voir Économique)
│   ├─ Niveau 3 — Provisions (réduite) avec toggles + ajout
│   └─ Verdict prix (ouverte) avec décomposition
│
└─ Section Catalogue (ouverte)
    ├─ Résumé : aligned / underpriced / overpriced
    ├─ Filtre + bouton "Tout appliquer" (admin)
    └─ Tableau produits avec écart et bouton "Appliquer"
```

### Décisions UX validées avec l'utilisateur

| Décision | Choix |
|---|---|
| Sections au chargement | N1 + Verdict + Catalogue ouvertes ; N2 + N3 réduites |
| Ajout d'un composant | Slider latéral droit (drawer modal) |
| Recalcul prix | Bouton "Recalculer" explicite (pas auto) |
| Tabs Pricing | Aucun tab (vue unique) — le tab Configuration et Pricing en Masse sont supprimés |
| Cible marge | 40% globale + override par catégorie via `customs_categories.default_margin_pct` |
| Stratégie suppression | Soft delete par défaut, hard delete via `?force=true` |
| Composants système | `is_deletable=false`, label/key/unit verrouillés (mais valeur éditable) |
| "Tout appliquer" | Verrouillé admin/founder uniquement |

### Bouton "Tout appliquer" (Mode A+B)

- **Mode A** : le prix recommandé est calculé en temps réel et affiché à côté du prix actuel
- **Mode B** : un bouton "Appliquer" par produit + un bouton "Tout appliquer" admin
- Audit : chaque application est journalisée dans `price_history`

## Tests à faire après déploiement

### Backend (curl ou Postman)

```bash
# Lister les composants
curl /api/admin/pricing-components -b "kmrc_jwt=..."

# Toggle un composant
curl -X PUT /api/admin/pricing-components/{ID}/toggle -b "kmrc_jwt=..."

# Recommander un prix
curl -X POST /api/pricing/recommend -H "Content-Type: application/json" \
  -b "kmrc_jwt=..." \
  -d '{"category":"phones","prix_aed":200,"volume_m3":0.005,"poids_kg":0.5}'

# Recommander en batch
curl -X POST /api/pricing/recommend-batch -H "Content-Type: application/json" \
  -b "kmrc_jwt=..." \
  -d '{"limit":50}'
```

### Frontend (Control Tower)

1. Ouvrir Pricing → vue unique chargée
2. Configurer un produit (cat: phones, prix: 100 AED, dim: 17×12×11)
3. Cliquer "Recalculer" → voir le prix recommandé
4. Toggler un composant (ex: désactiver "Frais Stripe") → recalculer → écart
5. Ajouter une nouvelle variable via le drawer → recalculer
6. Voir le tableau catalogue en bas → cliquer "Appliquer" sur un produit
7. Si admin → cliquer "Tout appliquer" → confirmation → audit

## Fichiers livrés (Étape 2 complète)

### Migrations SQL
- `migrations/037_pricing_components_risk_provisions.sql` (UTF-8)
- `migrations/037b_pricing_components_risk_provisions_ascii.sql` (ASCII pur Windows)
- `migrations/038_price_history.sql`

### Backend
- `routes/admin-pricing-components.js` (nouveau)
- `routes/admin-risk-provisions.js` (nouveau)
- `routes/admin-customs-categories.js` (+toggle)
- `routes/economic-engine.js` (+DELETE charges)
- `routes/pricing.js` (+recommend-batch +apply-price +apply-all)
- `server.js` (mounts)

### Frontend
- `public/js/ct-views-pricing.js` (réécriture complète, -62%)
- `public/js/ct-platform.js` (tabs nettoyés)

### Documentation
- `docs/ADR-011-pricing-extensible-3-niveaux.md`

## Bénéfices

| Avant | Après |
|---|---|
| Constantes en dur dans 2145 lignes JS | Toutes les variables en BDD |
| Modifier un taux = 4 endroits + déploiement | 1 toggle dans la Control Tower |
| Pas de provisions risques | Système 3-niveaux complet |
| 3 tabs confus | 1 vue scrollable cohérente |
| Pricing en Masse manuel | Auto-recalcul + bouton "Tout appliquer" |
| Pas d'audit prix | Table `price_history` |

## Étapes suivantes

- **Étape 3 (Modèle économique)** : ajouter une UI dans le module Économique pour gérer `customs_categories` et `charges` plus richement (la doc renvoie déjà vers Économique pour les charges)
- **Phase 2 catégories** : compléter `customs_categories.default_margin_pct` avec des cibles affinées par catégorie selon les premières mesures terrain
- **Audit prix** : ajouter un tab "Historique des changements de prix" dans le module Pricing (lecture de `price_history`)
