# Golden CDR — harnais de parité (LOT 0C-eco)

Filet de référence du calcul CDR. **Prérequis de toute étape qui déplace un prix** (LOT 1A « BEFORE == AFTER », LOT 1B « DELTA EXPLIQUÉ », doctrine I-7).

## Principe

Le harnais appelle le **vrai** `computeCDR` de `services/pricing-cdr.js` — jamais une copie (sinon il ne prouverait rien). Il fige un **snapshot de config** dans le golden pour être **déterministe** : le verdict de parité n'est alors imputable qu'au **code**, jamais à la dérive de la DB.

`computeCDR` est pur au-dessus de `ctx.config` ; seul `loadGlobalConfig()` touche la DB. Le golden embarque la config figée (`frozen_config`), donc `verify` tourne **sans DB**.

## Fichiers

- `golden-cdr.js` — le harnais (modes `capture` / `verify`).
- `witnesses.js` — les produits témoins (catégorie × canal + cas limites). **Le harnais ne protège que ce qu'il couvre** : ajouter un témoin dès qu'on touche une branche non représentée.
- `fixtures/config.demo.json` — config synthétique fidèle, pour la démo hors-DB.
- `golden/cdr.golden[.demo].json` — le snapshot de référence (généré).
- `_demo-run.js` — lanceur **local uniquement** : neutralise `../db` quand `dotenv`/`pg` sont absents (sandbox). En prod, ignorer ce fichier.

## Usage

```bash
# Sur la branche de référence (avant LOT 1A), une fois :
node tools/golden-cdr/golden-cdr.js capture      # → golden/cdr.golden.json (config figée depuis la DB)

# En CI, sur chaque PR touchant le CDR :
node tools/golden-cdr/golden-cdr.js verify        # exit 0 = parité OK, exit 1 = rompue

# Démo hors-DB (config synthétique) :
node tools/golden-cdr/_demo-run.js capture --demo
node tools/golden-cdr/_demo-run.js verify --demo
```

## Ce que capture le golden, par témoin

`breakdown` (noms doctrinaux) : `purchase, sourcing, hub, packaging, freight, customs, transitary, distribution, relay, payment, risk, overhead` ·
`totals` : `variable, fixed, risk, total` ·
`provenance` : `components_source` (cost_components vs pricing_components_legacy), `category_known`, `volume_defaulted`, `cost_zero` ·
`allocation` : niveaux (`article/parcel/order/shipment`) + `min_confidence` ·
`warnings`.

## Insertion dans le plan

- **LOT 0** : capturer le golden CURRENT (mode `capture` sur la DB de référence). C'est le gate de sortie « on sait comment le CDR courant se comporte ».
- **LOT 1A** (intégrité silencieuse) : `verify` doit rester **vert** — aucun déplacement de prix toléré.
- **LOT 1B** (canonisation économique, dont le fret W/M) : re-capturer un golden **TARGET**, puis exiger que **chaque écart CURRENT↔TARGET soit expliqué** (retrait du double-count fret, dédup risk, etc.). Un écart inexpliqué = échec (doctrine I-7).

## Note importante

Le golden fige le comportement **actuel**, doublons compris — p. ex. le **double-comptage du fret** (`finance_config` + composant `freight`) est visible tel quel dans `breakdown.freight`. Ce n'est pas un bug du harnais : c'est la vérité CURRENT que le harnais doit protéger jusqu'à ce que 1B la corrige explicitement.
