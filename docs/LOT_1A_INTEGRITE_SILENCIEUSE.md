# LOT 1A — Intégrité silencieuse

Statut : **OUVERT — 2/4 sous-lots engagés**. Migration de structure uniquement.

Invariant de lot : **Golden CDR `BEFORE == AFTER`**. Aucun déplacement volontaire de prix n'est autorisé ici. Toute correction de vérité économique appartient au LOT 1B et suivra `DELTA TOTAL == DELTA EXPLIQUÉ`.

## Périmètre figé

La doctrine fixe quatre chantiers pour LOT 1A :

1. **Éditeurs Taxes/Dimensions fantômes** — `pricing_category_taxes` / `pricing_category_dims` sont éditables mais ne sont pas des sources de vérité runtime.
2. **FX USD** — canoniser une seule source/clé runtime sans changer la valeur effectivement consommée.
3. **Commission relais** — désambiguïser les champs concurrents en une règle de priorité unique, sans changer le résultat courant.
4. **`economic_variables`** — traiter la source legacy uniquement **après** migration de `redistribute`; re-tester aussi Ops car `dashboard-ops-queries.js` la lit.

LOT 2 UI reste hors séquence.

## 1A-1 — Éditeurs Taxes/Dimensions fantômes ✅

**Merged : PR #800 — commit `cc32bb4469584d0ed6012e68775de8bdb2112581`.**

Décision de migration additive : **masquer puis purger plus tard**, conformément à I-8.

### État livré

- `GET /api/admin/pricing-matrices/taxes` : conservé temporairement en lecture forensic/compatibilité.
- `GET /api/admin/pricing-matrices/dims` : conservé temporairement en lecture forensic/compatibilité.
- `PUT /api/admin/pricing-matrices/taxes/:category` : **410 Gone**, zéro écriture DB.
- `PUT /api/admin/pricing-matrices/dims/:category` : **410 Gone**, zéro écriture DB.
- Settings : les onglets **Taxes** et **Dimensions** sont masqués par un guard additif chargé après `SettingsView`.
- Sources de vérité rappelées explicitement par le 410 :
  - taxes → `customs_categories.{douane_pct,tva_pct,taxe_add_pct}`;
  - dimensions défaut → `customs_categories.{default_dim_l_cm,default_dim_w_cm,default_dim_h_cm}`.
- Les tables, anciens GET et code legacy interne ne sont **pas supprimés** ici : purge physique en LOT 11 après preuve de remplacement.

### Preuves livrées

- unit : admin guard conservé; PUT taxes/dims = 410; aucune query DB sur PUT; GET conserve sa forme historique;
- intégration DB réelle : ligne taxes/dims strictement identique avant/après un PUT legacy;
- UI : Taxes/Dimensions absents, Règles/Historique conservés, remasquage après rerender;
- Golden CDR : `PARITÉ OK` sur les 13 témoins CURRENT;
- Business Graph régénéré officiellement;
- PR enforcement : vert.

## 1A-2 — FX USD — canonisation CURRENT

Statut : **implémenté sur PR #801, validation finale en cours**.

### Constat prouvé

- La source persistée canonique reste `finance_config` :
  - `taux_change_eur_kmf` pour EUR/KMF;
  - `taux_aed_kmf` pour AED/KMF.
- **Il n'existe pas de colonne USD canonique** dans `finance_config`.
- Le comportement CURRENT dérivait USD de façon répétée dans plusieurs consommateurs :

```text
USD_KMF = 0.92 × EUR_KMF
```

- Cette formule était recopiée dans `services/pricing-cdr.js`, `services/supplier-catalog-scanner.js` et `PricingView.js`.
- La capture Golden DB réelle porte actuellement **EUR=495 / AED=139**.
- `PricingView` utilisait historiquement **EUR=492 / AED=138** via ses fallbacks locaux, car sa lecture du contrat `admin-finance-config` ne consommait pas réellement les taux DB. Brancher directement 495/139 en LOT 1A déplacerait les simulations silencieusement : **interdit**.

### Autorité retenue

`utils/rates.js` est l'autorité runtime unique du FX :

- EUR et AED restent persistés dans `finance_config`;
- USD reste **DERIVED_CURRENT**, jamais édité ni persisté;
- `USD_EUR_CURRENT_RATIO = 0.92` ne vit plus qu'à cet endroit;
- `resolveFxRates(finance)` produit EUR/AED/USD;
- USD est normalisé à 6 décimales pour ne pas exposer le bruit IEEE-754;
- `getRates()` garde volontairement son ancien contrat `{ eur_kmf, aed_kmf }` pour ne pas élargir silencieusement les contrats existants.

### Compatibilité PricingView

`admin-finance-config` expose deux projections distinctes :

```text
fx.current
  → vérité DB réelle + USD dérivé CURRENT

fx.pricing_view_current_compat
  → 492 / 138 / 452.64, reproduction exacte du comportement historique de PricingView
```

`PricingView` consomme désormais `pricing_view_current_compat` au lieu de porter sa propre formule `0.92`. Les literals 492/138/452.64 ne subsistent côté vue que comme fallback **old-server / config indisponible**, explicitement iso-comportemental.

La correction future de la divergence PricingView ↔ DB réelle n'est **pas** absorbée dans 1A-2 : si elle doit déplacer un résultat, elle suivra le protocole de correction de vérité et un delta expliqué.

### Preuves déjà obtenues sur le patch 1A-2

- `rates` + scanner sourcing : **33/33 tests ciblés verts**;
- scanner : USD avec EUR=495 → `10 USD = 4554 KMF`;
- test CDR dédié : un `cost_component` USD de 10 avec EUR=495 est valorisé **4554 KMF**;
- Golden CDR : **13/13 `PARITÉ OK`**, fingerprint `05d6b471d8b870ca`;
- le workflow Golden surveille désormais aussi `utils/rates.js`.

### Gate de fermeture 1A-2

- test `admin-finance-config` avec `fx.current` + `fx.pricing_view_current_compat` vert;
- tests `PricingView` verts;
- Business Graph régénéré via `npm run business-graph:gen`;
- Golden CDR vert sur le head final;
- PR enforcement / Required verdict verts;
- squash merge de PR #801.

## Gates communs LOT 1A

Chaque sous-lot doit satisfaire :

1. **Avant = Après économiquement** : `node tools/golden-cdr/golden-cdr.js verify` vert.
2. Aucun nouveau fallback silencieux.
3. Une variable = une vérité runtime; priorité/fallback documentés quand une migration transitoire l'exige.
4. Tests de non-mutation / parité adaptés au chemin modifié.
5. Aucun chantier de refonte UI : seuls les masques/guards ou branchements de source nécessaires à la suppression d'une fausse vérité sont autorisés.
6. Pas de suppression physique de legacy avant la séquence de purge LOT 11.

## Ordre de travail

- **1A-1** faux éditeurs Taxes/Dimensions — ✅ mergé PR #800.
- **1A-2** FX USD — en validation finale PR #801.
- **1A-3** commission relais — prochain : audit des trois champs puis règle de priorité verrouillée.
- **1A-4** `redistribute` → `economic_variables` — dernier, avec re-test Ops.

LOT 1A est fermé uniquement quand les quatre sous-lots sont prouvés et que le Golden CURRENT reste identique.
