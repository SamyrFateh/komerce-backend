# ADR-010 — Pricing lit la BDD (Étape 1 refonte Pricing)

**Date :** avril 2026
**Statut :** Implémenté (Étape 1 / 4 de la refonte Pricing)
**Contexte :** Suite à l'ADR-009 qui a unifié `finance_config` comme source de vérité, cette ADR connecte le module Pricing pour qu'il consomme cette source au lieu de ses constantes en dur.

---

## Problème résolu

Avant cette ADR, `ct-views-pricing.js` contenait **75 lignes de constantes en dur** :
- 8 catégories avec leurs taux douane/TVA/dimensions
- Taux EUR/AED/Fret
- Cible marge à 12%

Modifier un taux nécessitait : édition du JS → commit → push → déploiement Railway → reload navigateur.

## Décisions

### 1. Catégories chargées depuis `customs_categories` au démarrage

Le module appelle `/api/admin/customs-categories?active=true` au démarrage. Les 8 catégories sont chargées en mémoire dans `_ps.catsFromDb`.

**Helper `_getCats()`** : retourne `_ps.catsFromDb` si chargé, sinon `CATS_FALLBACK`.

```javascript
function _getCats() {
  if (_ps.catsFromDb && Object.keys(_ps.catsFromDb).length > 0) {
    return _ps.catsFromDb;
  }
  return CATS_FALLBACK;
}
```

### 2. Cible marge par catégorie

`customs_categories.default_margin_pct` permet une cible spécifique :

| Catégorie | Cible marge |
|---|---|
| Phones, Enfants, Électro | 30-32% |
| Matériels | 35% |
| Vêtements | 45% |
| Cosmétiques | 50% |
| Cérémonie, Mariage | 55% |

**Helper `_getMarginTargetForCat(catKey)`** : retourne la cible spécifique (BDD) ou la cible globale `finance_config.target_marge_brute_pct = 40%` en fallback.

```javascript
function _getMarginTargetForCat(catKey) {
  if (_ps.catsFromDb?.[catKey]?.defaultMargin) {
    return _ps.catsFromDb[catKey].defaultMargin / 100;
  }
  return _ps.TARGET_MARGE_PCT / 100;  // 40% par défaut depuis finance_config
}
```

### 3. Tous les paramètres business depuis `finance_config`

Au démarrage, `_loadConfig()` charge en parallèle :
- `/api/admin/finance-config` → 11 paramètres (taux, marges, frais, commissions)
- `/api/admin/customs-categories?active=true` → 8 catégories

Les anciennes constantes (`TAUX_EUR = 492`, `targetMargin = 0.12`, etc.) deviennent des **fallbacks d'urgence** au cas où la BDD est inaccessible au tout premier rendu.

### 4. Politique de fallback robuste

Le module reste fonctionnel même si la BDD est down :

```
1. _loadConfig() tente l'appel API
2. Si succès → _ps.catsFromDb / _ps.TARGET_MARGE_PCT mis à jour
3. Si échec → console.warn + utilisation des fallbacks hardcodés
4. Le pricing fonctionne dans tous les cas
```

## Implémentation : 19 remplacements automatiques

```bash
sed -i 's/\bCATS\[/_getCats()[/g'                   ct-views-pricing.js
sed -i 's/\bCATS\./_getCats()./g'                    ct-views-pricing.js
sed -i 's/Object\.entries(CATS)/Object.entries(_getCats())/g'  ct-views-pricing.js
sed -i 's/Object\.keys(CATS)/Object.keys(_getCats())/g'        ct-views-pricing.js
```

`CATS` → `CATS_FALLBACK` (renommé pour clarifier son rôle de filet de sécurité).

## Vérification syntaxique

- ✅ `node --check ct-views-pricing.js`
- ✅ 19 références à `_getCats()` (correspond aux 19 occurrences originales de `CATS`)
- ✅ 2 références à `_getMarginTargetForCat` (1 dans le helper, 1 dans le calcul)
- ✅ `targetMargin = 0.12` éliminé

## Compatibilité ascendante

- L'ancien nom `_loadRates()` est conservé comme alias de `_loadConfig()` au cas où d'autres modules l'appellent
- `CATS_FALLBACK` reste accessible globalement (pas exporté mais visible dans le scope IIFE)
- Aucun changement d'API externe

## Cas non couverts (intentionnellement)

Certains commentaires obsolètes (lignes 1689 et 1727) mentionnent encore `CATS` mais ce sont juste des commentaires inertes. Le code utilise bien `_getCats()`.

Le tab Configuration (lignes 1685-1810 environ) qui édite les taxes/dimensions reste là pour l'instant — il sera **supprimé en Étape 3** (déplacement vers Modèle économique).

## Bénéfices

| Avant | Après |
|---|---|
| Modifier un taux douane = redéploiement | UI immédiate via `/api/admin/customs-categories` |
| Cible marge unique = 12% partout | Cible par catégorie (30 à 55%) + globale 40% |
| 4 sources de vérité divergentes | 1 source (`finance_config` + `customs_categories`) |
| Désync silencieuse possible | Cohérent par construction |

## Fichiers modifiés

- `public/js/ct-views-pricing.js` — 19 remplacements + 3 nouveaux helpers + `_loadConfig()`

## Déploiement

Aucune migration SQL nécessaire (l'ADR-009 a déjà tout préparé).

```bash
git add public/js/ct-views-pricing.js docs/ADR-010-pricing-reads-db.md
git commit -m "refactor(pricing): Étape 1 — Pricing lit customs_categories + finance_config (ADR-010)"
git push
```

## Vérifications post-déploiement

- [ ] Le module Pricing s'ouvre sans erreur
- [ ] Le simulateur affiche les 8 catégories
- [ ] Modifier `customs_categories.douane_pct` via PUT → recalcul correct du prix simulé
- [ ] Modifier `finance_config.target_marge_brute_pct` → reflété dans le `prixConseille` pour les cats sans `default_margin_pct`
- [ ] La page de masse pricing recharge correctement les marges cibles
- [ ] Console : voir le log `[Pricing] 8 catégories chargées depuis customs_categories`

## Étapes suivantes

- **Étape 2** : nouvel endpoint `/api/pricing/recommend` qui calcule le prix recommandé en intégrant **les charges fixes** (pas seulement la marge cible)
- **Étape 3** : suppression du tab Configuration → fusion dans Modèle économique. UI propre pour éditer `customs_categories`.
