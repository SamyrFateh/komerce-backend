# ADR-006 — Vue Clients dédiée (CRM analytique)

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Module manquant identifié lors de l'audit architectural. Les clients sont l'actif principal de Komerce mais n'avaient aucune vue dédiée — `renderClients()` était enfoui dans la mégavue `pilotage.js` sans détection des "perdus en cours".

---

## Pourquoi cette vue est critique

Les clients sont **ton actif principal**. Sans vue dédiée :
- ❌ Tu ne sais pas qui sont tes meilleurs clients
- ❌ Tu ne détectes pas les VIP qui s'éteignent (= revenus futurs perdus)
- ❌ Tu ne peux pas chercher un client précis pour répondre à une question SAV
- ❌ Les cohortes et la rétention sont de la théorie

L'audit a relevé que `clients` était dans `PLANNED_VIEWS` du registry mais jamais sorti. Cette ADR comble le manque.

## Décision : identifier un client par (téléphone, nom)

**Pourquoi pas `user_id` seulement ?**

Aujourd'hui beaucoup de commandes sont faites par des **clients invités** (sans création de compte). Donc `orders.user_id` est souvent `NULL` mais le client existe quand même via la table `recipients`.

**Stratégie d'identité retenue** :

```sql
COALESCE(users.phone, recipients.phone) AS client_phone
COALESCE(users.full_name, recipients.full_name) AS client_name
```

Quand un compte sera systématique (futur), on pourra basculer vers `user_id`. La forme actuelle est **provisoire mais fonctionnelle**.

## Segmentation client (5 buckets + total)

| Segment | Définition | Couleur | Action implicite |
|---|---|---|---|
| **🆕 Nouveau** | 1 commande, < 30j depuis 1ère | bleu | Bienvenue, fidéliser |
| **🔁 Récurrent** | ≥ 2 commandes, dernière < 90j | vert | Maintenir, paliers fidélité |
| **⭐ VIP** | LTV ≥ 200k KMF OU ≥ 5 commandes (+ actif < 180j) | orange | **Protéger** |
| **⚠️ À risque** | ≥ 2 commandes mais silencieux 60-180j | rouge | **Relancer urgemment** |
| **💤 Dormant** | Silencieux > 180j | gris | Probablement perdu |

Le seuil VIP est paramétrable via `?vip_threshold=` (défaut 200 000 KMF).

**Le segment "À risque" est central** : ce sont les clients qui ont prouvé leur valeur (≥ 2 commandes) mais qui s'éteignent. C'est là que les actions de relance ont le plus d'impact.

## Endpoints API (3 nouveaux)

| Méthode | URL | Rôle |
|---|---|---|
| GET | `/api/dashboard/clients` | KPI globaux + 5 segments + at_risk + VIP + top + évolution |
| GET | `/api/dashboard/clients/list` | Liste paginée avec recherche, filtres segment + île |
| GET | `/api/dashboard/clients/detail?phone=...` | Fiche détail (profil + 100 commandes + top produits) |

L'endpoint `/clients` était déjà là (v1) — j'ai **réécrit** sa logique pour utiliser (phone, name) au lieu de `user_id`, et ajouté les segments + VIP + à risque.

## UI organisée en 7 sections empilées

```
┌─ Header ─────────────────────────────────────────────────────────┐
├─ KPI : nb clients · commandes · panier moyen · taux récurrence  │
├─ ⚠️ Banner "X clients à risque détectés" si pertinent           │
├─ 🎯 Cards segments cliquables (filtre la liste)                  │
│    Tous · Nouveaux · Récurrents · VIP · À risque · Dormants     │
├─ ⭐ Top 8 VIP actifs                                             │
├─ 📋 Liste clients paginée (recherche + filtre île + segment)    │
│    → clic ligne = ouvre fiche détail (modal)                     │
├─ 📈 Évolution mensuelle (clients / commandes / CA)              │
└─ 📍 Activité par relais                                          │
```

## Fiche client (modal)

S'ouvre au clic sur n'importe quelle ligne du tableau :

```
👤 [Nom du client]
📞 [Téléphone]  ✉ [Email si dispo]
─────────────────────────────────────────────
[LTV]  [Cmd]  [Panier moy]  [Silence]  [Annulées]
─────────────────────────────────────────────
🟢 1ère commande : 12/03/2025
⏱ Dernière : 18/04/2026

📦 Historique des commandes (table 100 dernières)
🏆 Produits préférés (top 20)
```

## Branchement dans la Control Tower

- **Section** : `ct/pilotage` — c'est une vue d'analyse stratégique, pas opérationnelle
- **Roles** : `founder`, `admin`, `finance`, `support` (lecture seule pour finance/support)
- **Filtres supportés** : `period`, `island`, `segment`
- **Position dans le menu** : aux côtés de `Pilotage Stratégique` et `Ventes` (qui sont prévus pour être réorganisés en Phase 3 de l'audit)

## Limites connues

1. **Identité fragile** : si un client change de téléphone, c'est un nouveau client à nos yeux. Acceptable tant qu'il n'y a pas de comptes systématiques.
2. **Pas de dédoublonnage** : si le nom est tapé différemment ("Ali Mohamed" vs "ali mohamed"), ce sont 2 lignes. Un nettoyage CASE INSENSITIVE serait possible.
3. **Pas de tags ni de notes manuelles** : on ne peut pas étiqueter un client comme "VIP family", "professionnel", etc. À ajouter plus tard si besoin.
4. **LTV historique sur toute la période** : pas de notion de LTV "12 derniers mois" séparée.

## Évolutions futures possibles

- **Notes & tags clients** : table `client_notes` avec UID + commentaire libre
- **Export CSV** des segments (pour campagnes externes)
- **Lien WhatsApp direct** depuis la fiche (relance 1-clic)
- **Suggestions d'actions** : "Ce client est VIP à risque, envoyer code promo X"
- **Cohortes interactives** : déjà partiellement dans la vue Sales v2

## Fichiers livrés

- **Modifié** : `routes/dashboard.js` — endpoint `/clients` enrichi + 2 nouveaux endpoints
- **Modifié** : `public/js/ct-platform.js` — registry + retrait de PLANNED_VIEWS
- **Modifié** : `control-tower.html` — load script
- **Créé** : `public/js/ct-views-clients.js` — vue complète (596 lignes)
- **Créé** : `docs/ADR-006-clients-view.md` — ce document

## Déploiement

1. Push code → Railway build
2. Aucune migration SQL nécessaire
3. Control Tower → Pilotage → **👥 Clients**
4. Vérifier que les segments se peuplent correctement
5. Cliquer sur un client → la fiche s'ouvre

Aucun risque de régression : on a ajouté des endpoints et des champs (`segments`, `at_risk_clients`, `vip_clients`) sans casser ce que `/clients` retournait déjà.
