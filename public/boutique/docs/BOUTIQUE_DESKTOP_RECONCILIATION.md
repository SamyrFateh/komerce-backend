# Réconciliation desktop — note de pilotage
## `BOUTIQUE_DESKTOP_RECONCILIATION.md` (31/05/2026)

> But : relier les deux documents de crise desktop, dire ce qui est vrai,
> ce qui est corrigé, et **comment on empêche la rechute**.
> À lire en tête de `BOUTIQUE_DESKTOP_LAYOUT_CONTRACT.md` et
> `BOUTIQUE_ARCHITECTURE_DESKTOP_DIAGNOSIS.md`.

---

## 1. Les deux docs ne se contredisent pas — ils décrivent DEUX problèmes distincts

| | Problème décrit | Symptôme | Nature |
|---|---|---|---|
| **LAYOUT_CONTRACT** | `overflow: visible` (layout.css l.756) annule `overflow-x: clip` (l.701) sur `#k-catalog-section`, **même `@media (min-width:900px)`, le second gagne** | La grille **peint par-dessus** le side-cart `fixed` | Painting / overflow |
| **DIAGNOSIS** | Deux systèmes de rendu home coexistent : `b-home-premium-v1.js` pose un titre CSS `::before "Bons plans du moment"` sur `#k-catalog-section`, mais `render-home-sections.js` y écrit des sections par catégorie | Titre éditorial **incohérent** avec le contenu ; mock "Nos trouvailles" **jamais codé** | Contenu / titres |

Les deux sont **réels et vérifiés dans le code** (audit 31/05). Aucun n'invalide l'autre.
Un fix de l'un ne résout pas l'autre.

Un troisième point, secondaire mais à traiter : `desktop-commerce-skeleton.css`
est **cassé** (37 lignes, `background:` vide, `@media` non fermé, accolades déséquilibrées 5/4).
Il ne contribue rien au layout. Décision requise : le remplir (I-9) ou le supprimer.

---

## 2. Statut des fixes

| Problème | Statut | Détail |
|---|:-:|---|
| Overflow grille/side-cart | ✅ **CORRIGÉ** | `#k-catalog-section` retiré du bloc `overflow:visible` (layout.css ~l.751). Conserve `overflow-x:clip`. Sibling du side-cart → ne le clippe pas. Validé : `bundle:css` OK, `check:breakpoints --strict` OK, `audit:arch` conforme, bundle 0 occurrence `catalog+visible`. |
| Titre `::before` incohérent | ⏳ **DÉCISION REQUISE** | Le doc recommande de supprimer `::before/::after` sur `#k-catalog-section` (b-home-premium-v1.js ~l.188-211) et de confier le titre à `render-home-sections.js`. **Mais quel titre veut-on ?** À trancher avant de toucher le code. |
| Skeleton CSS cassé | ⏳ **DÉCISION REQUISE** | Remplir (background + règles layout) ou supprimer le fichier du bundle. |

---

## 3. Pourquoi les patchs s'empilaient sans succès (la vraie cause)

`audit:arch` vérifie les invariants **I-1 à I-7** (orphelins, owner unique, hex,
tokens cassés, media desktop, etc.). Il **ne vérifie AUCUN** des invariants
desktop nouveaux :

- pas de check « `#k-catalog-section` ne doit jamais finir en `overflow:visible` »
- pas de check « pas de titre `::before` sur un conteneur piloté par JS »
- pas de check « `--sc-reserve-w` défini uniquement dans layout.css »

**Conséquence** : un patch pouvait ré-poser `overflow:visible`, passer tous les
garde-fous au vert, et casser le desktop **sans alerte**. On corrigeait en
aveugle parce que l'outil ne regardait pas au bon endroit.

---

## 4. Comment on maîtrise la suite — fermer le trou

Transformer chaque invariant en **check machine** dans `audit-boutique-arch.js`.
Ordre de priorité :

1. **I-DESK-2** (le plus urgent) — échouer si une règle pose `overflow: visible`
   ou `overflow-x: visible` sur `#k-catalog-section` dans un `@media ≥900px`.
   *Regex sur le CSS source, ~15 lignes. Empêche définitivement la rechute du bug corrigé.*
2. **I-DESK-1** — échouer si `html|body|#k-page-scroll|#k-desktop-catalog-wrap`
   reçoit `overflow-x: clip|hidden` (casse l'ancrage du side-cart fixed).
3. **I-DESK-3** — échouer si `--sc-reserve-w` est défini hors `layout.css`.
4. **I-8 / I-10** — échouer si `b-home-premium-v1.js` contient `::before`/`::after`
   avec `content:` sur `#k-catalog-section`.

Tant que ces checks ne sont pas codés, **toute PR desktop se valide à la main**
contre les checklists des deux docs (section « Checklist PR »).

---

## 5. Où rangent les docs

```
public/boutique/docs/
  BOUTIQUE_DESKTOP_LAYOUT_CONTRACT.md        ← normatif layout ≥900px (overflow, --sc-reserve-w)
  BOUTIQUE_ARCHITECTURE_DESKTOP_DIAGNOSIS.md ← diagnostic rendu (2 systèmes, skeleton, invariants I-8..11)
  BOUTIQUE_DESKTOP_RECONCILIATION.md         ← CE FICHIER — point d'entrée, statut, plan
```

À référencer depuis `BOUTIQUE_DOCS_INDEX.md` (ligne « layout/rendu desktop »)
et depuis `BOUTIQUE_ARCHITECTURE.md §1` (invariants).
