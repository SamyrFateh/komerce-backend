# Doctrine Pyramide Qualité — Komerce Boutique

> **Version** : 1.0 — 2026-06  
> **Statut** : doctrine active — copie locale Boutique  
> **Hiérarchie** : complète `FEATURE_DOCTRINE.md` et `FEATURE_SLICE_DOCTRINE.md`.

---

## Principe

La Boutique suit la même pyramide que le backend : on ne valide pas une feature parce que son UI fonctionne visuellement, mais parce que chaque couche inférieure est propre.

```
         ╔══════════════════════════════╗
 Niveau 0 ║    FEATURE DOCTRINE          ║  Feature reconnue, owner unique, périmètre clair
         ╠══════════════════════════════╣
 Niveau 5 ║    FEATURE SLICE GUARD       ║  Fichiers JS/CSS/tests rattachés à une feature
         ╠══════════════════════════════╣
 Niveau 4 ║    ARCHITECTURE GATES        ║  Audit arch, ownership, événements, endpoints
         ╠══════════════════════════════╣
 Niveau 3 ║    TESTS                     ║  Unitaires Jest + e2e Playwright
         ╠══════════════════════════════╣
 Niveau 2 ║    CODE QUALITY GATE         ║  Conventions JS/CSS, pas d’injection, imports propres
         ╠══════════════════════════════╣
 Niveau 1 ║    SÉCURITÉ DÉPENDANCES      ║  npm audit high/critical
         ╚══════════════════════════════╝
```

---

## Niveau 0 — Feature Doctrine

**But** : chaque fichier Boutique doit appartenir à une feature métier ou à un transversal déclaré.

**Commandes attendues** :

```bash
npm run audit:registry
npm run audit:registry:report
```

Un fichier Boutique non déclaré est une dette de gouvernance. Un fichier déclaré par deux features est une anomalie.

---

## Niveau 1 — Sécurité dépendances

**But** : bloquer les vulnérabilités `high` ou `critical` dans les dépendances propres à `public/boutique`.

**Commande attendue** :

```bash
npm run audit:gate
```

---

## Niveau 2 — Code Quality Gate

**But** : éviter que les fichiers JS/CSS deviennent des zones libres.

**Commandes attendues** :

```bash
npm run quality:gate
npm run check:fast
```

Règles typiques : pas de `var`, pas de `console.log` hors exception déclarée, pas d’injection HTML non sanitizée, imports cohérents, CSS gouverné par les bundles attendus.

---

## Niveau 3 — Tests

**But** : compléter les tests e2e par des tests unitaires rapides sur les fonctions pures ou DOM-pures.

**Commandes attendues** :

```bash
npm run test:unit
npm test
```

Les tests unitaires D8 couvrent notamment :

- formatage prix / devise ;
- sanitation HTML ;
- calcul panier ;
- favoris ;
- rendu identité checkout ;
- sélection Comores / France ;
- mise à jour de la carte identité.

---

## Niveau 4 — Architecture Gates

**But** : vérifier que les événements, endpoints, modules et owners restent cohérents.

**Commandes attendues** :

```bash
npm run audit:arch
npm run audit:arch:live
npm run audit:ownership
```

---

## Niveau 5 — Feature Slice Guard

**But** : vérifier que le slice Boutique d’une feature est complet : JS, CSS, tests, événements, endpoints consommés, invariants.

**Commandes attendues** :

```bash
npm run feature:guard:strict
```

---

## Règle de mise à jour

Toute nouvelle règle ajoutée à un gate Boutique doit être documentée dans cette pyramide. Toute nouvelle feature UI doit d’abord être rattachée à un manifest avant d’être testée ou stylée.
