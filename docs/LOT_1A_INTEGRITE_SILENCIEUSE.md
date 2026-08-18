# LOT 1A — Intégrité silencieuse

Statut : **OUVERT** — migration de structure uniquement.

Invariant de lot : **Golden CDR `BEFORE == AFTER`**. Aucun déplacement volontaire de prix n'est autorisé ici. Toute correction de vérité économique appartient au LOT 1B et suivra `DELTA TOTAL == DELTA EXPLIQUÉ`.

## Périmètre figé

La doctrine fixe quatre chantiers pour LOT 1A :

1. **Éditeurs Taxes/Dimensions fantômes** — `pricing_category_taxes` / `pricing_category_dims` sont éditables mais ne sont pas des sources de vérité runtime.
2. **FX USD** — canoniser une seule source/clé runtime sans changer la valeur effectivement consommée.
3. **Commission relais** — désambiguïser les champs concurrents en une règle de priorité unique, sans changer le résultat courant.
4. **`economic_variables`** — traiter la source legacy uniquement **après** migration de `redistribute`; re-tester aussi Ops car `dashboard-ops-queries.js` la lit.

LOT 2 UI reste hors séquence.

## 1A-1 — Éditeurs Taxes/Dimensions fantômes

Décision de migration additive : **masquer puis purger plus tard**, conformément à I-8.

### État cible de ce sous-lot

- `GET /api/admin/pricing-matrices/taxes` : conservé temporairement en lecture forensic/compatibilité.
- `GET /api/admin/pricing-matrices/dims` : conservé temporairement en lecture forensic/compatibilité.
- `PUT /api/admin/pricing-matrices/taxes/:category` : **410 Gone**, zéro écriture DB.
- `PUT /api/admin/pricing-matrices/dims/:category` : **410 Gone**, zéro écriture DB.
- Settings : les onglets **Taxes** et **Dimensions** sont masqués par un guard additif chargé après `SettingsView`.
- Sources de vérité rappelées explicitement par le 410 :
  - taxes → `customs_categories.{douane_pct,tva_pct,taxe_add_pct}`;
  - dimensions défaut → `customs_categories.{default_dim_l_cm,default_dim_w_cm,default_dim_h_cm}`.
- Les tables, anciens GET et code legacy interne ne sont **pas supprimés** ici : purge physique en LOT 11 après preuve de remplacement.

### Preuves exigées

- unit : admin guard conservé; PUT taxes/dims = 410; aucune query DB sur PUT; GET conserve sa forme historique;
- intégration DB réelle : ligne taxes/dims strictement identique avant/après un PUT legacy;
- UI : Taxes/Dimensions absents, Règles/Historique conservés, remasquage après rerender;
- Golden CDR : `PARITÉ OK` sur les 13 témoins CURRENT;
- PR enforcement : vert.

## Gates communs LOT 1A

Chaque sous-lot doit satisfaire :

1. **Avant = Après économiquement** : `node tools/golden-cdr/golden-cdr.js verify` vert.
2. Aucun nouveau fallback silencieux.
3. Une variable = une vérité runtime; priorité/fallback documentés quand une migration transitoire l'exige.
4. Tests de non-mutation / parité adaptés au chemin modifié.
5. Aucun chantier de refonte UI : seuls les masques/guards nécessaires à la suppression d'un faux éditeur sont autorisés.
6. Pas de suppression physique de legacy avant la séquence de purge LOT 11.

## Ordre de travail

- **1A-1** faux éditeurs Taxes/Dimensions — en cours sur `agent/lot1a-integrity-silent`.
- **1A-2** FX USD — audit puis canonisation structurelle.
- **1A-3** commission relais — audit des trois champs puis règle de priorité verrouillée.
- **1A-4** `redistribute` → `economic_variables` — dernier, avec re-test Ops.

LOT 1A est fermé uniquement quand les quatre sous-lots sont prouvés et que le Golden CURRENT reste identique.
