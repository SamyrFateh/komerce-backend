## Checklist carte-first

### Entree

- [ ] J'ai lu AGENTS.md.
- [ ] J'ai lu docs/CARTE_FIRST_INDEX.md.
- [ ] J'ai identifie la feature ou le transversal.
- [ ] J'ai lu la carte feature.
- [ ] Operation : Create / Read / Update / Delete-Archive-Deprecate.

Feature(s) :

Operation :

### Plan d'attaque

- [ ] J'ai annonce le plan d'attaque avant de coder.
- [ ] Le plan nomme le perimetre probable.
- [ ] Le plan nomme le hors perimetre.
- [ ] Le plan nomme les invariants a proteger.
- [ ] Le plan nomme les gates ou tests prevus.

Plan annonce :

### Intention

- [ ] L'intention ne change pas.
- [ ] L'intention change et la carte est mise a jour.
- [ ] Incertain : revue humaine obligatoire.

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

### Cloture autonome

- [ ] Si les checks requis sont verts et la PR mergeable, l'agent merge sans demander une validation humaine supplementaire.
- [ ] Aucun blocage explicite d'auto-merge n'est present (hold utilisateur, conflit, check rouge/en cours, revue humaine exigee, operation destructive/autorite sensible).
- [ ] Le merge Git est distingue de toute activation production ou action post-merge qui possede sa propre autorisation.
- [ ] Apres merge, le statut de la PR et `main` sont verifies ; le deploiement est verifie s'il fait partie du chantier.

Fichiers modifies :

Elements A REVOIR :
