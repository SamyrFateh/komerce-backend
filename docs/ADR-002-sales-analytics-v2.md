# ADR-002 — Enrichissement vue Ventes (Sales Analytics v2)

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Point 2 du plan de complétion Control Tower.

---

## Contexte

La vue `ct-views-sales.js` initiale (v1) affichait seulement :
- KPI basiques (CA, commandes, panier moyen)
- **Marge brute hardcodée à 25%** (fausse)
- Top 5 produits
- CA par île
- CA par mode de paiement

Il manquait : marges réelles, évolution temporelle, funnel de conversion, répartition par catégorie avec marge, et cohortes de rétention.

## Décision

**Enrichir l'endpoint existant `/api/dashboard/sales`** (pas de nouvel endpoint) et refaire la vue `ct-views-sales.js` pour tout consommer.

### 5 ajouts côté endpoint

| Ajout | Source des données | Détails |
|---|---|---|
| **Marges réelles** | `orders.cost_real_kmf`, `orders.margin_real_pct` | Remplace le `margeEst = ca × 0.25` hardcodé |
| **Évolution temporelle** | `date_trunc('day' ou 'week', created_at)` | Buckets jour si ≤31j, semaine sinon |
| **Funnel commandes** | Filtres sur `orders.status` + `payment_status` | 5 étapes : créées → confirmées → expédiées → livrées → payées |
| **Par catégorie** | JOIN `order_items` + `products` + pondération par `margin_real_pct` | CA + marge KMF + taux |
| **Cohortes** | Première commande par `client_phone` puis offset mensuel | Matrice 6×6 (rétention) |

### Couverture des données

Le champ `marges.couverture_pct` indique le % de commandes qui ont une marge calculable (`cost_real_kmf IS NOT NULL`). Si la couverture est faible, la marge globale affichée est moins fiable — l'interface le signale.

## UI

**Layout 7 sections empilées :**

```
┌─ Header + période (7/30/90/365j) ──────────────────────────┐
├─ KPI (4 cards) — CA · Cmd · Panier · Marge réelle         │
├─ Évolution CA (bar chart SVG/CSS) avec tooltips hover     │
├─ Funnel commandes (5 barres + % drop entre étapes)        │
├─ Par catégorie (tableau avec bars + taux coloré)          │
├─ Top 5 produits                                           │
├─ Par île · Par paiement (2 colonnes)                      │
└─ Cohortes (matrice heatmap avec couleurs selon %)         │
```

### Code couleur des marges/rétention

| Contexte | Seuil bas | Seuil haut |
|---|---|---|
| Marge catégorie | < 15% rouge / 15-25% orange / ≥ 25% vert |
| Rétention cohorte | < 15% rouge / 15-35% orange / ≥ 35% vert |

### Auto-documentation

Chaque section explique ce qu'elle montre via un `sales-hint` (sous-titre italique). L'utilisateur voit en permanence :
- Pourquoi les écarts entre étapes du funnel comptent
- Comment lire la matrice de cohortes (1ère commande en ligne, mois suivants en colonnes)

## Limites connues

1. **Pas de tracking visites/paniers abandonnés** — le funnel commence au statut "commande créée", pas à la visite. Pour ajouter le vrai funnel e-commerce, il faudra d'abord tracker les events côté boutique (hors scope).
2. **Cohortes limitées à 6 mois × 6 mois** — pour rester lisible. Au-delà, une vue séparée "Cohortes détaillées" serait nécessaire.
3. **Attribution marge par catégorie approximative** — on pondère le CA par le taux de marge de la commande (qui peut inclure plusieurs catégories). Acceptable en première approche, à raffiner avec des marges par ligne produit si besoin.

## Fichiers touchés

- **Modifié :** `routes/dashboard.js` — endpoint `/api/dashboard/sales` enrichi (les 5 ajouts dans la même réponse)
- **Réécrit :** `public/js/ct-views-sales.js` — nouvelle UI complète (v2), styles injectés, helpers format

Aucune migration SQL nécessaire — toutes les données viennent de tables existantes (`orders`, `order_items`, `products`).

## Déploiement

1. Push code → Railway rebuild
2. La route `/api/dashboard/sales` expose directement la nouvelle structure (backward-compatible sur les champs existants)
3. La vue CT est automatiquement utilisée à la place de l'ancienne
4. **Aucun impact sur les autres vues** qui consomment `/sales` (elles ignorent simplement les nouveaux champs)
