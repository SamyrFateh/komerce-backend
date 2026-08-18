# ADR-009 — Unification source de vérité (Étape 0 refonte Pricing)

**Date :** avril 2026
**Statut :** Implémenté (Étape 0 / 4)
**Contexte :** Avant la refonte du module Pricing, il fallait absolument **unifier la source de vérité** sinon on construisait sur du sable. Cette ADR documente la consolidation.

---

## Problème détecté

Audit du système : **5 sources de vérité parallèles** pour les mêmes paramètres business, qui divergeaient silencieusement.

### Exemple symptomatique : la cible de marge

| Module | Cible | D'où ça vient |
|---|---|---|
| Vue Santé business | **25%** | hardcodé dans `ct-views-sante.js` |
| Pricing simulator | **12%** | hardcodé dans `ct-views-pricing.js` |
| `economic_variables.marge_cible_pct` | **12%** | seed initial |
| `finance_config.target_marge_brute_pct` | **30%** | seed initial différent |

Conséquence : la Vue Santé pouvait dire "rouge sous la cible" alors que le pricing pensait être OK. Aucun module n'avait la vraie cible business.

### Tableau complet des dérives

| Paramètre | Sources parallèles |
|---|---|
| Taux EUR/KMF | `exchange_rates`, `economic_variables.eur_kmf`, `business_rules.EUR_KMF_FALLBACK`, `finance_config.taux_change_eur_kmf`, hardcode JS — **5 sources** |
| Taux AED/KMF | 4 sources |
| Cible marge | 4 valeurs différentes (12, 25, 30, hardcode) |
| Coût hub | 3 sources (en AED *et* en KMF !) |
| Frais Stripe | calculs ad hoc partout |
| 8 catégories douane | en dur dans le JS du pricing |

## Décision business critique : cible marge brute = 40%

**Avant cette ADR** : aucune cible business validée. Chaque module avait sa propre valeur fantôme.

**Après audit business** :

```
Charges fixes mensuelles ≈ 800 000 KMF (estimation prudente)
Volume cible = 100 commandes/mois
Part fixe par commande = 8 000 KMF
Panier moyen ≈ 15 000 KMF
Marge nécessaire pour absorber les fixes = 53%
```

Avec des marges par catégorie réalistes (téléphones 30%, vêtements 45%, cérémonie 55%, etc.) pondérées par le mix CA → **marge brute moyenne ≈ 38%**.

**Cible retenue : 40%**, avec affinage par catégorie en phase 2 (colonne `default_margin_pct` dans `customs_categories`).

## Décisions architecturales

### 1. `finance_config` devient LA source de vérité unique

- C'est un **singleton** (1 seule ligne id=1) → pas de risque de duplication
- Fortement typé (chaque param a sa colonne) → pas de soupe key/value
- A déjà une UI dans Settings + endpoint `/api/admin/finance-config`

**Enrichissement** : ajout de 13 colonnes pour rassembler tous les paramètres business (taux AED, fret, frais Stripe, commissions, seuils Vue Santé, coût hub).

### 2. Nouvelle table `customs_categories`

Sortir les 8 catégories en dur du JS pour permettre l'édition sans déploiement.

```sql
CREATE TABLE customs_categories (
  key TEXT UNIQUE NOT NULL,        -- 'phones', 'vetements', etc.
  label TEXT NOT NULL,
  douane_pct, tva_pct, taxe_add_pct NUMERIC,
  default_dim_l_cm, default_dim_w_cm, default_dim_h_cm INT,
  sh_code, hint TEXT,
  default_margin_pct NUMERIC,      -- cible marge spécifique (ex: 30 pour phones, 55 pour cérémonie)
  ...
);
```

Seed des 8 catégories actuelles avec des cibles marge réalistes par catégorie :

| Catégorie | Marge cible | Justification |
|---|---|---|
| 🧸 Enfants / 📱 Phones / 🏠 Électro | 30-32% | Produits sensibles au prix, volume |
| 🔧 Matériels | 35% | Niche utilitaire, peu de concurrence |
| 👗 Vêtements / 💄 Cosmétiques | 45-50% | Marges naturellement plus élevées |
| 💃 Cérémonie / 💍 Mariage | 55% | Produits événementiels, à forte valeur perçue |

Moyenne pondérée selon le mix CA actuel ≈ 40% → cohérent avec la cible globale.

### 3. `exchange_rates` devient pure historique

- Plus consulté en runtime
- Trigger automatique : à chaque modification du taux dans `finance_config`, une ligne est insérée dans `exchange_rates` pour audit
- Permet de répondre à "à quelle date le taux EUR/KMF a-t-il été modifié à 495 ?"

### 4. `economic_variables` devient legacy en lecture seule

- **Ne pas supprimer** : le moteur `redistribute()` l'utilise pour calculer la marge pondérée par rail (mix A/B/C/D)
- L'UI Modèle économique → tab "Variables" reste accessible mais avec un avertissement "Migré vers Configuration"
- À terme : ne contiendra plus que les paramètres rails et les valeurs computed

### 5. `business_rules` reste, mais périmètre clarifié

- **Garde** : règles fonctionnelles (max quantité par produit, durée de session, seuils anti-fraude...)
- **Quitte** : tout ce qui touche aux taux/marges/coûts (déplacé dans finance_config)

## Cache et invalidation

`utils/rates.js` est revu :
- `getRates()` lit `finance_config` (cache 60s)
- `invalidateCache()` exporté → appelé après chaque PUT `finance_config` ou `pricing/rates`

Conséquence : pas de désync, et pas de N+1 queries sous charge.

## Endpoints API

### Existants (inchangés en signature, comportement adapté)

- `GET /api/pricing/rates` → lit désormais `finance_config` au lieu de `exchange_rates`
- `PUT /api/pricing/rates` → écrit dans `finance_config` + log dans `exchange_rates`
- `GET /api/admin/finance-config` → singleton complet
- `PUT /api/admin/finance-config` → mise à jour + invalidation cache + log historique si taux modifiés

### Nouveaux

- `GET /api/admin/customs-categories` → liste des 8 catégories
- `GET /api/admin/customs-categories/:key` → détail
- `POST /api/admin/customs-categories` → création (rare)
- `PUT /api/admin/customs-categories/:key` → modification
- `DELETE /api/admin/customs-categories/:key` → soft-delete

## Migration

`migrations/036_finance_config_unification.sql` :
1. Ajout des 13 colonnes manquantes à `finance_config` (idempotent)
2. Création table `customs_categories` (idempotent)
3. Seed des 8 catégories
4. **Auto-correction** : si `target_marge_brute_pct` est encore au défaut historique 30%, le passe à 40%
5. **Synchronisation** : si `finance_config.taux_change_eur_kmf` est NULL/obsolète, prend la dernière valeur d'`exchange_rates`

Aucune destruction. Aucune perte de données. Idempotent.

## Étapes suivantes (refonte Pricing)

Cette ADR est l'**Étape 0**. Suivront :

- **Étape 1** : `ct-views-pricing.js` lit `customs_categories` au lieu du `CATS` en dur. Plus de hardcode des taux.
- **Étape 2** : nouvel endpoint `/api/pricing/recommend?product_id=` qui calcule le prix recommandé en intégrant **TOUT** (variables + charges fixes par commande + marge cible par catégorie).
- **Étape 3** : suppression du tab "Configuration" du Pricing → fusionné dans Modèle économique. Plus que 2 tabs : Simulateur + Masse.

## Fichiers livrés

**Créés**
- `migrations/036_finance_config_unification.sql`
- `routes/admin-customs-categories.js`
- `docs/ADR-009-source-verite-unifiee.md`

**Modifiés**
- `utils/rates.js` — getRates() lit finance_config, ajout invalidateCache()
- `routes/pricing.js` — GET/PUT /rates → finance_config
- `routes/admin-finance-config.js` — invalide cache rates + log exchange_rates
- `server.js` — mount du router customs-categories

## Déploiement

```bash
# 1. Push code
git add migrations/036_finance_config_unification.sql \
        routes/admin-customs-categories.js \
        utils/rates.js \
        routes/pricing.js \
        routes/admin-finance-config.js \
        server.js \
        docs/ADR-009-source-verite-unifiee.md
git commit -m "refactor(audit): Étape 0 — unification finance_config source unique (ADR-009)"
git push

# 2. Migration SQL
psql $DATABASE_URL -f migrations/036_finance_config_unification.sql

# 3. Vérifier
psql $DATABASE_URL -c "SELECT target_marge_brute_pct, taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id=1"
psql $DATABASE_URL -c "SELECT key, label, douane_pct, default_margin_pct FROM customs_categories ORDER BY display_order"
```

## Vérifications post-déploiement

- [ ] Le pricing simulator continue à fonctionner (taux récupérés)
- [ ] La Vue Santé continue à fonctionner (utilise encore les seuils en dur, sera migrée à l'étape suivante)
- [ ] La boutique continue à fonctionner (utilise `getRates()` qui lit maintenant `finance_config`)
- [ ] Aucune perte de données dans `economic_variables` ou `charges`
- [ ] Modifier un taux dans `/api/admin/finance-config` met à jour le pricing instantanément

## Limites connues / Évolutions

- **Étape 0 ne déconnecte pas encore les hardcodes** dans `ct-views-pricing.js` et `ct-views-sante.js`. Ce sera l'Étape 1.
- **Pas de UI** pour `customs_categories` encore. Sera créée à l'Étape 2 dans le module Économique.
- **Migration des autres modules** (qui lisent encore `economic_variables`) à faire progressivement, sans urgence puisque les valeurs sont alignées via la migration 036.
