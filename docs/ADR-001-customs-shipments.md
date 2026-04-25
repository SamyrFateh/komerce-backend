# ADR-001 — Historique Douane & Ventilation par Colis

**Date :** avril 2026
**Statut :** Implémenté (migration 034, routes admin, ct-views-customs)
**Contexte :** Réintégration du module "Historique Douane" perdu lors de la migration v84 → Control Tower.

---

## Contexte métier

Komerce importe des marchandises Dubai → Comores en **groupage** (plusieurs colis dans une même cargaison). La douane est payée **globalement** pour la cargaison entière, pas colis par colis. Pourtant, pour calculer la marge réelle de chaque commande, il faut **attribuer une part de douane à chaque colis**.

Le **taux officiel** de douane (ex : 15%) ne reflète pas le **taux réel terrain** (qui peut être 12% ou 22% selon les envois, négociations, changements réglementaires). Le dashboard doit utiliser le taux terrain calculé sur les **envois réels récents**, pas le taux théorique.

## Décision

**Nouvelle table `customs_shipments`** (niveau cargaison) + table de liaison `customs_shipment_parcels` (ventilation automatique vers les colis).

### Schéma

```
customs_shipments
├── Identification : reference, shipment_date, transitaire_name, transport_mode
├── Valeurs saisies : cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg, nb_parcels
├── Méthode : allocation_method ('by_cif_value' | 'by_weight' | 'by_volume' | 'mixed' | 'manual')
├── Calculé : effective_rate_pct = customs_paid_kmf / cif_value_kmf × 100
└── État : is_active, deactivated_at, deactivated_reason

customs_shipment_parcels (ventilation calculée)
├── (shipment_id, parcel_id)  [PK composite]
├── parcel_cif_kmf, parcel_weight_kg   [snapshot au moment de la ventilation]
├── customs_share_kmf                   [part attribuée]
└── allocation_basis, manual_override
```

### Vue `customs_effective_rates`

Calcule le taux terrain moyen sur 30 / 90 / 365 jours à partir des envois **actifs uniquement**. Consommable par `finance.js` pour les calculs de marge réelle.

## Règles métier importantes

### 1. Ventilation automatique

À la création d'un envoi + ids de colis, le backend calcule la part de douane de chaque colis selon `allocation_method` :

| Méthode | Formule | Quand l'utiliser |
|---|---|---|
| `by_cif_value` (défaut) | `total × (valeur_colis / Σ valeurs)` | Droits ad valorem (en % de valeur) |
| `by_weight` | `total × (poids_colis / Σ poids)` | Fret aérien au kg |
| `by_volume` | `total × (volume_colis / Σ volumes)` | Fret mer au m³ |
| `mixed` | `total × (α·cif_ratio + β·weight_ratio)` | Cas réels complexes |
| `manual` | Aucun calcul auto | Override exceptionnel |

### 2. Activation / Désactivation

**Activer** = l'envoi compte dans le taux effectif moyen ET ses parts de douane s'appliquent aux colis.

**Désactiver** (`POST /:id/deactivate`) = **les lignes `customs_shipment_parcels` sont SUPPRIMÉES** (les marges des commandes reviennent au taux théorique) ET l'envoi est exclu des stats. L'envoi reste en historique (audit trail) avec `deactivated_at` + `deactivated_reason`.

C'est le choix fort de cette implémentation : **désactiver n'est pas "masquer", c'est vraiment retirer l'effet financier**. Utile quand :
- Un taux de douane change → on désactive les envois "anciens tarifs" et on repart sur une base neuve
- Une erreur de saisie est découverte → on désactive, on corrige, on réactive

**Réactiver** (`POST /:id/activate` avec `parcel_ids`) = recalcule la ventilation avec les colis fournis.

### 3. Auto-documentation UI

Chaque méthode de ventilation a un **tooltip explicatif** affiché dans l'interface (composant `cust-method-box`), pour qu'un opérateur novice comprenne **pourquoi** choisir une méthode plutôt qu'une autre. Le choix est documenté dans l'interface elle-même, pas seulement dans cette ADR.

## Endpoints

| Méthode | URL | Rôle |
|---|---|---|
| GET | `/api/admin/customs-shipments` | Liste (filtres: `from`, `to`, `active`) |
| POST | `/api/admin/customs-shipments` | Créer un envoi + ventilation initiale |
| GET | `/api/admin/customs-shipments/:id` | Détail + colis ventilés |
| PATCH | `/api/admin/customs-shipments/:id` | Modifier metadata |
| POST | `/api/admin/customs-shipments/:id/deactivate` | Désactiver + retirer ventilation |
| POST | `/api/admin/customs-shipments/:id/activate` | Réactiver + recalculer |
| DELETE | `/api/admin/customs-shipments/:id` | Supprimer définitivement |
| GET | `/api/admin/customs-shipments/rates/effective` | Taux terrain 30/90/365j |

## Alternatives considérées et rejetées

- **Option A : `customs_history` existante** — la table migration 018 existait, mais le schéma était incohérent (code insérait `order_id` alors que la table attendait `parcel_id`) et la granularité par colis oblige à saisir manuellement la décomposition. Abandonné.
- **Stockage direct sur `parcels.customs_*`** — perd la notion d'envoi global et empêche le recalcul en cas de changement de taux.

## Intégration avec `finance.js`

`finance.js` doit lire `customs_effective_rates` pour obtenir le taux terrain, avec fallback sur `finance_config.customs_rate_pct` (valeur par défaut) si aucun envoi n'est enregistré sur la période. Modification à faire dans un second temps (non bloquante pour l'UI).

## Fichiers créés/modifiés

- **Créés :**
  - `migrations/034_customs_shipments.sql`
  - `routes/admin-customs-shipments.js`
  - `public/js/ct-views-customs.js`
  - `docs/ADR-001-customs-shipments.md` (ce fichier)
- **Modifiés :**
  - `server.js` : require + `app.use('/api/admin/customs-shipments', ...)` AVANT `app.use('/api/admin', adminRouter)` (ordre critique Express)
  - `control-tower.html` : `<script src="/js/ct-views-customs.js">`
  - `public/js/ct-platform.js` : registry `id: 'customs'` dans section `finance_bo`

## Migration & déploiement

1. Déployer le code (Railway build)
2. Appliquer la migration 034 : `psql $DATABASE_URL -f migrations/034_customs_shipments.sql`
3. Vérifier que la vue apparaît dans la sidebar BO (section Finance) pour les rôles `founder`, `admin`, `finance`
4. Test : créer un envoi de test, vérifier le calcul du taux effectif
