# Boutique Komerce — Index documentaire local

> **Statut** : index local / historique pour `public/boutique/docs`.  
> **Date** : 16 juin 2026 — synchronisation doctrine graphe.  
> **Important** : en repo complet, les docs canoniques Boutique vivent dans `docs/boutique/*`. Les docs de ce dossier sont utiles pour le contexte local, les snapshots ou l'historique, mais elles sont subordonnées aux docs canoniques.

---

## 0. Doctrine graphe obligatoire

Même dans ce dossier local/historique, toute intervention fonctionnelle doit repartir de :

```txt
../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
../../docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md
../../docs/KOMERCE_ARCH_HEADER_GRAPH.md
../../docs/komerce-arch-header-graph.json
```

Aucun nouveau fichier Boutique ne doit être invisible : header complet `@komerce-arch` ou header lite `@komerce-arch-lite` avec `@owner`.

---

## 1. Hiérarchie actuelle

| Niveau | Rôle | Chemin |
|---|---|---|
| Point d'entrée repo | Règles globales et chemins vrais | `AGENTS.md` |
| Doctrine graphe obligatoire | Contrat d'intervention architecture | `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` |
| Point d'entrée Boutique canonique | Guide opératoire Boutique | `docs/boutique/README.md` |
| Point d'entrée Boutique local | Commandes et workflow dans le dossier | `public/boutique/README.md` |
| Canonique CSS Boutique | Pipeline CSS réel | `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Canonique ownership Boutique | Propriété des composants | `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Canonique modal Boutique | Architecture modal actuelle | `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Docs locales | Historique / contexte / généré | `public/boutique/docs/*` |

Si une doc locale contredit `docs/boutique/*`, `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` ou le code actuel, elle doit être alignée ou considérée comme historique.

---

## 2. Quelle doc lire ?

| Tu veux... | Tu lis... |
|---|---|
| Modifier une feature Boutique | `../../docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` puis `../../docs/boutique/README.md` |
| Comprendre le pipeline CSS actuel | `../../docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Comprendre l'ownership des composants | `../../docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Comprendre la modal actuelle | `../../docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Avoir les commandes locales | `../README.md` |
| Consulter l'état réel généré | `BOUTIQUE_ARCHITECTURE_LIVE.md` si à jour, sinon régénérer |
| Lire l'ancienne architecture locale | `BOUTIQUE_ARCHITECTURE.md` avec prudence : vérifier contre `docs/boutique/*` |
| Lire l'ancienne source de vérité locale | `BOUTIQUE_SOURCE_OF_TRUTH.md` avec prudence : certaines métriques historiques peuvent être obsolètes |

---

## 3. Scripts actuels

Tous lancés depuis `public/boutique`.

| Commande | Rôle |
|---|---|
| `npm run deploy:css` | Bundler officiel : CSS source → dist + cache-buster |
| `npm run bundle:css` | Alias de compatibilité vers `deploy-css.js` |
| `npm run check:cache` | Dry-run du bundler/cache |
| `npm run audit:arch` | Audit architecture Boutique |
| `npm run audit:arch:live` | Génère la photo d'architecture réelle |
| `npm run audit:ownership` | Génère la carte d'ownership live |
| `npm run check:all` | Chaîne complète de garde-fous |

`bundle-css.js` n'est plus source de vérité. Il délègue au bundler actuel ou doit être traité comme wrapper de compatibilité.

---

## 4. Workflow CSS actuel

```bash
cd public/boutique

# 1. Modifier les sources css/*.css
# 2. Rebuilder et bumper les bundles nécessaires
npm run deploy:css

# 3. Vérifier
npm run check:cache
npm run audit:arch

# 4. Commit depuis la racine
cd ../..
git add public/boutique/css/ public/boutique/index.html public/boutique/.cache-buster-state.json
git commit -m "style(boutique): ..."
```

Règle : ne jamais éditer `css/dist/*.css` directement.
Si un nouveau fichier source ou owner apparaît, appliquer `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`.

---

## 5. Anti-dérives à retenir

- Le JS ne dessine pas : pas de `createElement('style')`, `style.textContent`, `style.cssText`, `innerHTML style=` pour du CSS stable.
- Le CSS stable vit dans l'owner documenté.
- Le graphe architecture doit refléter les owners et responsabilités réelles.
- `modal-product-lot4-hybrid.css` est une extension officielle de `modal-product.css`.
- Les seules règles `!important` actives acceptées au 3 juin 2026 sont les guards desktop du drawer mobile dans `boutique-desktop.css`.
- Toute doc locale obsolète doit être alignée dans la PR qui la rend visible.

---

## 6. Évolution de cet index

Si une nouvelle doc locale est créée, ajoute-la ici. Si une doc locale devient obsolète, ajoute un warning clair en tête ou archive-la.