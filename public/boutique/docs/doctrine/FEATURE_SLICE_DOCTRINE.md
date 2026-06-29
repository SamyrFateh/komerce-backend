# Komerce Boutique — Feature Slice Doctrine
> Copie locale pour usage standalone.

Un **slice** = l'ensemble cohérent d'un domaine fonctionnel :
- ses fichiers source (`files.js`)
- ses tests (`files.tests`)
- ses CSS (`files.css`)
- ses contrats (`contracts`)

## Invariants du slice

1. Un fichier ne peut appartenir qu'à **un seul** slice (domaine exclusif).
2. Le `@domain` du header d'un fichier JS = le `domain` du manifest qui le déclare.
3. Tout slice `production` doit avoir au moins un test déclaré.
4. Les contrats `render-static` sont vérifiés par `feature-guard.js --contracts-only`.

## Usage feature-guard

```bash
node scripts/feature-guard.js              # rapport complet
node scripts/feature-guard.js --strict     # CI / pre-commit
node scripts/feature-guard.js --feature catalog  # un seul slice
node scripts/feature-guard.js --json       # sortie JSON
node scripts/feature-guard.js --contracts-only   # contrats seuls
```
