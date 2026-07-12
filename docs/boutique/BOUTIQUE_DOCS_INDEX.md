# Boutique Komerce — Index documentaire

> **Point d'entrée pour la documentation Boutique.**
> Mis à jour : 2026-07-12
> Si tu débarques sur ce dossier, lis ce fichier en premier.

---

## 1. Quelle doc lire en premier ?

| Tu veux... | Tu lis... |
|---|---|
| Comprendre les **règles Boutique** (invariants, ownership, process PR) | `BOUTIQUE_ARCHITECTURE.md` |
| Savoir l'**état réel** du code aujourd'hui | `BOUTIQUE_ARCHITECTURE_LIVE.md` (généré, ne pas éditer) |
| Comprendre comment **sources CSS → dist** fonctionne | `BOUTIQUE_CSS_PIPELINE.md` |
| Modifier la **modal produit** | `BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Comprendre la frontière **raffinerie → produit canonique → contrat détail → modal** | `../doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` |
| Savoir **qui possède quel composant JS** | `BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Comprendre les **contrats produit de carte** (props, slots) | `BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md` |

Pour un chantier modal enrichie, l'ordre de lecture est :

```text
AGENTS.md
→ docs/CARTE_FIRST_INDEX.md
→ features/catalog.feature.js
→ ../doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
→ BOUTIQUE_ARCHITECTURE.md
→ BOUTIQUE_MODAL_ARCHITECTURE.md
→ BOUTIQUE_COMPONENT_OWNERSHIP.md
```

Ne pas démarrer depuis les anciens `MODAL_*_ARCHITECTURE.md` locaux sous `public/boutique/docs/` : ils sont historiques lorsque leur contenu diverge des documents canoniques sous `docs/boutique/`.

---

## 2. Architecture documentaire active

```text
                         AGENTS.md
                              │
                    CARTE_FIRST_INDEX.md
                              │
                    features/*.feature.js
                              │
             doctrines actives du domaine/couture
                              │
                  BOUTIQUE_ARCHITECTURE.md
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
        ▼                     ▼                      ▼
BOUTIQUE_ARCHITECTURE_LIVE  BOUTIQUE_CSS_PIPELINE  BOUTIQUE_MODAL_ARCHITECTURE
(généré / descriptif)        (pipeline CSS)          (ownership modal)
```

`DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` est une doctrine de couture cross-feature : `catalog` en possède le contrat ; `logistics` et `economic-engine` contribuent leurs vérités ; la Boutique/modal le consomme.

Règle : le document spécifique explique **comment** modifier sa zone. Il ne peut pas contredire la carte feature ni une doctrine active.

---

## 3. Scripts associés

| Script | Commande npm | Quand l'utiliser |
|---|---|---|
| Déploiement CSS | `npm run deploy:css` | Après toute modif d'un fichier source CSS modal/boutique |
| Vérification cache CSS | `npm run check:cache` | Après rebundle/déploiement CSS |
| Audit architecture Boutique | `npm run audit:arch` | Avant commit Boutique |
| Ownership Boutique | `npm run gate:boutique-ownership` | Depuis la racine, après changement d'owner/périmètre |
| Carte globale | `npm run map:check` | Vérification complète carte-first |

Les commandes exactes de pipeline CSS restent gouvernées par `BOUTIQUE_CSS_PIPELINE.md` et le `package.json` courant. Ne pas recopier une ancienne commande `modal.css` depuis une doc historique.

---

## 4. Workflow type d'une PR modal

```bash
# 1. Lire carte + doctrine + owner
# 2. Modifier uniquement les owners concernés

cd public/boutique
npm run check:html
npm run check:imports
npm run check:body-classes
npm run deploy:css        # si CSS touché
npm run check:cache       # si CSS touché
npm run audit:arch

cd ../..
npm run gate:boutique-ownership
npm run gate:docs-lint
npm run gate:touched-files
npm run map:check
```

Anti-pattern interdit : modifier un source CSS sans régénérer le dist réellement livré.

---

## 5. Hiérarchie en cas de conflit

La hiérarchie racine est celle de `AGENTS.md` :

```text
1. Code de production
2. DB live
3. AGENTS.md
4. CARTE_FIRST_INDEX.md
5. features/*.feature.js
6. Doctrines actives
7. Générateurs
8. Sorties générées à jour
9. Archives
```

À l'intérieur des docs Boutique actives :

```text
BOUTIQUE_ARCHITECTURE.md
        ↓
BOUTIQUE_CSS_PIPELINE.md / BOUTIQUE_MODAL_ARCHITECTURE.md
        ↓
BOUTIQUE_COMPONENT_OWNERSHIP.md
        ↓
BOUTIQUE_ARCHITECTURE_LIVE.md (photo générée, jamais intention)
```

Si un conflit est trouvé, ne pas le contourner. Aligner la doc subordonnée ou changer explicitement l'intention dans la carte/doctrine de la même PR.

---

## 6. Que faire si...

| Situation | Action |
|---|---|
| Tu modifies du CSS Boutique | source owner → `deploy:css` → `check:cache` → `audit:arch` |
| `audit:arch` plante | lire le rapport et corriger l'ownership/la divergence avant de continuer |
| Tu modifies la modal produit | lire `DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` puis `BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Tu touches couleur/taille/stock | partir de `sellable_units` / SKU ; ne pas recréer un stock par axe dans la modal |
| Tu touches Standard/Express | le frontend rend `delivery_options` ; la décision appartient aux moteurs backend |
| Tu trouves un sélecteur dans deux fichiers | vérifier `BOUTIQUE_COMPONENT_OWNERSHIP.md` avant toute nouvelle règle |
| Tu veux toucher `b-pager.js`, `b-store.js` ou `b-scroll-owner.js` | PR isolée selon la règle Boutique correspondante |

---

## 7. Évolution de l'index

Toute nouvelle doc Boutique active doit avoir une place explicite ici ou être rattachée à une doctrine/carte existante.

Ne pas créer une doc satellite pour répéter une doctrine active. En cas de nouvelle frontière métier, modifier la doctrine propriétaire puis pointer les docs de zone vers elle.
