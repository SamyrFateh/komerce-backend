# Komerce Boutique — Feature Doctrine
> Copie locale pour usage standalone. Source canonique : backend/docs/doctrine/FEATURE_DOCTRINE.md

## Champs obligatoires d'un manifest

Tout fichier `features/*.feature.js` DOIT déclarer :

```
name, type, domain, status, owner, service, perimeter, authority, invariants
```

## Statuts valides

| Status | Signification |
|--------|---------------|
| `draft` | En cours de développement — non activé en prod |
| `staging` | Intégration — tests requis |
| `production` | Actif en production |
| `deprecated` | À supprimer — imports résiduels interdits |

## Règles

1. **Chaque fichier JS source** doit avoir un header `@domain <domain>` correspondant au `domain` du manifest qui le déclare.
2. **Chaque fichier déclaré** dans `files.*` doit exister sur disque.
3. **Les tests** doivent être déclarés dans `files.tests` pour les features `staging` et `production`.
4. **Les contrats** (`contracts.render-static`) définissent les patterns obligatoires dans les artefacts — vérifiés par `feature-guard.js`.
5. **Les slices deprecated** ne peuvent plus être importés par du code actif.

## Pyramide qualité

```
N0 — Registre feature (feature-registry-check.js)
N2 — Code quality gate (code-quality-gate.js)
N4 — Architecture audit (audit-boutique-arch.js)
N5 — Feature slice guard (feature-guard.js)   ← ce niveau
```

## Référence

Voir `scripts/feature-guard.js` pour la vérification N5 complète.
