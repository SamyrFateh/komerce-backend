# Boutique Komerce — Index documentaire

> **Point d'entrée pour la documentation Boutique.**
> Date : 18 mai 2026
> Si tu débarques sur ce dossier, lis ce fichier en premier.

---

## 1. Quelle doc lire en premier ?

| Tu veux... | Tu lis... |
|---|---|
| Comprendre les **règles** (invariants, ownership, process PR) | `BOUTIQUE_ARCHITECTURE.md` |
| Savoir l'**état réel** du code aujourd'hui | `BOUTIQUE_ARCHITECTURE_LIVE.md` (généré, ne pas éditer) |
| Comprendre comment **sources → dist** fonctionne | `BOUTIQUE_CSS_PIPELINE.md` |
| Comprendre **le détail interne de `modal.css`** (1736L, 7 sections) | `BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Savoir **qui possède quel composant JS** | `BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Comprendre **les contrats produit** (props, slots) | `BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md` |

---

## 2. Les 4 docs satellites de l'architecture

```
                    BOUTIQUE_ARCHITECTURE.md
                    (normatif — règles, ce qui DOIT être vrai)
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
BOUTIQUE_ARCHITECTURE_LIVE.md  BOUTIQUE_CSS_PIPELINE.md  BOUTIQUE_MODAL_ARCHITECTURE.md
(descriptif — état réel,       (référentiel pipeline    (référentiel interne modal.css,
 généré, jamais édité)          source → bundle → dist)  7 sections, invariants, pièges)
```

**Règle de hiérarchie** : `BOUTIQUE_ARCHITECTURE.md` est la **source normative**. Si une autre doc le contredit, c'est l'autre doc qui doit être alignée (ou la règle changée explicitement dans ARCHITECTURE.md).

---

## 3. Les 3 scripts associés

| Script | Commande npm | Quand l'utiliser |
|---|---|---|
| `bundle-css.js` | `npm run bundle:css` | Après toute modif d'un fichier source CSS — sinon rien n'est en prod |
| `gen-boutique-arch-live.js` | `npm run boutique:arch` | En début de session + après chaque PR — pour photographier l'état réel |
| `audit-boutique-arch.js` | `npm run boutique:audit` | Avant tout commit — plante (exit 1) si les invariants §1 sont violés |

**Tous lancés depuis `boutique/`.**

---

## 4. Workflow type d'une PR CSS

```bash
cd boutique

# 1. Modifier les sources
vim css/modal.css

# 2. Rebundler (obligatoire — sinon non-prod)
npm run bundle:css

# 3. Régénérer la photo descriptive
npm run boutique:arch

# 4. Valider les invariants
npm run boutique:audit

# 5. Commit unique (sources + dist + docs LIVE ensemble)
cd ../../
git add boutique/css/ boutique/docs/
git commit -m "..."
```

**Anti-pattern interdit** : commiter une modif source sans rebundle. Le dist daterait alors d'avant les modifs et la prod afficherait l'ancienne version sans avertissement. C'est précisément ce qui a créé la dette résolue le 18/05/2026.

---

## 5. Hiérarchie en cas de conflit

Si plusieurs docs disent des choses différentes, voici qui gagne :

```
1. BOUTIQUE_ARCHITECTURE.md            ← source normative, gagne sur tout
2. BOUTIQUE_CSS_PIPELINE.md            ← détail pipeline, gagne sur les docs spécifiques
3. BOUTIQUE_MODAL_ARCHITECTURE.md      ← spécifique modal
4. BOUTIQUE_COMPONENT_OWNERSHIP.md     ← spécifique composants JS
5. BOUTIQUE_ARCHITECTURE_LIVE.md       ← descriptif, jamais source de vérité (c'est une photo)
```

**Si tu trouves un conflit** : ouvre une PR qui aligne la doc subordonnée sur la doc principale. Si c'est la doc principale qui se trompe, change-la explicitement dans la même PR.

---

## 6. Que faire si...

| Situation | Action |
|---|---|
| Tu modifies du CSS Boutique | 1. Modifier source, 2. `npm run bundle:css`, 3. `npm run boutique:audit` |
| `boutique:audit` plante (exit 1) | Lire le rapport, corriger les violations avant de continuer |
| `BOUTIQUE_ARCHITECTURE_LIVE.md` ne match pas tes changements | `npm run boutique:arch` (régénération) puis commit |
| Tu veux ajouter un nouveau fichier CSS source | 1. Ajouter dans `bundle-css.js`, 2. Mettre à jour `BOUTIQUE_ARCHITECTURE.md` §2 inventaire, 3. `npm run bundle:css` |
| Tu trouves un sélecteur dans 2 fichiers et ne sais pas si c'est OK | Vérifier `BOUTIQUE_ARCHITECTURE.md` §3 (table d'ownership avec exceptions multi-owner légitimes) |
| Tu veux toucher un fichier verrouillé (b-pager.js, b-store.js, b-scroll-owner.js) | Lire `BOUTIQUE_ARCHITECTURE.md` §6 — PR isolée obligatoire |
| Tu veux modifier `modal.css` | Lire d'abord `BOUTIQUE_MODAL_ARCHITECTURE.md` (les 7 sections + pièges connus) |

---

## 7. Évolution de l'index

Si tu crées une nouvelle doc Boutique, ajoute-la au tableau §1 ci-dessus dans la même PR.

Si tu supprimes une doc, retire la ligne correspondante.

Si la hiérarchie §5 change, mets à jour dans la même PR `BOUTIQUE_ARCHITECTURE.md` § 1 et ici.
