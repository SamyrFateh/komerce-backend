# Golden CDR — harnais de parité (LOT 0C-eco)

Filet de référence du calcul CDR. **Prérequis de toute étape qui déplace un prix** (LOT 1A « BEFORE == AFTER », LOT 1B « DELTA EXPLIQUÉ », doctrine I-7).

## Principe

Le harnais appelle le **vrai** `computeCDR` de `services/pricing-cdr.js` — jamais une copie. Il fige un **snapshot de config** dans le golden pour être **déterministe** : le verdict de parité n'est alors imputable qu'au **code**, jamais à la dérive de la DB.

`computeCDR` est pur au-dessus de `ctx.config` ; seul `loadGlobalConfig()` touche la DB. Le golden embarque la config figée (`frozen_config`), donc `verify`, `target` et `promote-target` tournent **sans DB**.

## Fichiers

- `golden-cdr.js` — harnais (`capture`, `verify`, `target`, `promote-target`).
- `target-promotion.js` — invariants purs de promotion CURRENT → TARGET.
- `witnesses.js` — produits témoins.
- `fixtures/config.demo.json` — config synthétique de démo hors DB.
- `golden/cdr.golden.json` — référence officielle courante.
- `golden/cdr.golden.current.1b1.json` — archive immuable du CURRENT avant promotion 1B-1.
- `golden/cdr.golden.target.1b1.json` — candidat TARGET calculé depuis le même `frozen_config`.

## Usage

```bash
node tools/golden-cdr/golden-cdr.js capture
node tools/golden-cdr/golden-cdr.js verify

# LOT 1B-1 — aucun accès DB :
node tools/golden-cdr/golden-cdr.js target
node tools/lot1b/delta-transport-cdr.js
node tools/golden-cdr/golden-cdr.js promote-target
node tools/golden-cdr/golden-cdr.js verify
```

### Protocole 1B-1

`target` archive d'abord le CURRENT officiel s'il n'existe pas encore, puis rejoue **le code courant** sur exactement le `frozen_config` et les mêmes témoins. Il ne recharge jamais Railway/Postgres.

`promote-target` est fail-closed. Il refuse la promotion si :

- le CURRENT officiel a dérivé depuis son archive ;
- le `config_fingerprint` du TARGET diffère ;
- l'ensemble des témoins diffère ;
- le TARGET ne correspond pas au code courant.

La preuve métier `DELTA TOTAL == DELTA EXPLIQUÉ` reste portée par `tools/lot1b/delta-transport-cdr.js`. La promotion Golden ne remplace pas cette preuve : elle enregistre la nouvelle référence une fois le delta expliqué.

## Insertion dans le plan

- **LOT 0** : capturer le golden CURRENT depuis la DB de référence.
- **LOT 1A** : `verify` reste vert — aucun déplacement de prix toléré.
- **LOT 1B** : `target` calcule le candidat avec **la même config figée**, le comparateur explique 100 % du delta, puis `promote-target` rend le TARGET officiel.

Le golden CURRENT peut figer un comportement faux, doublons compris : c'est volontaire. Il protège la vérité observée jusqu'à ce qu'une correction explicite soit prouvée. La promotion TARGET est donc un acte contrôlé, jamais une simple recapture DB.
