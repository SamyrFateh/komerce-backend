# LOT 1A — Intégrité silencieuse

Statut : **CLOSED — 4/4 sous-lots prouvés**. Migration de structure uniquement.

Invariant de lot : **Golden CDR `BEFORE == AFTER`**. Aucun déplacement volontaire de prix n'est autorisé ici. Toute correction de vérité économique appartient au LOT 1B et suivra `DELTA TOTAL == DELTA EXPLIQUÉ`.

## Périmètre figé

La doctrine fixe quatre chantiers pour LOT 1A :

1. **Éditeurs Taxes/Dimensions fantômes** — retirer la capacité d'écriture qui ne pilote pas le runtime.
2. **FX USD** — canoniser une seule règle runtime sans changer la valeur effectivement consommée.
3. **Commission relais** — désambiguïser les représentations concurrentes en une priorité unique CURRENT.
4. **`economic_variables`** — migrer `redistribute` et Ops vers `finance_config`, puis rendre le legacy read-only.

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
- La divergence historique PricingView **492/138** vs DB Golden **495/139** est rendue explicite mais n'est pas corrigée silencieusement.

### Preuves

- backend FX : **54/54 PASS**;
- PricingView actif sous son harnais Jest/jsdom : PASS;
- scanner + CDR dédié : `10 USD` avec EUR=495 → **4554 KMF**;
- Golden CDR : **13/13 PARITÉ OK**;
- Business Graph officiel + Required verdict verts.

## 1A-3 — Commission relais ✅

**Merged : PR #802 — commit `3789cce5e65f2195f9a3c26d686534b631ce8345`.**

### Audit CURRENT

La DB contenait quatre représentations :

```text
finance_config.commission_relais_pct          = 5%
finance_config.commission_relais_standard_kmf = 500
finance_config.commission_relais_showroom_kmf = 750
cost_components.commission_relais_kmf         = 500
```

Consommation réelle avant 1A-3 :

- CDR estimé → `cost_components.commission_relais_kmf`;
- allocation réelle → `finance_config.commission_relais_standard_kmf`;
- `%` et `showroom` → aucun consommateur runtime prouvé;
- `business_rules.COMMISSION_RELAIS_*` → legacy, aucun lecteur runtime prouvé.

### Règle canonique CURRENT

`utils/relay-commission.js` :

```text
1. cost_components.commission_relais_kmf          ← autorité OWNED nominale
2. finance_config.commission_relais_standard_kmf  ← fallback legacy
3. 500 KMF                                         ← fallback CURRENT ultime
```

- allocation réelle consomme le composant en priorité et trace sa provenance;
- anciens éditeurs `%`, `standard`, `showroom` → **410 Gone**;
- aucune suppression physique avant LOT 11;
- suite ciblée **39/39 PASS**;
- Golden CDR **13/13 PARITÉ OK**;
- Business Graph + Required verdict verts.

## 1A-4 — `economic_variables` → `finance_config` ✅

**PR #805 — fermeture canonique avec merge de ce livrable.**

### Preflight Railway réel — 2026-08-18

Avant toute migration, le script fail-closed `tools/economic-variables/preflight-1a4.js` a mesuré la DB Railway de référence.

Correspondances déjà égales :

```text
orders_per_month     -> objectif_commandes_mois  : 100 == 100
 target_basket_avg   -> target_panier_moyen_kmf  : 15000 == 15000
hub_monthly_cost_aed -> hub_monthly_cost_aed     : 7000 == 7000
```

Valeurs CURRENT capturées pour les colonnes encore absentes de `finance_config` :

```text
customs_rate_default_pct = 42
mix_rail_a                = 60
mix_rail_b                = 25
mix_rail_c                = 10
mix_rail_d                = 5
margin_rail_a             = 45
margin_rail_b             = 18
margin_rail_c             = 35
margin_rail_d             = 70
```

Le preflight a passé **4/4 tests** et a refusé par construction toute divergence sur les correspondances existantes.

### Migration 119

`migrations/119_economic_variables_to_finance_config.sql` :

- ajoute les 9 colonnes typées manquantes dans `finance_config`;
- sur une DB existante, copie la valeur CURRENT selon la priorité historique exacte `value_used > value_supposed > fallback`;
- sur un environnement neuf sans table legacy au `releaseCommand`, utilise les mêmes fallbacks CURRENT sans référence SQL statique à une table absente;
- est idempotente : une valeur canonique déjà renseignée n'est pas écrasée;
- n'effectue **aucun `INSERT` / `UPDATE` / `DELETE` sur `economic_variables`**.

### Vérité runtime après 1A-4

`services/economic-config.js` devient le pont canonique pour les entrées du modèle :

```text
redistribute ───────┐
Ops pilotage ───────┼──> finance_config
legacy eco-bridge ──┘
```

- `redistribute()` charge ses paramètres depuis `finance_config` et ne persiste plus ses computed dans le legacy;
- les computed sont recalculés et projetés en mémoire;
- Ops lit directement `customs_rate_default_pct` et `hub_monthly_cost_aed` depuis la même SOV;
- `eco-bridge` conserve son API/cache de compatibilité mais lit `finance_config`;
- `seedEconomicData()` ne seed/update plus `economic_variables` au runtime;
- `/variables` conserve les métadonnées legacy pour lecture forensic et superpose les valeurs canoniques/computed fraîches;
- l'ancien PUT `/variables/:key` write-through uniquement les clés dont le mapping runtime est exact; computed et clés sans mapping prouvé sont fail-closed (`410`);
- `NULL` et chaîne vide ne peuvent pas être convertis silencieusement en zéro.

### Ratchets permanents

- `tests/unit/economic-variables-readonly-1a4.test.js` interdit tout writer runtime `economic_variables` dans le moteur, Ops, le bridge et la route;
- `tests/unit/economic-variables-migration-119.test.js` verrouille les 9 colonnes, les fallbacks CURRENT, la priorité de copie et le chemin fresh-env;
- `tests/unit/economic-config.test.js` verrouille les mappings, projections, validations et write-through canonique;
- le workflow Golden couvre désormais `services/economic-config.js` et la migration 119 en plus des consommateurs 1A.

### Qualification finale

Le finalizer temporaire — retiré avant revue — a exécuté sur le head 1A-4 :

1. suites permanentes du bridge/config/migration/ratchet/moteur/Ops/route/finance-config : **PASS**;
2. Golden CDR : **13/13 PARITÉ OK**;
3. `npm run business-graph:gen` : **PASS**;
4. `git diff --check` : **PASS**;
5. seules `docs/BUSINESS_FEATURE_GRAPH.json` et `.md` ont été régénérées par l'outil officiel.

Le Business Graph constate logiquement la disparition des deux anciennes preuves statiques `dashboard → economic-engine` portées par Ops et son test : le dashboard consomme maintenant la SOV économique sans ce détour legacy.

## Gates communs LOT 1A — satisfaits

1. **Avant = Après économiquement** : Golden CDR vert à chaque sous-lot.
2. Aucun nouveau fallback silencieux.
3. Une variable = une vérité runtime; priorité/fallback explicités lorsqu'une compatibilité transitoire subsiste.
4. Tests de non-mutation / parité sur chaque chemin modifié.
5. Aucun chantier de refonte UI dans LOT 1A.
6. Pas de suppression physique de legacy avant LOT 11.

## Fermeture

- **1A-1** faux éditeurs Taxes/Dimensions — ✅ PR #800.
- **1A-2** FX USD — ✅ PR #801.
- **1A-3** commission relais — ✅ PR #802.
- **1A-4** `redistribute` / Ops / `economic_variables` — ✅ PR #805.

**LOT 1A = 4/4 CLOSED.**

Prochaine séquence autorisée : **LOT 1B — corrections économiques explicites**, avec `DELTA TOTAL == DELTA EXPLIQUÉ`. **LOT 2 UI reste interdit tant que la séquence ne l'autorise pas.**
