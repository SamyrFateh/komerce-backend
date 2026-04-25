# ADR-003 — Enrichissement vue Comptabilité (Accounting v2)

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Point 3 du plan de complétion Control Tower.

---

## Contexte

La vue `ct-views-accounting.js` initiale (v1) affichait :
- Balance KMF/EUR + taux (avec bug : lisait `fin.total_ca_kmf` inexistant)
- Transactions récentes (liste `recent_orders` inexistante dans la réponse `/finance`)
- Export CSV simple

**Problèmes** :
- Champs mal lus (`fin.total_ca_kmf` au lieu de `fin.kpi.ca_kmf`) → affichage cassé
- Pas de vue par section métier (grand livre)
- Pas de rapprochement cash relais (pourtant essentiel vu le modèle cash)
- Pas de suivi des commandes non encaissées

## Décision

**Réécrire la vue en consommant 4 endpoints existants** (aucun nouvel endpoint ni migration) :

| Endpoint | Usage |
|---|---|
| `GET /api/dashboard/finance?period=N` | KPI globaux, marges réelles, top produits |
| `GET /api/admin/economic/charges` | Grand livre par famille (charges configurées) |
| `GET /api/cash/reconciliation?from=&to=` | Rapprochement attendu/collecté/déposé par agent |
| `GET /api/cash/uncollected?hours=N` | Commandes cash livrées non encaissées |

## Structure de l'UI

**5 sections empilées :**

```
┌─ Header + sélecteurs période (7/30/90/365j) + date range cash ─┐
├─ KPI (4 cards)                                                 │
│   CA période · Contre-valeur EUR · Taux EUR/KMF · Marge réelle │
├─ Grand livre par section                                       │
│   Accordions par famille (Démarrage/Croisière/Opérationnelle…) │
│   Total mensuel + par commande + hebdo + ponctuel              │
├─ Réconciliation cash relais                                    │
│   Cards par agent (clean/warning/alert)                        │
│   Attendu vs Collecté vs Déposé (vérifié + en attente + dispute)│
│   Écarts colorés                                               │
├─ Commandes non encaissées                                      │
│   Sélecteur seuil (24/48/72h/7j)                               │
│   Table avec badges âge                                        │
├─ Top produits période                                          │
│   Vue synthétique (transactions détaillées → vue Ventes)       │
└────────────────────────────────────────────────────────────────┘
```

## Règles d'affichage

### Status réconciliation

Les agents sont classés en 3 niveaux visuels :

| Status | Condition | Indicateur visuel |
|---|---|---|
| `clean` | Gap collecte = 0 ET gap dépôt = 0 | bordure verte |
| `warning` | Gap collecte < 10% de l'attendu, ou petit écart dépôt | bordure orange |
| `alert` | Gap collecte ≥ 10% attendu, ou gap dépôt > 20% | bordure rouge + fond rosé |

### Ancienneté commandes non encaissées

| Âge | Couleur badge |
|---|---|
| < 72h | jaune clair |
| 72h – 7j | orange |
| > 7j | rouge |

### Code couleur marge réelle

| Taux marge | Couleur |
|---|---|
| ≥ 25% | vert |
| 15–25% | orange |
| < 15% | rouge |

## Exports CSV (4 types ciblés)

Chaque section a son propre bouton `⬇ CSV` qui exporte un fichier dédié :

| Section | Fichier | Colonnes |
|---|---|---|
| Grand livre | `komerce-grand-livre-{date}.csv` | Section, Label, Nom, Montant KMF, Récurrence, Actif, Notes |
| Réconciliation | `komerce-reconciliation-{from}-au-{to}.csv` | Agent, Attendu, Collecté, Déposé vérifié, En attente, Litigieux, Gap collecte, Gap dépôt, Statut |
| Non encaissées | `komerce-non-encaissees-{date}.csv` | Référence, Client, Téléphone, Montant, Statut, Créée le, Âge (h) |
| Top produits | `komerce-top-produits-{Nj}-{date}.csv` | Rang, Produit, Catégorie, Quantité, CA KMF |

BOM UTF-8 ajouté en début de fichier pour compatibilité Excel FR.

## Limites connues

1. **Pas de transactions détaillées** dans la réponse `/finance` → on affiche Top produits comme proxy. Pour le détail ligne par ligne, l'utilisateur consulte la vue **Ventes**.
2. **La réconciliation agrège toutes les commandes cash globalement** (pas de lien order → agent individuel). Le détail par agent vient de `cash_collections` (qui a vraiment collecté).
3. **Les charges dépendent de la config Moteur économique** — si aucune charge n'est saisie, la section Grand livre reste vide avec un message d'invitation.

## Accessibilité & UX

- Accordions par famille (évite les listes interminables)
- État d'ouverture maintenu en session via `state.openFamilies`
- Info-bulles via `acct-hint` (italique en sous-titre) qui expliquent chaque section
- Sélecteurs période globale (7/30/90/365j) + date range spécifique cash (for audit période comptable)

## Fichiers touchés

- **Réécrit :** `public/js/ct-views-accounting.js` (v2 complète, 576 lignes vs 132 avant)
- **Inchangé :** `routes/dashboard.js`, `routes/cash.js`, `routes/economic-engine.js` (tous les endpoints existaient déjà)

Aucune migration SQL nécessaire. Aucun nouvel endpoint créé.

## Déploiement

1. Écraser `public/js/ct-views-accounting.js` dans le repo
2. Ajouter `docs/ADR-003-accounting-v2.md`
3. Commit + push → Railway build auto
4. Ouvrir Control Tower → section **Finance BO** → **📊 Comptabilité** → les 5 sections doivent s'afficher
5. **Si Moteur économique n'a jamais été initialisé**, le grand livre sera vide avec un message explicite → aller dans la vue Moteur économique pour ajouter des charges
