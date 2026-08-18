# LOT 1A — Intégrité silencieuse

Statut : **OUVERT — 3/4 sous-lots traités**. Migration de structure uniquement.

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

- GET taxes/dims conservés temporairement en lecture forensic/compatibilité.
- PUT taxes/dims → **410 Gone**, zéro écriture DB.
- Settings masque les onglets Taxes/Dimensions via un guard additif.
- Sources runtime : `customs_categories`.
- Tables/code legacy conservés jusqu'au LOT 11.
- Golden 13/13, Business Graph et PR enforcement verts.

## 1A-2 — FX USD ✅

**Merged : PR #801 — commit `607e03984887e30d128d74449e44155bc4b0cd00`.**

### Vérité livrée

- EUR/KMF et AED/KMF restent persistés dans `finance_config`.
- USD reste **DERIVED_CURRENT**, jamais persisté ni édité.
- Règle CURRENT unique dans `utils/rates.js` :

```text
USD_KMF = 0.92 × EUR_KMF
```

- CDR et scanner sourcing consomment cette projection.
- `PricingView` ne porte plus sa propre formule USD ; il consomme la projection compat API.
- La divergence historique PricingView **492/138** vs DB réelle Golden **495/139** est rendue explicite mais n'est pas corrigée silencieusement.

### Preuves livrées

- backend FX : **54/54 PASS**;
- PricingView actif sous son harnais Jest/jsdom : PASS;
- scanner + CDR dédié : `10 USD` avec EUR=495 → **4554 KMF**;
- Golden CDR : **13/13 PARITÉ OK**, fingerprint `05d6b471d8b870ca`;
- Business Graph officiel + Required verdict verts.

## 1A-3 — Commission relais — canonisation CURRENT

Statut : **implémenté sur PR #802, validation finale en cours**.

### Audit prouvé

La DB CURRENT contient quatre représentations :

```text
finance_config.commission_relais_pct          = 5%
finance_config.commission_relais_standard_kmf = 500
finance_config.commission_relais_showroom_kmf = 750
cost_components.commission_relais_kmf         = 500
```

Consommation réelle avant 1A-3 :

- CDR estimé → `cost_components.commission_relais_kmf`;
- allocation réelle d'un parcel collecté → `finance_config.commission_relais_standard_kmf`;
- `commission_relais_pct` → éditable mais **aucun consommateur runtime trouvé**;
- `commission_relais_showroom_kmf` → **aucun consommateur runtime trouvé**;
- `business_rules.COMMISSION_RELAIS_*` → legacy, aucun lecteur runtime prouvé;
- copies `economic_variables` → hors scope jusqu'à 1A-4.

### Règle de priorité canonique

`utils/relay-commission.js` fixe une seule priorité CURRENT :

```text
1. cost_components.commission_relais_kmf          ← autorité OWNED nominale
2. finance_config.commission_relais_standard_kmf  ← fallback legacy
3. 500 KMF                                         ← fallback CURRENT ultime
```

`commission_relais_pct` et `showroom` sont volontairement exclus : aucun moteur ne doit deviner un contexte showroom. Une future commission scopée exige un contexte relais explicite et des tests dédiés.

### État cible 1A-3

- `allocateParcelRealCosts()` consomme le composant canonique en priorité ;
- la provenance de la commission réelle est persistée dans `source` et renvoyée au résultat;
- `finance_config.standard` reste fallback legacy uniquement;
- les tentatives PUT sur `%`, `standard` ou `showroom` via `admin-finance-config` → **410 Gone**, zéro écriture DB;
- `commission_relais_pct` reste lisible dans la réponse historique pour compat/forensic mais disparaît du schéma éditable;
- l'éditeur canonique est le composant `cost_components` key `commission_relais_kmf`;
- aucune suppression physique des anciennes colonnes avant LOT 11.

### Preuves déjà obtenues avant push du patch

- resolver : composant > standard > 500, zéro accepté comme valeur explicite;
- Golden snapshot : composant=500, standard=500, showroom=750, pct=5;
- allocation : composant prioritaire + fallback standard + provenance;
- ancien éditeur finance : 410, zéro DB write;
- suite focalisée relais/finance/allocation : **39/39 PASS**;
- Golden CDR : **13/13 PARITÉ OK** avant push du patch.

### Gate de fermeture 1A-3

- helper/pather temporaires retirés;
- workflow Golden étendu à `services/cost-allocation/allocate.js` + `utils/relay-commission.js`;
- Business Graph régénéré officiellement;
- Golden CDR vert sur le head final;
- PR enforcement / Required verdict verts;
- squash merge de PR #802.

## Gates communs LOT 1A

Chaque sous-lot doit satisfaire :

1. **Avant = Après économiquement** : `node tools/golden-cdr/golden-cdr.js verify` vert.
2. Aucun nouveau fallback silencieux.
3. Une variable = une vérité runtime; priorité/fallback documentés quand une migration transitoire l'exige.
4. Tests de non-mutation / parité adaptés au chemin modifié.
5. Aucun chantier de refonte UI : seuls les masques/guards ou branchements de source nécessaires à la suppression d'une fausse vérité sont autorisés.
6. Pas de suppression physique de legacy avant la séquence de purge LOT 11.

## Ordre de travail

- **1A-1** faux éditeurs Taxes/Dimensions — ✅ PR #800.
- **1A-2** FX USD — ✅ PR #801.
- **1A-3** commission relais — validation finale PR #802.
- **1A-4** `redistribute` → `economic_variables` — dernier, avec re-test Ops.

LOT 1A est fermé uniquement quand les quatre sous-lots sont prouvés et que le Golden CURRENT reste identique.
