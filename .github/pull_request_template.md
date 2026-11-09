## Pourquoi
<!-- Cause racine : pourquoi ce changement est necessaire -->

## Quoi
<!-- Perimetre : qu'est-ce qui change, quels fichiers/features -->

Feature(s) :
Operation : Create / Read / Update / Delete-Archive-Deprecate

## Tests
<!-- Preuve de non-regression : commandes executees, resultats -->

## Checklist carte-first

### Entree

- [ ] J'ai lu AGENTS.md.
- [ ] J'ai lu docs/CARTE_FIRST_INDEX.md.
- [ ] J'ai identifie la feature ou le transversal.
- [ ] J'ai lu la carte feature.

### Plan d'attaque

- [ ] J'ai annonce le plan d'attaque avant de coder.
- [ ] Le plan nomme le perimetre probable et le hors perimetre.
- [ ] Le plan nomme les invariants a proteger.

### Intention

- [ ] L'intention ne change pas.
- [ ] L'intention change et la carte est mise a jour.

### Perimetre

- [ ] Les fichiers touches appartiennent a la carte ou a un transversal.
- [ ] perimeter.in couvre la modification.
- [ ] perimeter.out n'est pas franchi silencieusement.

### Analyse ciblée / coût

- [ ] J'ai utilisé la carte, les headers et `interventionIndex.mustCheck` avant d'élargir l'analyse.
- [ ] Aucun clone/fetch/scan complet inutile ; toute exploration exhaustive éventuelle est justifiée.
- [ ] Aucune nouvelle dette silencieuse (unknown/allowlist/exemption/baseline/bypass/autorité dupliquée).

### Verification

- [ ] `npm run pr:preflight` est vert avant ouverture/mise à jour de la PR.
- [ ] Les tests lourds non reproductibles localement restent à la CI.
- [ ] `npm run map:check` si reconstruction globale explicitement nécessaire.

### Certification métier — si un PASS métier est revendiqué

Ne pas cocher cette section pour une simple correction de code sans revendication de certification ; noter alors `NON APPLICABLE — aucune certification revendiquée` dans « Elements A REVOIR ».

- [ ] Les tests techniques pertinents (positifs, négatifs, habilitations, idempotence) sont verts, avec run/SHA.
- [ ] Le parcours métier complet a été exercé **par les vrais écrans Chromium sur staging**, sous les rôles concernés, sans mock d'API ni SQL seed d'états.
- [ ] Les effets sont prouvés par readback **indépendant API + PostgreSQL**, sur les **mêmes références** (run_id / SHA / UUID / acteur / marché), avec état avant/après et traces anonymisées.
- [ ] Toutes les cellules obligatoires sont `PASS`; les `SKIP`, `BLOCKED` et `NOT_PROVEN` ne sont pas annoncées comme certifiées.
- [ ] Les gardes de staging (fixtures, isolation, cleanup, absence d'effets externes) sont prouvés avant mutation.
- [ ] Les étapes précédemment certifiées sont conservées ; les non-régressions rejouées correspondent au périmètre réellement impacté. Le GO production reste séparé.

### Cloture autonome

- [ ] Si les checks requis sont verts et la PR mergeable, l'agent merge sans demander une validation humaine supplementaire.
- [ ] Aucun blocage explicite d'auto-merge n'est present (hold utilisateur, conflit, check rouge/en cours, revue humaine exigee, operation destructive/autorite sensible).
- [ ] Le merge Git est distingue de toute activation production ou action post-merge qui possede sa propre autorisation.
- [ ] Apres merge, le statut de la PR et `main` sont verifies ; le deploiement est verifie s'il fait partie du chantier.

Fichiers modifies :

Elements A REVOIR :
