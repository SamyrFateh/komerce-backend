## Checklist carte-first

### Entree

- [ ] J'ai commence par `docs/INDEX.md`.
- [ ] J'ai identifie la feature ou le transversal.
- [ ] J'ai lu `features/<feature>.feature.js`.
- [ ] Operation : Create / Read / Update / Delete-Archive-Deprecate.

Feature(s) :

Operation :

### Intention

- [ ] L'intention ne change pas.
- [ ] L'intention change et la carte est mise a jour.
- [ ] Incertain : revue humaine obligatoire.

### Perimetre

- [ ] Les fichiers touches appartiennent a la carte ou a un transversal.
- [ ] `perimeter.in` couvre la modification.
- [ ] `perimeter.out` n'est pas franchi silencieusement.

### Documentation

- [ ] Aucun genere n'est edite manuellement.
- [ ] Aucun snapshot historique n'est ajoute hors `archive/`.
- [ ] Les cas ambigus sont marques `A REVOIR`.

### Verification

- [ ] `npm run feature:registry` lance.
- [ ] `node scripts/run-carte-first-checks.js` lance ou execute par CI.
- [ ] Tests de non-regression lances ou justification donnee.

---

Fichiers modifies :

Endpoints impactes :

Tables DB impactees :

Cartes mises a jour :

Elements A REVOIR :
